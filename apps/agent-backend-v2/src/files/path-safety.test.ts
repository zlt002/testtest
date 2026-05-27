import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { HttpError } from '../shared/errors.ts';
import { resolveSafeProjectPath } from './path-safety.ts';

test('allows paths inside project root', async () => {
  const resolved = await resolveSafeProjectPath({
    projectPath: process.cwd(),
    requestedPath: 'package.json',
  });

  assert.equal(resolved.endsWith('package.json'), true);
});

test('rejects traversal outside project root', async () => {
  await assert.rejects(
    () =>
      resolveSafeProjectPath({
        projectPath: process.cwd(),
        requestedPath: '../package.json',
      }),
    /outside the project path/
  );
});

test('reports missing project roots as not found', async () => {
  await assert.rejects(
    () =>
      resolveSafeProjectPath({
        projectPath: join(process.cwd(), '.missing-project-root'),
        requestedPath: '.',
      }),
    (error) => {
      assert.equal(error instanceof HttpError, true);
      assert.equal((error as HttpError).status, 404);
      assert.equal((error as HttpError).code, 'project_not_found');
      return true;
    }
  );
});

test('accepts legacy slash-prefixed Windows drive project paths on Windows', async () => {
  if (process.platform !== 'win32') {
    return;
  }

  const resolved = await resolveSafeProjectPath({
    projectPath: process.cwd().replace(/^([a-zA-Z]):\\/, '/$1//').replace(/\\/g, '/'),
    requestedPath: 'package.json',
  });

  assert.equal(resolved.endsWith('package.json'), true);
});
