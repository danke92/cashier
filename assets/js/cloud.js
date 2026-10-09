/* =========================================================
   收款台 · 云端数据层
   账号登录 + 收款记录 + 收款码设置，全部按账号隔离
   ========================================================= */
(function () {
  'use strict';

  /* publicConfig 由云服务开通时下发，请勿手改 */
  var PUBLIC_CONFIG = {
    endpoint: 'https://cashier-57532.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_LuDcYo5udKGoLlMja45JaE_8lZA1vTidt7dId6fF949rQ5ZSvpo5GSK'
  };

  if (!window.WorkBuddyCloud) {
    window.CashierCloud = { unavailable: '云端组件未能加载，请检查网络后刷新页面' };
    return;
  }

  // 云端接口按发布域名校验来源，从别的网址打开会一直被拒，这里提前说清楚
  var host = window.location && window.location.hostname;
  if (host && PUBLIC_CONFIG.endpoint.indexOf(host) === -1) {
    window.CashierCloud = {
      unavailable: '当前网址没有绑定云服务，请改用 ' + PUBLIC_CONFIG.endpoint + ' 打开'
    };
    return;
  }

  var cloud = window.WorkBuddyCloud.createWorkBuddyCloud(PUBLIC_CONFIG);

  /* ---------------- 内部工具 ---------------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function unwrap(res, fallbackMsg) {
    if (res && res.error) {
      var err = new Error(res.error.message || fallbackMsg || '请求失败');
      err.kind = res.error.kind || res.error.code || '';
      throw err;
    }
    return res ? res.data : null;
  }

  // Promise 包装：构造即抛出的场景也要变成 rejected
  function wrap(p) { return Promise.resolve().then(function () { return p; }); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function rowToRecord(r) {
    var ts = Date.parse(r.paid_at);
    return {
      id: String(r.id),
      amount: Math.round(r.amount_cents) / 100,
      method: r.method,
      note: r.note || '',
      ts: ts,
      date: dateKey(new Date(ts))
    };
  }

  /* ================= 登录 ================= */

  function getSession() {
    return wrap(cloud.auth.getSession()).then(function (res) {
      return unwrap(res, '读取登录状态失败');
    });
  }

  function getUser() {
    return wrap(cloud.auth.getUser()).then(function (res) {
      return unwrap(res, '读取账号信息失败');
    });
  }

  function signOut() {
    return wrap(cloud.auth.signOut()).then(function (res) {
      if (res && res.error) throw new Error(res.error.message || '退出失败');
      return true;
    });
  }

  // 当前待校验的验证码票据（发送与校验必须分开）
  var pendingPhone = null;
  var pendingEmail = null;

  var PHONE_RE = /^1\d{10}$/;

  function sendPhoneCode(phone) {
    if (!PHONE_RE.test(phone)) {
      var bad = new Error('请输入正确的 11 位手机号');
      bad.kind = 'invalid_input';
      return Promise.reject(bad);
    }
    return wrap(cloud.auth.sendOtp({ phone: phone })).then(function (res) {
      var d = unwrap(res, '验证码发送失败');
      pendingPhone = {
        to: phone,
        verificationId: d.verificationId,
        isExistingUser: d.isExistingUser
      };
      return d;
    });
  }

  function verifyPhone(phone, code) {
    if (!pendingPhone || pendingPhone.to !== phone) {
      var e = new Error('请先为当前手机号获取验证码');
      e.kind = 'local';
      return Promise.reject(e);
    }
    return wrap(cloud.auth.verifyOtp({
      phone: phone,
      verificationId: pendingPhone.verificationId,
      isExistingUser: pendingPhone.isExistingUser,
      token: code
    })).then(function (res) {
      var data = unwrap(res, '验证码校验失败');
      pendingPhone = null;
      return data;
    });
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function sendEmailCode(email, password) {
    if (!EMAIL_RE.test(email)) {
      var bad = new Error('请输入正确的邮箱地址');
      bad.kind = 'invalid_input';
      return Promise.reject(bad);
    }
    return wrap(cloud.auth.sendOtp({ email: email })).then(function (res) {
      var d = unwrap(res, '验证码发送失败');
      pendingEmail = {
        to: email,
        password: password || '',
        verificationId: d.verificationId,
        isExistingUser: d.isExistingUser
      };
      return d;
    });
  }

  function verifyEmail(email, code) {
    if (!pendingEmail || pendingEmail.to !== email) {
      var e = new Error('请先为当前邮箱获取验证码');
      e.kind = 'local';
      return Promise.reject(e);
    }
    if (!pendingEmail.isExistingUser && !pendingEmail.password) {
      var e2 = new Error('新账号请先设置登录密码');
      e2.kind = 'local';
      return Promise.reject(e2);
    }
    return wrap(cloud.auth.verifyOtp({
      email: email,
      verificationId: pendingEmail.verificationId,
      isExistingUser: pendingEmail.isExistingUser,
      token: code,
      password: pendingEmail.isExistingUser ? undefined : pendingEmail.password
    })).then(function (res) {
      var data = unwrap(res, '验证码校验失败');
      pendingEmail = null;
      return data;
    });
  }

  /* ================= 收款记录 ================= */

  function loadRecords() {
    return wrap(
      cloud.database.from('payment_records')
        .select('id, amount_cents, method, note, paid_at')
        .order('paid_at', { ascending: false })
        .limit(3000)
    ).then(function (res) {
      var rows = unwrap(res, '读取收款记录失败');
      return (rows || []).map(rowToRecord);
    });
  }

  function addRecord(rec) {
    return wrap(
      cloud.database.from('payment_records')
        .insert({
          amount_cents: Math.round(rec.amount * 100),
          method: rec.method,
          note: rec.note || '',
          paid_at: new Date(rec.ts).toISOString()
        })
        .select('id, amount_cents, method, note, paid_at')
    ).then(function (res) {
      var rows = unwrap(res, '保存失败');
      if (!rows || !rows.length) throw new Error('未能写入，请退出后重新登录再试');
      return rowToRecord(rows[0]);
    });
  }

  function removeRecord(id) {
    return wrap(
      cloud.database.from('payment_records')
        .delete()
        .eq('id', Number(id))
        .select('id')
    ).then(function (res) {
      var rows = unwrap(res, '删除失败');
      if (!rows || !rows.length) throw new Error('这笔记录已不存在，或不属于当前账号');
      return rows;
    });
  }

  // RLS 保证只能删自己的行，这里是「删本人全部」而非无条件的全表删除
  function clearRecords() {
    return wrap(
      cloud.database.from('payment_records')
        .delete()
        .gt('id', 0)
        .select('id')
    ).then(function (res) {
      var rows = unwrap(res, '清空失败');
      return rows ? rows.length : 0;
    });
  }

  /* ================= 收款码设置 ================= */

  function emptyConfig() {
    return { qr: { wechat: '', alipay: '' }, link: { wechat: '', alipay: '' } };
  }

  function loadSettings() {
    return wrap(
      cloud.database.from('cashier_settings')
        .select('channel, qr_image, pay_link')
    ).then(function (res) {
      var rows = unwrap(res, '读取收款码设置失败');
      var cfg = emptyConfig();
      (rows || []).forEach(function (r) {
        if (r.channel !== 'wechat' && r.channel !== 'alipay') return;
        cfg.qr[r.channel] = r.qr_image || '';
        cfg.link[r.channel] = r.pay_link || '';
      });
      return cfg;
    });
  }

  function saveChannel(channel, qrImage, payLink) {
    var patch = { qr_image: qrImage || '', pay_link: payLink || '' };
    // 先改，改不到说明该渠道还没有行，再插
    return wrap(
      cloud.database.from('cashier_settings')
        .update(patch)
        .eq('channel', channel)
        .select('channel')
    ).then(function (res) {
      var rows = unwrap(res, '保存收款码失败');
      if (rows && rows.length) return rows;
      var ins = { channel: channel };
      ins.qr_image = patch.qr_image;
      ins.pay_link = patch.pay_link;
      return wrap(
        cloud.database.from('cashier_settings').insert(ins).select('channel')
      ).then(function (res2) {
        var rows2 = unwrap(res2, '保存收款码失败');
        if (!rows2 || !rows2.length) throw new Error('未能写入，请退出后重新登录再试');
        return rows2;
      });
    });
  }

  /* ================= 对外接口 ================= */
  window.CashierCloud = {
    getSession: getSession,
    getUser: getUser,
    signOut: signOut,
    onAuthStateChange: function (cb) {
      if (cloud.auth && cloud.auth.onAuthStateChange) {
        return cloud.auth.onAuthStateChange(cb);
      }
      return function () {};
    },
    sendPhoneCode: sendPhoneCode,
    verifyPhone: verifyPhone,
    sendEmailCode: sendEmailCode,
    verifyEmail: verifyEmail,
    loadRecords: loadRecords,
    addRecord: addRecord,
    removeRecord: removeRecord,
    clearRecords: clearRecords,
    loadSettings: loadSettings,
    saveChannel: saveChannel,
    isNetworkError: function (err) {
      return !!err && (err.kind === 'network' || err.kind === 'backend-unavailable');
    }
  };
})();
