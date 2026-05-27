// 探索 office-iframe 内部结构并尝试创建表格
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 第一步：点击父页面的"插入"标签
  const insertTab = document.querySelector('.tab-btn');
  console.log('找到插入标签:', insertTab ? insertTab.textContent.trim() : '未找到');

  if (insertTab) {
    insertTab.click();
    await wait(800);
    console.log('已点击插入标签');

    // 查找表格相关选项
    const allText = document.body.textContent;
    console.log('点击后页面文字片段(前500字符):', allText.substring(0, 500));
  }

  // 第二步：探索 iframe 内部
  const iframe = document.getElementById('office-iframe');
  if (!iframe) {
    return '未找到 office-iframe';
  }

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  if (!iframeDoc) {
    return '无法访问 iframe 内容（可能跨域）';
  }

  const result = {};

  // iframe 基本信息
  result.iframeTitle = iframeDoc.title;
  result.iframeBodyChildren = iframeDoc.body ? iframeDoc.body.children.length : 0;

  // 找 iframe 中的 contenteditable
  const editables = iframeDoc.querySelectorAll('[contenteditable="true"]');
  result.editables = Array.from(editables).map(el => ({
    tag: el.tagName,
    className: (el.className || '').substring(0, 80),
    id: el.id,
    textLength: (el.textContent || '').length,
    textPreview: (el.textContent || '').trim().substring(0, 200)
  }));

  // 找 iframe 中的按钮和菜单
  const buttons = iframeDoc.querySelectorAll('button, [role="button"], [role="menuitem"], .menu-item, [class*="btn"], [class*="toolbar"]');
  result.buttons = Array.from(buttons).slice(0, 30).map(b => ({
    tag: b.tagName,
    text: (b.textContent || '').trim().substring(0, 40),
    className: (b.className || '').substring(0, 60),
    title: b.getAttribute('title'),
    role: b.getAttribute('role')
  }));

  // 找工具栏区域
  const toolbars = iframeDoc.querySelectorAll('[class*="toolbar"], [class*="ribbon"], [class*="menu"], [class*="header"], [class*="top"]');
  result.toolbars = Array.from(toolbars).slice(0, 15).map(t => ({
    tag: t.tagName,
    className: (t.className || '').substring(0, 80),
    text: (t.textContent || '').trim().substring(0, 150)
  }));

  // 查找包含"表格"或"插入"的元素
  const insertElems = [];
  iframeDoc.querySelectorAll('*').forEach(el => {
    const text = (el.textContent || '').trim();
    if ((text.includes('表格') || text.includes('插入') || text.includes('Table') || text.includes('Insert')) &&
        text.length < 100 && el.children.length <= 5) {
      insertElems.push({
        tag: el.tagName,
        text: text,
        className: (el.className || '').substring(0, 60),
        id: el.id
      });
    }
  });
  result.insertElements = insertElems.slice(0, 20);

  // 看看 iframe body 的直接子元素
  if (iframeDoc.body) {
    result.bodyDirectChildren = Array.from(iframeDoc.body.children).map(el => ({
      tag: el.tagName,
      id: el.id,
      className: (el.className || '').substring(0, 80),
      childCount: el.children.length,
      textPreview: (el.textContent || '').trim().substring(0, 100)
    }));
  }

  return JSON.stringify(result, null, 2);
})();
