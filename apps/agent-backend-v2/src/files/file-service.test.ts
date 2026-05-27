import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFileService } from './file-service.ts';

async function trySymlink(target: string, linkPath: string, type?: 'dir' | 'file') {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return false;
    }
    throw error;
  }
}

test('file service reads and writes text files inside the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-files-'));
  try {
    await writeFile(join(dir, 'a.txt'), 'hello', 'utf8');
    const service = createFileService();

    const read = await service.readTextFile({ projectPath: dir, filePath: 'a.txt' });
    assert.equal(read.content, 'hello');

    await service.writeTextFile({ projectPath: dir, filePath: 'b.txt', content: 'world' });
    assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'world');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service writes binary content from base64 and creates parent directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-files-binary-'));
  try {
    const service = createFileService();

    await service.writeBinaryFile({
      projectPath: dir,
      filePath: 'docs/assets/image.png',
      dataBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
    });

    assert.deepEqual(
      await readFile(join(dir, 'docs', 'assets', 'image.png')),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service lists a shallow directory tree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-tree-'));
  try {
    await mkdir(join(dir, 'folder'));
    await writeFile(join(dir, 'a.txt'), 'hello', 'utf8');
    await writeFile(join(dir, 'folder', 'b.txt'), 'world', 'utf8');
    const service = createFileService();
    const tree = await service.listTree({ projectPath: dir });

    assert.deepEqual(
      tree.entries.map((entry) => ({
        name: entry.name,
        type: entry.type,
        size: typeof entry.size,
        modifiedAt: typeof entry.modifiedAt,
        children: entry.children?.map((child) => child.name),
      })),
      [
        {
          name: 'folder',
          type: 'directory',
          size: 'number',
          modifiedAt: 'string',
          children: undefined,
        },
        {
          name: 'a.txt',
          type: 'file',
          size: 'number',
          modifiedAt: 'string',
          children: undefined,
        },
      ]
    );

    const nestedTree = await service.listTree({ projectPath: dir, maxDepth: 1 });
    assert.deepEqual(nestedTree.entries[0].children?.map((child) => child.name), ['b.txt']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service can skip size and modified metadata for faster listing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-tree-lite-'));
  try {
    await mkdir(join(dir, 'folder'));
    await writeFile(join(dir, 'a.txt'), 'hello', 'utf8');
    const service = createFileService();

    const tree = await service.listTree({ projectPath: dir, includeMetadata: false });

    assert.deepEqual(
      tree.entries.map((entry) => ({
        name: entry.name,
        type: entry.type,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })),
      [
        {
          name: 'folder',
          type: 'directory',
          size: undefined,
          modifiedAt: undefined,
        },
        {
          name: 'a.txt',
          type: 'file',
          size: undefined,
          modifiedAt: undefined,
        },
      ]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service creates files and directories inside the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-create-'));
  try {
    const service = createFileService();

    await service.createEntry({ projectPath: dir, parentPath: '', type: 'directory', name: 'src' });
    await service.createEntry({ projectPath: dir, parentPath: 'src', type: 'file', name: 'index.ts' });

    assert.equal((await stat(join(dir, 'src'))).isDirectory(), true);
    assert.equal(await readFile(join(dir, 'src', 'index.ts'), 'utf8'), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service renames and deletes entries inside the project', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-rename-delete-'));
  try {
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'old.txt'), 'hello', 'utf8');
    const service = createFileService();

    await service.renameEntry({ projectPath: dir, entryPath: 'src/old.txt', newName: 'new.txt' });
    assert.equal(await readFile(join(dir, 'src', 'new.txt'), 'utf8'), 'hello');

    await service.deleteEntry({ projectPath: dir, entryPath: 'src/new.txt' });
    await assert.rejects(() => stat(join(dir, 'src', 'new.txt')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service rejects invalid entry names', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-invalid-name-'));
  try {
    const service = createFileService();

    await assert.rejects(
      () => service.createEntry({ projectPath: dir, parentPath: '', type: 'file', name: 'bad/name.txt' }),
      /invalid characters/
    );
    await assert.rejects(
      () => service.renameEntry({ projectPath: dir, entryPath: 'missing.txt', newName: 'CON' }),
      /reserved name/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file service rejects writes through a symlinked parent directory', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-project-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-outside-'));
  try {
    if (!(await trySymlink(outsideDir, join(projectDir, 'link-dir'), 'dir'))) {
      return;
    }
    const service = createFileService();

    await assert.rejects(
      () =>
        service.writeTextFile({
          projectPath: projectDir,
          filePath: 'link-dir/new.txt',
          content: 'outside',
        }),
      /outside the project path/
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('file service does not create directories through a symlinked parent before rejecting', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-project-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-outside-'));
  const outsideSubdir = join(outsideDir, 'sub');
  try {
    if (!(await trySymlink(outsideDir, join(projectDir, 'link-dir'), 'dir'))) {
      return;
    }
    const service = createFileService();

    await assert.rejects(
      () =>
        service.writeTextFile({
          projectPath: projectDir,
          filePath: 'link-dir/sub/new.txt',
          content: 'outside',
        }),
      /outside the project path/
    );
    await assert.rejects(() => readFile(join(outsideSubdir, 'new.txt'), 'utf8'));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('file service rejects writes through a symlinked target file', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-project-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-outside-'));
  try {
    const outsideFile = join(outsideDir, 'outside.txt');
    await writeFile(outsideFile, 'before', 'utf8');
    if (!(await trySymlink(outsideFile, join(projectDir, 'link.txt')))) {
      return;
    }
    const service = createFileService();

    await assert.rejects(
      () =>
        service.writeTextFile({
          projectPath: projectDir,
          filePath: 'link.txt',
          content: 'outside',
        }),
      /outside the project path/
    );
    assert.equal(await readFile(outsideFile, 'utf8'), 'before');
  } finally {
    await rm(projectDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});
