/* =========================================================
   收款台 · 登录门
   未登录时遮住整个界面，登录后交还给主程序
   ========================================================= */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var C = window.CashierCloud;

  if (!C || C.unavailable) {
    var box = $('#authGate');
    if (box) {
      box.innerHTML = '<div class="auth-card"><div class="auth-head">' +
        '<div class="auth-logo">!</div><h2>云端组件未就绪</h2>' +
        '<p>' + ((C && C.unavailable) || '无法加载云端组件') + '</p></div></div>';
    }
    return;
  }

  var el = {
    gate: $('#authGate'),
    foot: $('#authFoot'),
    phone: $('#authPhone'),
    phoneCode: $('#authPhoneCode'),
    phoneSend: $('#authPhoneSend'),
    phoneErr: $('#authPhoneErr'),
    phoneHint: $('#authPhoneHint'),
    email: $('#authEmail'),
    pwd: $('#authPassword'),
    emailCode: $('#authEmailCode'),
    emailSend: $('#authEmailSend'),
    emailErr: $('#authEmailErr'),
    emailHint: $('#authEmailHint'),
    userName: $('#userName'),
    userAvatar: $('#userAvatar'),
    btnLogout: $('#btnLogout')
  };

  var onSignedIn = null;
  var onSignedOut = null;
  var countdownTimer = null;
  var signedIn = false;

  /* ---------------- 小工具 ---------------- */
  function setErr(node, msg) { if (node) node.textContent = msg || ''; }
  function setHint(node, msg) { if (node) node.textContent = msg || ''; }

  function busy(btn, isBusy, idleText) {
    if (!btn) return;
    btn.disabled = !!isBusy;
    if (!isBusy && idleText) btn.textContent = idleText;
  }

  function startCountdown(btn, seconds, idleText) {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    var left = seconds;
    btn.disabled = true;
    btn.textContent = left + 's 后重发';
    countdownTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        btn.disabled = false;
        btn.textContent = idleText;
      } else {
        btn.textContent = left + 's 后重发';
      }
    }, 1000);
  }

  function friendlyError(err) {
    if (!err) return '未知错误';
    if (err.kind === 'local' || err.kind === 'invalid_input') return err.message;
    if (err.kind === 'network' || err.kind === 'backend-unavailable') {
      return '网络异常，请检查连接后重试';
    }
    return err.message || '操作失败，请重试';
  }

  /* ---------------- 会话 ---------------- */
  function showGate() {
    el.gate.hidden = false;
    document.body.classList.add('is-locked');
  }

  function hideGate() {
    el.gate.hidden = true;
    document.body.classList.remove('is-locked');
  }

  function describeUser(session) {
    var u = (session && session.user) || {};
    var phone = u.phoneNumber || u.phone || '';
    var email = u.email || '';
    var name = phone ? phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
      : email.replace(/^(.).*(@.*)$/, '$1****$2');
    return {
      label: name || u.uid || '已登录',
      initial: (name || '?').trim().charAt(0).toUpperCase()
    };
  }

  function enter(session) {
    var info = describeUser(session);
    if (el.userName) el.userName.textContent = info.label;
    if (el.userAvatar) el.userAvatar.textContent = info.initial;
    signedIn = true;
    hideGate();
    if (onSignedIn) onSignedIn(session);
  }

  function leave(msg) {
    var wasIn = signedIn;
    signedIn = false;
    if (wasIn && onSignedOut) onSignedOut();
    showGate();
    if (msg) setHint(el.phoneHint, msg);
    // 清空输入框，避免账号串号
    el.phone.value = ''; el.phoneCode.value = '';
    el.email.value = ''; el.emailCode.value = ''; el.pwd.value = '';
    if (el.userName) el.userName.textContent = '';
    if (el.userAvatar) el.userAvatar.textContent = '';
  }

  /* ---------------- 手机号表单 ---------------- */
  el.phone.addEventListener('input', function () { setErr(el.phoneErr, ''); });

  el.phoneSend.addEventListener('click', function () {
    var phone = el.phone.value.trim();
    setErr(el.phoneErr, '');
    setHint(el.phoneHint, '');

    busy(el.phoneSend, true);
    el.phoneSend.textContent = '发送中…';

    C.sendPhoneCode(phone).then(function () {
      el.phoneSend.disabled = false;
      startCountdown(el.phoneSend, 60, '获取验证码');
      setHint(el.phoneHint, '验证码已发送，请查收短信');
      if (el.phoneCode) el.phoneCode.focus();
    }).catch(function (err) {
      el.phoneSend.disabled = false;
      el.phoneSend.textContent = '获取验证码';
      if (err && err.kind === 'invalid_input') setErr(el.phoneErr, err.message);
      else setHint(el.phoneHint, friendlyError(err));
    });
  });

  el.gate.querySelector('#authPhoneForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var phone = el.phone.value.trim();
    var code = el.phoneCode.value.trim();
    setErr(el.phoneErr, '');
    setHint(el.phoneHint, '');
    if (!code) { setHint(el.phoneHint, '请输入短信中的验证码'); return; }

    var btn = $('#authPhoneSubmit');
    var old = btn.textContent;
    busy(btn, true);
    btn.textContent = '验证中…';

    C.verifyPhone(phone, code).then(function (data) {
      busy(btn, false, old);
      enter(data.session || data);
    }).catch(function (err) {
      busy(btn, false, old);
      setHint(el.phoneHint, friendlyError(err));
    });
  });

  /* ---------------- 邮箱表单 ---------------- */
  el.email.addEventListener('input', function () { setErr(el.emailErr, ''); });

  el.emailSend.addEventListener('click', function () {
    var email = el.email.value.trim();
    var pwd = el.pwd.value;
    setErr(el.emailErr, '');
    setHint(el.emailHint, '');

    el.emailSend.disabled = true;
    el.emailSend.textContent = '发送中…';

    C.sendEmailCode(email, pwd).then(function () {
      el.emailSend.disabled = false;
      startCountdown(el.emailSend, 60, '获取验证码');
      setHint(el.emailHint, '验证码已发送到邮箱，请查收');
      if (el.emailCode) el.emailCode.focus();
    }).catch(function (err) {
      el.emailSend.disabled = false;
      el.emailSend.textContent = '获取验证码';
      if (err && err.kind === 'invalid_input') setErr(el.emailErr, err.message);
      else setHint(el.emailHint, friendlyError(err));
    });
  });

  el.gate.querySelector('#authEmailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = el.email.value.trim();
    var code = el.emailCode.value.trim();
    setErr(el.emailErr, '');
    setHint(el.emailHint, '');
    if (!code) { setHint(el.emailHint, '请输入邮箱中的验证码'); return; }

    var btn = $('#authEmailSubmit');
    var old = btn.textContent;
    busy(btn, true);
    btn.textContent = '验证中…';

    C.verifyEmail(email, code).then(function (data) {
      busy(btn, false, old);
      enter(data.session || data);
    }).catch(function (err) {
      busy(btn, false, old);
      setHint(el.emailHint, friendlyError(err));
    });
  });

  /* ---------------- Tab 切换 ---------------- */
  $$('#authTabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.dataset.mode;
      $$('#authTabs button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
      $$('.auth-pane').forEach(function (p) {
        p.classList.toggle('is-active', p.dataset.pane === mode);
      });
      setErr(el.phoneErr, ''); setHint(el.phoneHint, '');
      setErr(el.emailErr, ''); setHint(el.emailHint, '');
      setTimeout(function () { (mode === 'phone' ? el.phone : el.email).focus(); }, 60);
    });
  });

  /* ---------------- 退出登录 ---------------- */
  if (el.btnLogout) {
    el.btnLogout.addEventListener('click', function () {
      if (!confirm('确定要退出登录吗？\n退出后本机不会再显示云端账本（数据仍保存在云端）。')) return;
      el.btnLogout.disabled = true;
      C.signOut().then(function () {
        el.btnLogout.disabled = false;
        leave('已退出登录');
      }).catch(function (err) {
        el.btnLogout.disabled = false;
        leave(friendlyError(err));
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  window.CashierAuth = {
    boot: function (handlers) {
      onSignedIn = handlers && handlers.onSignedIn;
      onSignedOut = handlers && handlers.onSignedOut;

      C.getSession().then(function (session) {
        if (session) enter(session);
        else showGate();
      }).catch(function () {
        showGate();
      });

      // 会话过期被踢下线时自动回到登录页
      if (C.onAuthStateChange) {
        C.onAuthStateChange(function (event) {
          if (event === 'SIGNED_OUT' && signedIn) leave('登录已失效，请重新登录');
        });
      }
    },
    leave: leave
  };
})();
