import { Buffer } from 'node:buffer';
import { cp, lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readCapabilityState,
  resolveCapabilityEnabled,
  setCapabilityEnabledState,
} from './capability-state-store.ts';
import { updateJsonObjectFile } from './json-file-store.ts';

export type CapabilityType = 'skill' | 'command';
export type CapabilitySourceKind = 'user' | 'project' | 'plugin' | 'builtin';

export type CapabilityItem = {
  id: string;
  type: CapabilityType;
  name: string;
  description: string;
  path: string;
  editable: boolean;
  enabled: boolean;
  source: {
    kind: CapabilitySourceKind;
    path: string;
    writable: boolean;
    reason?: string;
    pluginId?: string;
    pluginSourceKind?: string;
  };
};

type BuiltinCapabilitySource = {
  rootDir: string;
  scanDir: string;
  prefix?: string;
};

type PluginCapabilitySource = {
  id?: string;
  path: string;
  enabled?: boolean;
  sourceKind?: string;
};

type CapabilityFileNode = {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  children?: CapabilityFileNode[];
};

const BUILTIN_SKILLS_DIR = fileURLToPath(new URL('../../builtin-skills', import.meta.url));
const BUILTIN_PLUGINS_DIR = fileURLToPath(new URL('../../builtin-plugins', import.meta.url));

const VALID_TYPES = new Set<CapabilityType>(['skill', 'command']);
const WRITABLE_SOURCE_KINDS = new Set<CapabilitySourceKind>(['user', 'project']);
const MAX_CATALOG_CACHE_ENTRIES = 50;
const MAX_SCAN_DEPTH = 8;
const SKIPPED_SCAN_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.hg',
  '.pnpm',
  '.svn',
  '.venv',
  '.yarn',
  '__pycache__',
  'node_modules',
  'venv',
]);

const capabilityCatalogCache = new Map<string, CapabilityItem[]>();
const pendingCapabilityCatalogReads = new Map<string, Promise<CapabilityItem[]>>();

function createHttpError(message: string, statusCode = 500, code = 'Error') {
  const error = new Error(message) as Error & { statusCode?: number; code?: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertType(type: unknown = 'skill'): CapabilityType {
  if (type === 'skill' || type === 'command') {
    return type;
  }
  throw createHttpError('Capability type must be "skill" or "command".', 400);
}

function assertScope(scope: unknown): 'user' | 'project' {
  if (scope === 'user' || scope === 'project') {
    return scope;
  }
  throw createHttpError('Capability scope must be "user" or "project".', 400);
}

function encodeCapabilityId(payload: {
  type: CapabilityType;
  sourceKind: CapabilitySourceKind;
  filepath: string;
}) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCapabilityId(id: unknown): {
  type: CapabilityType;
  sourceKind: CapabilitySourceKind;
  filepath: string;
} {
  if (typeof id !== 'string' || !id.trim()) {
    throw createHttpError('Capability id is required.', 400);
  }
  try {
    const payload = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as {
      type?: unknown;
      sourceKind?: unknown;
      filepath?: unknown;
    };
    const type = assertType(payload.type);
    const sourceKind = payload.sourceKind;
    const filepath = payload.filepath;
    if (
      sourceKind !== 'user' &&
      sourceKind !== 'project' &&
      sourceKind !== 'plugin' &&
      sourceKind !== 'builtin'
    ) {
      throw new Error('invalid source');
    }
    if (typeof filepath !== 'string' || !isAbsolute(filepath)) {
      throw new Error('invalid filepath');
    }
    return { type, sourceKind, filepath };
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error;
    }
    throw createHttpError('Capability id is invalid.', 400);
  }
}

function isInside(parentPath: string, childPath: string) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith(sep);
}

function capabilityFolder(type: CapabilityType) {
  return type === 'skill' ? 'skills' : 'commands';
}

function normalizeName(name: unknown) {
  if (typeof name !== 'string') {
    throw createHttpError('Capability name is required.', 400);
  }
  const normalized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  if (!normalized || normalized === '.' || normalized === '..') {
    throw createHttpError('Capability name is required.', 400);
  }
  return normalized;
}

async function readDirSafe(pathname: string) {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(pathname, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldSkipScanDirectory(entry: { name: string; isSymbolicLink(): boolean }) {
  return entry.isSymbolicLink() || SKIPPED_SCAN_DIRECTORIES.has(entry.name.toLowerCase());
}

async function walkFiles(rootDir: string, matcher: (fileName: string) => boolean) {
  const found: string[] = [];

  async function visit(dirPath: string, depth: number) {
    if (depth > MAX_SCAN_DEPTH) {
      return;
    }
    const entries = await readDirSafe(dirPath);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipScanDirectory(entry)) {
          continue;
        }
        await visit(fullPath, depth + 1);
        continue;
      }
      if (entry.isFile() && matcher(entry.name)) {
        found.push(fullPath);
      }
    }
  }

  await visit(rootDir, 0);
  return found;
}

function stripFrontmatter(content: string) {
  if (!content.startsWith('---')) {
    return { metadata: {} as Record<string, string>, body: content };
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { metadata: {} as Record<string, string>, body: content };
  }
  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) {
      metadata[pair[1]] = pair[2].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return { metadata, body: content.slice(match[0].length) };
}

function extractDescription(content: string) {
  const { metadata, body } = stripFrontmatter(content);
  if (metadata.description) {
    return metadata.description;
  }
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('#'))
      .find(Boolean) || ''
  );
}

function sourceFor(sourceKind: CapabilitySourceKind, rootDir: string) {
  if (sourceKind === 'plugin' || sourceKind === 'builtin') {
    return {
      kind: sourceKind,
      path: rootDir,
      writable: false,
      reason:
        sourceKind === 'plugin'
          ? 'Plugin sources are read-only.'
          : 'Builtin sources are read-only.',
    };
  }
  return { kind: sourceKind, path: rootDir, writable: true };
}

async function listBuiltinCapabilitySources(): Promise<BuiltinCapabilitySource[]> {
  const sources: BuiltinCapabilitySource[] = [];
  sources.push({
    rootDir: BUILTIN_SKILLS_DIR,
    scanDir: BUILTIN_SKILLS_DIR,
  });
  const pluginEntries = await readDirSafe(BUILTIN_PLUGINS_DIR);
  for (const entry of pluginEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginRoot = join(BUILTIN_PLUGINS_DIR, entry.name);
    sources.push({
      rootDir: pluginRoot,
      scanDir: join(pluginRoot, capabilityFolder('skill')),
      prefix: entry.name,
    });
  }
  return sources;
}

function pluginSourceMeta(pluginSources: PluginCapabilitySource[] | undefined, rootDir: string) {
  return (
    pluginSources?.find((plugin) => resolve(plugin.path) === resolve(rootDir)) || {
      id: undefined,
      enabled: true,
      sourceKind: undefined,
    }
  );
}

function normalizePluginSources(input: {
  pluginSources?: PluginCapabilitySource[];
  pluginPaths?: string[];
}): PluginCapabilitySource[] {
  return input.pluginSources ?? (input.pluginPaths || []).map((path) => ({ path, enabled: true }));
}

function cloneCapability(capability: CapabilityItem): CapabilityItem {
  return {
    ...capability,
    source: { ...capability.source },
  };
}

function cloneCapabilities(capabilities: CapabilityItem[]) {
  return capabilities.map(cloneCapability);
}

function cacheKeyForCapabilities(input: {
  type: CapabilityType;
  homeDir: string;
  projectPath?: string;
  pluginSources: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
}) {
  return `${input.type}:${JSON.stringify({
    homeDir: resolve(input.homeDir),
    projectPath: input.projectPath ? resolve(input.projectPath) : '',
    pluginSources: input.pluginSources.map((plugin) => ({
      id: plugin.id || '',
      path: resolve(plugin.path),
      enabled: plugin.enabled !== false,
      sourceKind: plugin.sourceKind || '',
    })),
    builtinSources: input.builtinSources
      ? input.builtinSources.map((source) => ({
          rootDir: resolve(source.rootDir),
          scanDir: resolve(source.scanDir),
          prefix: source.prefix || '',
        }))
      : null,
  })}`;
}

function rememberCapabilityCatalog(cacheKey: string, capabilities: CapabilityItem[]) {
  if (
    !capabilityCatalogCache.has(cacheKey) &&
    capabilityCatalogCache.size >= MAX_CATALOG_CACHE_ENTRIES
  ) {
    const oldestKey = capabilityCatalogCache.keys().next().value;
    if (oldestKey) {
      capabilityCatalogCache.delete(oldestKey);
    }
  }
  capabilityCatalogCache.set(cacheKey, cloneCapabilities(capabilities));
}

export function clearCapabilityCatalogCache(input: { type?: CapabilityType } = {}) {
  if (!input.type) {
    capabilityCatalogCache.clear();
    pendingCapabilityCatalogReads.clear();
    return;
  }
  const prefix = `${input.type}:`;
  for (const key of capabilityCatalogCache.keys()) {
    if (key.startsWith(prefix)) {
      capabilityCatalogCache.delete(key);
    }
  }
  for (const key of pendingCapabilityCatalogReads.keys()) {
    if (key.startsWith(prefix)) {
      pendingCapabilityCatalogReads.delete(key);
    }
  }
}

function capabilityName(type: CapabilityType, filepath: string) {
  return type === 'skill' ? basename(dirname(filepath)) : basename(filepath, '.md');
}

function capabilityRootDir(type: CapabilityType, filepath: string) {
  return type === 'skill' ? dirname(resolve(filepath)) : resolve(filepath);
}

async function capabilityFromFile(input: {
  type: CapabilityType;
  filepath: string;
  sourceKind: CapabilitySourceKind;
  rootDir: string;
  enabled?: boolean;
  pluginId?: string;
  pluginSourceKind?: string;
}): Promise<CapabilityItem> {
  const filepath = resolve(input.filepath);
  const content = await readFile(filepath, 'utf8');
  return {
    id: encodeCapabilityId({
      type: input.type,
      sourceKind: input.sourceKind,
      filepath,
    }),
    type: input.type,
    name: capabilityName(input.type, filepath),
    description: extractDescription(content),
    path: filepath,
    source: {
      ...sourceFor(input.sourceKind, resolve(input.rootDir)),
      ...(input.pluginId ? { pluginId: input.pluginId } : {}),
      ...(input.pluginSourceKind ? { pluginSourceKind: input.pluginSourceKind } : {}),
    },
    editable: WRITABLE_SOURCE_KINDS.has(input.sourceKind),
    enabled: input.enabled !== false,
  };
}

async function scanSource(input: {
  type: CapabilityType;
  sourceKind: CapabilitySourceKind;
  rootDir: string;
  scanDir: string;
}) {
  const matcher =
    input.type === 'skill'
      ? (fileName: string) => fileName === 'SKILL.md'
      : (fileName: string) => fileName.endsWith('.md');
  const filepaths = await walkFiles(input.scanDir, matcher);
  return Promise.all(
    filepaths.map((filepath) =>
      capabilityFromFile({
        type: input.type,
        filepath,
        sourceKind: input.sourceKind,
        rootDir: input.rootDir,
      })
    )
  );
}

function ensureSingleTrailingNewline(content: unknown) {
  const value = typeof content === 'string' ? content : '';
  return `${value.replace(/\n*$/g, '')}\n`;
}

async function scanCapabilityFileTree(
  rootDir: string,
  currentDir = rootDir,
  depth = 0
): Promise<CapabilityFileNode[]> {
  if (depth > MAX_SCAN_DEPTH) {
    return [];
  }
  const entries = await readDirSafe(currentDir);
  const nodes = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      const relativePath = posix.normalize(relative(rootDir, fullPath).replace(/\\/g, '/'));
      if (entry.isDirectory()) {
        if (shouldSkipScanDirectory(entry)) {
          return null;
        }
        return {
          path: relativePath,
          name: entry.name,
          kind: 'directory' as const,
          children: await scanCapabilityFileTree(rootDir, fullPath, depth + 1),
        };
      }
      if (!entry.isFile()) {
        return null;
      }
      return {
        path: relativePath,
        name: entry.name,
        kind: 'file' as const,
      };
    })
  );
  return nodes.filter(Boolean).sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  }) as CapabilityFileNode[];
}

function normalizeCapabilityRelativePath(filepath: unknown) {
  if (typeof filepath !== 'string' || !filepath.trim()) {
    throw createHttpError('Capability file path is required.', 400);
  }
  const normalized = posix.normalize(filepath.replace(/\\/g, '/').trim());
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/')
  ) {
    throw createHttpError(`Capability file path is invalid: ${filepath}`, 400);
  }
  return normalized;
}

function capabilityStateFilePath(rootDir: string) {
  return join(rootDir, '.claude', 'capability-state.json');
}

function capabilityStateBucketKey(type: CapabilityType) {
  return type === 'skill' ? 'skills' : 'commands';
}

function capabilityStateKey(rootDir: string, filepath: string) {
  return relative(resolve(rootDir), resolve(filepath)).replace(/\\/g, '/');
}

async function clearCapabilityEnabledState(input: {
  type: CapabilityType;
  rootDir: string;
  filepath: string;
}) {
  const bucketKey = capabilityStateBucketKey(input.type);
  const stateKey = capabilityStateKey(input.rootDir, input.filepath);

  await updateJsonObjectFile(capabilityStateFilePath(resolve(input.rootDir)), (current) => {
    const currentBucket = current[bucketKey];
    if (!currentBucket || typeof currentBucket !== 'object' || Array.isArray(currentBucket)) {
      return current;
    }

    const bucket = { ...(currentBucket as Record<string, unknown>) };
    delete bucket[stateKey];
    return {
      ...current,
      [bucketKey]: bucket,
    };
  });
}

async function resolveCapabilityChildFile(input: {
  id: unknown;
  homeDir?: string;
  projectPath?: string;
  pluginPaths?: string[];
  builtinSources?: BuiltinCapabilitySource[];
  path?: unknown;
}) {
  const decoded = decodeCapabilityId(input.id);
  if (decoded.type !== 'skill') {
    throw createHttpError('Capability file operations only support skills.', 400);
  }
  const builtinSources = input.builtinSources || (await listBuiltinCapabilitySources());
  const managed = assertReadablePath({
    ...decoded,
    homeDir: resolve(input.homeDir || homedir()),
    projectPath: input.projectPath,
    pluginPaths: input.pluginPaths,
    builtinSources,
  });
  const rootDir = capabilityRootDir(decoded.type, managed.filepath);
  const relativePath = normalizeCapabilityRelativePath(input.path);
  const targetPath = resolve(rootDir, relativePath);
  if (!isInside(rootDir, targetPath) && resolve(rootDir) !== targetPath) {
    throw createHttpError('Capability file path is invalid.', 400);
  }
  return { decoded, managed, rootDir, relativePath, targetPath, builtinSources };
}

async function assertNoSymlinkTraversal(rootDir: string, relativePath: string) {
  let currentPath = resolve(rootDir);
  for (const segment of relativePath.split('/')) {
    currentPath = join(currentPath, segment);
    const entry = await lstat(currentPath);
    if (entry.isSymbolicLink()) {
      throw createHttpError('Capability file path cannot traverse symlinks.', 400);
    }
  }
}

function decodeTextFileContent(bytes: Buffer): { content: string; encoding: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      content: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf16le',
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      content: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf16be',
    };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      content: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'utf8-bom',
    };
  }
  return {
    content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    encoding: 'utf8',
  };
}

async function readEditableTextFile(filepath: string) {
  const bytes = await readFile(filepath);
  try {
    return decodeTextFileContent(bytes);
  } catch {
    throw createHttpError('Capability file does not support text editing.', 415);
  }
}

function encodeTextFileContent(content: string, encoding: string) {
  switch (encoding) {
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]);
    case 'utf16be': {
      const leBytes = Buffer.from(content, 'utf16le');
      const beBytes = Buffer.allocUnsafe(leBytes.length);
      for (let index = 0; index < leBytes.length; index += 2) {
        beBytes[index] = leBytes[index + 1] ?? 0;
        beBytes[index + 1] = leBytes[index];
      }
      return Buffer.concat([Buffer.from([0xfe, 0xff]), beBytes]);
    }
    case 'utf8-bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]);
    case 'utf8':
    default:
      return Buffer.from(content, 'utf8');
  }
}

async function resolveCapabilitySummary(input: {
  id: unknown;
  homeDir?: string;
  projectPath?: string;
  pluginPaths?: string[];
  pluginSources?: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
}) {
  const decoded = decodeCapabilityId(input.id);
  const builtinSources = input.builtinSources || (await listBuiltinCapabilitySources());
  const readable = assertReadablePath({
    ...decoded,
    homeDir: resolve(input.homeDir || homedir()),
    projectPath: input.projectPath,
    pluginPaths: input.pluginPaths,
    builtinSources,
  });
  const capability = await capabilityFromFile({
    type: decoded.type,
    filepath: readable.filepath,
    sourceKind: decoded.sourceKind,
    rootDir: readable.rootDir,
  });
  const pluginMeta = pluginSourceMeta(input.pluginSources, readable.rootDir);
  const pluginPrefix =
    decoded.sourceKind === 'plugin' ? pluginMeta.id?.split('@')[0]?.trim() || '' : '';
  const builtinPrefix =
    decoded.sourceKind === 'builtin'
      ? builtinSources.find((source) => resolve(source.rootDir) === resolve(readable.rootDir))
          ?.prefix || ''
      : '';
  const enabled =
    decoded.sourceKind === 'plugin'
      ? pluginMeta.enabled !== false
      : decoded.sourceKind === 'builtin'
        ? true
        : resolveCapabilityEnabled({
            type: decoded.type,
            rootDir: readable.rootDir,
            filepath: readable.filepath,
            state: await readCapabilityState(readable.rootDir),
          });
  return {
    decoded,
    readable,
    capability:
      decoded.sourceKind === 'plugin' && pluginPrefix
        ? {
            ...capability,
            name: `${pluginPrefix}:${capability.name}`,
            enabled,
            source: {
              ...capability.source,
              ...(pluginMeta.id ? { pluginId: pluginMeta.id } : {}),
              ...(pluginMeta.sourceKind ? { pluginSourceKind: pluginMeta.sourceKind } : {}),
            },
          }
        : decoded.sourceKind === 'builtin' && builtinPrefix
          ? {
              ...capability,
              name: `${builtinPrefix}:${capability.name}`,
              enabled,
            }
          : { ...capability, enabled },
  };
}

function writableRoot(input: {
  sourceKind: CapabilitySourceKind;
  homeDir: string;
  projectPath?: string;
}) {
  if (input.sourceKind === 'user') {
    return resolve(input.homeDir);
  }
  if (input.sourceKind === 'project') {
    if (!input.projectPath) {
      throw createHttpError('projectPath is required for project capability scope.', 400);
    }
    return resolve(input.projectPath);
  }
  throw createHttpError('Plugin capabilities are read-only.', 403);
}

function assertWritablePath(input: {
  type: CapabilityType;
  sourceKind: CapabilitySourceKind;
  filepath: string;
  homeDir: string;
  projectPath?: string;
}) {
  const rootDir = writableRoot(input);
  const managedDir = join(rootDir, '.claude', capabilityFolder(input.type));
  const filepath = resolve(input.filepath);
  if (!isInside(managedDir, filepath)) {
    throw createHttpError('Capability path is outside the managed source.', 403);
  }
  if (input.type === 'skill' && basename(filepath) !== 'SKILL.md') {
    throw createHttpError('Skill capability path must end with SKILL.md.', 400);
  }
  if (input.type === 'command' && extname(filepath) !== '.md') {
    throw createHttpError('Command capability path must be a markdown file.', 400);
  }
  return { rootDir, filepath };
}

function assertReadablePath(input: {
  type: CapabilityType;
  sourceKind: CapabilitySourceKind;
  filepath: string;
  homeDir: string;
  projectPath?: string;
  pluginPaths?: string[];
  builtinSources?: BuiltinCapabilitySource[];
}) {
  if (input.sourceKind !== 'plugin' && input.sourceKind !== 'builtin') {
    return assertWritablePath(input);
  }

  const filepath = resolve(input.filepath);
  if (input.sourceKind === 'plugin') {
    const pluginRoot = (input.pluginPaths || [])
      .map((pluginPath) => resolve(pluginPath))
      .find((root) => isInside(join(root, capabilityFolder(input.type)), filepath));
    if (!pluginRoot) {
      throw createHttpError('Capability path is outside enabled plugin sources.', 403);
    }
    return { rootDir: pluginRoot, filepath };
  }

  const builtinSource = (input.builtinSources || []).find((source) =>
    isInside(resolve(source.scanDir), filepath)
  );
  if (!builtinSource) {
    throw createHttpError('Capability path is outside builtin sources.', 403);
  }
  return { rootDir: builtinSource.rootDir, filepath };
}

async function scanCapabilities(input: {
  type: CapabilityType;
  homeDir: string;
  projectPath?: string;
  pluginSources: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
}) {
  const type = input.type;
  const homeDir = input.homeDir;
  const capabilities: CapabilityItem[] = [];
  const userState = await readCapabilityState(homeDir);
  capabilities.push(
    ...(
      await scanSource({
        type,
        sourceKind: 'user',
        rootDir: homeDir,
        scanDir: join(homeDir, '.claude', capabilityFolder(type)),
      })
    ).map((capability) => ({
      ...capability,
      enabled: resolveCapabilityEnabled({
        type,
        rootDir: homeDir,
        filepath: capability.path,
        state: userState,
      }),
    }))
  );

  if (input.projectPath) {
    const projectRoot = resolve(input.projectPath);
    const projectState = await readCapabilityState(projectRoot);
    capabilities.push(
      ...(
        await scanSource({
          type,
          sourceKind: 'project',
          rootDir: projectRoot,
          scanDir: join(projectRoot, '.claude', capabilityFolder(type)),
        })
      ).map((capability) => ({
        ...capability,
        enabled: resolveCapabilityEnabled({
          type,
          rootDir: projectRoot,
          filepath: capability.path,
          state: projectState,
        }),
      }))
    );
  }

  if (type === 'skill') {
    for (const builtinSource of input.builtinSources || (await listBuiltinCapabilitySources())) {
      capabilities.push(
        ...(
          await scanSource({
            type,
            sourceKind: 'builtin',
            rootDir: builtinSource.rootDir,
            scanDir: builtinSource.scanDir,
          })
        ).map((capability) => ({
          ...(builtinSource.prefix
            ? { ...capability, name: `${builtinSource.prefix}:${capability.name}` }
            : capability),
          enabled: true,
        }))
      );
    }
  }

  for (const plugin of input.pluginSources) {
    if (!plugin?.path) {
      continue;
    }
    const pluginRoot = resolve(plugin.path);
    const pluginPrefix =
      typeof plugin.id === 'string' && plugin.id.trim()
        ? plugin.id.split('@')[0]?.trim() || ''
        : '';
    const pluginEnabled = plugin.enabled !== false;
    const scanned = await scanSource({
      type,
      sourceKind: 'plugin',
      rootDir: pluginRoot,
      scanDir: join(pluginRoot, capabilityFolder(type)),
    });
    capabilities.push(
      ...scanned.map((capability) =>
        capability.source.kind === 'plugin'
          ? {
              ...capability,
              name: pluginPrefix ? `${pluginPrefix}:${capability.name}` : capability.name,
              enabled: pluginEnabled,
              source: {
                ...capability.source,
                ...(plugin.id ? { pluginId: plugin.id } : {}),
                ...(plugin.sourceKind ? { pluginSourceKind: plugin.sourceKind } : {}),
              },
            }
          : capability
      )
    );
  }

  return capabilities;
}

export async function listCapabilities(
  input: {
    type?: unknown;
    homeDir?: string;
    projectPath?: string;
    pluginPaths?: string[];
    pluginSources?: PluginCapabilitySource[];
    builtinSources?: BuiltinCapabilitySource[];
    forceRefresh?: boolean;
  } = {}
) {
  const type = assertType(input.type);
  const homeDir = resolve(input.homeDir || homedir());
  const pluginSources = normalizePluginSources(input);
  const cacheKey = cacheKeyForCapabilities({
    type,
    homeDir,
    projectPath: input.projectPath,
    pluginSources,
    builtinSources: input.builtinSources,
  });

  if (input.forceRefresh) {
    capabilityCatalogCache.delete(cacheKey);
    pendingCapabilityCatalogReads.delete(cacheKey);
  } else {
    const cached = capabilityCatalogCache.get(cacheKey);
    if (cached) {
      return cloneCapabilities(cached);
    }
    const pending = pendingCapabilityCatalogReads.get(cacheKey);
    if (pending) {
      return cloneCapabilities(await pending);
    }
  }

  const pending = scanCapabilities({
    type,
    homeDir,
    projectPath: input.projectPath,
    pluginSources,
    builtinSources: input.builtinSources,
  });
  pendingCapabilityCatalogReads.set(cacheKey, pending);
  try {
    const capabilities = await pending;
    rememberCapabilityCatalog(cacheKey, capabilities);
    return cloneCapabilities(capabilities);
  } finally {
    pendingCapabilityCatalogReads.delete(cacheKey);
  }
}

export async function createCapability(
  input: {
    type?: unknown;
    scope?: unknown;
    homeDir?: string;
    projectPath?: string;
    name?: unknown;
    content?: unknown;
  } = {}
) {
  const type = assertType(input.type);
  const scope = assertScope(input.scope || 'user');
  const homeDir = resolve(input.homeDir || homedir());
  const rootDir = scope === 'project' ? resolve(input.projectPath || '') : homeDir;
  if (scope === 'project' && !input.projectPath) {
    throw createHttpError('projectPath is required for project capability scope.', 400);
  }
  const safeName = normalizeName(input.name);
  const filepath =
    type === 'skill'
      ? join(rootDir, '.claude', 'skills', safeName, 'SKILL.md')
      : join(rootDir, '.claude', 'commands', `${safeName}.md`);

  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, ensureSingleTrailingNewline(input.content), 'utf8');
  clearCapabilityCatalogCache({ type });
  return capabilityFromFile({ type, filepath, sourceKind: scope, rootDir });
}

export async function importSkillDirectory(input: {
  scope?: unknown;
  homeDir?: string;
  projectPath?: string;
  sourceDir?: unknown;
}) {
  const scope = assertScope(input.scope || 'user');
  const homeDir = resolve(input.homeDir || homedir());
  const rootDir = scope === 'project' ? resolve(input.projectPath || '') : homeDir;
  if (scope === 'project' && !input.projectPath) {
    throw createHttpError('projectPath is required for project capability scope.', 400);
  }

  if (typeof input.sourceDir !== 'string' || !input.sourceDir.trim()) {
    throw createHttpError('sourceDir is required.', 400);
  }

  const sourceDir = resolve(input.sourceDir);
  let sourceStats;
  try {
    sourceStats = await stat(sourceDir);
  } catch {
    throw createHttpError('sourceDir does not exist.', 400);
  }
  if (!sourceStats.isDirectory()) {
    throw createHttpError('sourceDir must be a directory.', 400);
  }

  const sourceSkillFile = join(sourceDir, 'SKILL.md');
  let skillFileStats;
  try {
    skillFileStats = await stat(sourceSkillFile);
  } catch {
    throw createHttpError('sourceDir must contain SKILL.md.', 400);
  }
  if (!skillFileStats.isFile()) {
    throw createHttpError('sourceDir must contain SKILL.md.', 400);
  }

  const safeName = normalizeName(basename(sourceDir));
  const targetDir = join(rootDir, '.claude', 'skills', safeName);
  try {
    await stat(targetDir);
    throw createHttpError(`Skill "${safeName}" already exists.`, 409);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
  }

  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, errorOnExist: true, force: false });
  clearCapabilityCatalogCache({ type: 'skill' });

  return capabilityFromFile({
    type: 'skill',
    filepath: join(targetDir, 'SKILL.md'),
    sourceKind: scope,
    rootDir,
  });
}

function normalizeImportedSkillFilepath(filepath: unknown) {
  if (typeof filepath !== 'string' || !filepath.trim()) {
    throw createHttpError('Imported skill file path is required.', 400);
  }
  const normalized = posix.normalize(filepath.replace(/\\/g, '/').trim());
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/')
  ) {
    throw createHttpError(`Imported skill file path is invalid: ${filepath}`, 400);
  }
  return normalized;
}

export async function importSkillBundle(input: {
  scope?: unknown;
  homeDir?: string;
  projectPath?: string;
  name?: unknown;
  files?: unknown;
}) {
  const scope = assertScope(input.scope || 'user');
  const homeDir = resolve(input.homeDir || homedir());
  const rootDir = scope === 'project' ? resolve(input.projectPath || '') : homeDir;
  if (scope === 'project' && !input.projectPath) {
    throw createHttpError('projectPath is required for project capability scope.', 400);
  }

  const safeName = normalizeName(input.name);
  const files = Array.isArray(input.files) ? input.files : null;
  if (!files?.length) {
    throw createHttpError('files are required.', 400);
  }

  const targetDir = join(rootDir, '.claude', 'skills', safeName);
  try {
    await stat(targetDir);
    throw createHttpError(`Skill "${safeName}" already exists.`, 409);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
  }

  const normalizedFiles = files.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw createHttpError('Imported skill file entry is invalid.', 400);
    }
    const filepath = normalizeImportedSkillFilepath((entry as { path?: unknown }).path);
    const contentBase64 = (entry as { contentBase64?: unknown }).contentBase64;
    if (typeof contentBase64 !== 'string') {
      throw createHttpError(`Imported skill file content is required for ${filepath}.`, 400);
    }
    return { path: filepath, contentBase64 };
  });

  if (!normalizedFiles.some((entry) => entry.path === 'SKILL.md')) {
    throw createHttpError('Imported skill files must contain a top-level SKILL.md.', 400);
  }

  await mkdir(targetDir, { recursive: true });
  try {
    for (const file of normalizedFiles) {
      const targetPath = join(targetDir, file.path);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, Buffer.from(file.contentBase64, 'base64'));
    }
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }
  clearCapabilityCatalogCache({ type: 'skill' });

  return capabilityFromFile({
    type: 'skill',
    filepath: join(targetDir, 'SKILL.md'),
    sourceKind: scope,
    rootDir,
  });
}

export async function readCapability(input: {
  id: unknown;
  homeDir?: string;
  projectPath?: string;
  pluginPaths?: string[];
  pluginSources?: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
}) {
  const { decoded, readable, capability } = await resolveCapabilitySummary(input);
  return {
    capability,
    content: await readFile(readable.filepath, 'utf8'),
    ...(decoded.type === 'skill'
      ? {
          rootDir: capabilityRootDir(decoded.type, readable.filepath),
          selectedFilePath: 'SKILL.md',
          files: await scanCapabilityFileTree(capabilityRootDir(decoded.type, readable.filepath)),
        }
      : {}),
  };
}

export async function readCapabilityFile(input: {
  id: unknown;
  homeDir?: string;
  projectPath?: string;
  pluginPaths?: string[];
  pluginSources?: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
  path?: unknown;
}) {
  const { rootDir, relativePath, targetPath } = await resolveCapabilityChildFile(input);
  await assertNoSymlinkTraversal(rootDir, relativePath);
  const fileStats = await stat(targetPath);
  if (!fileStats.isFile()) {
    throw createHttpError('Capability file must be a regular file.', 400);
  }
  const capability = (await resolveCapabilitySummary({
    id: input.id,
    homeDir: input.homeDir,
    projectPath: input.projectPath,
    pluginPaths: input.pluginPaths,
    pluginSources: input.pluginSources,
    builtinSources: input.builtinSources,
  })).capability;
  const file = await readEditableTextFile(targetPath);
  return {
    capability,
    rootDir,
    path: relativePath,
    content: file.content,
    encoding: file.encoding,
  };
}

export async function updateCapability(input: {
  id: unknown;
  content?: unknown;
  homeDir?: string;
  projectPath?: string;
}) {
  const decoded = decodeCapabilityId(input.id);
  const managed = assertWritablePath({
    ...decoded,
    homeDir: resolve(input.homeDir || homedir()),
    projectPath: input.projectPath,
  });
  await writeFile(managed.filepath, ensureSingleTrailingNewline(input.content), 'utf8');
  clearCapabilityCatalogCache({ type: decoded.type });
  return capabilityFromFile({
    type: decoded.type,
    filepath: managed.filepath,
    sourceKind: decoded.sourceKind,
    rootDir: managed.rootDir,
  });
}

export async function updateCapabilityFile(input: {
  id: unknown;
  content?: unknown;
  homeDir?: string;
  projectPath?: string;
  pluginPaths?: string[];
  pluginSources?: PluginCapabilitySource[];
  builtinSources?: BuiltinCapabilitySource[];
  path?: unknown;
}) {
  const { decoded, targetPath, relativePath } = await resolveCapabilityChildFile(input);
  if (!WRITABLE_SOURCE_KINDS.has(decoded.sourceKind)) {
    throw createHttpError('Capability source is read-only.', 403);
  }
  const rootDir = capabilityRootDir(decoded.type, decoded.filepath);
  await assertNoSymlinkTraversal(rootDir, relativePath);
  const fileStats = await stat(targetPath);
  if (!fileStats.isFile()) {
    throw createHttpError('Capability file must be a regular file.', 400);
  }
  const existingFile = await readEditableTextFile(targetPath);
  await writeFile(
    targetPath,
    encodeTextFileContent(
      ensureSingleTrailingNewline(input.content),
      existingFile.encoding
    )
  );
  clearCapabilityCatalogCache({ type: decoded.type });
  const capability = (await resolveCapabilitySummary({
    id: input.id,
    homeDir: input.homeDir,
    projectPath: input.projectPath,
    pluginPaths: input.pluginPaths,
    pluginSources: input.pluginSources,
    builtinSources: input.builtinSources,
  })).capability;
  return {
    capability,
    path: relativePath,
  };
}

export async function setCapabilityEnabled(input: {
  id: unknown;
  enabled?: unknown;
  homeDir?: string;
  projectPath?: string;
}) {
  const decoded = decodeCapabilityId(input.id);
  const managed = assertWritablePath({
    ...decoded,
    homeDir: resolve(input.homeDir || homedir()),
    projectPath: input.projectPath,
  });
  await setCapabilityEnabledState({
    type: decoded.type,
    rootDir: managed.rootDir,
    filepath: managed.filepath,
    enabled: Boolean(input.enabled),
  });
  clearCapabilityCatalogCache({ type: decoded.type });
  return capabilityFromFile({
    type: decoded.type,
    filepath: managed.filepath,
    sourceKind: decoded.sourceKind,
    rootDir: managed.rootDir,
    enabled: Boolean(input.enabled),
  });
}

export async function deleteCapability(input: {
  id: unknown;
  homeDir?: string;
  projectPath?: string;
}) {
  const decoded = decodeCapabilityId(input.id);
  const managed = assertWritablePath({
    ...decoded,
    homeDir: resolve(input.homeDir || homedir()),
    projectPath: input.projectPath,
  });
  await clearCapabilityEnabledState({
    type: decoded.type,
    rootDir: managed.rootDir,
    filepath: managed.filepath,
  });
  await rm(decoded.type === 'skill' ? dirname(managed.filepath) : managed.filepath, {
    force: true,
    recursive: decoded.type === 'skill',
  });
  clearCapabilityCatalogCache({ type: decoded.type });
  return { deleted: true };
}
