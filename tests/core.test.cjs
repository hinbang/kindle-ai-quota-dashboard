'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  demoSnapshot,
  preserveLastKnownGood,
  validateSnapshot,
  writeSnapshot,
} = require('../src/collect.cjs');
const { safeError } = require('../src/lib/common.cjs');
const { ROOT, validateConfig } = require('../src/lib/config.cjs');
const { collectProblems } = require('../scripts/check-public.cjs');
const { collectKnowledgeBase } = require('../src/collectors/knowledgebase.cjs');

test('knowledge-base collector aggregates capture folders, today titles, and trends', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-kb-test-'));
  const write = (relative, content, modifiedAt) => {
    const target = path.join(vault, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    if (modifiedAt) fs.utimesSync(target, modifiedAt, modifiedAt);
    return target;
  };
  const now = new Date('2026-10-06T12:00:00+08:00');
  try {
    write('catalog/migration/file-manifest.jsonl', [
      { target_rel: 'capture/materials/converted-md/pdf/1.微信发的文章/a.md' },
      { target_rel: 'capture/materials/converted-md/pdf/1.微信发的文章/b.md' },
      { target_rel: 'capture/materials/wechat/集智俱乐部/c.md' },
      { target_rel: 'capture/materials/legacy-originals/7.书籍/d.pdf' },
    ].map((row) => JSON.stringify(row)).join('\n'));
    write('capture/jobs/wechat/集智俱乐部/20261006-090000_集智俱乐部_report.json', JSON.stringify({
      task_time: '20261006-090000',
      results: [
        { status: 'ok', title: '今天的新标题', account: '集智俱乐部', published_at: '2026-10-06 08:30:00' },
        { status: 'fail', title: '失败内容不展示', account: '集智俱乐部' },
      ],
    }));
    write('capture/jobs/wechat/集智俱乐部/20261005-090000_集智俱乐部_report.json', JSON.stringify({
      task_time: '20261005-090000',
      results: [{ status: 'ok', title: '昨天的标题', account: '集智俱乐部' }],
    }));
    write('knowledge/lantel/atomic/draft/today.md', '# today', now);
    write('knowledge/lantel/atomic/draft/old.md', '# old', new Date('2026-09-01T12:00:00+08:00'));
    write('weknora/lantel/input/atomic/published.md', '# published', now);
    write('weknora/lantel/state/sync/example.json', JSON.stringify({
      files: { 'atomic/published.md': { synced_at: '2026-10-06T10:00:00+08:00' } },
    }));

    const result = collectKnowledgeBase({
      enabled: true,
      vaultRoot: vault,
      topicLimit: 8,
      todayTitleLimit: 5,
      trendDays: 7,
    }, now);

    assert.equal(result.ok, true);
    assert.deepEqual(result.topics.map((item) => [item.name, item.count]), [
      ['微信发的文章', 2],
      ['公众号／集智俱乐部', 1],
      ['书籍', 1],
    ]);
    assert.equal(result.today.total, 1);
    assert.equal(result.today.items[0].title, '今天的新标题');
    assert.equal(result.trends.recentSources, 2);
    assert.equal(result.trends.recentAtomicCards, 1);
    assert.equal(result.trends.pendingReview, 2);
    assert.equal(result.trends.published, 1);
    assert.equal(result.trends.synced, 1);
    assert.equal(result.trends.daily.length, 7);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('demo snapshot passes the public schema', () => {
  const snapshot = demoSnapshot();
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.equal(snapshot.weather.place, '示例城市');
  assert.equal(snapshot.sources.deepseek.balance, 12.34);
});

test('last known good data is preserved only for enabled failing providers', () => {
  const previous = demoSnapshot();
  const next = demoSnapshot();
  next.sources.claude = {
    ok: false,
    label: 'Claude',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '临时失败',
  };
  next.sources.kimi = {
    ok: false,
    label: 'Kimi',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '未启用',
    disabled: true,
  };
  preserveLastKnownGood(next, previous);
  assert.equal(next.sources.claude.ok, true);
  assert.equal(next.sources.claude.stale, true);
  assert.equal(next.sources.claude.error, '临时失败');
  assert.equal(next.sources.kimi.ok, false);
  assert.equal(next.sources.kimi.disabled, true);
});

test('safeError removes obvious credential material', () => {
  const secret = 'A'.repeat(90);
  const output = safeError(`authorization: bearer ${secret}`);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /已隐藏/);
});

test('config rejects inline secrets but accepts environment variable names', () => {
  assert.doesNotThrow(() => validateConfig({
    providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  }));
  assert.throws(() => validateConfig({
    providers: { demo: { token: 'this-should-never-be-here' } },
  }), /不允许保存密钥值/);
});

test('snapshot writer emits JSON and old-browser JavaScript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-quota-test-'));
  try {
    writeSnapshot(demoSnapshot(), dir, false);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    const javascript = fs.readFileSync(path.join(dir, 'data.js'), 'utf8');
    assert.equal(json.sources.codex.ok, true);
    assert.match(javascript, /^window\.DASH_DATA = /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('browser runtime is valid JavaScript', () => {
  for (const name of ['dashboard-runtime.js', 'app.js']) {
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, 'web', name)], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

function runBrowserRuntime(snapshot, storage) {
  const nodes = new Map();
  function node() {
    return {
      textContent: '',
      innerHTML: '',
      className: '',
      style: {},
      getAttribute() { return null; },
      setAttribute() {},
      querySelector() { return node(); },
      querySelectorAll() { return []; },
    };
  }
  function namedNode(name) {
    if (!nodes.has(name)) nodes.set(name, node());
    return nodes.get(name);
  }
  const head = node();
  head.appendChild = (child) => { child.parentNode = head; };
  head.removeChild = (child) => { child.parentNode = null; };
  const document = {
    createElement: () => node(),
    getElementById: (id) => namedNode(`#${id}`),
    getElementsByTagName: () => [head],
    querySelector: (selector) => namedNode(selector),
  };
  const localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  const window = { DASH_DATA: snapshot, localStorage };
  const source = fs.readFileSync(path.join(ROOT, 'web', 'dashboard-runtime.js'), 'utf8');
  vm.runInNewContext(source, {
    window,
    document,
    location: { search: '' },
    setTimeout: () => 1,
  });
  return { nodes, window };
}

test('browser runtime restores a valid cache and rejects older replacement data', () => {
  const storage = new Map();
  const fresh = demoSnapshot();
  runBrowserRuntime(fresh, storage);
  const cacheKey = 'kindle_ai_quota_cache_v2';
  const cached = storage.get(cacheKey);
  assert.ok(cached, 'fresh data should be cached');

  const restored = runBrowserRuntime(null, storage);
  assert.match(restored.nodes.get('#aiSummary').textContent, /DeepSeek.*12\.34/);
  assert.match(restored.nodes.get('#topicList').innerHTML, /科技创新/);
  assert.match(restored.nodes.get('#todayList').innerHTML, /世界模型/);

  const older = demoSnapshot();
  older.updatedAt = '2025-01-01T00:00:00+08:00';
  runBrowserRuntime(older, storage);
  assert.equal(storage.get(cacheKey), cached, 'older data must not replace a newer cache');
});

test('public checker skips ignored files on Windows paths but rejects exposed data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-public-check-'));
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: dir, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'config.json\nprivate/\n.env\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'config.json'), '{"providers":{}}\n', 'utf8');
    fs.mkdirSync(path.join(dir, 'private'));
    fs.writeFileSync(path.join(dir, 'private', 'config.json'), '{"private":true}\n', 'utf8');
    const localSecret = ['API', '_KEY=', '"', 'this-is-a-local-secret', '"\n'].join('');
    fs.writeFileSync(path.join(dir, '.env'), localSecret, 'utf8');
    assert.deepEqual(collectProblems(dir), []);

    fs.writeFileSync(path.join(dir, 'data.json'), '{"public":true}\n', 'utf8');
    assert.ok(
      collectProblems(dir).some((problem) => problem.includes('data.json')),
      'unignored runtime data should be rejected',
    );

    const exposedSecret = ['API', '_KEY=', '"', 'this-is-an-exposed-secret', '"\n'].join('');
    fs.writeFileSync(path.join(dir, 'credentials.txt'), exposedSecret, 'utf8');
    assert.ok(
      collectProblems(dir).some((problem) => problem.includes('credentials.txt')),
      'unignored secrets should still be rejected',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
