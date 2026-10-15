// ==UserScript==
// @name         小黑盒 - 收藏夹浏览与批量移动
// @namespace    https://github.com/Acetab/xiaoheihe-site-fixes
// @version      1.3.0
// @description  显示收藏夹与分页内容，支持筛选、复选框选择、确认后逐条移动及停止后续。
// @author       Acetab
// @homepageURL  https://github.com/Acetab/xiaoheihe-site-fixes
// @supportURL   https://github.com/Acetab/xiaoheihe-site-fixes/issues
// @downloadURL  https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-favorite-folders.user.js
// @updateURL    https://raw.githubusercontent.com/Acetab/xiaoheihe-site-fixes/main/xiaoheihe-favorite-folders.user.js
// @match        https://www.xiaoheihe.cn/*
// @match        https://xiaoheihe.cn/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';
  if (window.__xhhFolders) return;
  const state = window.__xhhFolders = { enabled: true, version: '1.3.0', mounted: false, moving: false, lastOperation: null };
  const PATH = '/bbs/app/profile/fav/folder/v2/links';
  const MOVE = '/bbs/app/profile/fav/folder/move';
  const LIMIT = 30;
  let clientPromise, root, nativeParent, dialog, active = '', folders = [], views = new Map();
  let generation = 0, mountGeneration = 0, stopRequested = false, folderFilter = '', contentFilter = '';
  let managing = false, message = '', folderError = '', pendingMount = false;
  const ui = {};
  const onRoute = () => /^\/app\/user\/favour(?:\/content)?\/?$/.test(location.pathname);
  const idOf = item => String(item?.link?.linkid ?? item?.link?.id ?? '');
  const validId = value => /^[1-9]\d*$/.test(String(value));
  const titleOf = item => String(item?.link?.title || item?.link?.description || '无标题内容');
  const isSelectable = item => validId(idOf(item)) && !item.is_deleted;
  const cleanText = text => String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && !key.startsWith('aria')) node[key] = value;
      else node.setAttribute(key, String(value));
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = '') { return el('button', { type: 'button', class: className, onclick: action }, text); }
  function view(id = active) {
    if (!views.has(id)) views.set(id, { items: [], offset: 0, hasNext: true, loaded: false, loading: false, error: '', selected: new Set(), scroll: 0, epoch: 0 });
    return views.get(id);
  }
  async function client() {
    if (!clientPromise) clientPromise = (async () => {
      const entries = [...document.scripts].map(s => s.src).filter(Boolean).filter(src => {
        try {
          const u = new URL(src);
          return (u.origin === location.origin || u.hostname === 'static.max-c.com') &&
            u.pathname.includes('/website/app/') && /\/index-[^/]+\.js$/.test(u.pathname);
        } catch (_) { return false; }
      });
      for (const src of entries) {
        const module = await import(src);
        const found = Object.values(module).find(v => v && typeof v.$get === 'function' &&
          typeof v.$post === 'function' && typeof v.defaults?.getPlatformRequestParams === 'function');
        if (found) return found;
      }
      throw new Error('未找到站点请求组件，请刷新重试；站点更新后可能需要更新脚本。');
    })().catch(error => { clientPromise = null; throw error; });
    return clientPromise;
  }
  async function get(path, params) {
    const api = await client();
    const response = await api.$get(path, params, { target: 'heybox_app', forbidden_auto_tologin: true });
    const data = response?.data;
    if (data?.status !== 'ok') throw new Error(data?.msg || '读取失败，请检查登录状态后重试。');
    return data.result || {};
  }
  async function loadFolders() {
    const token = mountGeneration;
    try {
      const data = await get('/bbs/app/profile/fav/folders', { enable_new_style_collect: 1 });
      if (token !== mountGeneration || !root?.isConnected) return;
      folders = (data.folders || []).filter(f => validId(f.id)).map(f => ({ id: String(f.id), name: String(f.name), count: Number(f.count) || 0 }));
      folderError = '';
      renderFolders(); update();
    } catch (error) {
      if (token !== mountGeneration) return;
      folderError = error.message;
      renderFolders();
    }
  }
  function visibleItems() {
    const needle = contentFilter.trim().toLocaleLowerCase();
    return view().items.filter(item => !needle || (titleOf(item) + ' ' + cleanText(item.link?.description) + ' ' + (item.link?.user?.username || '')).toLocaleLowerCase().includes(needle));
  }
  function folderName(id = active) { return id ? folders.find(f => f.id === id)?.name || '收藏夹' : '所有收藏'; }
  async function loadMore(id = active) {
    const current = view(id);
    if (current.loading || !current.hasNext) return;
    const token = generation, epoch = current.epoch;
    current.loading = true; current.error = '';
    if (id === active) update();
    try {
      const params = { offset: current.offset, limit: LIMIT, enable_new_style_collect: 1, dw: Math.max(ui.items?.clientWidth || 400, 0) };
      if (id) params.folder_id = id;
      const data = await get(PATH, params);
      if (token !== generation || current.epoch !== epoch) return;
      const raw = Array.isArray(data.links) ? data.links : [];
      const existing = new Set(current.items.map(idOf).filter(Boolean));
      for (const item of raw) {
        const itemId = idOf(item);
        if (itemId && existing.has(itemId)) continue;
        current.items.push(item);
        if (itemId) existing.add(itemId);
      }
      current.offset += raw.length;
      current.hasNext = String(data.has_next) === '1' && raw.length > 0;
      current.loaded = true;
      if (data.folder && id) {
        const known = folders.find(f => f.id === id);
        if (known && Number.isFinite(Number(data.folder.count))) known.count = Number(data.folder.count);
      }
    } catch (error) {
      if (token === generation && current.epoch === epoch) current.error = error.message;
    } finally {
      if (token === generation && current.epoch === epoch) {
        current.loading = false;
        if (id === active && root?.isConnected) { renderItems(); renderFolders(); update(); }
      }
    }
  }
  function switchFolder(id) {
    if (state.moving || id === active) return;
    view().scroll = window.scrollY;
    active = id; contentFilter = ''; ui.filter.value = ''; message = '';
    renderFolders(); renderItems(); update();
    const current = view();
    if (!current.loaded && !current.loading) loadMore();
    window.scrollTo({ top: current.scroll, behavior: 'instant' });
  }
  function renderFolders() {
    if (!root?.isConnected) return;
    ui.folders.replaceChildren();
    const all = button('所有收藏', () => switchFolder(''), 'xhh-folder-link');
    all.dataset.folderId = ''; all.setAttribute('aria-current', active === '' ? 'page' : 'false');
    all.disabled = state.moving; ui.folders.append(all);
    const needle = folderFilter.trim().toLocaleLowerCase();
    const matches = folders.filter(f => f.name.toLocaleLowerCase().includes(needle));
    for (const folder of matches) {
      const b = button('', () => switchFolder(folder.id), 'xhh-folder-link');
      b.dataset.folderId = folder.id; b.setAttribute('aria-current', active === folder.id ? 'page' : 'false'); b.disabled = state.moving;
      b.append(el('span', { class: 'xhh-folder-name' }, folder.name), el('span', { class: 'xhh-count' }, folder.count));
      const picked = views.get(folder.id)?.selected.size || 0;
      if (picked) b.append(el('span', { class: 'xhh-picked', title: '该夹已选 ' + picked + ' 条' }, '已选 ' + picked));
      ui.folders.append(b);
    }
    ui.folderCount.textContent = folders.length ? folders.length + ' 个收藏夹' : '收藏夹';
    if (folderError) {
      ui.folders.append(el('p', { class: 'xhh-error' }, folderError), button('重试加载收藏夹', loadFolders));
    } else if (needle && !matches.length) ui.folders.append(el('p', { class: 'xhh-muted' }, '没有匹配的收藏夹'));
    else if (!folders.length) ui.folders.append(el('p', { class: 'xhh-muted' }, '正在加载收藏夹…'));
  }
  function renderItems() {
    if (!root?.isConnected) return;
    ui.items.replaceChildren();
    for (const item of visibleItems()) {
      const id = idOf(item);
      const row = el('article', { class: 'xhh-item' }); row.dataset.linkId = id;
      if (managing) {
        const box = el('input', { type: 'checkbox', checked: view().selected.has(id), disabled: state.moving || !isSelectable(item), 'aria-label': '选择：' + titleOf(item) });
        box.addEventListener('change', () => { if (box.checked) view().selected.add(id); else view().selected.delete(id); update(); });
        row.append(el('label', { class: 'xhh-check' })); row.lastChild.append(box);
      }
      const body = el('div', { class: 'xhh-item-body' });
      if (item.is_deleted || !validId(id)) body.append(el('p', { class: 'xhh-item-title xhh-muted' }, '内容已失效'));
      else body.append(el('a', { class: 'xhh-item-title', href: location.origin + '/app/bbs/link/' + id, target: '_blank', rel: 'noopener noreferrer' }, titleOf(item)));
      const description = cleanText(item.link?.description);
      if (description && description !== cleanText(titleOf(item))) body.append(el('p', { class: 'xhh-description' }, description));
      const author = item.link?.user?.username;
      body.append(el('p', { class: 'xhh-meta' }, author ? String(author) : '帖子 ' + id));
      row.append(body);
      const image = item.link?.thumbs?.[0]?.url || item.link?.imgs?.[0]?.url;
      if (image) {
        try { const url = new URL(image); if (url.protocol === 'https:') row.append(el('img', { class: 'xhh-thumb', src: url.href, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })); } catch (_) { /* 非图片地址 */ }
      }
      ui.items.append(row);
    }
  }
  function update() {
    if (!root?.isConnected) return;
    const current = view();
    const shown = visibleItems();
    const selectable = shown.filter(isSelectable);
    const selectedVisible = selectable.filter(item => current.selected.has(idOf(item))).length;
    ui.heading.textContent = folderName();
    const total = folders.find(f => f.id === active)?.count;
    ui.summary.textContent = '已加载 ' + current.items.length + (total === undefined ? ' 条' : ' / ' + total + ' 条') + (contentFilter ? '，筛选到 ' + shown.length + ' 条' : '');
    ui.message.textContent = message;
    ui.manage.textContent = managing ? '结束选择' : '批量管理';
    ui.manage.disabled = state.moving;
    ui.selection.hidden = !managing;
    ui.selected.textContent = '已选 ' + current.selected.size + ' 条';
    ui.allText.textContent = '全选当前结果（' + selectable.length + '）';
    ui.all.checked = selectable.length > 0 && selectedVisible === selectable.length;
    ui.all.indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
    ui.all.disabled = state.moving || !selectable.length;
    ui.clear.disabled = state.moving || !current.selected.size;
    ui.move.disabled = state.moving || !current.selected.size || !folders.length;
    ui.refresh.disabled = state.moving || current.loading;
    ui.filter.disabled = state.moving;
    ui.folderSearch.disabled = state.moving;
    ui.more.disabled = state.moving || current.loading;
    ui.more.hidden = !current.hasNext && !current.error;
    ui.more.textContent = current.loading ? '正在加载…' : current.error ? '重试加载' : '加载更多';
    ui.loadState.textContent = current.error || (current.loading && !current.loaded ? '正在加载收藏内容…' : !shown.length ? (contentFilter ? '已加载内容中没有匹配结果，可继续加载更多。' : current.loaded ? '这个收藏夹还没有内容。' : '') : !current.hasNext ? '已加载全部内容' : '');
    ui.loadState.className = current.error ? 'xhh-error' : 'xhh-muted';
    ui.items.setAttribute('aria-busy', String(current.loading));
  }
  async function refresh() {
    if (state.moving) return;
    const current = view();
    current.epoch++; current.items = []; current.offset = 0; current.hasNext = true; current.loaded = false; current.loading = false; current.error = '';
    if (current.selected.size) message = '已刷新内容，并清空当前选择。';
    current.selected.clear();
    renderItems(); update(); await Promise.all([loadFolders(), loadMore()]);
  }
  function makeDialog(snapshot) {
    const d = el('dialog', { class: 'xhh-move-dialog' });
    d.setAttribute('aria-labelledby', 'xhh-move-heading');
    const h = el('h2', { id: 'xhh-move-heading' }, '移动收藏');
    const sourceName = folderName();
    const intro = el('p', {}, '已选择 ' + snapshot.length + ' 条内容，来自“' + sourceName + '”。');
    const label = el('label', { class: 'xhh-target-label', htmlFor: 'xhh-move-target' }, '目标收藏夹');
    const select = el('select', { id: 'xhh-move-target' });
    select.append(el('option', { value: '' }, '请选择目标收藏夹'));
    for (const f of folders) select.append(el('option', { value: f.id, disabled: f.id === active }, f.name + '（' + f.count + '）'));
    const names = el('ul', { class: 'xhh-preview' });
    snapshot.slice(0, 5).forEach(item => names.append(el('li', {}, item.title)));
    if (snapshot.length > 5) names.append(el('li', {}, '另有 ' + (snapshot.length - 5) + ' 条'));
    const status = el('p', { class: 'xhh-move-status', role: 'status', 'aria-live': 'polite' }, '确认后会逐条移动；遇到失败将停止，未处理的内容保留选择。');
    const footer = el('div', { class: 'xhh-dialog-actions' });
    const cancel = button('取消', () => d.close());
    const stop = button('停止后续', () => { stopRequested = true; stop.disabled = true; status.textContent = '正在停止，等待当前请求完成…'; }); stop.hidden = true;
    const confirm = button('确认移动 ' + snapshot.length + ' 条', async () => {
      if (state.moving || !validId(select.value) || select.value === active) return;
      const target = folders.find(f => f.id === select.value);
      if (!target) return;
      confirm.disabled = true; select.disabled = true; cancel.disabled = true; stop.hidden = false;
      await move(snapshot, target, status);
      stop.hidden = true; cancel.disabled = false; cancel.textContent = '关闭';
    }, 'xhh-primary');
    confirm.disabled = true;
    select.addEventListener('change', () => {
      confirm.disabled = !validId(select.value) || select.value === active;
      status.textContent = select.value ? '将选中内容移动到“' + (folders.find(f => f.id === select.value)?.name || '') + '”。' : '请选择目标收藏夹。';
    });
    d.addEventListener('cancel', event => { if (state.moving) event.preventDefault(); });
    d.addEventListener('close', () => { d.remove(); if (dialog === d) dialog = null; });
    footer.append(cancel, stop, confirm); d.append(h, intro, label, select, names, status, footer); document.body.append(d);
    dialog = d; d.showModal(); select.focus();
  }
  function openMove() {
    if (state.moving || dialog?.isConnected) return;
    const current = view();
    const selected = current.items.filter(item => current.selected.has(idOf(item)) && isSelectable(item)).map(item => ({ id: idOf(item), title: titleOf(item), item }));
    if (selected.length) makeDialog(selected);
  }
  async function move(snapshot, target, statusNode) {
    state.moving = true; stopRequested = false;
    const source = active, result = { source, target: target.id, total: snapshot.length, completed: [], failed: null, stopped: false, unprocessed: [] };
    state.lastOperation = result; renderFolders(); renderItems(); update();
    try {
      const api = await client();
      for (let i = 0; i < snapshot.length; i++) {
        if (stopRequested) { result.stopped = true; break; }
        const item = snapshot[i];
        statusNode.textContent = '正在移动 ' + (i + 1) + ' / ' + snapshot.length + '：' + item.title;
        // 官方 Android 接口声明：POST + FormUrlEncoded；两个 Field，另一个 Query。
        const response = await api.$post(MOVE, { enable_new_style_collect: 1 },
          { folder_id: target.id, link_id: item.id }, { target: 'heybox_app', forbidden_auto_tologin: true, need_recall: false });
        if (response?.data?.status !== 'ok') {
          result.failed = { id: item.id, title: item.title, unknown: response?.data?.status === 'network_error', message: response?.data?.msg || '服务器未确认移动结果' };
          break;
        }
        result.completed.push(item.id);
        view(source).selected.delete(item.id);
        if (i + 1 < snapshot.length) await new Promise(resolve => setTimeout(resolve, 180));
      }
    } catch (error) {
      const item = snapshot[result.completed.length];
      result.failed = { id: item?.id, title: item?.title, unknown: true, message: error.message || '请求结果未确认' };
    } finally {
      result.unprocessed = snapshot.map(x => x.id).filter(id => !result.completed.includes(id) && id !== result.failed?.id);
      state.moving = false;
      message = '已移动 ' + result.completed.length + ' / ' + snapshot.length + ' 条到“' + target.name + '”。';
      if (result.failed) message += (result.failed.unknown ? '有 1 条结果未确认，请核对后再操作；' : '有 1 条失败：' + result.failed.message + '；') + '已停止后续操作。';
      else if (result.stopped) message += '已按要求停止。';
      if (result.unprocessed.length) message += '未处理 ' + result.unprocessed.length + ' 条。';
      statusNode.textContent = message;
      // 每次修改后作废分页，避免源夹删除项目后 offset 跳过下一页。
      const pending = new Set(snapshot.map(x => x.id).filter(id => !result.completed.includes(id)));
      views.clear(); view(source).selected = pending;
      // 未处理的选择可能来自第二页以后，保留其条目，避免刷新首页后只剩计数却无法重选。
      view(source).items = snapshot.filter(x => pending.has(x.id)).map(x => x.item);
      if (root?.isConnected && onRoute()) {
        await Promise.all([loadFolders(), loadMore(active)]);
        renderItems(); update();
      }
    }
  }
  const css = `
    .xhh-folders-enhanced>.user-favour__list{display:none!important}
    #xhh-folders{--xf-bg:#fff;--xf-fg:#202124;--xf-muted:#62666b;--xf-line:#e2e4e7;--xf-soft:#f3f4f5;--xf-accent:#286aa7;color:var(--xf-fg);background:var(--xf-bg);font-family:inherit;font-size:14px;line-height:1.5;border-radius:0 0 8px 8px;padding:16px 12px 24px}
    #xhh-folders *,.xhh-move-dialog *{box-sizing:border-box}
    #xhh-folders button,#xhh-folders input,.xhh-move-dialog button,.xhh-move-dialog select{font:inherit}
    #xhh-folders button,.xhh-move-dialog button{cursor:pointer;border:1px solid var(--xf-line,#d6d9dc);background:var(--xf-bg,#fff);color:var(--xf-fg,#202124);border-radius:5px;padding:6px 10px;white-space:nowrap}
    #xhh-folders button:hover,.xhh-move-dialog button:hover{background:var(--xf-soft,#f3f4f5)}
    #xhh-folders button:disabled,.xhh-move-dialog button:disabled{opacity:.5;cursor:default}
    #xhh-folders :focus-visible,.xhh-move-dialog :focus-visible{outline:2px solid #286aa7;outline-offset:2px}
    #xhh-folders input[type=search],.xhh-move-dialog select{width:100%;min-width:0;padding:7px 9px;border:1px solid var(--xf-line,#d6d9dc);border-radius:5px;background:var(--xf-bg,#fff);color:inherit}
    .xhh-folder-layout{display:grid;grid-template-columns:156px minmax(0,1fr);gap:18px}
    .xhh-sidebar{position:sticky;top:84px;align-self:start;max-height:calc(100vh - 105px);overflow:auto;overscroll-behavior:contain;padding-right:8px}
    .xhh-sidebar h2{font-size:14px;margin:0 0 8px}.xhh-folder-nav{margin-top:10px}
    #xhh-folders .xhh-folder-link{display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:space-between;width:100%;text-align:left;border:0;border-radius:4px;padding:8px;margin:1px 0;white-space:normal}
    #xhh-folders .xhh-folder-link[aria-current=page]{background:var(--xf-soft);font-weight:600;color:var(--xf-accent)}
    .xhh-folder-name{min-width:0;overflow-wrap:anywhere;flex:1}.xhh-count{color:var(--xf-muted);font-variant-numeric:tabular-nums}.xhh-picked{font-size:11px;color:var(--xf-muted)}
    .xhh-main{min-width:0}.xhh-main h2{font-size:18px;line-height:1.4;margin:0}.xhh-top{display:flex;gap:10px;align-items:start;justify-content:space-between}.xhh-top-actions{display:flex;gap:6px}.xhh-summary{font-size:12px;color:var(--xf-muted);margin:5px 0 12px}
    .xhh-filter-label{display:block;font-size:12px;color:var(--xf-muted);margin:10px 0 5px}.xhh-selection{padding:10px 0;margin-top:8px;border-bottom:1px solid var(--xf-line)}.xhh-selection[hidden]{display:none}.xhh-selection-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0}.xhh-selection label{display:flex;gap:6px;align-items:center}
    .xhh-status{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}.xhh-status:empty{display:none}
    .xhh-item{display:flex;gap:10px;align-items:flex-start;padding:15px 0;border-bottom:1px solid var(--xf-line)}.xhh-item-body{min-width:0;flex:1}.xhh-item-title{color:inherit!important;font-size:15px;font-weight:600;line-height:1.5;overflow-wrap:anywhere;text-decoration:none}.xhh-item-title:hover{text-decoration:underline}.xhh-description{font-size:13px;color:var(--xf-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:6px 0}.xhh-meta{font-size:12px;color:var(--xf-muted);margin:6px 0 0}.xhh-thumb{width:68px;height:68px;object-fit:cover;border-radius:4px;flex:none}.xhh-check{padding-top:3px;flex:none;cursor:pointer}.xhh-check input,#xhh-folders input[type=checkbox]{width:16px;height:16px;accent-color:#286aa7;cursor:pointer}
    .xhh-load{margin:14px 0;text-align:center}.xhh-load p{font-size:13px}.xhh-muted{color:var(--xf-muted,#62666b);font-size:13px}.xhh-error{color:#ad2929;font-size:13px;overflow-wrap:anywhere}.xhh-original{display:block;text-align:right;margin-top:20px;font-size:12px}
    .xhh-move-dialog{--xf-bg:#fff;--xf-fg:#202124;--xf-soft:#f3f4f5;--xf-line:#d6d9dc;position:fixed;inset:0;margin:auto;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;border:1px solid var(--xf-line);border-radius:8px;background:var(--xf-bg);color:var(--xf-fg);padding:22px;font:14px/1.6 system-ui,sans-serif}.xhh-move-dialog::backdrop{background:rgb(0 0 0 / .38)}.xhh-move-dialog h2{font-size:20px;margin:0 0 12px}.xhh-target-label{display:block;margin:14px 0 5px}.xhh-preview{max-height:160px;overflow:auto;padding-left:20px;font-size:13px}.xhh-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}.xhh-move-status{font-size:13px;overflow-wrap:anywhere}#xhh-folders .xhh-primary,.xhh-move-dialog .xhh-primary{background:#286aa7;color:#fff;border-color:#286aa7}
    @media(prefers-color-scheme:dark){#xhh-folders,.xhh-move-dialog{--xf-bg:#202226;--xf-fg:#e6e7e9;--xf-muted:#b3b7bc;--xf-line:#40444a;--xf-soft:#30343a;--xf-accent:#9cc9ed}.xhh-error{color:#ffaaa2}}
    @media(max-width:700px){#page-user-favour{width:calc(100vw - 24px)!important;max-width:calc(100vw - 24px);margin-left:12px!important;margin-right:12px!important}#page-user-favour>.content{width:100%;min-width:0}#page-user-favour .xhh-folders-enhanced{min-width:0;width:100%!important;max-width:100%;flex:1}#page-user-favour .user-favour__header{width:100%;max-width:100%}.xhh-folder-layout{grid-template-columns:minmax(0,1fr)}.xhh-sidebar{position:static;max-height:210px;padding-right:0;border-bottom:1px solid var(--xf-line);padding-bottom:12px}.xhh-folder-nav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 8px}.xhh-top{flex-wrap:wrap}.xhh-thumb{width:56px;height:56px}}
  `;
  function mount(host) {
    mountGeneration++; generation++; active = ''; views = new Map(); folders = []; folderError = ''; managing = false; message = ''; contentFilter = ''; folderFilter = '';
    nativeParent = host;
    root = el('section', { id: 'xhh-folders', 'aria-label': '收藏夹浏览与批量管理' });
    root.append(el('style', {}, css));
    const layout = el('div', { class: 'xhh-folder-layout' });
    const sidebar = el('aside', { class: 'xhh-sidebar' });
    ui.folderCount = el('h2', {}, '收藏夹');
    const folderLabel = el('label', { class: 'xhh-filter-label', htmlFor: 'xhh-folder-search' }, '查找收藏夹');
    ui.folderSearch = el('input', { id: 'xhh-folder-search', type: 'search', autocomplete: 'off', placeholder: '输入文件夹名' });
    ui.folderSearch.addEventListener('input', () => { folderFilter = ui.folderSearch.value; renderFolders(); });
    ui.folders = el('nav', { class: 'xhh-folder-nav', 'aria-label': '收藏夹' }); sidebar.append(ui.folderCount, folderLabel, ui.folderSearch, ui.folders);
    const main = el('div', { class: 'xhh-main' }), top = el('div', { class: 'xhh-top' });
    ui.heading = el('h2', {}, '所有收藏'); const actions = el('div', { class: 'xhh-top-actions' });
    ui.refresh = button('刷新', refresh); ui.manage = button('批量管理', () => { managing = !managing; renderItems(); update(); }); actions.append(ui.refresh, ui.manage); top.append(ui.heading, actions);
    ui.summary = el('p', { class: 'xhh-summary' });
    const filterLabel = el('label', { class: 'xhh-filter-label', htmlFor: 'xhh-content-filter' }, '筛选已加载内容');
    ui.filter = el('input', { id: 'xhh-content-filter', type: 'search', autocomplete: 'off', placeholder: '标题、摘要或作者' });
    ui.filter.addEventListener('input', () => { contentFilter = ui.filter.value; renderItems(); update(); });
    ui.selection = el('div', { class: 'xhh-selection', hidden: true });
    const checkRow = el('div', { class: 'xhh-selection-row' }); ui.all = el('input', { type: 'checkbox' }); ui.allText = el('span'); const allLabel = el('label'); allLabel.append(ui.all, ui.allText);
    ui.all.addEventListener('change', () => { for (const item of visibleItems().filter(isSelectable)) { if (ui.all.checked) view().selected.add(idOf(item)); else view().selected.delete(idOf(item)); } renderItems(); update(); });
    ui.selected = el('span'); ui.clear = button('清空选择', () => { view().selected.clear(); renderItems(); update(); });
    ui.move = button('移动到…', openMove, 'xhh-primary'); checkRow.append(allLabel, ui.selected, ui.clear, ui.move); ui.selection.append(checkRow);
    ui.message = el('p', { class: 'xhh-status', role: 'status', 'aria-live': 'polite' }); ui.items = el('div', { class: 'xhh-items' });
    const load = el('div', { class: 'xhh-load' }); ui.more = button('加载更多', () => loadMore()); ui.loadState = el('p', { role: 'status' }); load.append(ui.loadState, ui.more);
    const original = button('使用原收藏列表', () => state.set(false), 'xhh-original');
    main.append(top, ui.summary, filterLabel, ui.filter, ui.selection, ui.message, ui.items, load, original); layout.append(sidebar, main); root.append(layout);
    const header = host.querySelector(':scope > .user-favour__header'); if (header) header.after(root); else host.prepend(root);
    nativeParent.classList.add('xhh-folders-enhanced'); state.mounted = true;
    renderFolders(); update(); loadFolders(); loadMore();
  }
  function unmount() {
    if (state.moving) stopRequested = true;
    mountGeneration++; generation++; root?.remove(); root = null; nativeParent?.classList.remove('xhh-folders-enhanced'); nativeParent = null; state.mounted = false;
    if (dialog?.isConnected && !state.moving) dialog.close();
  }
  function checkMount() {
    pendingMount = false;
    if (!state.enabled || !onRoute()) { if (state.mounted) unmount(); return; }
    if (root?.isConnected) return;
    const list = document.querySelector('#page-user-favour .user-favour__list');
    if (list?.parentElement) mount(list.parentElement);
  }
  const observer = new MutationObserver(() => {
    if (!pendingMount) { pendingMount = true; requestAnimationFrame(checkMount); }
  });
  observer.observe(document, { childList: true, subtree: true });
  window.addEventListener('popstate', checkMount);
  window.addEventListener('beforeunload', event => { if (state.moving) { event.preventDefault(); event.returnValue = ''; } });
  state.set = on => { if (state.moving) return '请先停止移动并等待当前请求结束'; state.enabled = !!on; if (!state.enabled) unmount(); else checkMount(); return state.enabled; };
  state.refresh = refresh;
  state.status = () => ({ enabled: state.enabled, mounted: state.mounted, activeFolder: active, folders: folders.length, loaded: view().items.length, selected: view().selected.size, moving: state.moving });
  checkMount();
})();
