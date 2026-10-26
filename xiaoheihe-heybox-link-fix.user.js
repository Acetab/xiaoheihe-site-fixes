// ==UserScript==
// @name         小黑盒 - 引用帖子链接改用网页版打开
// @namespace    https://github.com/Acetab/xiaoheihe-site-fixes
// @version      1.4.0
// @description  把动态 heybox 帖子链接转为网页版，可选当前页或新标签页打开。
// @author       Acetab
// @homepageURL  https://github.com/Acetab/xiaoheihe-site-fixes
// @supportURL   https://github.com/Acetab/xiaoheihe-site-fixes/issues
// @downloadURL  https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-heybox-link-fix.user.js
// @updateURL    https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-heybox-link-fix.user.js
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
  if (window.__xhhHeyboxLink) return;
  const state = window.__xhhHeyboxLink = { enabled: true, fixed: 0 };
  // 只识别完整的 linkid 键和值，不把非帖子协议或 123abc 误转成帖子。
  function toWebUrl(raw) {
    if (typeof raw !== 'string' || !/^heybox:\/\//i.test(raw)) return null;
    let payload = raw.slice(raw.indexOf('://') + 3);
    for (let i = 0; i < 2 && /%[\da-f]{2}/i.test(payload); i++) {
      try { payload = decodeURIComponent(payload); } catch (_) { break; }
    }
    if (!/^\s*\{/.test(payload)) return null;
    let data;
    try { data = JSON.parse(payload); }
    catch (_) {
      // 兼容单引号键/字符串，但仍交给 JSON 解析，绝不执行协议内容。
      try {
        const normalized = payload.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, token => {
          if (token[0] === '"') return token;
          return JSON.stringify(token.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
        });
        data = JSON.parse(normalized);
      } catch (_) { return null; }
    }
    const id = data?.link?.linkid ?? data?.linkid;
    if (typeof id === 'number' && !Number.isSafeInteger(id)) return null;
    if (!['number', 'string'].includes(typeof id) || !/^[1-9]\d*$/.test(String(id))) return null;
    return 'https://www.xiaoheihe.cn/app/bbs/link/' + id;
  }
  const originals = new Map();
  const navigation = window.__xhhNavigation;
  const patchedTarget = () => navigation?.mode === 'current-tab' ? '_self' : '_blank';
  function fixOne(a) {
    if (!state.enabled) return;
    const raw = a.getAttribute('href');
    const url = toWebUrl(raw);
    if (!url) return;
    const previous = originals.get(a);
    originals.set(a, {
      href: raw, url,
      target: previous && a.getAttribute('target') === previous.patchedTarget ? previous.target : a.getAttribute('target'),
      rel: previous && a.getAttribute('rel') === previous.patchedRel ? previous.rel : a.getAttribute('rel')
    });
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    rel.add('noopener'); rel.add('noreferrer');
    a.setAttribute('href', url);
    a.setAttribute('target', patchedTarget());
    a.setAttribute('rel', [...rel].join(' '));
    originals.get(a).patchedRel = a.getAttribute('rel');
    originals.get(a).patchedTarget = a.getAttribute('target');
    state.fixed++;
  }
  function scan(root) {
    if (!state.enabled) return;
    if (root.nodeType === 1 && root.matches('a[href]')) fixOne(root);
    root.querySelectorAll?.('a[href]').forEach(fixOne);
  }
  const observer = new MutationObserver(records => {
    for (const [a] of originals) if (!a.isConnected) originals.delete(a);
    if (!state.enabled) return;
    for (const record of records) {
      if (record.type === 'attributes') fixOne(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
    }
  });
  function start() {
    scan(document);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  // 同一事件栈中 href 被站点改回时，默认导航之前仍能修正，包括中键。
  for (const type of ['click', 'auxclick']) window.addEventListener(type, event => {
    if (event.target instanceof Element) {
      const a = event.target.closest('a[href]');
      if (a) {
        fixOne(a);
        if (state.enabled && type === 'click' && originals.get(a)?.url === a.getAttribute('href')) navigation?.handleLink(event);
      }
    }
  }, true);
  state.toWebUrl = toWebUrl;
  state.set = on => {
    state.enabled = !!on;
    if (state.enabled) scan(document);
    else {
      // 开关关闭时还原已转换的链接，便于独立排查。
      for (const [a, old] of originals) {
        if (a.getAttribute('href') !== old.url) continue;
        a.setAttribute('href', old.href);
        for (const key of ['target', 'rel']) {
          if (a.getAttribute(key) !== (key === 'target' ? old.patchedTarget : old.patchedRel)) continue;
          if (old[key] === null) a.removeAttribute(key); else a.setAttribute(key, old[key]);
        }
      }
      originals.clear();
    }
    return state.enabled;
  };
  window.addEventListener('xhh-open-mode-change', () => {
    for (const [a, old] of originals) if (a.getAttribute('href') === old.url && a.getAttribute('target') === old.patchedTarget) {
      old.patchedTarget = patchedTarget(); a.setAttribute('target', old.patchedTarget);
    }
  });
})();
