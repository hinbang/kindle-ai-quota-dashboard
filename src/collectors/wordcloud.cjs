'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Function characters that must never survive inside a keyword candidate.
 * Kept narrow on purpose: negation and aspect characters such as 不/无/非/有
 * appear inside real domain terms (e.g. 不确定性), so they are allowed.
 */
const STOP_CHARS = new Set(Array.from('的了着过是和与及或把被从向于为对就都而也还很更最这那其之以等个我你他她它们吗呢吧啊呀哦'));

/** Characters that may not open or close a keyword. */
const EDGE_STOP = new Set(Array.from('的了着过是和与及或把被从向于为对就都而也还很更最这那其之以等个我你他她它们吗呢吧啊呀哦并且但则即若因由使让给将却该此本每各另何谁又再只已并没太'));

const LATIN_STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'you', 'your', 'our', 'its', 'their',
  'can', 'will', 'would', 'should', 'could', 'into', 'than', 'then', 'there',
  'http', 'https', 'www', 'com', 'html', 'png', 'jpg', 'pdf', 'md',
]);

const CJK_RUN = /[\u4e00-\u9fff]+/g;

/** Acronyms that carry real meaning; other uppercase strings are treated as codes. */
const LATIN_ALLOW = new Set([
  'ai', 'gpt', 'gpu', 'cpu', 'api', 'llm', 'agi', 'gai', 'rag', 'stem', 'trl',
  'sbir', 'sttr', 'ppp', 'ipo', 'vc', 'sme', 'smes', 'gdp', 'rd', 'esg',
  'oecd', 'wto', 'imf', 'nato', 'eu', 'us', 'uk', 'un', 'mit', 'nsf', 'darpa',
  'nasa', 'doe', 'nih', 'sem', 'cnc', 'iot', 'ev', 'evs', '5g', '6g', 'moe',
]);

/** Sections of an atomic card that carry propositions rather than template fields. */
const CARD_SECTIONS = ['核心命题', '解释', '判断', '结论'];

/**
 * Generic content words: frequent in any analytical prose, so they say nothing
 * about what this knowledge base is actually about. Domain nouns (政府/教育/
 * 企业/大学/产业链) are deliberately NOT listed here.
 */
const GENERIC_TERMS = new Set([
  '实现', '提供', '降低', '提高', '增加', '减少', '替代', '取代', '直接', '间接',
  '管理', '识别', '案例', '信息', '支持', '不足', '区分', '实践', '部分', '全部',
  '定义', '构成', '构建', '关系', '建设', '合作', '结果', '深度', '无法', '显示',
  '产生', '分别', '进入', '团队', '控制', '连接', '特征', '成为', '作为', '认为',
  '指出', '强调', '说明', '表示', '发现', '分析', '研究', '探讨', '介绍', '描述',
  '讨论', '总结', '回顾', '展望', '需要', '必须', '应该', '要求', '影响', '作用',
  '意义', '问题', '方面', '情况', '过程', '条件', '方式', '方法', '手段', '措施',
  '能力', '水平', '程度', '范围', '内容', '形式', '具有', '存在', '出现', '带来',
  '导致', '面临', '涉及', '包括', '属于', '形成', '推动', '促进', '采用', '利用',
  '通过', '同时', '此外', '因此', '然而', '例如', '鉴于', '值得', '综上', '所谓',
  '相应', '依据', '聚焦', '涵盖', '引用', '建议', '帮助', '希望', '起点', '赋予',
  '暴露', '大小', '通道', '空间', '目标', '本文', '研究', '两者', '各方', '不同',
  '相同', '相关', '重要', '主要', '基本', '核心', '关键', '整体', '具体', '一般',
  '有所', '一定', '进一步', '不断', '持续', '有效', '完整', '明显', '显著', '相对',
  '实际上', '至关重要', '密切相关', '联系起来', '建立在', '扩展到', '停留在',
  '大程度', '大程度上', '研究表明', '本文提出', '在本文中', '原文链接', '阅读原文',
  '推荐阅读', '关键词', '引言', '报名', '读书', '课程', '精品', '学园', '字幕',
  '公众号', '文章汇编', '编辑部', '转载', '版权', '声明', '点击', '关注', '扫码',
  '表明', '建立', '解决', '理解', '支撑', '报道', '层面', '迭代', '发生', '产出',
  '时间', '既有', '真正', '早期', '实际', '承担', '反馈', '结合', '嵌入', '统一',
  '选择', '改变', '效率', '功能', '环节', '重构', '边界',
  '逻辑', '共享', '收益', '学术', '协作', '架构', '人类', '学习', '优化', '资金',
  '规律', '激励', '决策', '跨越', '融资', '保护', '处理', '规划', '历史', '测试',
  '定位', '界定', '区别', '数量', '归纳', '论文', '角色', '价值', '背景', '趋势',
  '决定', '扩大', '门槛', '设备', '维度', '一种', '资助', '短期', '国际', '活动',
  '明确', '取决', '三类', '少数', '现代', '证据', '阶段', '本身', '单一', '多种',
  '不仅', '获得', '简单', '往往', '现实', '性能', '责任', '转变', '量化',
]);

function stripMarkup(text) {
  return String(text || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[#>*\-+\s]+/gm, ' ')
    .replace(/[`*_~]/g, ' ');
}

function frontmatterOf(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

/**
 * Atomic cards are highly templated. Counting raw card text surfaces the
 * template (适用范围 / 生命周期 / contested / source_checked) instead of the
 * knowledge, so only the proposition-bearing sections are analysed.
 */
function cardContent(text) {
  const fields = frontmatterOf(text);
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const parts = [];

  const chunks = body.split(/^##\s+/m);
  for (const chunk of chunks) {
    const newline = chunk.indexOf('\n');
    const heading = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const content = newline === -1 ? '' : chunk.slice(newline + 1);
    if (CARD_SECTIONS.includes(heading)) parts.push(content);
  }
  if (!parts.length) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1) parts.push(h1[1]);
    else parts.push(body);
  }
  return { title: fields.title || '', body: parts.join('\n') };
}

function isCardFile(file) {
  return file.split(/[\\/]/).includes('atomic');
}

function listMarkdown(root) {
  const output = [];
  if (!root || !fs.existsSync(root)) return output;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(full);
    }
  }
  return output.sort();
}

/**
 * Body text is scanned up to four characters: longer windows in prose mostly
 * produce cross-word spans ("世界模型需要"). Curated card titles are scanned
 * further, because that is where genuine five- and six-character terms live
 * (新质生产力, 科技与产业创新).
 */
function candidateTerms(text, maxSize = 4) {
  const terms = [];
  const runs = String(text).match(CJK_RUN) || [];
  for (const run of runs) {
    const length = run.length;
    if (length < 2) continue;
    for (let size = 2; size <= maxSize; size += 1) {
      for (let start = 0; start + size <= length; start += 1) {
        terms.push(run.substr(start, size));
      }
    }
  }
  return terms;
}

function latinTerms(text) {
  const matches = String(text).match(/[A-Za-z][A-Za-z0-9+#.]{1,11}/g) || [];
  const output = [];
  for (const raw of matches) {
    const value = raw.replace(/\.+$/, '');
    const key = value.toLowerCase();
    if (key.length < 2) continue;
    if (LATIN_STOP.has(key)) continue;
    if (/^\d+$/.test(value)) continue;
    if (/^[A-Z]{2,6}$/.test(value) && !LATIN_ALLOW.has(key)) continue;
    if (!/^[A-Za-z]/.test(value)) continue;
    output.push(value);
  }
  return output;
}

function isUsableTerm(term) {
  if (term.length < 2) return false;
  for (const char of term) {
    if (STOP_CHARS.has(char)) return false;
  }
  if (EDGE_STOP.has(term[0])) return false;
  if (EDGE_STOP.has(term[term.length - 1])) return false;
  return true;
}

function substringsOf(term) {
  const output = new Set();
  const size = term.length;
  for (let span = 2; span < size; span += 1) {
    for (let start = 0; start + span <= size; start += 1) {
      output.add(term.substr(start, span));
    }
  }
  return output;
}

function collectWordCloud(config = {}, now = new Date()) {
  if (!config.enabled) {
    return { ok: false, fetchedAt: now.toISOString(), docCount: 0, terms: [], error: '未启用词云统计' };
  }
  const vaultRoot = String(config.vaultRoot || '').trim();
  if (!vaultRoot || !fs.existsSync(vaultRoot)) {
    return { ok: false, fetchedAt: now.toISOString(), docCount: 0, terms: [], error: '知识库目录不存在' };
  }

  const sources = Array.isArray(config.sources) && config.sources.length
    ? config.sources
    : ['knowledge/lantel/atomic', 'weknora/lantel/input', 'capture/materials-md'];
  const limit = Math.max(5, Math.min(120, Number(config.limit) || 60));
  const minDocs = Math.max(2, Number(config.minDocs) || 3);
  const maxCharsPerDoc = Math.max(2000, Number(config.maxCharsPerDoc) || 40000);

  const files = [];
  for (const relative of sources) {
    files.push(...listMarkdown(path.join(vaultRoot, relative)));
  }

  const df = new Map();
  const tf = new Map();
  const titleSeen = new Map();
  let docCount = 0;

  try {
    for (const file of files) {
      let rawText;
      try {
        rawText = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const isCard = isCardFile(file);
      const scoped = isCard ? cardContent(rawText) : { title: '', body: rawText };
      const clean = stripMarkup(scoped.body).slice(0, maxCharsPerDoc);
      if (clean.trim().length < 20) continue;
      docCount += 1;

      const seen = new Set();
      for (const term of candidateTerms(clean, 4)) {
        if (!isUsableTerm(term)) continue;
        tf.set(term, (tf.get(term) || 0) + 1);
        seen.add(term);
      }
      if (scoped.title) {
        for (const term of candidateTerms(stripMarkup(scoped.title), 8)) {
          if (!isUsableTerm(term)) continue;
          if (!titleSeen.has(term)) titleSeen.set(term, 0);
          titleSeen.set(term, titleSeen.get(term) + 1);
          tf.set(term, (tf.get(term) || 0) + 1);
          seen.add(term);
        }
      }
      for (const term of latinTerms(clean)) {
        seen.add(term);
        tf.set(term, (tf.get(term) || 0) + 1);
      }
      for (const term of seen) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }
  } catch (error) {
    return {
      ok: false,
      fetchedAt: now.toISOString(),
      docCount,
      terms: [],
      error: String((error && error.message) || error).slice(0, 160),
    };
  }

  const candidates = [];
  const twoCharFloor = Math.max(minDocs, Number(config.twoCharMinDocs) || 14);
  for (const [term, count] of df) {
    if (count < minDocs) continue;
    if (GENERIC_TERMS.has(term)) continue;
    if (term.length === 2 && count < twoCharFloor) continue;
    candidates.push({ text: term, count, tf: tf.get(term) || count });
  }
  candidates.sort((a, b) => b.text.length - a.text.length || b.count - a.count);

  const fragment = new Set();
  for (const item of candidates) {
    if (!/^[\u4e00-\u9fff]+$/.test(item.text) || item.text.length < 3) continue;
    for (const sub of substringsOf(item.text)) {
      const subCount = df.get(sub) || 0;
      if (subCount > 0 && subCount >= item.count * 0.8) fragment.add(sub);
    }
  }

  const scored = candidates
    .filter((item) => !fragment.has(item.text))
    .map((item) => {
      const lengthBoost = 1 + 0.15 * Math.max(0, item.text.length - 2);
      const titleBoost = titleSeen.has(item.text) ? 1.25 : 1;
      return { ...item, score: item.count * lengthBoost * titleBoost };
    })
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length || a.text.localeCompare(b.text, 'zh-CN'))
    .slice(0, limit);

  const maxScore = scored.length ? scored[0].score : 1;
  const terms = scored.map((item) => ({
    text: item.text,
    count: item.count,
    weight: Math.max(0.05, Math.round((item.score / maxScore) * 100) / 100),
  }));

  return {
    ok: terms.length > 0,
    fetchedAt: now.toISOString(),
    docCount,
    terms,
    error: terms.length ? null : '语料不足，未生成关键词',
  };
}

module.exports = {
  collectWordCloud,
  isUsableTerm,
  stripMarkup,
  STOP_CHARS,
};
