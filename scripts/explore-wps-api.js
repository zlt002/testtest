// 探索 WPS 电子表格 API 并创建演示表格
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const result = { steps: [] };

  const iframe = document.getElementById('office-iframe');
  if (!iframe) return JSON.stringify({ error: '未找到 iframe' });

  const win = iframe.contentWindow;
  const iframeDoc = iframe.contentDocument || win.document;

  // 1. 探索 WPS API
  const exploreObj = (obj, name, depth = 0) => {
    if (depth > 2 || !obj || typeof obj !== 'object') return typeof obj;
    const keys = Object.keys(obj).filter(k => !k.startsWith('_') && !k.startsWith('on'));
    if (keys.length === 0) return '{}';
    const subset = {};
    keys.slice(0, 30).forEach(k => {
      try {
        const val = obj[k];
        if (typeof val === 'function') {
          subset[k] = 'function(' + (val.length || 0) + ' params)';
        } else if (typeof val === 'object' && val !== null && depth < 2) {
          subset[k] = exploreObj(val, k, depth + 1);
        } else {
          subset[k] = typeof val === 'string' ? val.substring(0, 80) : val;
        }
      } catch(e) {
        subset[k] = '<error: ' + e.message + '>';
      }
    });
    return subset;
  };

  if (win.WPS) result.WPS = exploreObj(win.WPS, 'WPS');
  if (win.WPSOpenApi) result.WPSOpenApi = exploreObj(win.WPSOpenApi, 'WPSOpenApi');
  if (win.APP) result.APP = exploreObj(win.APP, 'APP');
  if (win.WPSPlugin) result.WPSPlugin = exploreObj(win.WPSPlugin, 'WPSPlugin');

  // 2. 查找 formulaBarEditor
  if (win.formulaBarEditor) {
    result.formulaBarEditor = exploreObj(win.formulaBarEditor, 'formulaBarEditor');
  }

  // 3. 探索 et-container 中的对象
  const etContainer = iframeDoc.querySelector('.et-container');
  if (etContainer) {
    // 检查是否有 Vue/React 组件实例
    const vueKeys = Object.keys(etContainer).filter(k => k.startsWith('__vue') || k.startsWith('_vue') || k.startsWith('__react'));
    result.etContainerSpecialKeys = vueKeys;

    // 尝试通过 __vue__ 访问
    for (const key of vueKeys) {
      try {
        const comp = etContainer[key];
        if (comp) {
          result.vueComponent = exploreObj(comp, 'vueComp');
          break;
        }
      } catch(e) {}
    }
  }

  // 4. 尝试找到 editor API
  // 查找所有可能暴露单元格操作的对象
  const allGlobals = [];
  for (const key of Object.keys(win)) {
    try {
      const val = win[key];
      if (val && typeof val === 'object' && !key.startsWith('_') && !key.startsWith('on')) {
        const methods = Object.keys(val).filter(k => typeof val[k] === 'function');
        const cellRelated = methods.filter(m =>
          m.toLowerCase().includes('cell') ||
          m.toLowerCase().includes('sheet') ||
          m.toLowerCase().includes('range') ||
          m.toLowerCase().includes('set') ||
          m.toLowerCase().includes('value') ||
          m.toLowerCase().includes('data')
        );
        if (cellRelated.length > 0) {
          allGlobals.push({ name: key, cellMethods: cellRelated.slice(0, 10) });
        }
      }
    } catch(e) {}
  }
  result.cellRelatedGlobals = allGlobals.slice(0, 20);

  // 5. 尝试通过 fake-input (公式栏) 输入数据
  const formulaInput = iframeDoc.querySelector('.fake-input');
  const editBox = iframeDoc.querySelector('.edit-box');

  if (formulaInput) {
    result.formulaInputInfo = {
      className: formulaInput.className,
      value: formulaInput.value,
      tag: formulaInput.tagName
    };
  }

  if (editBox) {
    result.editBoxInfo = {
      value: editBox.value,
      className: editBox.className
    };
  }

  // 6. 尝试键盘操作来输入表格数据
  // 先点击主画布获取焦点
  const mainCanvas = iframeDoc.getElementById('et_canvas');
  if (mainCanvas) {
    mainCanvas.focus();
    mainCanvas.click();
    await wait(300);
    result.canvasClicked = true;
  }

  // 7. 找到 formula bar 的输入框并尝试输入
  // 通常 WPS 公式栏有一个专门的输入区域
  const allInputs = iframeDoc.querySelectorAll('input[type="text"], textarea, [contenteditable]');
  result.allTextInputs = Array.from(allInputs).map(el => ({
    tag: el.tagName,
    className: (el.className || '').substring(0, 80),
    value: (el.value || '').substring(0, 50),
    placeholder: el.placeholder || '',
    contentEditable: el.contentEditable || '',
    visible: el.offsetParent !== null
  }));

  // 8. 查找包含 "formula" 或 "editor" 的元素
  const formulaElements = iframeDoc.querySelectorAll('[class*="formula"], [class*="editor"], [class*="edit-bar"], [class*="input-box"], [class*="fx"]');
  result.formulaElements = Array.from(formulaElements).slice(0, 10).map(el => ({
    tag: el.tagName,
    className: (el.className || '').substring(0, 100),
    text: (el.textContent || '').trim().substring(0, 100)
  }));

  return JSON.stringify(result, null, 2);
})();
