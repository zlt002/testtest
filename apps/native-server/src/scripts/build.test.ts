import { createBundleOptions } from './build';

describe('native-server build bundling', () => {
  it('builds self-contained runtime bundles for the native host entrypoints', () => {
    const options = createBundleOptions(['uuid', 'fastify']);

    expect(options.entry).toEqual({
      index: 'src/index.ts',
      cli: 'src/cli.ts',
      'scripts/register-dev': 'src/scripts/register-dev.ts',
      'scripts/postinstall': 'src/scripts/postinstall.ts',
    });
    expect(options.platform).toBe('node');
    expect(options.format).toEqual(['cjs']);
    expect(options.outDir).toBe('dist');
    expect(options.clean).toBe(true);
    expect(options.noExternal).toEqual(['uuid', 'fastify']);
  });
});
