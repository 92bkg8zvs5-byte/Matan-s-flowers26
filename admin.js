(function () {
'use strict';
var FL = ['ורדים', 'פיוני', 'חמניות', 'טוליפים', 'ליזיאנטוס', 'לבנדר', 'גרברות', 'כלניות'];
var ST = [['ordered', 'הזמינו'], ['pending', 'ממתינים לתשלום'], ['paid', 'שילמו'], ['delivered', 'קיבלו'], ['cancelled', 'בוטלו']];
var A = { user: null, rows: [], f: 'pending', edit: null, loaded: false, pw: false, del: false, err: '' };
function $(i) { return document.getElementById(i); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmt(s) { return new Date(s + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }); }
function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); setTimeout(function () { t.classList.remove('on'); }, 2400); }
function api(method, url, body) {
  return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || 'שגיאה'); e.status = r.status; throw e; } return j;
    });
  });
}
function fail(e) { if (e.status === 401 && A.user) { A.user = null; render(); } toast(e.message || 'שגיאה'); }
function stName(k) { for (var i = 0; i < ST.length; i++) if (ST[i][0] === k) return ST[i][1]; return k; }
function opt(list, cur) { return list.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (x[0] === cur ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join(''); }
function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function row(id) { return A.rows.filter(function (x) { return x.id === id; })[0]; }
function body(r) { return { name: r.customer.name, phone: r.customer.phone, email: r.customer.email, addr: r.addr, flower: r.flower, date: r.date, status: r.status, refund: r.refund || undefined }; }

function loginPage() {
  return '<section class="card"><h2>כניסת מנהל</h2><label for="u">שם משתמש</label><input id="u" autocomplete="username" dir="ltr"><label for="p">סיסמה</label><input id="p" type="password" autocomplete="current-password" dir="ltr"><div class="err">' + esc(A.err) + '</div><button class="btn" data-a="login">כניסה</button></section>';
}
function form(r) {
  var c = r.customer;
  return '<div class="ord"><label for="e_name">שם</label><input id="e_name" value="' + esc(c.name) + '"><label for="e_phone">טלפון</label><input id="e_phone" dir="ltr" value="' + esc(c.phone) + '"><label for="e_email">מייל</label><input id="e_email" dir="ltr" value="' + esc(c.email) + '">' +
    '<label for="e_addr">כתובת למשלוח</label><input id="e_addr" value="' + esc(r.addr) + '"><div class="grid"><div><label for="e_fl">פרחים</label><select id="e_fl">' + opt(FL.map(function (f) { return [f, f]; }), r.flower) + '</select></div><div><label for="e_st">סטטוס</label><select id="e_st">' + opt(ST, r.status) + '</select></div></div>' +
    '<label for="e_date">תאריך משלוח</label><input id="e_date" type="date" value="' + esc(r.date) + '"><div class="row" style="margin-top:12px"><button class="btn sm" data-a="save">שמירה</button><button class="btn sec sm" data-a="cancel">ביטול</button>' + (r.id ? (A.del ? '<button class="btn del sm" data-a="del2">כן, למחוק סופית</button><button class="btn sec sm" data-a="delno">לא</button>' : '<button class="btn del sm" data-a="del">מחיקה</button>') : '') + '</div></div>';
}
function dash() {
  var h = '<section class="card"><h2>ניהול הזמנות</h2><p class="mute" style="margin:0">מחובר/ת: ' + esc(A.user) + '</p><div class="row" style="margin-top:10px"><button class="btn sm" data-a="new">הוספת הזמנה ידנית</button><button class="btn sec sm" data-a="pw">שינוי פרטי כניסה</button><button class="btn sec sm" data-a="logout">התנתקות</button></div></section>';
  if (A.pw) h += '<section class="card"><h2>שינוי פרטי כניסה</h2><label for="n_user">שם משתמש</label><input id="n_user" dir="ltr" value="' + esc(A.user) + '"><label for="n_cur">סיסמה נוכחית</label><input id="n_cur" type="password" dir="ltr"><label for="n_new">סיסמה חדשה (לפחות 8 תווים, אפשר להשאיר ריק)</label><input id="n_new" type="password" dir="ltr"><div class="row" style="margin-top:12px"><button class="btn sm" data-a="pwsave">עדכון</button><button class="btn sec sm" data-a="pw">סגירה</button></div></section>';
  if (A.edit === 'new') h += form({ id: null, date: today(), flower: FL[0], addr: '', status: 'ordered', customer: { name: '', phone: '', email: '' } });
  h += '<div class="fl">' + ST.map(function (s) { var n = A.rows.filter(function (r) { return r.status === s[0]; }).length; return '<button class="chip" aria-pressed="' + (A.f === s[0]) + '" data-a="f" data-v="' + s[0] + '">' + s[1] + ' <b>' + n + '</b></button>'; }).join('') + '</div>';
  var list = A.rows.filter(function (r) { return r.status === A.f; });
  if (!A.loaded) h += '<p class="mute">טוען…</p>'; else if (!list.length) h += '<p class="mute">אין הזמנות בקטגוריה הזו.</p>';
  list.forEach(function (r) {
    if (A.edit === r.id) { h += form(r); return; }
    var due = r.status === 'cancelled' && r.refund === 'due';
    var nx = { ordered: ['pending', 'סימון: ממתין לתשלום'], pending: ['paid', 'אישור תשלום'], paid: ['delivered', 'סימון: נמסר'] }[r.status];
    h += '<div class="ord"><div class="t"><b>' + esc(r.customer.name) + '</b><span class="mute">' + esc(fmt(r.date)) + '</span></div><div class="mute"><a href="tel:' + esc(r.customer.phone) + '">' + esc(r.customer.phone) + '</a> · ' + esc(r.customer.email) + '</div><div style="margin-top:6px">' + esc(r.flower) + ' · ' + esc(r.addr) + '</div><div class="mute">קוד: ' + esc(r.ref) + '</div>' +
      (due ? '<p style="margin:6px 0 0"><span class="tag err">יש להחזיר ₪80 בביט</span></p>' : '') +
      '<div class="row" style="margin-top:10px">' + (nx ? '<button class="btn sm" data-a="move" data-id="' + r.id + '" data-v="' + nx[0] + '">' + nx[1] + '</button>' : '') + (due ? '<button class="btn sm" data-a="refund" data-id="' + r.id + '">סימון: הוחזר</button>' : '') + '<button class="btn sec sm" data-a="edit" data-id="' + r.id + '">עריכה</button></div>' +
      '<div class="mv"><span class="mute">העברה ל:</span>' + ST.filter(function (x) { return x[0] !== r.status; }).map(function (x) { return '<button class="chip" data-a="move" data-id="' + r.id + '" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
  });
  return h;
}
function render() { $('view').innerHTML = A.user ? dash() : loginPage(); }
function load() { return api('GET', '/api/admin/orders').then(function (j) { A.rows = j.orders; A.loaded = true; if (!A.edit && !A.pw) render(); }, fail); }
function val(i) { return $(i).value; }
function payload() { return { name: val('e_name'), phone: val('e_phone'), email: val('e_email'), addr: val('e_addr'), flower: val('e_fl'), status: val('e_st'), date: val('e_date') }; }
// עדכון מיידי במסך, ואחר כך שמירה בשרת (ובכישלון חוזרים למצב האמיתי)
function optimistic(mutate, request, msg) {
  mutate(); render();
  request().then(function () { if (msg) toast(msg); return load(); }, function (e) { fail(e); return load(); });
}

$('view').addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b) return; var a = b.dataset.a, id = b.dataset.id, r;
  if (a === 'login') { api('POST', '/api/admin/login', { user: val('u'), password: val('p') }).then(function (j) { A.user = j.user; A.err = ''; render(); load(); }, function (er) { A.err = er.message; render(); }); return; }
  if (a === 'logout') { api('POST', '/api/admin/logout').then(function () { A.user = null; A.loaded = false; render(); }); return; }
  if (a === 'f') { A.f = b.dataset.v; A.edit = null; A.del = false; render(); }
  else if (a === 'new') { A.edit = 'new'; render(); }
  else if (a === 'edit') { A.edit = id; A.del = false; render(); }
  else if (a === 'cancel') { A.edit = null; A.del = false; render(); }
  else if (a === 'pw') { A.pw = !A.pw; render(); }
  else if (a === 'del') { A.del = true; render(); }
  else if (a === 'delno') { A.del = false; render(); }
  else if (a === 'pwsave') api('POST', '/api/admin/password', { user: val('n_user'), current: val('n_cur'), password: val('n_new') }).then(function (j) { A.user = j.user; A.pw = false; render(); toast('הפרטים עודכנו'); }, fail);
  else if (a === 'move') {
    r = row(id); var st = b.dataset.v, was = r.status, p = body(r); p.status = st;
    optimistic(function () { r.status = st; if (st === 'cancelled' && (was === 'paid' || was === 'pending') && !r.refund) r.refund = 'due'; A.f = st; }, function () { return api('PUT', '/api/admin/orders/' + id, p); }, 'עודכן: ' + stName(st));
  }
  else if (a === 'refund') { r = row(id); var q = body(r); q.refund = 'done'; optimistic(function () { r.refund = 'done'; }, function () { return api('PUT', '/api/admin/orders/' + id, q); }, 'סומן כהוחזר'); }
  else if (a === 'del2') { var did = A.edit; optimistic(function () { A.rows = A.rows.filter(function (x) { return x.id !== did; }); A.edit = null; A.del = false; }, function () { return api('DELETE', '/api/admin/orders/' + did); }, 'ההזמנה נמחקה'); }
  else if (a === 'save') {
    var p2 = payload(), isNew = A.edit === 'new', eid = A.edit;
    (isNew ? api('POST', '/api/admin/orders', p2) : api('PUT', '/api/admin/orders/' + eid, p2)).then(function () { A.f = p2.status; A.edit = null; toast('נשמר'); return load(); }, fail).then(render);
  }
});

api('GET', '/api/admin/me').then(function (j) { A.user = j.user; render(); load(); }, function () { render(); });
setInterval(function () { if (A.user && !document.hidden && !A.edit && !A.pw) load(); }, 20000);
})();
