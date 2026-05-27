// 快速探索 WPS API
(() => {
  const r = {};
  const iframe = document.getElementById('office-iframe');
  if (!iframe) return JSON.stringify({ error: 'no iframe' });

  const win = iframe.contentWindow;

  // APP
  if (win.APP) {
    const all = Object.keys(win.APP).filter(k => !k.startsWith('_'));
    r.APP_funcs = all.filter(k => typeof win.APP[k] === 'function').slice(0, 30);
    r.APP_props = all.filter(k => typeof win.APP[k] !== 'function').slice(0, 20);

    // 尝试查看 APP 中与 ActiveSheet / Sheet 相关的内容
    try {
      if (win.APP.ActiveSheet) {
        const sheetKeys = Object.keys(win.APP.ActiveSheet).filter(k => !k.startsWith('_'));
        r.ActiveSheet_funcs = sheetKeys.filter(k => typeof win.APP.ActiveSheet[k] === 'function').slice(0, 30);
        r.ActiveSheet_props = sheetKeys.filter(k => typeof win.APP.ActiveSheet[k] !== 'function').slice(0, 20);
      }
    } catch(e) {
      r.ActiveSheet_error = e.message;
    }

    try {
      if (win.APP.ActiveCell) {
        r.ActiveCell_keys = Object.keys(win.APP.ActiveCell).filter(k => !k.startsWith('_')).slice(0, 20);
      }
    } catch(e) {}

    try {
      if (win.APP.Range) {
        r.Range_funcs = Object.keys(win.APP.Range).filter(k => !k.startsWith('_') && typeof win.APP.Range[k] === 'function').slice(0, 20);
      }
    } catch(e) {}
  }

  // WPSPlugin
  if (win.WPSPlugin) {
    const all = Object.keys(win.WPSPlugin).filter(k => !k.startsWith('_'));
    r.WPSPlugin_funcs = all.filter(k => typeof win.WPSPlugin[k] === 'function').slice(0, 40);
  }

  // Plugin 可能包含多种 API
  for (const key of ['Plugin', 'Application', 'plugin', 'app']) {
    try {
      const obj = win[key];
      if (obj && typeof obj === 'object') {
        const all = Object.keys(obj).filter(k => !k.startsWith('_'));
        r[key + '_funcs'] = all.filter(k => typeof obj[k] === 'function').slice(0, 20);
      }
    } catch(e) {}
  }

  // 查找所有包含 'Cell', 'Range', 'Sheet' 方法的全局对象
  for (const key of Object.keys(win)) {
    try {
      const val = win[key];
      if (val && typeof val === 'object' && !key.startsWith('_') && !key.startsWith('on')) {
        const methods = Object.keys(val).filter(k => typeof val[k] === 'function');
        const cellMethods = methods.filter(m =>
          /cell|range|sheet|value|select/i.test(m)
        );
        if (cellMethods.length >= 2) {
          r[key] = cellMethods.slice(0, 10);
        }
      }
    } catch(e) {}
  }

  return JSON.stringify(r);
})();
