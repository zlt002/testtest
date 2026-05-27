const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi;

export function rewriteCssResourceUrls(cssText: string): string {
  return cssText
    .replace(
      CSS_URL_PATTERN,
      (_full, doubleQuoted: string, singleQuoted: string, unquoted: string) => {
        const value = (doubleQuoted || singleQuoted || unquoted || '').trim();
        if (!value || value.startsWith('data:') || value.startsWith('#')) {
          return 'url("")';
        }

        return 'none';
      }
    )
    .replace(/src\s*:\s*(?:none|url\(""\))/gi, 'src:none')
    .replace(/background(?:-image)?\s*:\s*(?:none|url\(""\))/gi, 'background: none');
}
