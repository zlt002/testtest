// 深入探索美的文档页面的DOM结构
(() => {
  const result = {};

  // 1. 页面基本信息
  result.title = document.title;
  result.url = window.location.href;
  result.bodyChildCount = document.body ? document.body.children.length : 0;

  // 2. 查找所有主要的顶层容器
  const containers = [];
  const rootDivs = document.body ? document.body.querySelectorAll(':scope > div') : [];
  rootDivs.forEach((div, i) => {
    containers.push({
      index: i,
      id: div.id,
      className: div.className,
      childCount: div.children.length,
      textPreview: (div.textContent || '').trim().substring(0, 100)
    });
  });
  result.rootContainers = containers;

  // 3. 查找所有 iframe
  const iframes = document.querySelectorAll('iframe');
  result.iframes = Array.from(iframes).map(f => ({
    src: f.src,
    id: f.id,
    className: f.className,
    name: f.name
  }));

  // 4. 查找 contenteditable 元素
  const editables = document.querySelectorAll('[contenteditable="true"]');
  result.editables = Array.from(editables).map(el => ({
    tag: el.tagName,
    className: el.className,
    id: el.id
  }));

  // 5. 查找 canvas 元素
  const canvases = document.querySelectorAll('canvas');
  result.canvases = Array.from(canvases).map(c => ({
    id: c.id,
    className: c.className,
    width: c.width,
    height: c.height
  }));

  // 6. 查找所有按钮（不限位置）
  const buttons = document.querySelectorAll('button');
  result.buttons = Array.from(buttons).map(b => ({
    text: (b.textContent || '').trim().substring(0, 50),
    title: b.getAttribute('title'),
    ariaLabel: b.getAttribute('aria-label'),
    className: (b.className || '').substring(0, 60)
  }));

  // 7. 查找所有带role的元素
  const roles = {};
  document.querySelectorAll('[role]').forEach(el => {
    const role = el.getAttribute('role');
    if (!roles[role]) roles[role] = [];
    if (roles[role].length < 5) {
      roles[role].push({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 50),
        className: (el.className || '').substring(0, 60)
      });
    }
  });
  result.roles = roles;

  // 8. 查找任何包含 "插入" 或 "表格" 文本的元素
  const insertEls = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  while (node = walker.nextNode()) {
    const text = (node.textContent || '').trim();
    if ((text.includes('插入') || text.includes('表格') || text.includes('Table')) && text.length < 50 && node.children.length <= 3) {
      insertEls.push({
        tag: node.tagName,
        text: text,
        className: (node.className || '').substring(0, 50),
        clickable: node.onclick !== null || node.getAttribute('onclick') !== null || node.tagName === 'BUTTON' || node.tagName === 'A'
      });
    }
    if (insertEls.length > 30) break;
  }
  result.insertRelated = insertEls.slice(0, 20);

  // 9. 特殊: 查找 React/Vue 组件的根节点（常见 data- 属性）
  const dataAttrs = [];
  document.querySelectorAll('[data-testid], [data-component], [data-node-id]').forEach(el => {
    dataAttrs.push({
      tag: el.tagName,
      testid: el.getAttribute('data-testid'),
      component: el.getAttribute('data-component'),
      nodeId: el.getAttribute('data-node-id'),
      className: (el.className || '').substring(0, 60)
    });
  });
  result.dataAttrs = dataAttrs.slice(0, 20);

  return JSON.stringify(result, null, 2);
})();
