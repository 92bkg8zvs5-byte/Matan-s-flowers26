(function () {
'use strict';
var PRICE = 80, BIT = '0512600412';
var FL = [['ורדים', '#d63a72'], ['פיוני', '#f4a6c0'], ['חמניות', '#f2b705'], ['טוליפים', '#e8573a'], ['ליזיאנטוס', '#8a5cc9'], ['לבנדר', '#9b8bd0'], ['גרברות', '#ff7a3d'], ['כלניות', '#c1272d']];
var STEPS = ['הזמנתם', 'ממתין לאישור תשלום', 'התשלום אושר', 'הזר הגיע אליכם'], ORDER = ['ordered', 'pending', 'paid', 'delivered'];
var DN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'], DC = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
var S = { ask: false, h: null, me: null, order: null, tab: 'week', auth: 'choose', errs: {}, f: { name: '', phone: '', email: '', addr: '' }, loaded: false };
var DP = null;

function $(i) { return document.getElementById(i); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function fmt(s) { return new Date(s + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' }); }
function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('on'); setTimeout(function () { t.classList.remove('on'); }, 2400); }
function api(method, url, body) {
  return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) { var e = new Error(j.error || 'שגיאה'); e.status = r.status; e.fields = j.fields; throw e; }
      return j;
    });
  });
}
function run(p) {
  return p.catch(function (e) {
    if (e.status === 401 && S.me) { S.me = null; S.auth = 'login'; render(); toast('ההתחברות פגה, נא להיכנס שוב'); }
    else if (e.fields) { S.errs = e.fields; render(); } else toast(e.message || 'שגיאה');
  });
}
function setMe(j) { S.me = j.customer; S.order = j.order; S.f = { name: j.customer.name, phone: j.customer.phone, email: j.customer.email, addr: j.customer.addr }; S.errs = {}; }

function field(id, label, type, dir, ph) {
  var er = S.errs[id], ac = { name: 'name', phone: 'tel', email: 'email', addr: 'street-address' }[id];
  return '<label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + type + '" value="' + esc(S.f[id]) + '"' + (dir ? ' dir="ltr"' : '') + ' placeholder="' + (ph || '') + '" autocomplete="' + ac + '"' + (er ? ' aria-invalid="true"' : '') + '><div class="err">' + esc(er || '') + '</div>';
}
function signup() {
  return '<section class="card"><h2>הרשמה</h2><p class="mute" style="margin-top:0">הפרטים משמשים רק לתיאום המשלוח, ונשלח אליכם מייל אישור.</p>' + field('name', 'שם מלא', 'text') + field('phone', 'טלפון', 'tel', 1, '050-0000000') + field('email', 'מייל', 'email', 1, 'name@example.com') + field('addr', 'כתובת למשלוח', 'text', 0, 'רחוב, מספר, עיר') + '<button class="btn" data-a="reg" style="margin-top:6px">הרשמה והמשך</button></section>';
}
function authPage() {
  var back = '<button class="chip" data-a="auth" data-v="choose" style="margin-bottom:10px">→ חזרה</button>';
  if (S.auth === 'signup') return back + signup();
  if (S.auth === 'login') return back + '<section class="card"><h2>כניסה</h2><p class="mute" style="margin-top:0">הזינו את הטלפון והמייל שנרשמתם איתם.</p>' + field('phone', 'טלפון', 'tel', 1, '050-0000000') + field('email', 'מייל', 'email', 1, 'name@example.com') + '<div class="err">' + esc(S.errs.login || '') + '</div><button class="btn" data-a="login">כניסה</button></section>';
  return '<section class="card" style="text-align:center"><h2 style="justify-content:center">ברוכים הבאים</h2><p class="mute" style="margin-top:0">כדי להזמין זר צריך חשבון.</p><button class="btn" data-a="auth" data-v="signup" style="margin-bottom:10px">יצירת חשבון חדש</button><button class="btn sec" data-a="auth" data-v="login">יש לי כבר חשבון</button></section>';
}
function track(st) {
  var i = ORDER.indexOf(st);
  return '<ul class="steps">' + STEPS.map(function (t, n) { return '<li class="' + (n <= i ? 'on' : '') + '"><i></i>' + t + '</li>'; }).join('') + '</ul>';
}
function weekPage() {
  var w = S.order, lock = w.status !== 'draft' && w.status !== 'ordered', live = w.status === 'ordered' || w.status === 'pending' || w.status === 'paid';
  var h = '<section class="card"><span class="mute">המשלוח של השבוע</span><div class="big">' + fmt(w.date) + '</div>' + (w.status !== 'draft' ? track(w.status) : '') + (w.status === 'paid' ? '<button class="btn" data-a="got" style="margin-top:12px">קיבלתי את הפרחים</button>' : '');
  if (live) {
    if (w.canCancel) h += S.ask ? '<div class="ord" style="margin-top:12px"><b>לבטל את ההזמנה?</b>' + (w.status !== 'ordered' ? '<p class="mute" style="margin:4px 0 0">ההזמנה כבר שולמה, ונחזיר את התשלום בביט.</p>' : '') + '<div class="row" style="margin-top:10px"><button class="btn del sm" data-a="cancel2">כן, לבטל</button><button class="btn sec sm" data-a="cancelno">חזרה</button></div></div>' : '<button class="btn sec" data-a="cancel" style="margin-top:12px">ביטול ההזמנה</button><p class="mute" style="margin:6px 0 0">אפשר לבטל עד שלושה ימים לפני המשלוח.</p>';
    else h += '<p class="mute" style="margin:12px 0 0">אי אפשר לבטל פחות משלושה ימים לפני המשלוח.</p>';
  }
  h += '</section>';
  h += '<section class="card"><h2>איזה פרחים יגיעו?</h2><div class="row" style="margin-top:8px">' + FL.map(function (f) { return '<button class="chip" aria-pressed="' + (w.flower === f[0]) + '" data-a="fl" data-v="' + f[0] + '"' + (lock ? ' disabled' : '') + '><span class="dot" style="background:' + f[1] + '"></span>' + f[0] + '</button>'; }).join('') + '</div>' + flowerPreview(w.flower) + '</section>';
  h += '<section class="card"><h2>לאן לשלוח?</h2><input id="wad" aria-label="כתובת למשלוח השבוע" value="' + esc(w.addr) + '"' + (lock ? ' disabled' : '') + '><p class="mute" style="margin:8px 0 0">הכתובת חלה על המשלוח של השבוע הזה בלבד.</p></section>';
  h += lock ? '<p class="mute">לשינוי אחרי תשלום, בטלו והזמינו מחדש (עד שלושה ימים לפני המשלוח).</p>' : '<button class="btn" data-a="topay">המשך לתשלום · ₪' + PRICE + '</button>';
  return h + remCard();
}
function payPage() {
  var w = S.order;
  var h = '<section class="card"><h2>סיכום ההזמנה</h2><div class="sum"><span>משלוח</span><b>' + fmt(w.date) + '</b></div><div class="sum"><span>פרחים</span><b>' + esc(w.flower) + '</b></div><div class="sum"><span>כתובת</span><b>' + esc(w.addr) + '</b></div><div class="sum"><span>לתשלום</span><b>₪' + PRICE + '</b></div></section>';
  if (w.status === 'draft') return h + '<section class="card"><p style="margin:0">קודם בוחרים פרחים ומאשרים בעמוד "השבוע".</p></section>';
  if (w.status === 'ordered') {
    return h + '<section class="card"><h2>תשלום בביט</h2><p class="mute" style="margin:0">ההזמנה תתבצע רק אחרי ששולחים את התשלום.</p><div class="bit"><div style="opacity:.75;font-size:14px">שלחו ₪' + PRICE + ' למספר</div><div class="num">' + BIT + '</div></div><button class="btn sec" data-a="copy">העתקת המספר</button><p style="margin:14px 0 0">בהערה בביט כתבו את קוד ההזמנה: <b>' + esc(w.ref) + '</b></p><button class="btn" data-a="paid" style="margin-top:14px">שלחתי את התשלום</button></section>';
  }
  return h + '<section class="card">' + track(w.status) + '<p style="margin:10px 0 0">' + (w.status === 'delivered' ? 'הזר נמסר. תודה!' : w.status === 'paid' ? 'התשלום התקבל והזר בדרך אליכם.' : 'ההזמנה תתבצע ברגע שנראה את התשלום בביט עם קוד ההזמנה ' + esc(w.ref) + '.') + '</p></section>';
}
var STL={ordered:'טרם שולם',pending:'ממתין לאישור תשלום',paid:'ההזמנה אושרה',delivered:'הזר נמסר',cancelled:'בוטלה'};
function histCard() {
  var H = S.h; if (!H) return '<section class="card"><h2>היסטוריית הזמנות</h2><p class="mute" style="margin:0">טוען…</p></section>';
  var h = '<section class="card"><h2>היסטוריית הזמנות</h2><div class="stats"><div><b>' + H.stats.received + '</b><span class="mute">זרים שקיבלתי</span></div><div><b>₪' + H.stats.spent + '</b><span class="mute">סה״כ שילמתי</span></div><div><b>' + H.stats.count + '</b><span class="mute">הזמנות</span></div></div>';
  if (!H.list.length) return h + '<p class="mute" style="margin:0">עוד אין הזמנות.</p></section>';
  return h + H.list.map(function (e) { var ok = e.status === 'paid' || e.status === 'delivered'; return '<div class="hrow"><div><b>' + esc(e.flower) + '</b><div class="mute">' + esc(new Date(e.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })) + (e.status === 'cancelled' && e.refund === 'due' ? ' · יוחזר בביט' : e.status === 'cancelled' && e.refund === 'done' ? ' · הוחזר' : '') + '</div></div><div style="text-align:left"><span class="tag' + (ok ? ' ok' : e.status === 'cancelled' ? ' err' : '') + '">' + (STL[e.status] || '') + '</span><div class="mute">' + (ok ? '₪80' : '—') + '</div></div></div>'; }).join('') + '</section>';
}
function loadHist() { api('GET', '/api/history').then(function (j) { S.h = j; if (S.me && S.tab === 'me') render(); }, function () {}); }
function mePage() {
  return '<section class="card"><h2>הפרטים שלי</h2>' + field('name', 'שם מלא', 'text') + field('phone', 'טלפון', 'tel', 1) + field('email', 'מייל', 'email', 1) + field('addr', 'כתובת ברירת מחדל', 'text') + '<button class="btn" data-a="saveme">שמירה</button></section>' + histCard() + remCard() +
    '<section class="card"><h2>התקנה בטלפון</h2>' + (DP ? '<button class="btn" data-a="install">התקנת האפליקציה</button>' : '<p class="mute" style="margin:0">באייפון: שיתוף ← "הוספה למסך הבית". באנדרואיד: תפריט ⋮ ← "התקנת אפליקציה".</p>') + '</section>' +
    '<section class="card"><button class="btn sec" data-a="logout">התנתקות</button></section>';
}
var DESC={'ורדים':'קלאסיים ורומנטיים, עם ניחוח עדין','פיוני':'ראשים גדולים ורכים, פורחים באביב','חמניות':'צהוב שמשי ושמח לכל חדר','טוליפים':'אלגנטיים ופשוטים, מתאימים לכל בית','ליזיאנטוס':'כותרות עדינות כמו ורד, בגווני סגול','לבנדר':'ריח מרגיע וגוון סגלגל','גרברות':'צבעוניות, עליזות ועמידות','כלניות':'פרח עונתי בולט באדום עמוק'};
function art(n){
  function P(c,rx,ry,r,dy){return '<ellipse cx="60" cy="'+(48-dy)+'" rx="'+rx+'" ry="'+ry+'" transform="rotate('+r+' 60 48)" fill="'+c+'"/>';}
  function C(c,r){return '<circle cx="60" cy="48" r="'+r+'" fill="'+c+'"/>';}
  function ring(c,rx,ry,k,off,dy){var o='';for(var i=0;i<k;i++)o+=P(c,rx,ry,i*(360/k)+off,dy);return o;}
  var leaf='<rect x="58" y="70" width="4" height="48" rx="2" fill="#2f6b4f"/><path d="M60 108c-16-2-24-10-24-20 14 0 24 8 24 20zM60 100c16-2 24-10 24-20-14 0-24 8-24 20z" fill="#2f6b4f"/>',h='';
  if(n==='ורדים')h=leaf+ring('#b3154f',18,24,6,0,14)+ring('#d63a72',13,17,5,20,9)+ring('#f06a99',8,10,4,0,4)+C('#a3124a',5);
  else if(n==='פיוני')h=leaf+ring('#f4a6c0',17,22,8,0,18)+ring('#f7c1d4',14,18,8,22,12)+ring('#fbd5e2',10,13,6,0,6)+C('#f3d26b',5);
  else if(n==='חמניות')h=leaf+ring('#e0a400',7,22,16,0,24)+ring('#f2b705',7,22,16,11,24)+C('#6b4420',15)+C('#3e2710',9);
  else if(n==='טוליפים')h=leaf+'<ellipse cx="46" cy="42" rx="14" ry="26" transform="rotate(-14 46 42)" fill="#d9432a"/><ellipse cx="74" cy="42" rx="14" ry="26" transform="rotate(14 74 42)" fill="#d9432a"/><ellipse cx="60" cy="40" rx="15" ry="28" fill="#f0684a"/>';
  else if(n==='ליזיאנטוס')h=leaf+ring('#7a4cb8',16,24,5,0,16)+ring('#a98ae0',12,17,5,36,10)+C('#e9ddff',8)+C('#f3d26b',3);
  else if(n==='לבנדר'){h='<rect x="58" y="14" width="4" height="104" rx="2" fill="#2f6b4f"/>';for(var i=0;i<9;i++){var y=14+i*9;h+='<ellipse cx="53" cy="'+y+'" rx="7" ry="4.5" transform="rotate(-25 53 '+y+')" fill="#9b8bd0"/><ellipse cx="67" cy="'+y+'" rx="7" ry="4.5" transform="rotate(25 67 '+y+')" fill="#8a78c4"/>';}h+='<ellipse cx="60" cy="8" rx="4.5" ry="7" fill="#9b8bd0"/>';}
  else if(n==='גרברות')h=leaf+ring('#ff7a3d',4,26,24,0,26)+ring('#ff9a5f',3.5,22,24,7,24)+C('#f3b02a',14)+C('#3a2a1a',8);
  else if(n==='כלניות')h=leaf+ring('#c1272d',17,26,6,0,20)+C('#3b2a55',15)+C('#1e1530',9);
  return '<svg viewBox="0 0 120 120" role="img" aria-label="איור של '+n+'">'+h+'</svg>';
}
function flowerPreview(n){
  return '<div class="fprev"><div class="fart">'+art(n)+'</div><div><b>'+n+'</b><div class="mute">'+(DESC[n]||'')+'</div><a class="btn sec sm" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;margin-top:8px" href="https://www.google.com/search?tbm=isch&q='+encodeURIComponent(n+' פרח')+'">לצפייה בתמונות ב־Google</a></div></div>';
}



function render() {
  var v = $('view');
  $('nav').hidden = !S.me;
  if (!S.loaded) { v.innerHTML = ''; return; }
  if (!S.me) { v.innerHTML = authPage(); return; }
  v.innerHTML = S.tab === 'week' ? weekPage() : S.tab === 'pay' ? payPage() : mePage();
  document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.t === S.tab); });
}

/* תזכורות */
var DN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'], DC = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function remVals() { return S.rem || { day: 3, time: '18:00' }; }
function googleUrl() {
  var r = remVals(), h = r.time.split(':'), d = new Date(); d.setHours(+h[0], +h[1], 0, 0);
  while (d.getDay() !== +r.day || d < new Date()) d.setDate(d.getDate() + 1);
  var e = new Date(d.getTime() + 900000), z = function (n) { return String(n).padStart(2, '0'); }, L = function (x) { return x.getFullYear() + z(x.getMonth() + 1) + z(x.getDate()) + 'T' + z(x.getHours()) + z(x.getMinutes()) + '00'; };
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('בחירת פרחים לשבוע – flowers') + '&details=' + encodeURIComponent('להיכנס לאפליקציה ולבחור את הפרחים והכתובת למשלוח הקרוב.') + '&dates=' + L(d) + '/' + L(e) + '&ctz=Asia/Jerusalem&recur=' + encodeURIComponent('RRULE:FREQ=WEEKLY;BYDAY=' + DC[r.day]);
}
function icsUrl() { var r = remVals(); return '/reminder.ics?day=' + r.day + '&time=' + encodeURIComponent(r.time); }
function remCard() {
  var r = remVals();
  return '<section class="card"><h2>תזכורת שבועית</h2><p class="mute" style="margin-top:0">בחרו יום ושעה, ואז הוסיפו ליומן. התזכורת תחזור כל שבוע.</p><div class="grid"><div><label for="rday">יום</label><select id="rday">' + DN.map(function (n, i) { return '<option value="' + i + '"' + (i == r.day ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div><div><label for="rtime">שעה</label><input id="rtime" type="time" value="' + r.time + '"></div></div><div class="row" style="margin-top:12px"><a class="btn sm" id="rios" href="' + icsUrl() + '" style="display:inline-block;text-decoration:none;text-align:center">יומן אייפון / Outlook</a><a class="btn sec sm" id="rgl" target="_blank" rel="noopener" href="' + googleUrl() + '" style="display:inline-block;text-decoration:none;text-align:center">יומן Google</a></div></section>';
}

var vw = $('view');
vw.addEventListener('input', function (e) { var id = e.target.id; if (id === 'rday' || id === 'rtime') { S.rem = { day: +$('rday').value, time: $('rtime').value || '18:00' }; try { localStorage.setItem('flowers-rem', JSON.stringify(S.rem)); } catch (x) {} var g = $('rgl'), i = $('rios'); if (g) g.href = googleUrl(); if (i) i.href = icsUrl(); return; } if (id === 'wad') S.order.addr = e.target.value; else if (id in S.f) S.f[id] = e.target.value; });
$('nav').addEventListener('click', function (e) { var t = e.target.closest('.tab'); if (t) { S.tab = t.dataset.t; S.ask = false; render(); window.scrollTo(0, 0); if (S.tab === 'me') loadHist(); } });
vw.addEventListener('click', function (e) {
  var b = e.target.closest('[data-a]'); if (!b) return; var a = b.dataset.a;
  if (a === 'auth') { S.auth = b.dataset.v; S.errs = {}; render(); }
  else if (a === 'reg') run(api('POST', '/api/register', S.f).then(function (j) { setMe(j); S.tab = 'week'; render(); window.scrollTo(0, 0); toast('נרשמתם בהצלחה, שלחנו לכם מייל'); }));
  else if (a === 'login') run(api('POST', '/api/login', { phone: S.f.phone, email: S.f.email }).then(function (j) { setMe(j); S.tab = 'week'; render(); window.scrollTo(0, 0); }).catch(function (er) { if (er.status === 401 || er.status === 429) { S.errs = { login: er.message }; render(); } else throw er; }));
  else if (a === 'logout') run(api('POST', '/api/logout').then(function () { S.me = null; S.auth = 'choose'; S.tab = 'week'; S.f = { name: '', phone: '', email: '', addr: '' }; render(); window.scrollTo(0, 0); }));
  else if (a === 'saveme') run(api('PUT', '/api/me', S.f).then(function (j) { setMe(j); render(); toast('הפרטים נשמרו'); }));
  else if (a === 'fl') { S.order.flower = b.dataset.v; render(); }
  else if (a === 'topay') { if ((S.order.addr || '').trim().length < 5) return toast('נא להזין כתובת למשלוח'); run(api('POST', '/api/order', { flower: S.order.flower, addr: S.order.addr }).then(function (j) { S.order = j.order; S.tab = 'pay'; render(); window.scrollTo(0, 0); })); }
  else if (a === 'copy') { try { navigator.clipboard.writeText(BIT).then(function () { toast('המספר הועתק'); }, function () { toast('העתיקו ידנית: ' + BIT); }); } catch (x) { toast('העתיקו ידנית: ' + BIT); } }
  else if (a === 'paid') run(api('POST', '/api/order/paid').then(function (j) { S.order = j.order; render(); toast('תודה! ממתינים לאישור התשלום'); }));
  else if (a === 'got') run(api('POST', '/api/order/received').then(function (j) { S.order = j.order; S.h = null; S.tab = 'week'; render(); toast('תודה! נהנים מהפרחים 🌸'); }));
  else if (a === 'cancel') { S.ask = true; render(); }
  else if (a === 'cancelno') { S.ask = false; render(); }
  else if (a === 'cancel2') { S.ask = false; run(api('POST', '/api/order/cancel').then(function (j) { S.order = j.order; S.h = null; render(); toast('ההזמנה בוטלה'); })); }
  else if (a === 'install' && DP) { DP.prompt(); DP = null; render(); }
});

window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); DP = e; if (S.me && S.tab === 'me') render(); });
try { S.rem = JSON.parse(localStorage.getItem('flowers-rem') || 'null') || undefined; } catch (e) {}

/* טעינה ראשונית, ריענון סטטוס אוטומטי ופתיח */
api('GET', '/api/me').then(setMe, function () {}).then(function () { S.loaded = true; render(); });
setInterval(function () {
  if (!S.me || document.hidden || !S.order || (S.order.status !== 'pending' && S.order.status !== 'paid' && S.order.status !== 'ordered')) return;
  api('GET', '/api/me').then(function (j) {
    if (j.order.status !== S.order.status) { S.order = j.order; var a = document.activeElement; if (!(a && a.tagName === 'INPUT')) render(); toast('סטטוס ההזמנה התעדכן'); }
  }, function () {});
}, 25000);
(function () { var sp = $('splash'), done = 0; function hide() { if (done) return; done = 1; sp.classList.add('out'); setTimeout(function () { sp.remove(); }, 600); } setTimeout(hide, 3500); sp.addEventListener('click', hide); })();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
