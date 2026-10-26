// ==UserScript==
// @name         小黑盒 - 浏览历史新标签页打开
// @namespace    https://github.com/Acetab/xiaoheihe-site-fixes
// @version      1.4.0
// @description  浏览历史可选新标签页或当前页打开，返回恢复阅读位置；支持中键与快捷键。
// @author       Acetab
// @homepageURL  https://github.com/Acetab/xiaoheihe-site-fixes
// @supportURL   https://github.com/Acetab/xiaoheihe-site-fixes/issues
// @downloadURL  https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-list-open-in-new-tab.user.js
// @updateURL    https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-list-open-in-new-tab.user.js
// @match        https://www.xiaoheihe.cn/*
// @match        https://xiaoheihe.cn/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @license      MIT
// ==/UserScript==

// 各独立版共用一份设置；列表与阅读位置只保留在当前标签页内存中。
(function () {
  'use strict';
  if (window.__xhhNavigation) return;
  const KEY = 'xhh-site-fixes-open-mode';
  let mode = 'new-tab';
  try { if (localStorage.getItem(KEY) === 'current-tab') mode = 'current-tab'; } catch (_) { /* 禁用存储时仍可切换 */ }
  const snapshots = new Map(), routers = new WeakSet();
  let restoreTimer, restoring = false, restoreToken = 0, dialog, modeSelect;
  const state = window.__xhhNavigation = { get mode() { return mode; }, restoring: false, lastRestore: null };
  const routeKey = () => String(history.state?.position ?? '') + ':' + location.pathname + location.search + location.hash;
  // popstate 时地址已变而 DOM 仍是离开的页面，不能用新地址覆盖返回目标的快照。
  let activeEntry = routeKey(), activePath = location.pathname;
  const routerOf = () => document.getElementById('app')?.__vue_app__?.config?.globalProperties?.$router;
  const historyPage = () => /^\/app\/user\/history\/?$/.test(location.pathname);
  function cancelRestore() {
    clearTimeout(restoreTimer); restoring = state.restoring = false; restoreToken++;
  }
  function remember() {
    if (restoring) return;
    const list = /^\/app\/user\/history\/?$/.test(activePath) ? document.querySelector('.user-history__list') : null;
    const tab = list?.parentElement?.querySelector('.slide-tab__tab-item.active');
    snapshots.set(activeEntry, {
      x: scrollX, y: scrollY,
      historyCount: list?.querySelectorAll('button.user-history__item').length || 0,
      historyTab: tab?.textContent.trim() || null
    });
    if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value);
  }
  function restore() {
    cancelRestore();
    const key = routeKey(), saved = snapshots.get(key);
    if (!saved) return;
    const token = restoreToken, started = performance.now();
    restoring = state.restoring = true;
    let stable = 0, tabClicked = false, lastCount = -1;
    function step() {
      if (token !== restoreToken || routeKey() !== key) return;
      const list = historyPage() ? document.querySelector('.user-history__list') : null;
      if (saved.historyTab && list) {
        const tabs = [...list.parentElement.querySelectorAll('.slide-tab__tab-item')];
        const target = tabs.find(e => e.textContent.trim() === saved.historyTab);
        if (target && !target.classList.contains('active') && !tabClicked) { tabClicked = true; target.click(); }
      }
      const count = list?.querySelectorAll('button.user-history__item').length || 0;
      const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const needsMore = saved.historyCount > 0 && (!list || count < saved.historyCount);
      // 原生历史页返回会重新分页，滚到末尾让站点继续加载，够数后再还原位置。
      if (!needsMore || list) window.scrollTo({ left: saved.x, top: needsMore ? maxY : saved.y, behavior: 'instant' });
      const ready = !needsMore && maxY >= saved.y - 2 && Math.abs(scrollY - saved.y) < 3;
      stable = ready && count === lastCount ? stable + 1 : 0;
      lastCount = count;
      if (stable >= 5 || performance.now() - started > 15000) {
        state.lastRestore = { restored: ready, elapsed: Math.round(performance.now() - started) };
        cancelRestore(); return;
      }
      restoreTimer = setTimeout(step, 120);
    }
    // 等待路由的首次渲染和站点默认滚动完成。
    restoreTimer = setTimeout(step, 60);
  }
  function ensureRouter() {
    const router = routerOf();
    if (!router || typeof router.beforeEach !== 'function' || typeof router.afterEach !== 'function') return false;
    if (!routers.has(router)) {
      router.beforeEach(() => { remember(); cancelRestore(); });
      router.afterEach((_to, _from, failure) => {
        if (!failure) { activeEntry = routeKey(); activePath = location.pathname; restore(); }
      });
      routers.add(router);
    }
    return true;
  }
  state.remember = remember;
  state.navigate = href => {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !/^\/app\/bbs\/link\/[1-9]\d*\/?$/.test(url.pathname)) return false;
    remember();
    const router = routerOf();
    if (router && typeof router.push === 'function') router.push(url.pathname + url.search + url.hash).catch(error => console.warn('[小黑盒修复] 跳转失败', error));
    else location.assign(url.href);
    return true;
  };
  state.handleLink = event => {
    if (mode !== 'current-tab' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
    const link = event.target instanceof Element && event.target.closest('a[href]');
    if (!link) return;
    // 同页时保留 Vue 应用，让返回后仍能复用收藏夹内存缓存。
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin && /^\/app\/bbs\/link\/[1-9]\d*\/?$/.test(url.pathname)) {
      event.preventDefault(); state.navigate(url.href);
    }
  };
  state.setMode = value => {
    if (!['new-tab', 'current-tab'].includes(value)) return mode;
    mode = value;
    try { localStorage.setItem(KEY, mode); } catch (_) { /* 当前页面仍生效 */ }
    if (modeSelect) modeSelect.value = mode;
    window.dispatchEvent(new CustomEvent('xhh-open-mode-change', { detail: mode }));
    return mode;
  };
  function settings() {
    if (dialog?.isConnected) { dialog.showModal(); return; }
    dialog = document.createElement('dialog'); dialog.id = 'xhh-navigation-settings';
    dialog.setAttribute('aria-labelledby', 'xhh-navigation-heading');
    const heading = document.createElement('h2'); heading.id = 'xhh-navigation-heading'; heading.textContent = '小黑盒脚本设置';
    const label = document.createElement('label'); label.htmlFor = 'xhh-open-mode'; label.textContent = '帖子打开方式';
    modeSelect = document.createElement('select'); modeSelect.id = 'xhh-open-mode';
    for (const [value, text] of [['new-tab', '新标签页打开（默认）'], ['current-tab', '当前页打开，返回继续浏览']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; modeSelect.append(option);
    }
    modeSelect.value = mode; modeSelect.addEventListener('change', () => state.setMode(modeSelect.value));
    const hint = document.createElement('p'); hint.textContent = '作用于浏览历史、增强收藏夹和修复后的引用链接。选择自动保存；中键或 Ctrl / Command + 点击仍可新开标签页。Shift + 点击历史条目保留当前页打开。';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '完成'; close.addEventListener('click', () => dialog.close());
    dialog.append(heading, label, modeSelect, hint, close); document.body.append(dialog); dialog.showModal(); modeSelect.focus();
  }
  state.settings = settings;
  function mount() {
    if (!document.body || document.getElementById('xhh-script-settings')) return;
    const style = document.createElement('style');
    style.textContent = `#xhh-script-settings{position:fixed;right:16px;bottom:20px;z-index:1000;padding:7px 10px;border:1px solid #c9cdd2;border-radius:5px;background:#fff;color:#333;font:12px/1.5 system-ui;cursor:pointer}#xhh-navigation-settings{position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;padding:22px;border:1px solid #c9cdd2;border-radius:8px;background:#fff;color:#222;font:14px/1.6 system-ui}#xhh-navigation-settings::backdrop{background:#0006}#xhh-navigation-settings h2{font-size:18px;margin:0 0 18px}#xhh-navigation-settings label{display:block;margin-bottom:6px}#xhh-navigation-settings select{box-sizing:border-box;width:100%;padding:8px;background:inherit;color:inherit;border:1px solid #aaa;border-radius:4px;font:inherit}#xhh-navigation-settings p{margin:14px 0;color:#666}#xhh-navigation-settings button{display:block;margin-left:auto;padding:6px 15px;font:inherit;cursor:pointer}#xhh-script-settings:focus-visible,#xhh-navigation-settings :focus-visible{outline:2px solid #286aa7;outline-offset:2px}@media(prefers-color-scheme:dark){#xhh-script-settings,#xhh-navigation-settings{background:#24262a;color:#eee;border-color:#555}#xhh-navigation-settings p{color:#bbb}}`;
    const button = document.createElement('button'); button.id = 'xhh-script-settings'; button.type = 'button'; button.textContent = '脚本设置'; button.setAttribute('aria-label', '小黑盒脚本设置'); button.addEventListener('click', settings);
    document.body.append(style, button);
  }
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) window.addEventListener(type, () => { if (restoring) cancelRestore(); }, { capture: true, passive: true });
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
  if (!ensureRouter()) {
    const timer = setInterval(() => { if (ensureRouter()) clearInterval(timer); }, 250);
    setTimeout(() => clearInterval(timer), 60000);
  }
})();

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
