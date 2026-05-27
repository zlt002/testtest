// 在美的文档编辑器中创建演示表格
(async () => {
  // 策略1: 尝试通过工具栏"插入" -> "表格"来创建
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // 查找"插入"菜单按钮
  const findAllButtons = () => {
    const all = [];
    // 查找工具栏中的所有可点击元素
    const toolbarSelectors = [
      '.toolbar', '.ribbon', '.menu-bar', '.top-bar', '.header-bar',
      '[role="toolbar"]', '[role="menubar"]', '.main-toolbar',
      '.editor-toolbar', '.top-toolbar', '#toolbar',
      'header', '.header', '.top-menu', '.menu-tabs'
    ];

    for (const sel of toolbarSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const items = el.querySelectorAll('button, [role="menuitem"], [role="tab"], .menu-item, .toolbar-item, .tab-item, span[class*="menu"], div[class*="menu-item"]');
        items.forEach(item => {
          all.push({
            tag: item.tagName,
            text: (item.textContent || '').trim().substring(0, 30),
            className: item.className,
            role: item.getAttribute('role'),
            title: item.getAttribute('title'),
            element: item
          });
        });
      }
    }

    // 如果上面没找到，就扫描整个页面的按钮和菜单项
    if (all.length === 0) {
      document.querySelectorAll('button, [role="menuitem"], [role="tab"], .menu-item, [class*="menu-btn"], [class*="tool-btn"]').forEach(item => {
        all.push({
          tag: item.tagName,
          text: (item.textContent || '').trim().substring(0, 30),
          className: item.className,
          role: item.getAttribute('role'),
          title: item.getAttribute('title'),
          element: item
        });
      });
    }

    return all;
  };

  const buttons = findAllButtons();
  console.log('找到的按钮/菜单项:', buttons.map(b => `${b.tag}: "${b.text}" [${b.className.substring(0, 30)}]`).join('\n'));

  // 查找"插入"按钮
  const insertBtn = buttons.find(b =>
    b.text.includes('插入') ||
    b.text.includes('Insert') ||
    (b.title && (b.title.includes('插入') || b.title.includes('Insert')))
  );

  if (insertBtn) {
    console.log('找到插入按钮:', insertBtn.text, insertBtn.tag);
    insertBtn.element.click();
    await wait(500);

    // 等待下拉菜单出现
    await wait(300);

    // 查找"表格"选项
    const allMenuItems = document.querySelectorAll('[role="menuitem"], .menu-item, [class*="dropdown-item"], [class*="menu-option"], li, .context-menu-item, [class*="popup"] *');
    const tableOption = Array.from(allMenuItems).find(el => {
      const text = (el.textContent || '').trim();
      return text.includes('表格') || text.includes('Table');
    });

    if (tableOption) {
      console.log('找到表格选项:', tableOption.textContent.trim());
      tableOption.click();
      await wait(500);
      return '表格已通过菜单创建';
    }
  }

  // 策略2: 查找是否有直接的"表格"按钮
  const tableBtn = buttons.find(b =>
    b.text.includes('表格') || b.text.includes('Table')
  );
  if (tableBtn) {
    console.log('找到直接表格按钮:', tableBtn.text);
    tableBtn.element.click();
    await wait(500);
    return '表格已通过直接按钮创建';
  }

  // 策略3: 尝试查找插入表格的API或通过contentEditable区域插入
  const editorArea = document.querySelector('[contenteditable="true"], .editor-content, .doc-content, [role="textbox"], .ql-editor, .ProseMirror');
  if (editorArea) {
    console.log('找到编辑器区域');
    editorArea.focus();

    // 尝试通过键盘快捷键或直接操作
    // 创建简单的HTML表格
    const tableHTML = `
      <table border="1" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #4472C4; color: white;">
            <th style="padding: 8px 12px; text-align: left;">序号</th>
            <th style="padding: 8px 12px; text-align: left;">姓名</th>
            <th style="padding: 8px 12px; text-align: left;">部门</th>
            <th style="padding: 8px 12px; text-align: left;">职位</th>
            <th style="padding: 8px 12px; text-align: left;">入职日期</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px 12px;">1</td>
            <td style="padding: 8px 12px;">张三</td>
            <td style="padding: 8px 12px;">技术部</td>
            <td style="padding: 8px 12px;">高级工程师</td>
            <td style="padding: 8px 12px;">2023-01-15</td>
          </tr>
          <tr style="background-color: #f2f2f2;">
            <td style="padding: 8px 12px;">2</td>
            <td style="padding: 8px 12px;">李四</td>
            <td style="padding: 8px 12px;">产品部</td>
            <td style="padding: 8px 12px;">产品经理</td>
            <td style="padding: 8px 12px;">2023-03-20</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px;">3</td>
            <td style="padding: 8px 12px;">王五</td>
            <td style="padding: 8px 12px;">设计部</td>
            <td style="padding: 8px 12px;">UI设计师</td>
            <td style="padding: 8px 12px;">2023-06-10</td>
          </tr>
          <tr style="background-color: #f2f2f2;">
            <td style="padding: 8px 12px;">4</td>
            <td style="padding: 8px 12px;">赵六</td>
            <td style="padding: 8px 12px;">市场部</td>
            <td style="padding: 8px 12px;">市场总监</td>
            <td style="padding: 8px 12px;">2022-09-01</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px;">5</td>
            <td style="padding: 8px 12px;">孙七</td>
            <td style="padding: 8px 12px;">财务部</td>
            <td style="padding: 8px 12px;">财务主管</td>
            <td style="padding: 8px 12px;">2022-11-18</td>
          </tr>
        </tbody>
      </table>
    `;

    // 尝试使用 execCommand 插入HTML
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      const fragment = range.createContextualFragment(tableHTML);
      range.insertNode(fragment);

      // 移动光标到表格后面
      range.setStartAfter(fragment);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      return '表格已通过 execCommand 插入';
    }
  }

  // 策略4: 通过查找iframe中的编辑器
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      const editable = doc.querySelector('[contenteditable="true"]');
      if (editable) {
        console.log('在iframe中找到编辑器');
        editable.focus();
        doc.execCommand('insertHTML', false, `
          <table border="1" style="border-collapse: collapse; width: 100%;">
            <thead>
              <tr style="background-color: #4472C4; color: white;">
                <th style="padding: 8px;">序号</th><th style="padding: 8px;">姓名</th><th style="padding: 8px;">部门</th><th style="padding: 8px;">职位</th><th style="padding: 8px;">入职日期</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style="padding: 8px;">1</td><td style="padding: 8px;">张三</td><td style="padding: 8px;">技术部</td><td style="padding: 8px;">高级工程师</td><td style="padding: 8px;">2023-01-15</td></tr>
              <tr style="background:#f2f2f2;"><td style="padding: 8px;">2</td><td style="padding: 8px;">李四</td><td style="padding: 8px;">产品部</td><td style="padding: 8px;">产品经理</td><td style="padding: 8px;">2023-03-20</td></tr>
              <tr><td style="padding: 8px;">3</td><td style="padding: 8px;">王五</td><td style="padding: 8px;">设计部</td><td style="padding: 8px;">UI设计师</td><td style="padding: 8px;">2023-06-10</td></tr>
              <tr style="background:#f2f2f2;"><td style="padding: 8px;">4</td><td style="padding: 8px;">赵六</td><td style="padding: 8px;">市场部</td><td style="padding: 8px;">市场总监</td><td style="padding: 8px;">2022-09-01</td></tr>
              <tr><td style="padding: 8px;">5</td><td style="padding: 8px;">孙七</td><td style="padding: 8px;">财务部</td><td style="padding: 8px;">财务主管</td><td style="padding: 8px;">2022-11-18</td></tr>
            </tbody>
          </table>
        `);
        return '表格已通过 iframe execCommand 插入';
      }
    } catch(e) {
      // 跨域iframe，跳过
    }
  }

  return '未找到可用的编辑器区域，按钮列表: ' + JSON.stringify(buttons.map(b => ({text: b.text, tag: b.tag})));
})();
