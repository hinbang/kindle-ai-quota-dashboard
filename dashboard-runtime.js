(function (win, doc) {
  'use strict';

  var settings = {
    fallbackData: 'data.js',
    endpointPointer: 'live-endpoint.js',
    pollEvery: 3 * 60 * 1000,
    pollOffset: 5000,
    cacheKey: 'kindle_ai_quota_cache_v3',
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
  function validWordCloud(value) {
    return !!value && typeof value.ok === 'boolean' && validTime(value.fetchedAt, false) &&
      Array.isArray(value.terms);
  }
  function validPayload(data) {
    var index;
    if (!data || !validTime(data.updatedAt, false) || !data.sources || !validWeather(data.weather) || !validKnowledgeBase(data.knowledgeBase)) return false;
    if (!validWordCloud(data.wordCloud)) return false;
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

  var cloudState = { terms: null, count: 0 };

  function measureText(text, size) {
    var canvas;
    var context;
    try {
      canvas = doc.createElement('canvas');
      context = canvas && canvas.getContext && canvas.getContext('2d');
    } catch (error) {
      context = null;
    }
    if (context) {
      context.font = '700 ' + size + 'px Arial, "PingFang SC", sans-serif';
      if (context.measureText) return context.measureText(String(text)).width;
    }
    var width = 0;
    var value = String(text);
    for (var i = 0; i < value.length; i += 1) {
      width += value.charCodeAt(i) > 255 ? size : size * 0.56;
    }
    return width;
  }

  function overlaps(x, y, w, h, placed) {
    for (var i = 0; i < placed.length; i += 1) {
      var item = placed[i];
      if (x < item.x + item.w && x + w > item.x && y < item.y + item.h && y + h > item.y) return true;
    }
    return false;
  }

  /** Archimedean spiral out of the centre: the heaviest term lands dead centre. */
  function findSpot(w, h, placed, width, height, cx, cy) {
    for (var step = 0; step < 6000; step += 1) {
      var angle = step * 0.28;
      var radius = 1.6 * step;
      var x = cx + Math.cos(angle) * radius - w / 2;
      var y = cy + Math.sin(angle) * radius * 0.75 - h / 2;
      if (x < 0 || y < 0 || x + w > width || y + h > height) continue;
      if (!overlaps(x, y, w, h, placed)) return { x: x, y: y };
    }
    return null;
  }

  function renderCloudLayout(container, terms) {
    /* offsetWidth/Height give the unrotated box; getBoundingClientRect returns a
       swapped AABB when the whole board is rotated 90 degrees. */
    var width = Math.round(container.offsetWidth || 0);
    var height = Math.round(container.offsetHeight || 0);
    if (!width || !height) {
      var box = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
      width = box ? Math.round(box.width) : 0;
      height = box ? Math.round(box.height) : 0;
    }
    if (!width || !height) return false;

    var maxCount = 1;
    terms.forEach(function (item) { maxCount = Math.max(maxCount, Number(item.count) || 0); });

    var shortest = Math.min(width, height);
    var minSize = Math.max(12, Math.round(shortest * 0.017));
    var maxSize = Math.max(minSize + 8, Math.round(shortest * 0.175));
    var cx = width / 2;
    var cy = height / 2;
    var placed = [];
    var html = '';

    terms.forEach(function (item, index) {
      var count = Number(item.count) || 0;
      var ratio = Math.max(0.02, count / maxCount);
      var size = Math.round(minSize + (maxSize - minSize) * Math.pow(ratio, 0.38));
      var spot = null;
      var textWidth = 0;
      var textHeight = 0;
      var attempt = 0;
      var pad = 16;
      // Shrink, then tighten the gap, before giving up: small tail words still
      // need to reach the page edges or the cloud looks half empty.
      while (attempt < 8) {
        pad = attempt < 2 ? 16 : (attempt < 5 ? 12 : 8);
        textWidth = Math.ceil(measureText(item.text, size));
        textHeight = Math.ceil(size * 1.06);
        spot = findSpot(textWidth + pad, textHeight + pad, placed, width, height, cx, cy);
        if (spot) break;
        size = Math.max(10, Math.round(size * 0.85));
        attempt += 1;
      }
      if (!spot) return;
      placed.push({ x: spot.x, y: spot.y, w: textWidth + pad, h: textHeight + pad });
      var tone = index < 3 ? 'w1' : (index < 10 ? 'w2' : (index < 24 ? 'w3' : 'w4'));
      html += '<span class="cloud-term ' + tone + '" style="left:' + Math.round(spot.x + 8) + 'px;top:' + Math.round(spot.y + 8) + 'px;' +
        'font-size:' + size + 'px;line-height:' + textHeight + 'px">' + escapeHtml(item.text) + '</span>';
    });

    ui.html(container, html || '<div class="cloud-empty">暂无可排布的关键词</div>');
    return placed.length > 0;
  }

  function renderCloudFlow(container, terms) {
    var html = '';
    terms.forEach(function (item, index) {
      var size = 16 + Math.round(Math.sqrt(Math.max(0.02, Number(item.weight) || 0.02)) * 54);
      var tone = index < 3 ? 'w1' : (index < 10 ? 'w2' : (index < 22 ? 'w3' : 'w4'));
      html += '<span class="cloud-term ' + tone + '" style="font-size:' + size + 'px">' + escapeHtml(item.text) + '</span>';
    });
    ui.html(container, html || '<div class="cloud-empty">暂无关键词</div>');
  }

  function updateWordCloud(cloud) {
    var terms = (cloud && cloud.terms) || [];
    var max = 0;
    terms.forEach(function (item) { max = Math.max(max, Number(item.count) || 0); });
    cloudState.terms = terms;
    cloudState.count = terms.length;

    var container = ui.find('cloudTerms');
    if (container && terms.length) {
      var laidOut = renderCloudLayout(container, terms);
      if (!laidOut) renderCloudFlow(container, terms);
    } else if (container) {
      ui.html(container, '<div class="cloud-empty">暂无关键词</div>');
    }

    if (ui.find('cloudMeta')) {
      ui.text('cloudMeta', terms.length
        ? terms.length + ' 个词 · ' + ((cloud && cloud.docCount) || 0) + ' 篇文档 · 最高 ' + max + ' 篇'
        : ((cloud && cloud.error) || '暂无数据'));
    }
  }

  /** Re-run the packed layout when page 2 becomes visible (hidden boxes have no size). */
  function relayoutCloud() {
    if (!cloudState.terms || !cloudState.terms.length) return;
    var container = ui.find('cloudTerms');
    if (container) renderCloudLayout(container, cloudState.terms);
  }

  function showPage(page) {
    var target = page === 2 ? 2 : 1;
    var overview = ui.find('pageOverview');
    var cloud = ui.find('pageCloud');
    var tab1 = ui.find('tabOverview');
    var tab2 = ui.find('tabCloud');
    if (overview) ui.className(overview, target === 1 ? 'page active' : 'page');
    if (cloud) ui.className(cloud, target === 2 ? 'page active' : 'page');
    if (tab1) ui.className(tab1, target === 1 ? 'tab active' : 'tab');
    if (tab2) ui.className(tab2, target === 2 ? 'tab active' : 'tab');
    state.page = target;
    /* Page 2 uses the whole screen: the header collapses while the cloud is shown. */
    ui.className(doc.body, target === 2 ? 'cloud-mode' : '');
    if (target === 2) {
      setTimeout(function () { relayoutCloud(); }, 30);
    }
  }
  var ROT_KEY = 'kindle_board_rot';

  function rotationOn() {
    return String(doc.documentElement.className || '').indexOf('rot90') >= 0;
  }

  function setRotation(on, persist) {
    ui.className(doc.documentElement, on ? 'rot90' : '');
    var btn = ui.find('rotateBtn');
    if (btn) ui.textNode(btn, on ? '⟲ 竖排' : '⟳ 横排');
    if (persist) {
      try { if (win.localStorage) win.localStorage.setItem(ROT_KEY, on ? '1' : '0'); } catch (error) {}
    }
    setTimeout(function () { relayoutCloud(); }, 40);
  }

  function bindTabs() {
    var tab1 = ui.find('tabOverview');
    var tab2 = ui.find('tabCloud');
    if (tab1) tab1.onclick = function () { showPage(1); };
    if (tab2) tab2.onclick = function () { showPage(2); };
    var close = ui.find('closeBtn');
    if (close) close.onclick = function () { requestClose(); };
    var rotate = ui.find('rotateBtn');
    if (rotate) rotate.onclick = function () { setRotation(!rotationOn(), true); };
  }

  /**
   * Closing the page is only a fallback: the launcher watches the bottom-right
   * corner and kills the browser itself, which is what restores the Kindle UI.
   * window.close() is delayed so the launcher can win first; if the page closes
   * on its own the browser can stay alive showing white, which strands the GUI.
   */
  function requestClose() {
    var close = ui.find('closeBtn');
    var status = ui.find('dataStatus');
    if (close) ui.textNode(close, '…');
    if (status) ui.textNode(status, '正在退出…');
    setTimeout(function () {
      try { win.close(); } catch (error) {}
    }, 1500);
  }

  function present(data, fromCache) {
    if (!validPayload(data)) return false;
    if (state.renderedAt && timestamp(data.updatedAt) < timestamp(state.renderedAt)) return false;
    if (!fromCache && !storeCache(data)) return false;
    state.latest = data; state.usingCache = !!fromCache;
    if (data.updatedAt !== state.renderedAt) {
      state.renderedAt = data.updatedAt;
      updateAiSummary(data.sources); updateKnowledgeBase(data.knowledgeBase); updateWordCloud(data.wordCloud);
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
  /* Rotation comes from the URL first, then from the last in-page toggle. */
  (function applyRotation() {
    var rotate = queryValue('rotate');
    var stored = null;
    try { stored = win.localStorage ? win.localStorage.getItem(ROT_KEY) : null; } catch (error) {}
    var wanted = (rotate !== null && rotate !== '')
      ? Number(rotate) === 90
      : stored === '1';
    setRotation(wanted, false);
  }());
  bindTabs();
  showPage(Number(queryValue('page')) === 2 ? 2 : 1);
  updateClock(); updateBattery();
  if (!isQuiet()) refresh();
  scheduleRefresh(); scheduleMinuteClock();
}(window, document));
