(() => {
  const root = document.querySelector('vis-bug[data-webmcp-page-edit-root="true"]');
  if (root instanceof HTMLElement) {
    root.remove();
  }

  const style = document.querySelector('link[data-webmcp-page-edit-style="true"]');
  if (style instanceof HTMLElement) {
    style.remove();
  }

  document.querySelectorAll('webmcp-page-annotation-dialog').forEach((node) => {
    node.remove();
  });

  document
    .querySelectorAll('[data-webmcp-annotation-overlay-layer="true"]')
    .forEach((node) => {
      if (!node.querySelector('[data-webmcp-annotation-marker="true"]')) {
        node.remove();
      }
    });
})();
