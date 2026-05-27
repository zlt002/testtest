// 点击"插入"标签，然后找到并点击"表格"按钮
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const iframe = document.getElementById('office-iframe');
  if (!iframe) return '未找到 office-iframe';

  const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
  if (!iframeDoc) return '无法访问 iframe 内容';

  // 第一步: 点击"插入"标签
  const insertTab = iframeDoc.getElementById('InsertTab');
  if (!insertTab) return '未找到插入标签';

  console.log('点击插入标签...');
  insertTab.click();
  await wait(1000);
  console.log('已点击插入标签');

  // 第二步: 查找工具栏中的所有按钮
  const allButtons = iframeDoc.querySelectorAll('button, [role="button"], [role="menuitem"], .kd-button');
  const buttonTexts = Array.from(allButtons).map(b => ({
    text: (b.textContent || '').trim().substring(0, 40),
    title: b.getAttribute('title'),
    ariaLabel: b.getAttribute('aria-label'),
    className: (b.className || '').substring(0, 60),
    tooltip: b.getAttribute('tooltip'),
    tag: b.tagName
  }));
  console.log('工具栏按钮:', JSON.stringify(buttonTexts, null, 2));

  // 第三步: 查找"表格"按钮
  const tableBtn = Array.from(allButtons).find(b => {
    const text = (b.textContent || '').trim();
    const title = b.getAttribute('title') || '';
    const ariaLabel = b.getAttribute('aria-label') || '';
    const tooltip = b.getAttribute('tooltip') || '';
    return text.includes('表格') || title.includes('表格') || ariaLabel.includes('表格') || tooltip.includes('表格');
  });

  if (tableBtn) {
    console.log('找到表格按钮:', tableBtn.textContent.trim());
    tableBtn.click();
    await wait(800);
    return '表格按钮已点击';
  }

  // 如果上面没找到，检查页面中所有元素
  const allElements = iframeDoc.querySelectorAll('*');
  const tableRelated = [];
  for (const el of allElements) {
    const text = (el.textContent || '').trim();
    const title = el.getAttribute('title') || '';
    if ((text === '表格' || title === '表格') && text.length < 10) {
      tableRelated.push({
        tag: el.tagName,
        text: text,
        title: title,
        className: (el.className || '').substring(0, 60),
        id: el.id,
        parent: el.parentElement ? (el.parentElement.className || '').substring(0, 60) : ''
      });
    }
  }
  console.log('表格相关元素:', JSON.stringify(tableRelated, null, 2));

  // 第四步: 打印当前工具栏区域的文本
  const toolbarArea = iframeDoc.querySelector('.component-header-middle');
  if (toolbarArea) {
    console.log('工具栏区域HTML片段:', toolbarArea.innerHTML.substring(0, 2000));
  }

  // 查找 ribbon/功能区中的所有项
  const allDivs = iframeDoc.querySelectorAll('div');
  const shortTextDivs = Array.from(allDivs)
    .filter(d => {
      const t = (d.textContent || '').trim();
      return t.length > 0 && t.length < 20 && d.children.length <= 2;
    })
    .map(d => ({
      text: (d.textContent || '').trim(),
      className: (d.className || '').substring(0, 80),
      tag: d.tagName,
      role: d.getAttribute('role'),
      title: d.getAttribute('title')
    }))
    .filter(d => d.text.length > 0);

  console.log('短文本元素:', JSON.stringify(shortTextDivs.slice(0, 50), null, 2));

  return '探索完成';
})();
