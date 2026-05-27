// WPS 电子表格 - 创建演示表格
(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const r = {};

  const iframe = document.getElementById('office-iframe');
  if (!iframe) return JSON.stringify({ error: 'no iframe' });

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument || win.document;

  // 1. 探索 WPS API (精简版)
  if (win.APP) {
    const keys = Object.keys(win.APP).filter(k => !k.startsWith('_'));
    r.APP_keys = keys.slice(0, 30);
    // 查看具体方法
    const methods = keys.filter(k => typeof win.APP[k] === 'function');
    r.APP_methods = methods.slice(0, 20);
    // 非函数属性
    const props = keys.filter(k => typeof win.APP[k] !== 'function');
    r.APP_props = props.slice(0, 20);
  }

  if (win.WPS) {
    r.WPS_keys = Object.keys(win.WPS).filter(k => !k.startsWith('_')).slice(0, 20);
  }

  if (win.WPSOpenApi) {
    r.WPSOpenApi_keys = Object.keys(win.WPSOpenApi).filter(k => !k.startsWith('_')).slice(0, 20);
    // 尝试看看 API 的方法
    const apiMethods = Object.keys(win.WPSOpenApi).filter(k => typeof win.WPSOpenApi[k] === 'function');
    r.WPSOpenApi_methods = apiMethods.slice(0, 20);
  }

  // 2. 尝试通过公式栏输入数据
  // 找到所有输入框
  const inputs = doc.querySelectorAll('input[type="text"], textarea');
  r.inputs = Array.from(inputs).map(el => ({
    cls: (el.className || '').substring(0, 60),
    val: (el.value || '').substring(0, 30),
    vis: el.offsetParent !== null
  }));

  // 3. 找到 fake-input（公式编辑栏）
  const fakeInput = doc.querySelector('.fake-input');
  if (fakeInput) {
    r.fakeInput = { cls: fakeInput.className, val: fakeInput.value };

    // 点击公式栏并输入数据
    fakeInput.focus();
    fakeInput.click();
    await wait(200);

    // 使用原生方式设置值
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(fakeInput, '姓名');
    fakeInput.dispatchEvent(new Event('input', { bubbles: true }));
    fakeInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(200);

    // 按 Tab 移动到下一列
    fakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    await wait(200);

    nativeSetter.call(fakeInput, '部门');
    fakeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);

    fakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    await wait(200);

    nativeSetter.call(fakeInput, '职位');
    fakeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);

    fakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    await wait(200);

    nativeSetter.call(fakeInput, '入职日期');
    fakeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);

    // 按 Enter 确认
    fakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await wait(300);

    r.headerInserted = true;
  }

  // 4. 尝试直接通过 WPS 插件 API
  if (win.WPSPlugin) {
    r.WPSPlugin_keys = Object.keys(win.WPSPlugin).filter(k => !k.startsWith('_')).slice(0, 30);
    const methods = Object.keys(win.WPSPlugin).filter(k => typeof win.WPSPlugin[k] === 'function');
    r.WPSPlugin_methods = methods.slice(0, 30);
  }

  return JSON.stringify(r);
})();
