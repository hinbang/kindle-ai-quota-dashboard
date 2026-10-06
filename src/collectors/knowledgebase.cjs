'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walkFiles(root, accept = () => true) {
  if (!root || !fs.existsSync(root)) return [];
  const output = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && accept(fullPath)) output.push(fullPath);
    }
  }
  return output;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function dateFromTaskTime(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function displayTopic(value) {
  return String(value || '')
    .replace(/^\d+(?:-\d+)?[.、]?\s*/, '')
    .replace(/（新增）/g, '')
    .trim();
}

function classifyManifestPath(relative) {
  const parts = String(relative || '').split('/');
  if (parts[0] !== 'capture' || parts[1] !== 'materials') return null;
  if (parts[2] === 'converted-md' && ['pdf', 'pdf-large', 'nonpdf'].includes(parts[3])) {
    if (!parts[4] || path.extname(relative).toLowerCase() !== '.md') return null;
    return { name: displayTopic(parts[4]), key: relative };
  }
  if (parts[2] === 'converted-md' && parts[3] === 'books') {
    if (!parts[4] || path.extname(relative).toLowerCase() !== '.md') return null;
    return { name: '书籍', key: relative };
  }
  if (parts[2] === 'wechat' && parts[3]) {
    if (path.extname(relative).toLowerCase() !== '.md') return null;
    return { name: `公众号／${displayTopic(parts[3])}`, key: relative };
  }
  if (parts[2] === 'papers' && parts[3]) {
    if (path.extname(relative).toLowerCase() !== '.md') return null;
    return { name: `论文／${displayTopic(parts[3])}`, key: relative };
  }
  if (parts[2] === 'legacy-originals' && parts[3]) {
    const ext = path.extname(relative).toLowerCase();
    if (['.md', '.html', '.json', '.jsonl', '.csv'].includes(ext)) return null;
    return { name: displayTopic(parts[3]), key: relative };
  }
  return null;
}

function collectTopics(vaultRoot, limit) {
  const manifest = path.join(vaultRoot, 'catalog', 'migration', 'file-manifest.jsonl');
  const counts = new Map();
  const seen = new Set();
  if (fs.existsSync(manifest)) {
    const lines = fs.readFileSync(manifest, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const item = classifyManifestPath(row.target_rel);
        if (!item || !item.name || seen.has(item.key)) continue;
        seen.add(item.key);
        counts.set(item.name, (counts.get(item.name) || 0) + 1);
      } catch {}
    }
  }

  if (!counts.size) {
    for (const baseName of ['materials-md', 'materials-origin']) {
      const base = path.join(vaultRoot, 'capture', baseName);
      for (const filePath of walkFiles(base)) {
        const relative = path.relative(base, filePath);
        const first = relative.split(path.sep)[0];
        if (!first || first === 'README.md') continue;
        const name = displayTopic(first);
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  }

  const all = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  const visible = all.slice(0, limit);
  const rest = all.slice(limit).reduce((sum, item) => sum + item.count, 0);
  if (rest) visible.push({ name: '其他', count: rest });
  return { items: visible, total: all.reduce((sum, item) => sum + item.count, 0) };
}

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function collectReports(vaultRoot) {
  return walkFiles(
    path.join(vaultRoot, 'capture', 'jobs'),
    (filePath) => /(?:_report|run_report)\.json$/i.test(path.basename(filePath)),
  ).map((filePath) => ({ filePath, payload: readJsonSafe(filePath) }))
    .filter((entry) => entry.payload);
}

function reportDate(entry) {
  const task = dateFromTaskTime(entry.payload.task_time) || dateFromTaskTime(path.basename(entry.filePath));
  if (task) return task;
  return localDateKey(fs.statSync(entry.filePath).mtime);
}

function successfulRows(payload) {
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.filter((row) => row && String(row.status || 'ok').toLowerCase() === 'ok');
}

function collectToday(reports, now, limit) {
  const today = localDateKey(now);
  const items = [];
  const seen = new Set();
  for (const report of reports) {
    if (reportDate(report) !== today) continue;
    for (const row of successfulRows(report.payload)) {
      const title = String(row.title || row.excel_title || '').trim();
      if (!title || seen.has(title)) continue;
      seen.add(title);
      items.push({
        title: title.slice(0, 90),
        account: String(row.account || report.payload.user_name || '').slice(0, 40),
        publishedAt: String(row.published_at || ''),
      });
    }
  }
  items.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return { total: items.length, items: items.slice(0, limit) };
}

function dayKeys(now, days) {
  const output = [];
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(noon);
    date.setDate(date.getDate() - index);
    output.push(localDateKey(date));
  }
  return output;
}

function countFilesByMtime(root, extension, keys) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const filePath of walkFiles(root, (item) => !extension || path.extname(item).toLowerCase() === extension)) {
    const key = localDateKey(fs.statSync(filePath).mtime);
    if (Object.hasOwn(counts, key)) counts[key] += 1;
  }
  return counts;
}

function countSynced(vaultRoot) {
  const ids = new Set();
  for (const filePath of walkFiles(path.join(vaultRoot, 'weknora'), (item) => item.includes(`${path.sep}state${path.sep}sync${path.sep}`) && item.endsWith('.json'))) {
    const payload = readJsonSafe(filePath);
    for (const [relative, metadata] of Object.entries((payload && payload.files) || {})) {
      ids.add(metadata.knowledge_id || relative);
    }
  }
  return ids.size;
}

function collectTrends(vaultRoot, reports, now, days) {
  const keys = dayKeys(now, days);
  const sourceCounts = Object.fromEntries(keys.map((key) => [key, 0]));
  for (const report of reports) {
    const key = reportDate(report);
    if (Object.hasOwn(sourceCounts, key)) sourceCounts[key] += successfulRows(report.payload).length;
  }
  const atomicCounts = countFilesByMtime(path.join(vaultRoot, 'knowledge'), '.md', keys);
  const pendingReview = walkFiles(path.join(vaultRoot, 'knowledge'), (item) => item.endsWith('.md') && item.includes(`${path.sep}atomic${path.sep}draft${path.sep}`)).length;
  const published = walkFiles(path.join(vaultRoot, 'weknora'), (item) => item.endsWith('.md') && item.includes(`${path.sep}input${path.sep}`)).length;
  return {
    recentSources: Object.values(sourceCounts).reduce((sum, value) => sum + value, 0),
    recentAtomicCards: Object.values(atomicCounts).reduce((sum, value) => sum + value, 0),
    pendingReview,
    published,
    synced: countSynced(vaultRoot),
    daily: keys.map((date) => ({ date, sources: sourceCounts[date], atomicCards: atomicCounts[date] })),
  };
}

function disabledResult(now, error) {
  return {
    ok: false,
    disabled: !error,
    fetchedAt: now.toISOString(),
    topics: [],
    topicFiles: 0,
    today: { total: 0, items: [] },
    trends: { recentSources: 0, recentAtomicCards: 0, pendingReview: 0, published: 0, synced: 0, daily: [] },
    error: error || '未启用知识库统计',
  };
}

function collectKnowledgeBase(config = {}, now = new Date()) {
  if (!config.enabled) return disabledResult(now);
  const vaultRoot = String(config.vaultRoot || '').trim();
  if (!vaultRoot || !fs.existsSync(vaultRoot)) return disabledResult(now, '知识库目录不存在');
  try {
    const reports = collectReports(vaultRoot);
    const topicData = collectTopics(vaultRoot, Math.max(1, Number(config.topicLimit) || 8));
    return {
      ok: true,
      fetchedAt: now.toISOString(),
      topics: topicData.items,
      topicFiles: topicData.total,
      today: collectToday(reports, now, Math.max(1, Number(config.todayTitleLimit) || 5)),
      trends: collectTrends(vaultRoot, reports, now, Math.max(2, Number(config.trendDays) || 7)),
      error: null,
    };
  } catch (error) {
    return disabledResult(now, String(error && error.message || error).slice(0, 160));
  }
}

module.exports = {
  classifyManifestPath,
  collectKnowledgeBase,
  displayTopic,
  localDateKey,
};
