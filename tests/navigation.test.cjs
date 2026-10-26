const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'navigation.js'), 'utf8');

function environment(stored) {
  const before = [], after = [], listeners = {}, storage = new Map();
  if (stored) storage.set('xhh-site-fixes-open-mode', stored);
  let time = 0, id = 0, rowCount = 60, tab = '内容', listReady = true;
  const timers = new Map();
  const location = { origin: 'https://www.xiaoheihe.cn', pathname: '/app/user/history', search: '', hash: '', href: 'https://www.xiaoheihe.cn/app/user/history' };
  const router = { beforeEach: fn => before.push(fn), afterEach: fn => after.push(fn), push: () => Promise.resolve() };
  const list = { querySelectorAll: () => Array(rowCount), parentElement: {
    querySelector: () => ({ textContent: tab }),
    querySelectorAll: () => [{ textContent: '全部', classList: { contains: () => tab === '全部' }, click: () => { tab = '全部'; } }, { textContent: '内容', classList: { contains: () => tab === '内容' }, click: () => { tab = '内容'; } }]
  } };
  const context = {
    location, history: { state: { position: 7 } }, scrollX: 0, scrollY: 1628, innerHeight: 900,
    performance: { now: () => time }, console, URL,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { body: null, addEventListener() {}, documentElement: { scrollHeight: 6000 },
      getElementById: key => key === 'app' ? { __vue_app__: { config: { globalProperties: { $router: router } } } } : null,
      querySelector: () => listReady && location.pathname === '/app/user/history' ? list : null },
    setTimeout: (fn, delay) => { const handle = ++id; timers.set(handle, { fn, at: time + delay }); return handle; },
    clearTimeout: handle => timers.delete(handle), setInterval() {}, clearInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    dispatchEvent: event => (listeners[event.type] || []).forEach(fn => fn(event))
  };
  context.window = context;
  context.scrollTo = ({ top }) => {
    context.scrollY = Math.max(0, Math.min(top, context.document.documentElement.scrollHeight - context.innerHeight));
    if (rowCount === 30 && top >= 5000) rowCount = 60;
  };
  vm.runInNewContext(source, context);
  function route(pathname, position) {
    location.pathname = pathname; location.href = location.origin + pathname; context.history.state.position = position;
  }
  function flush() {
    for (let n = 0; timers.size && n < 200; n++) {
      const [handle, next] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      timers.delete(handle); time = next.at; next.fn();
    }
  }
  return { context, before, after, route, flush, storage, setCount: value => { rowCount = value; }, setTab: value => { tab = value; }, getTab: () => tab, setReady: value => { listReady = value; } };
}

test('默认新标签页，保存切换选择，并在新的页面上下文中恢复设置', () => {
  const env = environment();
  assert.equal(env.context.__xhhNavigation.mode, 'new-tab');
  env.context.__xhhNavigation.setMode('current-tab');
  assert.equal(env.storage.get('xhh-site-fixes-open-mode'), 'current-tab');
  assert.equal(environment('current-tab').context.__xhhNavigation.mode, 'current-tab');
  env.context.__xhhNavigation.setMode('invalid');
  assert.equal(env.context.__xhhNavigation.mode, 'current-tab');
});

test('浏览器后退时新 URL 先到、旧 DOM 后卸载，不覆盖列表快照；恢复分页和筛选', () => {
  const env = environment('current-tab');
  env.before[0]();
  env.route('/app/bbs/link/123', 8); env.after[0](null, null, null); env.flush();
  env.context.scrollY = 90;
  // popstate 先修改地址，此时页面还是帖子。
  env.route('/app/user/history', 7); env.before[0]();
  env.context.scrollY = 0; env.setCount(30); env.setTab('全部'); env.after[0](null, null, null); env.flush();
  assert.equal(env.context.scrollY, 1628);
  assert.equal(env.getTab(), '内容');
  assert.equal(env.context.__xhhNavigation.lastRestore.restored, true);
});

test('用户主动滚动会取消自动恢复，避免抢回阅读位置', () => {
  const env = environment();
  env.before[0](); env.route('/app/bbs/link/123', 8); env.after[0](null, null, null); env.flush();
  env.route('/app/user/history', 7); env.before[0](); env.context.scrollY = 0; env.after[0](null, null, null);
  env.context.dispatchEvent({ type: 'wheel' }); env.context.scrollY = 300; env.flush();
  assert.equal(env.context.scrollY, 300);
  assert.equal(env.context.__xhhNavigation.restoring, false);
});

test('历史列表延迟挂载时等待真实列表，不把帖子旧 DOM 的滚动当成恢复完成', () => {
  const env = environment();
  env.before[0](); env.route('/app/bbs/link/123', 8); env.after[0](null, null, null); env.flush();
  env.route('/app/user/history', 7); env.before[0](); env.setReady(false); env.setCount(30); env.context.scrollY = 0;
  env.after[0](null, null, null); env.context.setTimeout(() => env.setReady(true), 1500); env.flush();
  assert.equal(env.context.scrollY, 1628);
  assert.equal(env.context.__xhhNavigation.lastRestore.restored, true);
  assert.ok(env.context.__xhhNavigation.lastRestore.elapsed >= 1500);
});

test('路由失败不恢复目标位置，跳转拒绝外站和非帖子地址', () => {
  const env = environment();
  assert.equal(env.context.__xhhNavigation.navigate('https://example.com/app/bbs/link/123'), false);
  assert.equal(env.context.__xhhNavigation.navigate('/app/user/history'), false);
  env.after[0](null, null, new Error('cancelled'));
  assert.equal(env.context.__xhhNavigation.restoring, false);
});
