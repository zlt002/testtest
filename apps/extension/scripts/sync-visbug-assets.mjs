import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VISBUG_LIB_VERSION = '0.2.21-pre.2';
const VISBUG_LIB_META_URL = `https://unpkg.com/visbug-lib@${VISBUG_LIB_VERSION}/app/?meta`;
const HOTKEYS_JS_VERSION = '3.6.2';
const BLINGBLINGJS_VERSION = '2.1.0';
const TINYCOLOR_VERSION = '2.4.0';
const QUERY_SELECTOR_SHADOW_DOM_VERSION = '0.3.2';
const TINYCOLOR_META_URL = `https://unpkg.com/@ctrl/tinycolor@${TINYCOLOR_VERSION}/es/?meta`;
const VENDOR_ROOT = new URL('../public/page-edit/vendor/', import.meta.url);
const APP_PREFIX = '/app/';
const JS_EXTENSIONS = ['.js', '.mjs', '.cjs'];
const ASSET_ALLOWLIST_PREFIXES = [
  '/app/components/',
  '/app/features/',
  '/app/plugins/',
  '/app/utilities/',
];
const ASSET_ALLOWLIST_FILES = new Set([
  '/app/index.js',
  '/app/bundle.css',
  '/app/extension.css',
  '/app/index.css',
  '/app/blingbling.js',
  '/app/npm.js',
]);
const BARE_SPECIFIER_REWRITES = new Map([
  ['blingblingjs', '/app/vendor-deps/blingblingjs.js'],
  ['blingblingjs/src/index.js', '/app/vendor-deps/blingblingjs.js'],
  ['hotkeys-js', '/app/vendor-deps/hotkeys-js.js'],
  ['@ctrl/tinycolor', '/app/vendor-deps/tinycolor/public_api.js'],
  ['query-selector-shadow-dom', '/app/vendor-deps/query-selector-shadow-dom.js'],
]);
const DYNAMIC_IMPORT_ALLOWLIST = new Set(['/app/plugins/_dynamic-registery.js']);

function normalizeAppPath(filePath) {
  return filePath.startsWith(APP_PREFIX) ? filePath : `${APP_PREFIX}${filePath.replace(/^\/+/, '')}`;
}

export function shouldSyncFile(filePath) {
  if (filePath.endsWith('.test.js')) {
    return false;
  }

  return (
    ASSET_ALLOWLIST_FILES.has(filePath) ||
    ASSET_ALLOWLIST_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch text from ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch binary from ${url}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isJavaScriptFile(filePath) {
  return JS_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function toVendorRelativePath(filePath) {
  return filePath.replace(/^\/+/, '');
}

function resolveRelativeImport(fromFilePath, specifier, appFileSet) {
  if (!specifier.startsWith('.')) {
    return specifier;
  }

  if (/\.(js|mjs|cjs|json)$/i.test(specifier)) {
    return specifier;
  }

  if (/\.css$/i.test(specifier)) {
    return `${specifier}.js`;
  }

  const sourceDirectory = path.posix.dirname(fromFilePath);
  const resolvedBase = path.posix.normalize(path.posix.join(sourceDirectory, specifier));

  const jsCandidate = normalizeAppPath(`${resolvedBase}.js`);
  if (appFileSet.has(jsCandidate)) {
    return `${specifier}.js`;
  }

  const indexCandidate = normalizeAppPath(path.posix.join(resolvedBase, 'index.js'));
  if (appFileSet.has(indexCandidate)) {
    return `${specifier.replace(/\/+$/, '')}/index.js`;
  }

  return specifier;
}

function toRelativeSpecifier(fromFilePath, absoluteTargetPath) {
  const fromDirectory = path.posix.dirname(fromFilePath);
  let relativePath = path.posix.relative(fromDirectory, absoluteTargetPath);
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath;
}

function rewriteJavaScriptImports(source, fromFilePath, appFileSet) {
  const fromRegex = /(\b(?:import|export)\s[^'"]*?\bfrom\s*['"])([^'"]+)(['"])/g;
  const sideEffectImportRegex = /(\bimport\s*['"])([^'"]+)(['"])/g;
  const dynamicImportRegex = /(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g;

  const rewrite = (_match, prefix, specifier, suffix) => {
    if (BARE_SPECIFIER_REWRITES.has(specifier)) {
      return `${prefix}${toRelativeSpecifier(fromFilePath, BARE_SPECIFIER_REWRITES.get(specifier))}${suffix}`;
    }
    return `${prefix}${resolveRelativeImport(fromFilePath, specifier, appFileSet)}${suffix}`;
  };

  return source
    .replace(fromRegex, rewrite)
    .replace(sideEffectImportRegex, rewrite)
    .replace(dynamicImportRegex, rewrite);
}

function guardCustomElementRegistrations(source) {
  return source.replace(
    /customElements\.define\((['"`])([^'"`]+)\1,\s*([A-Za-z_$][\w$]*)\)/g,
    (_match, _quote, tagName, classIdentifier) => `;(() => {
  const registry =
    globalThis.customElements ??
    globalThis.window?.customElements ??
    globalThis.document?.defaultView?.customElements;

  if (!registry) {
    throw new Error('Custom Elements registry is unavailable');
  }

  if (!registry.get('${tagName}')) {
    registry.define('${tagName}', ${classIdentifier});
  }
})()`
  );
}

function applyVisbugSourceFixups(source, filePath) {
  let nextSource = source;

  if (filePath === '/app/components/index.js') {
    nextSource = nextSource.replace(
      /\/\/export\s+\{\s*Hotkeys\s*\}\s+from\s+['"]\.\/hotkey-map\/hotkeys\.element(?:\.js)?['"]/,
      "export { Hotkeys }    from './hotkey-map/hotkeys.element.js'"
    );
  }

  if (filePath === '/app/vendor-deps/blingblingjs.js') {
    nextSource = nextSource.replace(
      /: query instanceof HTMLElement \|\| query instanceof SVGElement\s*\n\s*\? \[query\]/,
      `: !!query &&
      typeof query === 'object' &&
      query.nodeType === Node.ELEMENT_NODE &&
      typeof query.nodeName === 'string'
      ? [query]`
    );
  }

  if (filePath === '/app/components/vis-bug/vis-bug.element.js') {
    nextSource = nextSource
      .replaceAll('type="color" value=""', 'type="color"')
      .replace(/\n\s*\$\{this\.demoTip\(\{key, \.\.\.tool\}\)\}/, '')
      .replace(
        /demoTip\(\{key, tool, label, description, instruction\}\) \{[\s\S]*?\n  \}\n\n  move\(\) \{/,
        `move() {`
      );
  }

  if (filePath === '/app/components/vis-bug/vis-bug.element.css') {
    nextSource = nextSource.replace(
      `    will-change: transform, opacity;

    & > figure {
      margin: 0;
      display: grid;
    }`,
      `    will-change: transform, opacity;
    width: min(28rem, calc(100vw - 5rem));
    min-width: 22rem;

    & > figure {
      margin: 0;
      display: grid;
      min-height: auto;
      background:
        linear-gradient(180deg, hsla(0, 0%, 100%, 0.98) 0%, hsla(0, 0%, 100%, 0.92) 100%);
    }`
    );
  }

  if (filePath === '/app/components/vis-bug/model.js') {
    nextSource = nextSource
      .replace("label:       'Guides',", "label:       '参考线',")
      .replace("description: 'Verify alignment & measure distances',", "description: '查看对齐情况并测量元素间距',")
      .replaceAll('<b>Element Guides:</b>', '<b>元素参考线：</b>')
      .replaceAll('<span>hover</span>', '<span>悬停</span>')
      .replaceAll('<b>Measure:</b>', '<b>测量：</b>')
      .replaceAll('<span>click+hover</span>', '<span>点击后悬停</span>')
      .replaceAll('<b>Sticky Measurements:</b>', '<b>固定测量：</b>')
      .replaceAll('<span>shift+click</span>', '<span>Shift + 点击</span>')
      .replace("label:       'Inspect',", "label:       '检查样式',")
      .replace("description: 'Peek into common & current styles of an element',", "description: '查看元素当前样式和常用样式信息',")
      .replaceAll('<b>Pin it:</b>', '<b>固定显示：</b>')
      .replace("label:       'Accessibility',", "label:       '无障碍',")
      .replace("description: 'Peek into A11y attributes & compliance status',", "description: '查看无障碍属性与合规状态',")
      .replace("label:       'Move',", "label:       '移动',")
      .replace("description: 'Move elements laterally or in, out, over, and under',", "description: '移动元素位置，调整层级和容器内外关系',")
      .replaceAll('<b>Lateral:</b>', '<b>横向移动：</b>')
      .replace('<span>click container ⇒ drag child</span>', '<span>点击容器后拖动子元素</span>')
      .replace('<b>Out and above:</b>', '<b>移出并上移：</b>')
      .replace('<b>Down+in, out+under:</b>', '<b>下移/移入/置底：</b>')
      .replaceAll('<b>Trainer:</b>', '<b>提示：</b>')
      .replace("label:       'Margin',", "label:       '外边距',")
      .replace("description: 'Add or subtract outer space from any or all sides of the selected element(s)',", "description: '增加或减少所选元素四周的外部留白',")
      .replace('<b>+ Margin:</b>', '<b>增加外边距：</b>')
      .replace('<b>- Margin:</b>', '<b>减少外边距：</b>')
      .replaceAll('<b>All Sides:</b>', '<b>四边同时：</b>')
      .replace("label:       'Padding',", "label:       '内边距',")
      .replace("description: `Add or subtract inner space from any or all sides of the selected element(s)`", "description: `增加或减少所选元素四周的内部留白`")
      .replace('<b>+ Padding:</b>', '<b>增加内边距：</b>')
      .replace('<b>- Padding:</b>', '<b>减少内边距：</b>')
      .replace("label:       'Flexbox Align',", "label:       '弹性布局',")
      .replace("description: `Create or modify flexbox direction, distribution, order & wrapping`", "description: `创建或调整 Flex 布局方向、分布、顺序与换行`")
      .replace('<b>Rows:</b>', '<b>横向排列：</b>')
      .replace('<b>Columns:</b>', '<b>纵向排列：</b>')
      .replaceAll('<b>Alignment:</b>', '<b>对齐：</b>')
      .replace('<b>Distribution:</b>', '<b>分布：</b>')
      .replace('<b>Order:</b>', '<b>顺序：</b>')
      .replace('<b>Wrapping:</b>', '<b>换行：</b>')
      .replace("label:       'Hue Shift',", "label:       '颜色调整',")
      .replace("description: `Change foreground/background hue, brightness, saturation & opacity`", "description: `调整前景色、背景色的色相、亮度、饱和度与透明度`")
      .replace('<b>Saturation:</b>', '<b>饱和度：</b>')
      .replace('<b>Brightness:</b>', '<b>亮度：</b>')
      .replace('<b>Hue:</b>', '<b>色相：</b>')
      .replace('<b>Opacity:</b>', '<b>透明度：</b>')
      .replace("label:       'Shadow',", "label:       '阴影',")
      .replace("description: `Create & adjust position, blur & opacity of a box shadow`", "description: `创建并调整阴影的位置、模糊和透明度`")
      .replace('<b>X/Y Position:</b>', '<b>X/Y 位置：</b>')
      .replace('<b>Blur:</b>', '<b>模糊：</b>')
      .replace('<b>Spread:</b>', '<b>扩散：</b>')
      .replace("label:       'Position',", "label:       '定位',")
      .replace("description: 'Move svg (x,y) and elements (top,left,bottom,right)',", "description: '调整 SVG 的 x/y，以及元素的 top/left/bottom/right',")
      .replace('<b>Nudge:</b>', '<b>微调：</b>')
      .replace('<b>Move:</b>', '<b>移动：</b>')
      .replace('<span>Click & drag</span>', '<span>点击并拖动</span>')
      .replace("label:       'Font Styles',", "label:       '字体样式',")
      .replace("description: 'Change size, alignment, leading, letter-spacing, & weight',", "description: '调整字号、对齐、行高、字距和字重',")
      .replace('<b>Size:</b>', '<b>字号：</b>')
      .replace('<b>Leading:</b>', '<b>行高：</b>')
      .replace('<b>Letter-spacing:</b>', '<b>字间距：</b>')
      .replace('<b>Weight:</b>', '<b>字重：</b>')
      .replace("label:       'Edit Text',", "label:       '编辑文本',")
      .replace("description: 'Change any text on the page with a <b>double click</b>',", "description: '在页面上<b>双击</b>即可直接修改文本',")
      .replace("label:       'Search',", "label:       '搜索元素',")
      .replace("description: 'Select elements programatically by searching for them or use built in plugins with special commands',", "description: '通过搜索条件选择元素，或使用内置命令触发特殊插件能力',");
  }

  return guardCustomElementRegistrations(nextSource);
}

function applyVisbugCssFixups(cssText, filePath) {
  return applyVisbugSourceFixups(cssText, filePath);
}

function validateJavaScriptFile(source, filePath) {
  if (filePath.endsWith('.css.js')) {
    return;
  }

  const unresolvedBareSpecifiers = Array.from(source.matchAll(/(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g))
    .map((match) => match[1] || match[2] || match[3])
    .filter(Boolean)
    .filter((specifier) => !specifier.startsWith('.') && !/^(data:|https?:)/.test(specifier));

  if (unresolvedBareSpecifiers.length > 0) {
    throw new Error(
      `Unresolved bare specifiers remain in ${filePath}: ${unresolvedBareSpecifiers.join(', ')}`
    );
  }

  const unresolvedRelativeImports = Array.from(
    source.matchAll(/(?:import|export)\s[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)
  )
    .map((match) => match[1] || match[2] || match[3])
    .filter(Boolean)
    .filter((specifier) => !/\.(js|mjs|cjs|css\.js|json)$/i.test(specifier));

  if (unresolvedRelativeImports.length > 0) {
    throw new Error(
      `Unresolved relative specifiers remain in ${filePath}: ${unresolvedRelativeImports.join(', ')}`
    );
  }

  const templateImports = Array.from(source.matchAll(/\bimport\s*\(\s*`([^`]+)`\s*\)/g)).map(
    (match) => match[1]
  );
  if (templateImports.length > 0 && !DYNAMIC_IMPORT_ALLOWLIST.has(filePath)) {
    throw new Error(`Template dynamic import requires explicit allowlist in ${filePath}`);
  }
}

const CSS_IMPORT_REGEX =
  /(^|\n)\s*@import\s+(?:url\(\s*)?['"]?([^'"()\s;]+)['"]?\s*\)?\s*;/g;

function resolveCssImportPath(fromFilePath, specifier, appFileSet) {
  if (/^(https?:|data:)/i.test(specifier)) {
    return null;
  }

  if (specifier.startsWith('.')) {
    return normalizeAppPath(path.posix.normalize(path.posix.join(path.posix.dirname(fromFilePath), specifier)));
  }

  const appRelativePath = normalizeAppPath(specifier);
  if (appFileSet.has(appRelativePath)) {
    return appRelativePath;
  }

  const cssCandidate = normalizeAppPath(`${specifier}.css`);
  if (appFileSet.has(cssCandidate)) {
    return cssCandidate;
  }

  const indexCandidate = normalizeAppPath(path.posix.join(specifier, 'index.css'));
  if (appFileSet.has(indexCandidate)) {
    return indexCandidate;
  }

  return null;
}

async function inlineCssImports(cssText, fromFilePath, appFileSet, cssCache, activeStack = []) {
  let output = '';
  let lastIndex = 0;
  let match;

  CSS_IMPORT_REGEX.lastIndex = 0;

  while ((match = CSS_IMPORT_REGEX.exec(cssText)) !== null) {
    const [fullMatch, leadingWhitespace, specifier] = match;
    const importStart = match.index + leadingWhitespace.length;
    output += cssText.slice(lastIndex, importStart);
    lastIndex = match.index + fullMatch.length;

    const resolvedImportPath = resolveCssImportPath(fromFilePath, specifier, appFileSet);
    if (!resolvedImportPath) {
      output += `${leadingWhitespace}/* unsupported @import ${specifier} removed during sync */`;
      continue;
    }

    if (activeStack.includes(resolvedImportPath)) {
      throw new Error(
        `Circular CSS import detected: ${[...activeStack, resolvedImportPath].join(' -> ')}`
      );
    }

    let importedCss = cssCache.get(resolvedImportPath);
    if (importedCss == null) {
      const importedSource = await fetchText(
        `https://unpkg.com/visbug-lib@${VISBUG_LIB_VERSION}${resolvedImportPath}`
      );
      importedCss = await inlineCssImports(
        importedSource,
        resolvedImportPath,
        appFileSet,
        cssCache,
        [...activeStack, resolvedImportPath]
      );
      cssCache.set(resolvedImportPath, importedCss);
    }

    output += `${leadingWhitespace}/* inlined from ${specifier} */\n${importedCss}`;
  }

  output += cssText.slice(lastIndex);
  return output;
}

async function writeVendorFile(relativePath, contents) {
  const outputUrl = new URL(relativePath, VENDOR_ROOT);
  const directoryUrl = new URL(`${path.posix.dirname(relativePath)}/`, VENDOR_ROOT);
  await mkdir(directoryUrl, { recursive: true });
  await writeFile(outputUrl, contents);
}

async function writeCssModule(relativeCssPath, cssText) {
  const modulePath = `${relativeCssPath}.js`;
  const moduleSource = `export default ${JSON.stringify(cssText)};\n`;
  await writeVendorFile(modulePath, moduleSource);
}

async function syncTinycolorDependency() {
  const meta = await fetchJson(TINYCOLOR_META_URL);
  const entries = meta.files.filter((entry) => entry.path.endsWith('.js'));
  const fileSet = new Set(
    entries.map((entry) => `/app/vendor-deps/tinycolor/${path.posix.basename(entry.path)}`)
  );

  await Promise.all(
    entries.map(async (entry) => {
      const source = await fetchText(
        `https://unpkg.com/@ctrl/tinycolor@${TINYCOLOR_VERSION}${entry.path}`
      );
      const targetPath = `/app/vendor-deps/tinycolor/${path.posix.basename(entry.path)}`;
      const rewritten = rewriteJavaScriptImports(source, targetPath, fileSet);
      validateJavaScriptFile(rewritten, targetPath);
      await writeVendorFile(targetPath.replace(/^\/+/, ''), rewritten);
    })
  );
}

async function main() {
  const meta = await fetchJson(VISBUG_LIB_META_URL);
  const files = meta.files.filter((entry) => shouldSyncFile(entry.path));
  const appFileSet = new Set(files.map((entry) => normalizeAppPath(entry.path)));
  const cssCache = new Map();

  await rm(VENDOR_ROOT, { recursive: true, force: true });
  await mkdir(VENDOR_ROOT, { recursive: true });

  await writeVendorFile(
    'app/vendor-deps/hotkeys-js.js',
    await fetchText(`https://unpkg.com/hotkeys-js@${HOTKEYS_JS_VERSION}/dist/hotkeys.esm.js`)
  );
  await writeVendorFile(
    'app/vendor-deps/blingblingjs.js',
    applyVisbugSourceFixups(
      await fetchText(`https://unpkg.com/blingblingjs@${BLINGBLINGJS_VERSION}/src/index.js`),
      '/app/vendor-deps/blingblingjs.js'
    )
  );
  await syncTinycolorDependency();
  await writeVendorFile(
    'app/vendor-deps/query-selector-shadow-dom.js',
    await fetchText(
      `https://unpkg.com/query-selector-shadow-dom@${QUERY_SELECTOR_SHADOW_DOM_VERSION}/src/querySelectorDeep.js`
    )
  );

  await Promise.all(
    files.map(async (entry) => {
      const relativePath = toVendorRelativePath(entry.path);
      const upstreamUrl = `https://unpkg.com/visbug-lib@${VISBUG_LIB_VERSION}${entry.path}`;

      if (isJavaScriptFile(entry.path)) {
        const original = await fetchText(upstreamUrl);
        const rewritten = applyVisbugSourceFixups(
          rewriteJavaScriptImports(original, entry.path, appFileSet),
          entry.path
        );
        validateJavaScriptFile(rewritten, entry.path);
        await writeVendorFile(relativePath, rewritten);
        return;
      }

      if (entry.type.startsWith('image/')) {
        const buffer = await fetchBuffer(upstreamUrl);
        await writeVendorFile(relativePath, buffer);
        return;
      }

      const text = await fetchText(upstreamUrl);
      if (entry.path.endsWith('.css')) {
        const flattenedCss = await inlineCssImports(text, entry.path, appFileSet, cssCache, [
          entry.path,
        ]);
        const fixedCss = applyVisbugCssFixups(flattenedCss, entry.path);
        cssCache.set(entry.path, fixedCss);
        await writeVendorFile(relativePath, fixedCss);
        await writeCssModule(relativePath, fixedCss);
        return;
      }

      await writeVendorFile(relativePath, text);
    })
  );

  console.log(`[page-edit] synced ${files.length} upstream assets into ${new URL('.', VENDOR_ROOT).pathname}`);
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error('[page-edit] vendor asset sync failed');
    console.error(error);
    process.exitCode = 1;
  });
}
