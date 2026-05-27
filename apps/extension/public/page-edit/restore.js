(() => {
  const root = document.querySelector('vis-bug[data-webmcp-page-edit-root="true"]');
  if (root instanceof HTMLElement) {
    root.hidden = false;
    root.style.removeProperty('display');
  }
})();
