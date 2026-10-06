(function (win, doc) {
  'use strict';

  var settings = {
    fallbackData: 'data.js',
    endpointPointer: 'live-endpoint.js',
    pollEvery: 3 * 60 * 1000,
    pollOffset: 5000,
    cacheKey: 'kindle_ai_quota_cache_v2',
    maxCacheAge: 24 * 60 * 60 * 1000,
    quietStart: 3,
    quietEnd: 8
  };
  var state = { endpoint: win.DASH_LIVE_ENDPOINT || settings.fallbackData, latest: null, renderedAt: '', usingCache: false, requestId: 0 };
  var sourceNames = ['claude', 'codex', 'kimi', 'deepseek'];
  var weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var ui = {
    find: function (id) { return doc.getElementById(id); },
    textNode: function (node, value) { var next = String(value); if (node && node.textContent !== next) node.textContent = next; },
    text: function (id, value) { ui.textNode(ui.find(id), value); },
    html: function (node, value) { if (node && node.innerHTML !== value) node.innerHTML = value; },
    className: function (node, value) { if (node && node.className !== value) node.className = value; }
  };

  function twoDigits(value) { return value < 10 ? '0' + value : String(value); }
  function timestamp(value) { var parsed = Date.parse(value || ''); return isNaN(parsed) ? 0 : parsed; }
  function finiteNumber(value) { return typeof value === 'number' && isFinite(value); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function formatNumber(value) {
    var text = String(Math.max(0, Math.round(Number(value) || 0)));
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function validTime(value, nullable) { return nullable && value == null ? true : timestamp(value) > 0; }
  function validWindow(value) {
    return !!value && typeof value.name === 'string' && finiteNumber(value.usedPct) &&
      value.usedPct >= 0 && value.usedPct <= 100 && validTime(value.resetAt, true) &&
      (value.barPct == null || (finiteNumber(value.barPct) && value.barPct >= 0 && value.barPct <= 100));
  }
  function validSource(name, source) {
    var index;
    if (!source || typeof source.ok !== 'boolean' || typeof source.label !== 'string' || !validTime(source.fetchedAt, false)) return false;
    if (name === 'deepseek') return !source.ok || finiteNumber(source.balance);
    if (!Array.isArray(source.windows)) return false;
    for (index = 0; index < source.windows.length; index += 1) if (!validWindow(source.windows[index])) return false;
    return true;
  }
  function validWeather(weather) { return !!weather && typeof weather.ok === 'boolean' && validTime(weather.fetchedAt, false); }
  function validKnowledgeBase(value) {
    return !!value && typeof value.ok === 'boolean' && validTime(value.fetchedAt, false) &&
      Array.isArray(value.topics) && value.today && Array.isArray(value.today.items) &&
      value.trends && Array.isArray(value.trends.daily);
  }
  function validPayload(data) {
    var index;
    if (!data || !validTime(data.updatedAt, false) || !data.sources || !validWeather(data.weather) || !validKnowledgeBase(data.knowledgeBase)) return false;
    for (index = 0; index < sourceNames.length; index += 1) if (!validSource(sourceNames[index], data.sources[sourceNames[index]])) return false;
    return true;
  }

  function readCache() {
    var raw; var parsed;
    try {
      raw = win.localStorage && win.localStorage.getItem(settings.cacheKey);
      if (!raw) return null;
      parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 2 || !validPayload(parsed.payload)) return null;
      if (Date.now() - timestamp(parsed.payload.updatedAt) > settings.maxCacheAge) { win.localStorage.removeItem(settings.cacheKey); return null; }
      return parsed.payload;
    } catch (error) { return null; }
  }
  function storeCache(data) {
    var cached;
    if (!validPayload(data)) return false;
    cached = readCache();
    if (cached && timestamp(data.updatedAt) < timestamp(cached.updatedAt)) return false;
    try { if (win.localStorage) win.localStorage.setItem(settings.cacheKey, JSON.stringify({ version: 2, payload: data })); } catch (error) {}
    return true;
  }

  function clockText(value) { var date = new Date(value); return isNaN(date.getTime()) ? '--:--' : twoDigits(date.getHours()) + ':' + twoDigits(date.getMinutes()); }
  function isQuiet(date) { var hour = (date || new Date()).getHours(); return hour >= settings.quietStart && hour < settings.quietEnd; }
  function millisecondsUntilMorning(date) {
    var now = date || new Date();
    var morning = new Date(now.getFullYear(), now.getMonth(), now.getDate(), settings.quietEnd, 0, 5, 0);
    return Math.max(1000, morning.getTime() - now.getTime());
  }
  function updateFreshness() {
    var lastUpdate = state.latest && state.latest.updatedAt;
    var age = lastUpdate ? Math.floor((Date.now() - timestamp(lastUpdate)) / 60000) : 99999;
    var status = ui.find('dataStatus'); var alert = ui.find('dataAlert');
    if (isQuiet()) { ui.textNode(status, '夜间省电 · 08:00恢复'); ui.className(status, ''); ui.textNode(alert, ''); ui.className(alert, 'data-alert'); return; }
    if (state.latest && state.usingCache) { ui.textNode(status, '缓存 · ' + age + ' 分钟前'); ui.className(status, 'warn'); ui.textNode(alert, '网络暂时不可用 · 显示最近一次有效数据'); ui.className(alert, 'data-alert on'); return; }
    if (!state.latest || age > 30) { ui.textNode(status, '离线 · 最后 ' + clockText(lastUpdate)); ui.className(status, 'warn'); ui.textNode(alert, '数据链路已离线 · 最后在线 ' + clockText(lastUpdate)); ui.className(alert, 'data-alert on'); return; }
    if (age >= 7) { ui.textNode(status, '延迟 ' + age + ' 分钟'); ui.className(status, 'warn'); ui.textNode(alert, '数据延迟 · 正在显示最后一次结果'); ui.className(alert, 'data-alert on'); return; }
    ui.textNode(status, '实时 · ' + clockText(lastUpdate)); ui.className(status, ''); ui.textNode(alert, ''); ui.className(alert, 'data-alert');
  }
  function updateClock() {
    var now = new Date();
    ui.text('dtTime', twoDigits(now.getHours()) + ':' + twoDigits(now.getMinutes()));
    ui.text('dtDate', now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日');
    ui.text('dtWeek', weekdays[now.getDay()]); updateFreshness();
  }
  function queryValue(name) {
    var match = String(location.search || '').match(new RegExp('[?&]' + name + '=([^&]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function updateBattery() {
    var percentText = queryValue('battery'); var percent = percentText !== null ? Number(percentText) : null;
    var device = win.KINDLE_DEVICE;
    if (device && typeof device.battery === 'number') percent = device.battery;
    if (percent === null || isNaN(percent)) return;
    ui.text('batPct', Math.max(0, Math.min(100, percent)) + '%');
  }

  function quotaText(source) {
    var windowData;
    if (!source || !source.ok) return source && source.label ? source.label + ' --' : '';
    windowData = source.windows && source.windows[0];
    return source.label + ' ' + (windowData ? Math.round(Number(windowData.usedPct) || 0) + '%' : '--');
  }
  function updateAiSummary(sources) {
    var values = [];
    values.push(quotaText(sources.claude)); values.push(quotaText(sources.codex)); values.push(quotaText(sources.kimi));
    values.push(sources.deepseek && sources.deepseek.ok ? 'DeepSeek ¥' + Number(sources.deepseek.balance).toFixed(2) : 'DeepSeek --');
    ui.text('aiSummary', values.filter(Boolean).join(' ｜ '));
  }
  function updateTopics(kb) {
    var topics = kb.topics || []; var max = 1; var html = '';
    topics.forEach(function (item) { max = Math.max(max, Number(item.count) || 0); });
    topics.forEach(function (item) {
      var width = Math.max(1, Math.round((Number(item.count) || 0) / max * 100));
      html += '<div class="topic-row"><div class="topic-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="topic-count mono">' + formatNumber(item.count) + '</div>' +
        '<div class="topic-bar"><div class="topic-fill" style="width:' + width + '%"></div></div></div>';
    });
    ui.text('topicTotal', formatNumber(kb.topicFiles) + ' 个文件');
    ui.html(ui.find('topicList'), html || '<div class="empty">暂无主题数据</div>');
  }
  function updateToday(today) {
    var html = '';
    (today.items || []).forEach(function (item) {
      html += '<div class="today-item"><div class="today-account">' + escapeHtml(item.account || '今日采集') + '</div>' +
        '<div class="today-title">' + escapeHtml(item.title) + '</div></div>';
    });
    ui.text('todayTotal', formatNumber(today.total) + ' 篇');
    ui.html(ui.find('todayList'), html || '<div class="empty">今日暂无新增</div>');
  }
  function shortDay(value) { var date = new Date(value + 'T12:00:00'); return isNaN(date.getTime()) ? '' : weekdays[date.getDay()].slice(1); }
  function updateTrends(trends) {
    var daily = trends.daily || []; var max = 1; var html = '';
    ui.text('metricSources', formatNumber(trends.recentSources));
    ui.text('metricAtomic', formatNumber(trends.recentAtomicCards));
    ui.text('metricPending', formatNumber(trends.pendingReview));
    ui.text('metricPublished', formatNumber(trends.published) + ' / ' + formatNumber(trends.synced));
    daily.forEach(function (item) { max = Math.max(max, Number(item.sources) || 0); });
    daily.forEach(function (item) {
      var height = Math.max(2, Math.round((Number(item.sources) || 0) / max * 90));
      html += '<div class="spark-col"><div class="spark-bar" style="height:' + height + '%"></div><div class="spark-day">' + escapeHtml(shortDay(item.date)) + '</div></div>';
    });
    ui.html(ui.find('trendChart'), html);
  }
  function updateKnowledgeBase(kb) {
    if (!kb || !kb.ok) {
      ui.html(ui.find('topicList'), '<div class="empty">知识库统计不可用</div>');
      ui.html(ui.find('todayList'), '<div class="empty">今日暂无新增</div>');
      return;
    }
    updateTopics(kb); updateToday(kb.today); updateTrends(kb.trends);
  }

  function present(data, fromCache) {
    if (!validPayload(data)) return false;
    if (state.renderedAt && timestamp(data.updatedAt) < timestamp(state.renderedAt)) return false;
    if (!fromCache && !storeCache(data)) return false;
    state.latest = data; state.usingCache = !!fromCache;
    if (data.updatedAt !== state.renderedAt) {
      state.renderedAt = data.updatedAt;
      updateAiSummary(data.sources); updateKnowledgeBase(data.knowledgeBase);
    }
    updateFreshness(); return true;
  }
  function showValidatedCache() { var cached = readCache(); return cached ? present(cached, true) : false; }

  function attachScript(url, onSuccess, onFailure) {
    var script = doc.createElement('script'); script.async = true; script.src = url;
    script.onload = function () { if (script.parentNode) script.parentNode.removeChild(script); if (onSuccess) onSuccess(); };
    script.onerror = function () { if (script.parentNode) script.parentNode.removeChild(script); if (onFailure) onFailure(); };
    doc.getElementsByTagName('head')[0].appendChild(script);
  }
  function requestData(url, canFallback) {
    var requestId; var separator;
    if (!url || url.indexOf('__LIVE_') === 0) return;
    requestId = ++state.requestId; separator = url.indexOf('?') < 0 ? '?' : '&'; win.DASH_DATA = null;
    attachScript(url + separator + '_=' + Date.now(), function () {
      if (requestId !== state.requestId) return;
      if (!present(win.DASH_DATA, false)) {
        if (canFallback && url !== settings.fallbackData) requestData(settings.fallbackData, false);
        else { state.usingCache = true; if (!showValidatedCache()) updateFreshness(); }
      }
    }, function () {
      if (requestId !== state.requestId) return;
      if (canFallback && url !== settings.fallbackData) requestData(settings.fallbackData, false);
      else { state.usingCache = true; if (!showValidatedCache()) updateFreshness(); }
    });
  }
  function refresh() {
    win.DASH_LIVE_ENDPOINT = '';
    attachScript(settings.endpointPointer + '?_=' + Date.now(), function () {
      var supplied = win.DASH_LIVE_ENDPOINT || '';
      state.endpoint = supplied && supplied.indexOf('__LIVE_') !== 0 ? supplied : settings.fallbackData;
      requestData(state.endpoint, true);
    }, function () { state.endpoint = settings.fallbackData; requestData(state.endpoint, false); });
  }
  function scheduleRefresh() {
    var now = new Date(); var milliseconds = now.getTime(); var delay;
    if (isQuiet(now)) delay = millisecondsUntilMorning(now);
    else { delay = (settings.pollOffset - (milliseconds % settings.pollEvery) + settings.pollEvery) % settings.pollEvery; if (delay < 250) delay += settings.pollEvery; }
    setTimeout(function () { if (!isQuiet()) refresh(); scheduleRefresh(); }, delay);
  }
  function scheduleMinuteClock() {
    var now = new Date(); var delay = isQuiet(now) ? millisecondsUntilMorning(now) : 60000 - (now.getTime() % 60000) + 100;
    setTimeout(function () { updateClock(); scheduleMinuteClock(); }, delay);
  }

  if (!present(win.DASH_DATA, false)) showValidatedCache();
  updateClock(); updateBattery();
  if (!isQuiet()) refresh();
  scheduleRefresh(); scheduleMinuteClock();
}(window, document));
