(function () {
  'use strict';
  if (window.__xhhNewTab) return;
  const state = window.__xhhNewTab = { enabled: true, middleClick: true, patched: false, opened: 0, blocked: 0, last: null };
  const ROW = 'button.user-history__item.link';
  let intent = null;
  let middleDown = null;
  const patched = new WeakSet();
  const onHistory = () => /^\/app\/user\/history\/?$/.test(location.pathname);
  function rowOf(event) {
    return onHistory() && event.target instanceof Element ? event.target.closest(ROW) : null;
  }
  const navigation = window.__xhhNavigation;
  let forceNewTab = false;
  function arm(row, force = false) {
    const token = intent = { row, url: location.href, force };
    // 路由调用在条目的事件处理器内同步发生，不留下 800ms 的跨事件拦截窗口。
    // 原生用户事件可能在捕获监听器返回后立刻执行微任务；微任务清理会早于 Vue 的冒泡监听器。
    // 因此用下一任务清理，只覆盖本次事件分发及其同步/微任务处理。
    setTimeout(() => { if (intent === token) intent = null; }, 0);
  }
  function open(href) {
    let popup = null;
    try { popup = window.open(href, '_blank'); } catch (_) { /* 弹窗限制 */ }
    if (!popup) {
      state.blocked++;
      state.last = { href, opened: false };
      console.warn('[小黑盒修复] 新标签页被浏览器阻止，请允许本站弹出窗口后重试。');
      return;
    }
    try { popup.opener = null; } catch (_) { /* 防止新标签页访问来源窗口 */ }
    state.opened++;
    state.last = { href, opened: true };
  }
  function ensureRouter() {
    const router = document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$router;
    if (!router || typeof router.push !== 'function' || typeof router.resolve !== 'function') return false;
    if (patched.has(router)) return true;
    const original = router.push;
    router.push = function (to, ...rest) {
      const token = intent;
      intent = null;
      if (state.enabled && token && token.row.isConnected && token.url === location.href && onHistory()) {
        let url;
        try {
          const href = router.resolve(to).href;
          if (typeof href === 'string' && href) url = new URL(href, location.href);
        } catch (_) { /* 无效路由交给站点处理 */ }
        if (url && url.origin === location.origin && /^\/app\/bbs\/link\/\d+\/?$/.test(url.pathname)) {
          if (token.force || navigation?.mode !== 'current-tab') {
            open(url.href);
            return Promise.resolve();
          }
        }
      }
      return original.call(this, to, ...rest);
    };
    patched.add(router);
    state.patched = true;
    return true;
  }
  window.addEventListener('click', event => {
    intent = null;
    middleDown = null;
    if (!state.enabled || event.button !== 0 || event.shiftKey || event.defaultPrevented) return;
    const row = rowOf(event);
    if (row && ensureRouter()) arm(row, forceNewTab || event.ctrlKey || event.metaKey);
  }, true);
  window.addEventListener('mousedown', event => {
    middleDown = null;
    if (!state.enabled || !state.middleClick || event.button !== 1) return;
    const row = rowOf(event);
    if (!row || !ensureRouter()) return;
    // Chromium 的中键自动滚动由 mousedown 启动，不能等到 auxclick 才阻止。
    event.preventDefault();
    middleDown = row;
  }, true);
  window.addEventListener('mouseup', event => {
    if (event.button !== 1) return;
    const row = rowOf(event);
    const down = middleDown;
    middleDown = null;
    if (!state.enabled || !state.middleClick || !row || row !== down || !ensureRouter()) return;
    event.preventDefault();
    // 用站点自己的处理器解析地址，不依赖 Vue 私有的条目数据结构。
    forceNewTab = true;
    try { row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window })); }
    finally { forceNewTab = false; }
  }, true);
  window.addEventListener('auxclick', event => {
    if (state.enabled && state.middleClick && event.button === 1 && rowOf(event)) event.preventDefault();
  }, true);
  window.addEventListener('blur', () => { intent = null; middleDown = null; });
  state.set = on => { intent = null; middleDown = null; return state.enabled = !!on; };
  state.setMiddleClick = on => { middleDown = null; return state.middleClick = !!on; };
  if (!ensureRouter()) {
    const timer = setInterval(() => { if (ensureRouter()) clearInterval(timer); }, 250);
    setTimeout(() => clearInterval(timer), 60000);
  }
})();
