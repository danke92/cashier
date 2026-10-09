/* =========================================================
   收款台 · 主逻辑
   数据全部保存在本机浏览器 localStorage，不上传任何服务器
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var LS_RECORDS = 'cashier.records.v1';
  var LS_CONFIG  = 'cashier.config.v1';

  var METHOD_NAME = { wechat: '微信', alipay: '支付宝', cash: '现金', other: '其它' };
  var METHOD_COLOR = { wechat: '#07c160', alipay: '#1677ff', cash: '#f59e0b', other: '#8b5cf6' };
  var SCAN_METHODS = ['wechat', 'alipay'];

  /* ---------------- 状态 ---------------- */
  var state = {
    method: 'wechat',
    records: [],
    config: { qr: { wechat: '', alipay: '' }, link: { wechat: '', alipay: '' } },
    range: 'today',
    filter: 'all',
    keyword: '',
    lastDeleted: null
  };

  /* ---------------- DOM ---------------- */
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var el = {
    amountInput: $('#amountInput'),
    noteInput: $('#noteInput'),
    btnClear: $('#btnClear'),
    qrStage: $('#qrStage'),
    qrTitle: $('#qrTitle'),
    qrMethodTag: $('#qrMethodTag'),
    qrAmount: $('#qrAmount'),
    qrNote: $('#qrNote'),
    btnConfirm: $('#btnConfirm'),
    todayAmount: $('#todayAmount'),
    recordBody: $('#recordBody'),
    recordEmpty: $('#recordEmpty'),
    tableWrap: $('.table-wrap'),
    statToday: $('#statToday'),
    statTodayCount: $('#statTodayCount'),
    statMonth: $('#statMonth'),
    statMonthCount: $('#statMonthCount'),
    statAll: $('#statAll'),
    statAllCount: $('#statAllCount'),
    methodBars: $('#methodBars'),
    searchInput: $('#searchInput'),
    toastWrap: $('#toastWrap'),
    modal: $('#settingsModal')
  };

  /* ---------------- 工具函数 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function monthKey() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  function stampKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function money(n) {
    return '¥' + (Number(n) || 0).toFixed(2);
  }

  function prettyMoney(n) {
    return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatFullTime(ts) {
    var d = new Date(ts);
    return stampKey(ts).slice(5) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- 持久化 ---------------- */
  function loadStore() {
    try {
      var raw = localStorage.getItem(LS_RECORDS);
      state.records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.records)) state.records = [];
    } catch (e) {
      state.records = [];
    }
    try {
      var rawCfg = localStorage.getItem(LS_CONFIG);
      if (rawCfg) {
        var cfg = JSON.parse(rawCfg);
        state.config.qr = cfg && cfg.qr ? cfg.qr : { wechat: '', alipay: '' };
        state.config.link = cfg && cfg.link ? cfg.link : { wechat: '', alipay: '' };
      }
    } catch (e) { /* 保持默认 */ }
  }

  function saveRecords() {
    try {
      localStorage.setItem(LS_RECORDS, JSON.stringify(state.records));
    } catch (e) {
      toast('本机存储空间不足，记录可能未保存', 'error');
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(LS_CONFIG, JSON.stringify(state.config));
    } catch (e) {
      toast('收款码过大，未能保存到本机', 'error');
    }
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, type, action) {
    var box = document.createElement('div');
    box.className = 'toast' + (type ? ' ' + type : '');
    var text = document.createElement('span');
    text.textContent = msg;
    box.appendChild(text);

    if (action) {
      box.style.pointerEvents = 'auto';
      var btn = document.createElement('button');
      btn.textContent = action.label;
      btn.style.cssText = 'margin-left:6px;padding:4px 10px;border-radius:7px;' +
        'background:rgba(255,255,255,.18);color:#fff;font-size:12.5px;font-weight:600';
      btn.onclick = function () {
        action.onClick();
        dismiss();
      };
      box.appendChild(btn);
    }

    function dismiss() {
      box.classList.add('out');
      setTimeout(function () { box.remove(); }, 260);
    }

    el.toastWrap.appendChild(box);
    setTimeout(dismiss, action ? 4200 : 2200);
  }

  /* ---------------- 收款提示音 ---------------- */
  var audioCtx = null;
  function playDing() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var base = audioCtx.currentTime;
      [880, 1174.66].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        var t = base + i * 0.12;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.34);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    } catch (e) { /* 静默失败不影响记账 */ }
  }

  /* ---------------- 金额输入 ---------------- */
  function getAmountRaw() {
    return el.amountInput.value.trim();
  }

  function setAmount(v) {
    el.amountInput.value = v;
    syncQR();
  }

  function getAmount() {
    var v = parseFloat(getAmountRaw());
    return isNaN(v) ? 0 : v;
  }

  // 过滤非法字符，保留最多两位小数
  function sanitize(v) {
    v = v.replace(/[^0-9.]/g, '');
    var parts = v.split('.');
    if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
    var idx = v.indexOf('.');
    if (idx !== -1) {
      v = v.slice(0, idx) + '.' + v.slice(idx + 1).replace(/\./g, '');
      if (v.length - v.indexOf('.') - 1 > 2) v = v.slice(0, v.indexOf('.') + 3);
    }
    if (v.length > 10) v = v.slice(0, 10);
    return v;
  }

  function appendChar(ch) {
    var v = getAmountRaw();
    if (ch === '.') {
      if (v.indexOf('.') !== -1) return;
      if (v === '') v = '0';
      v += '.';
    } else if (ch === '00') {
      if (v === '' || v === '0') return;
      if (v.indexOf('.') !== -1 && v.length - v.indexOf('.') - 1 >= 2) return;
      v += '00';
    } else {
      if (v.indexOf('.') !== -1 && v.length - v.indexOf('.') - 1 >= 2) return;
      if (v === '0') v = ch;
      else v += ch;
    }
    setAmount(sanitize(v));
  }

  function addAmount(n) {
    var cur = getAmount();
    var next = (Math.round(cur * 100) + Math.round(n * 100)) / 100;
    if (next > 9999999) return;
    setAmount(String(next));
  }

  function backspace() {
    setAmount(getAmountRaw().slice(0, -1));
  }

  function clearAll() {
    setAmount('');
    el.amountInput.focus();
  }

  /* ---------------- 二维码渲染 ---------------- */
  function renderQR() {
    var m = state.method;
    el.qrMethodTag.textContent = METHOD_NAME[m];
    el.qrTitle.textContent = METHOD_NAME[m] + '收款';

    // 现金 / 其它：无需扫码
    if (SCAN_METHODS.indexOf(m) === -1) {
      var isCash = m === 'cash';
      el.qrStage.innerHTML =
        '<div class="qr-cash">' +
        '<div class="qc-icon">' + (isCash ? '💵' : '💳') + '</div>' +
        '<p>' + (isCash ? '当面收取现金' : '使用其它方式收款') + '<br>无需扫码，收款后点击确认即可</p>' +
        '</div>';
      return;
    }

    var img = state.config.qr[m] || '';
    var link = (state.config.link[m] || '').trim();

    if (img) {
      el.qrStage.innerHTML = '<img class="qr-img" src="' + img + '" alt="' + METHOD_NAME[m] + '收款码">';
      el.qrNote.textContent = '请让顾客扫描上方收款码付款';
      return;
    }

    if (link) {
      try {
        var qr = qrcode(0, 'M');
        qr.addData(link);
        qr.make();
        el.qrStage.innerHTML =
          '<div class="qr-svg-wrap">' + qr.createSvgTag({ cellSize: 6, margin: 2 }) + '</div>';
        el.qrNote.textContent = '请让顾客扫描上方二维码付款';
        return;
      } catch (e) {
        el.qrStage.innerHTML =
          '<div class="qr-blank"><div class="qb-icon">⚠️</div>' +
          '<p>收款链接过长，无法生成二维码</p>' +
          '<small>请改为上传收款码图片</small></div>';
        el.qrNote.textContent = '';
        return;
      }
    }

    el.qrStage.innerHTML =
      '<div class="qr-blank"><div class="qb-icon">▣</div>' +
      '<p>还没有设置' + METHOD_NAME[m] + '收款码</p>' +
      '<button class="btn btn-outline" id="gotoSettings">去设置</button></div>';
    el.qrNote.textContent = '';
    var go = $('#gotoSettings');
    if (go) go.onclick = openSettings;
  }

  function syncQR() {
    var v = getAmount();
    el.qrAmount.textContent = money(v);
    el.btnConfirm.disabled = v <= 0;
  }

  /* ---------------- 切换收款方式 ---------------- */
  function setMethod(m) {
    state.method = m;
    $$('#methodRow .method').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.method === m);
    });
    renderQR();
  }

  /* ---------------- 记账 ---------------- */
  function confirmPayment() {
    var amount = getAmount();
    if (amount <= 0) {
      toast('请先输入收款金额', 'error');
      el.amountInput.focus();
      return;
    }

    var rec = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      amount: Math.round(amount * 100) / 100,
      method: state.method,
      note: el.noteInput.value.trim(),
      ts: Date.now(),
      date: todayKey()
    };

    state.records.unshift(rec);
    saveRecords();

    playDing();
    toast('已收款 ' + money(rec.amount) + ' · ' + METHOD_NAME[rec.method], 'success');

    el.amountInput.value = '';
    el.noteInput.value = '';
    syncQR();
    updateToday();
    renderRecords(rec.id);
    el.amountInput.focus();
  }

  function deleteRecord(id) {
    var idx = -1;
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return;
    var removed = state.records.splice(idx, 1)[0];
    saveRecords();
    renderRecords();
    updateToday();

    state.lastDeleted = { rec: removed, idx: idx };
    toast('已删除 ' + money(removed.amount), null, {
      label: '撤销',
      onClick: function () {
        if (!state.lastDeleted) return;
        var item = state.lastDeleted;
        state.lastDeleted = null;
        var pos = Math.min(item.idx, state.records.length);
        state.records.splice(pos, 0, item.rec);
        saveRecords();
        renderRecords();
        updateToday();
        toast('已恢复该笔记录', 'success');
      }
    });
  }

  /* ---------------- 今日概览 ---------------- */
  function updateToday() {
    var tk = todayKey();
    var mk = monthKey();
    var tSum = 0, tCount = 0, mSum = 0, mCount = 0, aSum = 0;
    var todayByMethod = {};

    state.records.forEach(function (r) {
      aSum += r.amount;
      if (r.date === tk) {
        tSum += r.amount; tCount++;
        todayByMethod[r.method] = (todayByMethod[r.method] || 0) + r.amount;
      }
      if (r.date && r.date.slice(0, 7) === mk) { mSum += r.amount; mCount++; }
    });

    el.todayAmount.textContent = money(tSum);
    el.statToday.textContent = money(tSum);
    el.statTodayCount.textContent = tCount + ' 笔';
    el.statMonth.textContent = money(mSum);
    el.statMonthCount.textContent = mCount + ' 笔';
    el.statAll.textContent = money(aSum);
    el.statAllCount.textContent = state.records.length + ' 笔';

    // 今日分渠道条
    var maxV = 0;
    Object.keys(todayByMethod).forEach(function (k) {
      if (todayByMethod[k] > maxV) maxV = todayByMethod[k];
    });
    if (maxV === 0) {
      el.methodBars.innerHTML = '<div class="mbar-row"><span class="mbar-name" style="width:auto">今日还没有收款</span></div>';
      return;
    }
    var html = '';
    Object.keys(todayByMethod).sort(function (a, b) {
      return todayByMethod[b] - todayByMethod[a];
    }).forEach(function (k) {
      var pct = Math.max(4, (todayByMethod[k] / maxV) * 100);
      html += '<div class="mbar-row">' +
        '<span class="mbar-name">' + METHOD_NAME[k] + '</span>' +
        '<span class="mbar-track"><span class="mbar-fill" style="width:' + pct + '%;background:' + METHOD_COLOR[k] + '"></span></span>' +
        '<span class="mbar-val">' + prettyMoney(todayByMethod[k]) + '</span>' +
        '</div>';
    });
    el.methodBars.innerHTML = html;
  }

  /* ---------------- 记录列表 ---------------- */
  function renderRecords(highlightId) {
    var tk = todayKey();
    var mk = monthKey();
    var kw = state.keyword.trim().toLowerCase();

    var list = state.records.filter(function (r) {
      if (state.range === 'today' && r.date !== tk) return false;
      if (state.range === 'month' && r.date.slice(0, 7) !== mk) return false;
      if (state.filter !== 'all' && r.method !== state.filter) return false;
      if (kw) {
        var hit = (r.note || '').toLowerCase().indexOf(kw) !== -1 ||
                  String(r.amount).indexOf(kw) !== -1;
        if (!hit) return false;
      }
      return true;
    });

    if (!list.length) {
      el.recordBody.innerHTML = '';
      el.tableWrap.hidden = true;
      el.recordEmpty.hidden = false;
      return;
    }
    el.recordEmpty.hidden = true;
    el.tableWrap.hidden = false;

    var html = '';
    list.forEach(function (r) {
      var noteHtml = r.note
        ? '<span class="td-note">' + escapeHtml(r.note) + '</span>'
        : '<span class="td-note empty-note">—</span>';
      html += '<tr' + (r.id === highlightId ? ' class="is-new"' : '') + '>' +
        '<td class="td-time">' + formatTime(r.ts) + '<small>' + stampKey(r.ts) + '</small></td>' +
        '<td class="td-amount">' + money(r.amount) + '</td>' +
        '<td><span class="pay-tag ' + r.method + '">' + METHOD_NAME[r.method] + '</span></td>' +
        '<td>' + noteHtml + '</td>' +
        '<td style="text-align:right"><button class="row-del" data-del="' + r.id + '">删除</button></td>' +
        '</tr>';
    });
    el.recordBody.innerHTML = html;

    $$('#recordBody [data-del]').forEach(function (b) {
      b.onclick = function () { deleteRecord(b.dataset.del); };
    });
  }

  /* ---------------- 视图切换 ---------------- */
  function setView(name) {
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + name); });
    $$('.tab').forEach(function (t) { t.classList.toggle('is-active', t.dataset.view === name); });
    if (name === 'records') {
      renderRecords();
      updateToday();
    } else {
      el.amountInput.focus();
    }
  }

  /* ---------------- 设置弹窗 ---------------- */
  function openSettings() {
    renderSettingsModal();
    el.modal.hidden = false;
  }

  function closeSettings() {
    el.modal.hidden = true;
  }

  function renderSettingsModal() {
    SCAN_METHODS.forEach(function (m) {
      var linkInput = document.querySelector('[data-link="' + m + '"]');
      var prev = document.querySelector('[data-preview="' + m + '"]');
      if (linkInput) linkInput.value = state.config.link[m] || '';

      var img = state.config.qr[m];
      var link = (state.config.link[m] || '').trim();
      if (img) {
        prev.className = 'qs-preview has-item';
        prev.innerHTML = '<img src="' + img + '" alt="收款码">' +
          '<span class="qs-info">已上传收款码图片<br><b>收款时直接展示</b></span>';
      } else if (link) {
        prev.className = 'qs-preview has-item';
        prev.innerHTML = '<span class="qs-info">已设置收款链接<br><b>' + escapeHtml(link.slice(0, 46)) + '</b></span>';
      } else {
        prev.className = 'qs-preview';
        prev.innerHTML = '';
      }
    });
    // 每次关设置前都刷新收款台二维码
    renderQR();
  }

  // 图片压缩：等比缩到 maxSize 内，白底 JPEG，避免 localStorage 超限
  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var maxSize = 460;
        var ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        var w = Math.round(img.width * ratio);
        var h = Math.round(img.height * ratio);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function bindSettings() {
    $('#btnSettings').onclick = openSettings;
    $('#btnCloseSettings').onclick = closeSettings;
    el.modal.addEventListener('click', function (e) {
      if (e.target === el.modal) closeSettings();
    });

    $$('.file-input').forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
          toast('图片过大，请选择 8MB 以内的图片', 'error');
          input.value = '';
          return;
        }
        var ch = input.dataset.file;
        compressImage(file, function (dataUrl) {
          if (!dataUrl) {
            toast('图片读取失败', 'error');
            input.value = '';
            return;
          }
          state.config.qr[ch] = dataUrl;
          saveConfig();
          renderSettingsModal();
          toast(METHOD_NAME[ch] + '收款码已保存', 'success');
          input.value = '';
        });
      });
    });

    $$('.link-input').forEach(function (input) {
      input.addEventListener('input', function () {
        var ch = input.dataset.link;
        state.config.link[ch] = input.value.trim();
        saveConfig();
        renderSettingsModal();
      });
    });

    $$('[data-clear]').forEach(function (btn) {
      btn.onclick = function () {
        var ch = btn.dataset.clear;
        state.config.qr[ch] = '';
        state.config.link[ch] = '';
        saveConfig();
        renderSettingsModal();
        toast(METHOD_NAME[ch] + '收款码已移除');
      };
    });

    $('#btnWipe').onclick = function () {
      if (!state.records.length) {
        toast('当前没有收款记录');
        return;
      }
      if (!confirm('确定要清空全部 ' + state.records.length + ' 条收款记录吗？\n此操作不可恢复。')) return;
      state.records = [];
      saveRecords();
      updateToday();
      renderRecords();
      toast('已清空全部记录');
    };
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 视图切换
    $$('.tab').forEach(function (t) {
      t.onclick = function () { setView(t.dataset.view); };
    });

    // 收款方式
    $$('#methodRow .method').forEach(function (b) {
      b.onclick = function () { setMethod(b.dataset.method); };
    });

    // 快捷金额
    $$('#quickRow .chip').forEach(function (b) {
      b.onclick = function () { addAmount(parseFloat(b.dataset.amount)); };
    });

    // 数字键盘
    $$('#keypad button').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.key;
        if (k === 'del') backspace();
        else if (k === 'C') clearAll();
        else if (k === 'confirm') confirmPayment();
        else if (k === '+10') addAmount(10);
        else appendChar(k);
      };
    });

    // 输入框
    el.amountInput.addEventListener('input', function () {
      var v = sanitize(el.amountInput.value);
      if (v !== el.amountInput.value) el.amountInput.value = v;
      syncQR();
    });
    el.amountInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmPayment(); }
    });
    el.btnClear.onclick = clearAll;
    el.btnConfirm.onclick = confirmPayment;

    // 记住上次使用的备注习惯？不需要 —— 备注回车即提交
    el.noteInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmPayment(); }
    });

    // 记录页筛选
    $$('#rangeSeg button').forEach(function (b) {
      b.onclick = function () {
        $$('#rangeSeg button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        state.range = b.dataset.range;
        renderRecords();
      };
    });
    $$('#filterSeg button').forEach(function (b) {
      b.onclick = function () {
        $$('#filterSeg button').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        state.filter = b.dataset.filter;
        renderRecords();
      };
    });
    el.searchInput.addEventListener('input', function () {
      state.keyword = el.searchInput.value;
      renderRecords();
    });

    // 全局快捷键
    document.addEventListener('keydown', function (e) {
      var inField = e.target.tagName === 'INPUT';
      var onCounter = $('#view-counter').classList.contains('is-active');

      if (e.key === 'Escape') {
        if (el.modal.hidden === false) { closeSettings(); return; }
        if (inField && e.target === el.amountInput) { clearAll(); return; }
      }
      if (!onCounter || inField) return;

      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); appendChar(e.key); }
      else if (e.key === '.') { e.preventDefault(); appendChar('.'); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
      else if (e.key === 'Enter') { e.preventDefault(); confirmPayment(); }
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    loadStore();
    bindEvents();
    bindSettings();
    setMethod('wechat');
    syncQR();
    updateToday();
    renderRecords();
    el.amountInput.focus();
  }

  // 兼容 script 被动态插入或延迟执行的情况
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
