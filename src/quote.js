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
  function fixOne(a) {
    if (!state.enabled) return;
    const raw = a.getAttribute('href');
    const url = toWebUrl(raw);
    if (!url) return;
    const previous = originals.get(a);
    originals.set(a, {
      href: raw, url,
      target: previous && a.getAttribute('target') === '_blank' ? previous.target : a.getAttribute('target'),
      rel: previous && a.getAttribute('rel') === previous.patchedRel ? previous.rel : a.getAttribute('rel')
    });
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    rel.add('noopener'); rel.add('noreferrer');
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', [...rel].join(' '));
    originals.get(a).patchedRel = a.getAttribute('rel');
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
      if (a) fixOne(a);
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
          if (a.getAttribute(key) !== (key === 'target' ? '_blank' : old.patchedRel)) continue;
          if (old[key] === null) a.removeAttribute(key); else a.setAttribute(key, old[key]);
        }
      }
      originals.clear();
    }
    return state.enabled;
  };
})();
