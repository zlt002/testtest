// 在电子表格中创建演示表格 - 通过单元格填充数据
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const result = { steps: [] };

  const iframe = document.getElementById('office-iframe');
  if (!iframe) return JSON.stringify({ error: '未找到 office-iframe' });

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  if (!iframeDoc) return JSON.stringify({ error: '无法访问 iframe' });

  // 探索整个 iframe 结构，重点找编辑区域
  const bodyHTML = iframeDoc.body ? iframeDoc.body.innerHTML : '';
  result.bodyLength = bodyHTML.length;

  // 找 root 下的直接子元素
  const root = iframeDoc.getElementById('root');
  if (root) {
    const rootChildren = Array.from(root.children).map(el => ({
      tag: el.tagName,
      id: el.id,
      className: (el.className || '').substring(0, 100),
      childCount: el.children.length,
      textPreview: (el.textContent || '').trim().substring(0, 100)
    }));
    result.rootChildren = rootChildren;
  }

  // 找所有 input 和 textarea
  const inputs = iframeDoc.querySelectorAll('input, textarea, [contenteditable="true"]');
  result.inputs = Array.from(inputs).map(el => ({
    tag: el.tagName,
    type: el.type,
    className: (el.className || '').substring(0, 80),
    id: el.id,
    placeholder: el.placeholder,
    value: (el.value || '').substring(0, 50),
    contentEditable: el.contentEditable
  }));

  // 找所有 canvas 元素
  const canvases = iframeDoc.querySelectorAll('canvas');
  result.canvases = Array.from(canvases).map(c => ({
    id: c.id,
    className: (c.className || '').substring(0, 80),
    width: c.width,
    height: c.height,
    styleWidth: c.style.width,
    styleHeight: c.style.height
  }));

  // 查找带有 data- 属性的元素（这些通常是关键组件）
  const dataEls = iframeDoc.querySelectorAll('[data-v-], [data-component], [data-type]');
  result.dataElements = Array.from(dataEls).slice(0, 20).map(el => ({
    tag: el.tagName,
    className: (el.className || '').substring(0, 80),
    dataset: JSON.stringify(el.dataset).substring(0, 100)
  }));

  // 查找公式栏/编辑栏区域
  const editBarSelectors = [
    '[class*="formula"]', '[class*="edit-bar"]', '[class*="name-box"]',
    '[class*="fx"]', '[class*="cell-editor"]', '[class*="input-line"]',
    'input[type="text"]', '[class*="address"]'
  ];

  for (const sel of editBarSelectors) {
    const el = iframeDoc.querySelector(sel);
    if (el) {
      result.editBar = {
        selector: sel,
        tag: el.tagName,
        type: el.type,
        className: (el.className || '').substring(0, 80),
        value: (el.value || '').substring(0, 50),
        placeholder: el.placeholder,
        id: el.id
      };
      break;
    }
  }

  // 查找 grid/cell 相关的元素
  const gridSelectors = [
    '[class*="grid"]', '[class*="cell"]', '[class*="sheet-view"]',
    '[class*="spreadsheet"]', '[class*="table-view"]', '[class*="worksheet"]',
    '[class*="row-header"]', '[class*="col-header"]'
  ];

  for (const sel of gridSelectors) {
    const els = iframeDoc.querySelectorAll(sel);
    if (els.length > 0) {
      result.gridElements = Array.from(els).slice(0, 10).map(el => ({
        selector: sel,
        tag: el.tagName,
        className: (el.className || '').substring(0, 100),
        childCount: el.children.length,
        text: (el.textContent || '').trim().substring(0, 50)
      }));
      break;
    }
  }

  // 检查是否有 window 上的 API
  try {
    const wpsApi = iframe.contentWindow;
    const keys = Object.keys(wpsApi).filter(k =>
      k.toLowerCase().includes('wps') ||
      k.toLowerCase().includes('sheet') ||
      k.toLowerCase().includes('cell') ||
      k.toLowerCase().includes('grid') ||
      k.toLowerCase().includes('api') ||
      k.toLowerCase().includes('editor') ||
      k.toLowerCase().includes('app')
    );
    result.windowApiKeys = keys.slice(0, 30);
  } catch(e) {
    result.windowApiError = e.message;
  }

  // 尝试通过 keyboard event 输入数据
  // 先点击一下 iframe 让它获得焦点
  iframe.contentWindow.focus();
  iframeDoc.body.focus();
  await wait(300);

  // 查找并点击第一个可见的 input
  const visibleInputs = Array.from(iframeDoc.querySelectorAll('input[type="text"]')).filter(el => el.offsetParent !== null);
  result.visibleInputs = visibleInputs.map(el => ({
    className: (el.className || '').substring(0, 80),
    value: el.value,
    placeholder: el.placeholder
  }));

  if (visibleInputs.length > 0) {
    const input = visibleInputs[0];
    result.clickedInput = true;
    input.focus();
    input.click();
    await wait(300);

    // 尝试设置值
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, '演示表格数据');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    result.inputAfterSet = input.value;
  }

  return JSON.stringify(result, null, 2);
})();
