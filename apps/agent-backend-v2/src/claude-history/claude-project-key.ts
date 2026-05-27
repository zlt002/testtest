export function toClaudeProjectKey(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function fromClaudeProjectKey(projectKey: string): string {
  if (process.platform === 'win32') {
    const windowsDriveMatch = projectKey.match(/^-?([a-zA-Z])--(.+)$/);
    if (windowsDriveMatch) {
      return `${windowsDriveMatch[1]}:\\${windowsDriveMatch[2].replace(/-/g, '\\')}`;
    }
  }

  const path = projectKey.replace(/-/g, '/');
  return path.startsWith('/') ? path : `/${path}`;
}
