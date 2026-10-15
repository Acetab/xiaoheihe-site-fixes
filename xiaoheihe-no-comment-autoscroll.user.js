// ==UserScript==
// @name         小黑盒 - 评论区点击不跳动
// @namespace    https://github.com/Acetab/xiaoheihe-site-fixes
// @version      1.3.0
// @description  点击可见评论不滚动，裁切评论只做最小位移，保留外部评论定位。
// @author       Acetab
// @homepageURL  https://github.com/Acetab/xiaoheihe-site-fixes
// @supportURL   https://github.com/Acetab/xiaoheihe-site-fixes/issues
// @downloadURL  https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-no-comment-autoscroll.user.js
// @updateURL    https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-no-comment-autoscroll.user.js
// @match        https://www.xiaoheihe.cn/*
// @match        https://xiaoheihe.cn/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @license      MIT
// ==/UserScript==

// 只接管本次点击的评论；外链定位、其他评论和其他滚动照常执行。
(function () {
  'use strict';
  if (window.__xhhNoCommentJump) return;
  const state = window.__xhhNoCommentJump = { enabled: true, intercepted: 0, last: null };
  const rawTo = window.scrollTo;
  const rawScroll = window.scroll;
  let intent = null;
  function mark(event) {
    intent = null;
    if (!state.enabled || !/^\/app\/bbs\/link\/\d+\/?$/.test(location.pathname)) return;
    if (event.button !== undefined && event.button !== 0) return;
    const el = event.target instanceof Element && event.target.closest('[data-comment-id]');
    if (!el || event.target.closest('a, button, input, textarea, [contenteditable="true"]')) return;
    intent = { el, id: el.getAttribute('data-comment-id'), url: location.href, at: performance.now() };
  }
  window.addEventListener('click', mark, true);
  window.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') mark(event);
    else intent = null;
  }, true);
  window.addEventListener('popstate', () => { intent = null; }, true);
  function wrap(raw) {
    return function (...args) {
      const current = intent;
      const options = args.length === 1 && args[0] && typeof args[0] === 'object' ? args[0] : null;
      const top = options ? options.top : args[1];
      if (state.enabled && current && location.href === current.url &&
          performance.now() - current.at <= 800 && typeof top === 'number' && Number.isFinite(top)) {
        const el = current.el;
        if (el.isConnected && el.getAttribute('data-comment-id') === current.id) {
          const r = el.getBoundingClientRect();
          const centered = Math.max(0, r.top + scrollY - (innerHeight - r.height) / 2);
          // 38% 行是外部定位用途，始终放行；不按整页所有元素的坐标猜测目标。
          if (r.height > 0 && Math.abs(centered - top) <= 2) {
            intent = null;
            let delta = 0;
            if (r.height <= innerHeight) {
              if (r.top < 0) delta = r.top;
              else if (r.bottom > innerHeight) delta = r.bottom - innerHeight;
            } else if (r.top > 0) delta = r.top;
            else if (r.bottom < innerHeight) delta = r.bottom - innerHeight;
            const next = Math.max(0, scrollY + delta);
            state.intercepted++;
            state.last = { id: current.id, requested: top, from: scrollY, to: next };
            if (Math.abs(next - scrollY) < 0.5) return;
            // 裁切时只移动到视口边缘，不另加边距；保留水平位置与站点的平滑参数。
            return raw.call(window, { left: options?.left ?? scrollX, top: next, behavior: options?.behavior ?? 'auto' });
          }
        }
      }
      return raw.apply(this, args);
    };
  }
  window.scrollTo = wrap(rawTo);
  window.scroll = wrap(rawScroll);
  state.set = on => { state.enabled = !!on; intent = null; return state.enabled; };
  // 兼容旧版控制台开关；去掉会破坏外链定位的 strict 模式。
  window.__xhhNoCommentJumpSet = mode => {
    if (mode !== 'soft' && mode !== 'off') return '可选 soft / off';
    state.set(mode === 'soft');
    return 'mode=' + mode;
  };
})();
