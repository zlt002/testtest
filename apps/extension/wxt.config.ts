import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { defineConfig } from 'wxt';

const DEV_EXTENSION_MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoh9ge84FngkywTQwr8FjhcJq4NQHX+bBUX7y106uv+sJRyLt6yfCmi2MPyTWhU8bd3IhxCeFnHrCHaGMPXTEEAoeU1g9HaQPUyUgL1TxFHXz2DDiDNOANKiNhTIf9XodT8n8pk4MM8Ot1Hp6pit1Xvfu0536QV3JRD9XNpmHuYvkBQArP7JZ23FLzdV68zP4ZuFFO7HLyqguDMNzv2+Pab4EZEYFTC3+XyDiqKUbxOV2qjWnZhxdrcBu3HDm3KVhgkdZWGovbbJy+s5AKi04bNLIL5B4AWb8ZsROD4hMbj/xdCFZyzIpoixKT6rv+pZ4FyZjlsbV/SSQBcuVnbIMPQIDAQAB';

const inspectorEntrypoints = new Set(['sidepanel', 'userscript-editor']);
const inspectorInjectTo = [
  fileURLToPath(new URL('./entrypoints/sidepanel/main.tsx', import.meta.url)),
  fileURLToPath(new URL('./entrypoints/userscript-editor/main.js', import.meta.url)),
];
const isInspectorEnabled = () => process.env.CODE_INSPECTOR === 'true';
export const sidepanelRouterOptions = {
  generatedRouteTree: './entrypoints/sidepanel/routeTree.gen.ts',
  routesDirectory: './entrypoints/sidepanel/routes',
  routeFileIgnorePattern:
    '(?:file-preview\\..+|\\.(?:test|spec|shared|workspace))\\.[^.]+$',
};

const createInspectorPlugin = () =>
  codeInspectorPlugin({
    bundler: 'vite',
    needEnvInspector: true,
    dev: () => process.env.NODE_ENV === 'development',
    injectTo: inspectorInjectTo,
    skipSnippets: ['htmlScript'],
    showSwitch: true,
    include: [
      /entrypoints\/sidepanel\//,
      /entrypoints\/userscript-editor\//,
    ],
    exclude: [
      /entrypoints\/background\//,
      /entrypoints\/content\//,
    ],
  });

function getStartUrls() {
  const value = process.env.WXT_START_URLS?.trim();
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function shouldOpenBrowser() {
  return process.env.WXT_OPEN_BROWSER === 'true';
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // @ts-expect-error - Vite plugin types are resolved from multiple Vite versions.
  vite: (_env) => ({
    plugins: [
      tailwindcss(),
      tanstackRouter(sidepanelRouterOptions),
    ],
  }),
  hooks: {
    'vite:build:extendConfig': (entrypoints, viteConfig) => {
      if (!isInspectorEnabled()) {
        return;
      }

      if (!entrypoints.some((entrypoint) => inspectorEntrypoints.has(entrypoint.name))) {
        return;
      }

      viteConfig.plugins = [
        createInspectorPlugin(),
        ...(viteConfig.plugins ?? []),
      ];
    },
    'vite:devServer:extendConfig': (viteConfig) => {
      if (!isInspectorEnabled()) {
        return;
      }

      viteConfig.plugins = [
        createInspectorPlugin(),
        ...(viteConfig.plugins ?? []),
      ];
    },
  },
  manifestVersion: 3,
  dev: {
    server: {
      host: '127.0.0.1',
      port: 3000,
      origin: 'http://127.0.0.1:3000',
    },
  },
  manifest: {
    key: process.env.WXT_MANIFEST_KEY ?? DEV_EXTENSION_MANIFEST_KEY,
    name: 'accr-ui',
    description:
      'accr-ui browser assistant with Model Context Protocol integration for enhanced web interactions',
    minimum_chrome_version: '120',
    host_permissions: ['<all_urls>'],
    permissions: [
      'debugger',
      'storage',
      'tabs',
      'tabGroups',
      'sidePanel',
      'webNavigation',
      'bookmarks',
      'windows',
      'history',
      'userScripts',
      'nativeMessaging', // Enable communication with native hosts
      'scripting', // Enable scripting API for early injection
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval' http://localhost:3000 http://localhost:3001; object-src 'self'; style-src 'self' 'unsafe-inline' https: http:; font-src 'self' https: http: data:; connect-src 'self' data: ws: wss: http: https:; img-src 'self' data: https: http:;",
    },
    action: {
      default_title: 'Open accr-ui',
      default_icon: {
        '16': 'icon/16.png',
        '24': 'icon/48.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
    commands: {
      'toggle-page-edit': {
        suggested_key: {
          default: 'Alt+Shift+D',
          mac: 'Alt+Shift+D',
        },
        description: 'Toggle page edit mode on the current tab',
      },
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    web_accessible_resources: [
      {
        resources: ['page-edit/*', 'page-edit/**/*'],
        matches: ['<all_urls>'],
      },
    ],
    cross_origin_embedder_policy: {
      value: 'require-corp',
    },
    cross_origin_opener_policy: {
      value: 'same-origin',
    },
  },
  runner: {
    disabled: !shouldOpenBrowser(),
    openConsole: true,
    openDevtools: true,
    startUrls: getStartUrls(),
  },
});
