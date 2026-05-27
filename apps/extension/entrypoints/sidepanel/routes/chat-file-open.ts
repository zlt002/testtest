import type { RunFileReference } from '../lib/agent-v2/run-cards';
import {
  buildHtmlBrowserPreviewUrl,
  buildSidepanelFilePreviewUrl,
} from '../lib/file-preview-browser';

type FileOpenLocation = {
  projectPath: string;
  filePath: string;
};

export function normalizePreviewFilePath(filePath: string) {
  const normalizeWindowsDrivePath = (value: string) => {
    const legacyDrivePath = value.match(/^\/([a-zA-Z])\/+(.+)$/);
    if (!legacyDrivePath) {
      return value;
    }
    return `${legacyDrivePath[1].toUpperCase()}:/${legacyDrivePath[2]}`;
  };

  const trimmed = filePath.trim();
  if (trimmed.startsWith('file://')) {
    try {
      return normalizeWindowsDrivePath(decodeURIComponent(new URL(trimmed).pathname));
    } catch {
      return normalizeWindowsDrivePath(decodeURIComponent(trimmed.slice('file://'.length)));
    }
  }
  return normalizeWindowsDrivePath(trimmed);
}

export function resolveFilePreviewLocation(
  file: RunFileReference,
  fallbackProjectPath: string | undefined
): FileOpenLocation | null {
  const normalizeWindowsDrivePath = (value: string) => {
    const legacyDrivePath = value.match(/^\/([a-zA-Z])\/+(.+)$/);
    if (!legacyDrivePath) {
      return value;
    }
    return `${legacyDrivePath[1].toUpperCase()}:/${legacyDrivePath[2]}`;
  };

  const normalizeComparablePath = (value: string) =>
    normalizeWindowsDrivePath(value)
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/([A-Za-z]:\/)/, '$1')
      .replace(/\/+$/, '');

  const filePath = normalizePreviewFilePath(file.filePath);
  const projectPath = file.projectPath || fallbackProjectPath;

  if (projectPath) {
    const normalizedProject = normalizeComparablePath(projectPath);
    const normalizedFilePath = normalizeComparablePath(filePath);
    if (normalizedFilePath.startsWith(`${normalizedProject}/`)) {
      return {
        projectPath: normalizedProject,
        filePath: normalizedFilePath.slice(normalizedProject.length + 1),
      };
    }
    if (!normalizedFilePath.startsWith('/')) {
      return { projectPath: normalizedProject, filePath: normalizedFilePath };
    }
  }

  const normalizedFilePath = normalizeComparablePath(filePath);
  if (/^[A-Za-z]:\//.test(normalizedFilePath)) {
    const parts = normalizedFilePath.split('/').filter(Boolean);
    const drive = parts.shift();
    const name = parts.at(-1);
    if (drive && name) {
      const parent = parts.slice(0, -1).join('/');
      return {
        projectPath: parent ? `${drive}/${parent}` : drive,
        filePath: name,
      };
    }
  }
  if (normalizedFilePath.startsWith('/')) {
    const parts = normalizedFilePath.split('/').filter(Boolean);
    const name = parts.at(-1);
    if (name) {
      return {
        projectPath: `/${parts.slice(0, -1).join('/')}`,
        filePath: name,
      };
    }
  }

  return null;
}

function isHtmlFilePath(filePath: string) {
  return /\.html?$/i.test(filePath.trim());
}

export function resolveRunFileOpenTarget(
  file: RunFileReference,
  fallbackProjectPath: string | undefined
):
  | { kind: 'browser-preview'; url: string }
  | { kind: 'sidepanel-preview'; url: string }
  | null {
  const location = resolveFilePreviewLocation(file, fallbackProjectPath);
  if (!location) {
    return null;
  }

  if (isHtmlFilePath(location.filePath)) {
    return {
      kind: 'browser-preview',
      url: buildHtmlBrowserPreviewUrl(location),
    };
  }

  return {
    kind: 'sidepanel-preview',
    url: buildSidepanelFilePreviewUrl(location),
  };
}
