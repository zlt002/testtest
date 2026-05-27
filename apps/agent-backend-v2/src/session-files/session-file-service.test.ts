import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { HttpError } from '../shared/errors.ts';
import { createSessionFileService } from './session-file-service.ts';

test('session file service saves uploaded files under rootDir/sessionId with normalized metadata', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-'));
  try {
    const resolvedRootDir = await realpath(rootDir);
    const service = createSessionFileService({ rootDir });

    const result = await service.saveUploadedFile({
      sessionId: 'session-123',
      fileName: 'report.PDF',
      mimeType: 'application/pdf',
      content: Buffer.from('%PDF-sample', 'utf8'),
    });

    assert.equal(result.id.length > 0, true);
    assert.equal(result.sessionFileId, result.id);
    assert.equal(result.name, 'report.PDF');
    assert.equal(result.mimeType, 'application/pdf');
    assert.equal(result.size, Buffer.byteLength('%PDF-sample', 'utf8'));
    assert.equal(result.kind, 'document');
    assert.equal(result.storage, 'session-temp');
    assert.equal(result.absolutePath.startsWith(join(resolvedRootDir, 'session-123')), true);
    assert.equal(basename(result.absolutePath).endsWith('.pdf'), true);
    assert.equal(await readFile(result.absolutePath, 'utf8'), '%PDF-sample');
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service supports expected document and text-like kinds', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-kinds-'));
  try {
    const service = createSessionFileService({ rootDir });
    const fixtures = [
      { fileName: 'photo.png', mimeType: 'image/png', kind: 'image' },
      { fileName: 'report.pdf', mimeType: 'application/pdf', kind: 'document' },
      { fileName: 'doc.doc', mimeType: 'application/msword', kind: 'document' },
      {
        fileName: 'doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        kind: 'document',
      },
      { fileName: 'sheet.xls', mimeType: 'application/vnd.ms-excel', kind: 'document' },
      {
        fileName: 'sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        kind: 'document',
      },
      {
        fileName: 'slides.ppt',
        mimeType: 'application/vnd.ms-powerpoint',
        kind: 'document',
      },
      {
        fileName: 'slides.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        kind: 'document',
      },
      { fileName: 'table.csv', mimeType: 'text/csv', kind: 'text' },
      { fileName: 'notes.md', mimeType: 'text/markdown', kind: 'text' },
      { fileName: 'data.json', mimeType: 'application/json', kind: 'text' },
    ] as const;

    for (const fixture of fixtures) {
      const saved = await service.saveUploadedFile({
        sessionId: 'session-kinds',
        fileName: fixture.fileName,
        mimeType: fixture.mimeType,
        content: Buffer.from(fixture.fileName, 'utf8'),
      });

      assert.equal(saved.kind, fixture.kind);
      assert.equal(saved.storage, 'session-temp');
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service rejects unsupported file types', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-invalid-'));
  try {
    const service = createSessionFileService({ rootDir });

    await assert.rejects(() =>
      service.saveUploadedFile({
        sessionId: 'session-invalid',
        fileName: 'archive.zip',
        mimeType: 'application/zip',
        content: Buffer.from('zip', 'utf8'),
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 415);
      assert.equal(error.code, 'session_file_type_unsupported');
      return true;
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service rejects invalid session ids with HttpError', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-invalid-session-'));
  try {
    const service = createSessionFileService({ rootDir });

    await assert.rejects(() =>
      service.saveUploadedFile({
        sessionId: '../escape',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        content: Buffer.from('notes', 'utf8'),
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'session_file_session_id_invalid');
      return true;
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service deletes only the target attachment', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-delete-'));
  try {
    const service = createSessionFileService({ rootDir });
    const first = await service.saveUploadedFile({
      sessionId: 'session-delete',
      fileName: 'first.txt',
      mimeType: 'text/plain',
      content: Buffer.from('first', 'utf8'),
    });
    const second = await service.saveUploadedFile({
      sessionId: 'session-delete',
      fileName: 'second.txt',
      mimeType: 'text/plain',
      content: Buffer.from('second', 'utf8'),
    });

    const outcome = await service.deleteFile({
      sessionId: 'session-delete',
      sessionFileId: first.sessionFileId,
    });

    assert.deepEqual(outcome, { ok: true });
    await assert.rejects(() => stat(first.absolutePath));
    assert.equal(await readFile(second.absolutePath, 'utf8'), 'second');
    const remainingEntries = await readdir(join(rootDir, 'session-delete'));
    assert.equal(remainingEntries.length, 1);
    assert.equal(remainingEntries[0], basename(second.absolutePath));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service returns HttpError when deleting a missing attachment or missing session directory', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-missing-delete-'));
  try {
    const service = createSessionFileService({ rootDir });

    await assert.rejects(() =>
      service.deleteFile({
        sessionId: 'missing-session',
        sessionFileId: 'missing-file',
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'session_file_session_not_found');
      return true;
    });

    await service.saveUploadedFile({
      sessionId: 'session-delete-missing',
      fileName: 'first.txt',
      mimeType: 'text/plain',
      content: Buffer.from('first', 'utf8'),
    });

    await assert.rejects(() =>
      service.deleteFile({
        sessionId: 'session-delete-missing',
        sessionFileId: 'missing-file',
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'session_file_not_found');
      return true;
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('session file service rejects symlinked session directories for save and delete', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-symlink-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-outside-'));
  try {
    const linkedSessionDir = join(rootDir, 'session-link');
    await symlink(outsideDir, linkedSessionDir, 'dir');
    const service = createSessionFileService({ rootDir });

    await assert.rejects(() =>
      service.saveUploadedFile({
        sessionId: 'session-link',
        fileName: 'notes.txt',
        mimeType: 'text/plain',
        content: Buffer.from('notes', 'utf8'),
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'session_file_path_outside_root');
      return true;
    });

    await assert.rejects(() =>
      service.deleteFile({
        sessionId: 'session-link',
        sessionFileId: 'anything',
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'session_file_path_outside_root');
      return true;
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('session file service rejects ambiguous delete matches instead of deleting by weak prefix guess', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'agent-backend-v2-session-files-ambiguous-'));
  try {
    const sessionDir = join(rootDir, 'session-ambiguous');
    const service = createSessionFileService({ rootDir });
    await service.saveUploadedFile({
      sessionId: 'session-ambiguous',
      fileName: 'seed.txt',
      mimeType: 'text/plain',
      content: Buffer.from('seed', 'utf8'),
    });
    await writeFile(join(sessionDir, 'dup-id.txt'), 'one', 'utf8');
    await writeFile(join(sessionDir, 'dup-id.md'), 'two', 'utf8');

    await assert.rejects(() =>
      service.deleteFile({
        sessionId: 'session-ambiguous',
        sessionFileId: 'dup-id',
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'session_file_delete_ambiguous');
      return true;
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
