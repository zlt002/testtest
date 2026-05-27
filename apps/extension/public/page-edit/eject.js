(() => {
  const root = document.querySelector('vis-bug[data-webmcp-page-edit-root="true"]');
  if (root instanceof HTMLElement) {
    root.remove();
  }

  const style = document.querySelector('link[data-webmcp-page-edit-style="true"]');
  if (style instanceof HTMLElement) {
    style.remove();
  }

  document.querySelectorAll('[data-webmcp-annotation-ui="true"]').forEach((node) => {
    node.remove();
  });
})();
