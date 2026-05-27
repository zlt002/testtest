// 点击"插入"标签，找到表格按钮并点击创建表格
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const result = { steps: [] };

  const iframe = document.getElementById('office-iframe');
  if (!iframe) return JSON.stringify({ error: '未找到 office-iframe' });

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  if (!iframeDoc) return JSON.stringify({ error: '无法访问 iframe' });

  // 第一步: 点击"插入"标签
  const insertTab = iframeDoc.getElementById('InsertTab');
  if (!insertTab) return JSON.stringify({ error: '未找到 InsertTab' });

  insertTab.click();
  result.steps.push('点击了插入标签');
  await wait(1500);

  // 收集所有按钮信息
  const allButtons = iframeDoc.querySelectorAll('button, [role="button"]');
  const buttons = Array.from(allButtons).map(b => ({
    text: (b.textContent || '').trim().substring(0, 50),
    title: b.getAttribute('title') || '',
    ariaLabel: b.getAttribute('aria-label') || '',
    className: (b.className || '').substring(0, 80),
    tooltip: b.getAttribute('tooltip') || ''
  }));
  result.buttons = buttons;

  // 查找表格按钮
  const tableBtn = Array.from(allButtons).find(b => {
    const t = ((b.textContent || '') + (b.getAttribute('title') || '') + (b.getAttribute('aria-label') || '') + (b.getAttribute('tooltip') || '')).toLowerCase();
    return t.includes('表格') || t.includes('table');
  });

  if (tableBtn) {
    result.foundTableBtn = true;
    result.tableBtnInfo = {
      text: (tableBtn.textContent || '').trim(),
      className: (tableBtn.className || '').substring(0, 80),
      title: tableBtn.getAttribute('title')
    };
    tableBtn.click();
    result.steps.push('点击了表格按钮');
    await wait(1000);

    // 查找弹出的表格选择器（通常是网格选择行列数）
    const popups = iframeDoc.querySelectorAll('[class*="popup"], [class*="dropdown"], [class*="picker"], [class*="selector"], [class*="menu"], [class*="panel"], [role="dialog"], [role="menu"], [role="listbox"]');
    result.popups = Array.from(popups).slice(0, 10).map(p => ({
      tag: p.tagName,
      className: (p.className || '').substring(0, 80),
      text: (p.textContent || '').trim().substring(0, 200),
      role: p.getAttribute('role'),
      visible: p.offsetParent !== null
    }));

    // 尝试点击一个默认的表格大小（如 5x5 的网格中的某一个单元格）
    // 查找网格单元格
    const cells = iframeDoc.querySelectorAll('[class*="cell"], [class*="grid"] > *, [class*="picker"] td, [class*="picker"] [class*="item"]');
    result.cells = Array.from(cells).slice(0, 30).map(c => ({
      tag: c.tagName,
      className: (c.className || '').substring(0, 60),
      text: (c.textContent || '').trim()
    }));

    // 如果有单元格可选，点击中间的一个创建 5x5 表格
    if (cells.length > 0) {
      const midCell = cells[Math.min(24, cells.length - 1)]; // 选第25个（5x5网格）
      if (midCell) {
        midCell.click();
        result.steps.push('点击了表格网格单元格');
      }
    }
  } else {
    result.foundTableBtn = false;
    // 列出所有可见的文字元素帮助调试
    const visibleTexts = [];
    iframeDoc.querySelectorAll('span, div, button').forEach(el => {
      const t = (el.textContent || '').trim();
      if (t.length > 0 && t.length < 20 && el.children.length === 0 && el.offsetParent !== null) {
        visibleTexts.push(t);
      }
    });
    result.visibleShortTexts = [...new Set(visibleTexts)].slice(0, 50);
  }

  await wait(500);

  // 检查编辑器区域是否有表格出现
  const editorArea = iframeDoc.querySelector('[contenteditable="true"], .editor-content, [class*="editor"], [class*="document"], #root > div:last-child');
  result.editorFound = !!editorArea;
  if (editorArea) {
    const tables = editorArea.querySelectorAll('table');
    result.tablesFound = tables.length;
    if (tables.length > 0) {
      result.tableHTML = tables[0].outerHTML.substring(0, 500);
    }
  }

  return JSON.stringify(result, null, 2);
})();
