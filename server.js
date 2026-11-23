'use strict';
// flowers – שרת עצמאי, ללא תלויות חיצוניות. דורש Node 18 ומעלה.
process.env.TZ = process.env.TZ || 'Asia/Jerusalem';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
// תומך בשני מבנים: קבצי האתר בתיקיית public, או כולם באותה תיקייה (נוח להעלאה מהטלפון)
const FLAT = !fs.existsSync(path.join(__dirname, 'public', 'index.html'));
const PUB = FLAT ? __dirname : path.join(__dirname, 'public');
const FLAT_OK = /^(index\.html|admin\.html|app\.js|admin\.js|style\.css|sw\.js|manifest\.webmanifest|icon[\w.-]*\.(png|svg))$/;
const PRICE = 80;
const FLOWERS = ['ורדים', 'פיוני', 'חמניות', 'טוליפים', 'ליזיאנטוס', 'לבנדר', 'גרברות', 'כלניות'];
const STATUSES = ['ordered', 'pending', 'paid', 'delivered', 'cancelled'];

/* ---------- אחסון (קובץ JSON עם כתיבה אטומית) ---------- */
fs.mkdirSync(DATA, { recursive: true });
const DBF = path.join(DATA, 'db.json');
let db = { customers: [], orders: [], admin: null };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch (e) {}
let timer;
function save() { clearTimeout(timer); timer = setTimeout(flush, 30); }
function flush() { const t = DBF + '.tmp'; fs.writeFileSync(t, JSON.stringify(db)); fs.renameSync(t, DBF); }
process.on('SIGTERM', () => { flush(); process.exit(0); });

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  const f = path.join(DATA, 'secret.txt');
  try { SECRET = fs.readFileSync(f, 'utf8').trim(); }
  catch (e) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, SECRET, { mode: 0o600 }); }
}

/* ---------- סיסמאות וטוקנים ---------- */
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(16).toString('hex'); return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') }; }
function checkPw(pw, a) {
  const h = Buffer.from(crypto.scryptSync(String(pw), a.salt, 64).toString('hex')), g = Buffer.from(a.hash);
  return h.length === g.length && crypto.timingSafeEqual(h, g);
}
if (!db.admin) {
  const user = process.env.ADMIN_USER || 'admin', pass = process.env.ADMIN_PASS || crypto.randomBytes(5).toString('hex');
  db.admin = Object.assign({ user }, hashPw(pass)); flush();
  console.log('\n=== נוצר משתמש מנהל ===\nשם משתמש: ' + user + '\nסיסמה:    ' + pass + '\n(אפשר לשנות בעמוד /admin)\n');
}
const b64 = s => Buffer.from(s).toString('base64url');
function sign(o) { const p = b64(JSON.stringify(o)); return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); }
function verify(t) {
  if (!t) return null;
  const [p, s] = t.split('.'); if (!p || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch (e) { return null; }
}
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = c.slice(i + 1).trim(); }); return o; }
function setCookie(req, res, name, val, age) {
  const sec = req.headers['x-forwarded-proto'] === 'https' || process.env.FORCE_SECURE;
  res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], `${name}=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${sec ? '; Secure' : ''}`));
}
const getCust = req => { const t = verify(cookies(req).fc); return t && db.customers.find(c => c.id === t.c); };
const isAdmin = req => { const t = verify(cookies(req).fa); return !!t && t.s === db.admin.salt; };
const logCust = (req, res, c) => setCookie(req, res, 'fc', sign({ c: c.id, exp: Date.now() + 365 * 864e5 }), 365 * 86400);

/* ---------- הגבלת ניסיונות ---------- */
const hits = new Map();
function limited(req, key, max) {
  const k = key + (req.headers['x-forwarded-for'] || req.socket.remoteAddress), n = Date.now(), h = hits.get(k) || { n: 0, t: n };
  if (n - h.t > 6e5) { h.n = 0; h.t = n; }
  h.n++; hits.set(k, h); return h.n > max;
}

/* ---------- הודעות (מייל ו-SMS, אופציונלי לפי משתני סביבה) ---------- */
async function sendMail(to, subject, html) {
  if (!to) return;
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) { console.log('[מייל לא מוגדר] ל:', to, '|', subject); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html }) });
    if (!r.ok) console.log('שליחת מייל נכשלה', r.status, await r.text());
  } catch (e) { console.log('שליחת מייל נכשלה', e.message); }
}
async function notifyAdmin(text) {
  console.log('[התראה למנהל]', text);
  const { TWILIO_SID: sid, TWILIO_TOKEN: tok, TWILIO_FROM: from, ADMIN_PHONE: to } = process.env;
  if (!sid || !tok || !from || !to) return;
  const dest = to.startsWith('+') ? to : '+972' + to.replace(/^0/, '');
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + tok).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: dest, From: from, Body: text }) });
    if (!r.ok) console.log('שליחת SMS נכשלה', r.status, await r.text());
  } catch (e) { console.log('שליחת SMS נכשלה', e.message); }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mailWrap = (t, p) => `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:16px"><h2 style="color:#d63a72;margin:0 0 12px">flowers 🌸</h2><h3>${t}</h3><p style="line-height:1.6">${p}</p></div>`;

/* ---------- ולידציה ועזרים ---------- */
const norm = p => String(p || '').replace(/[\s-]/g, '');
const okPhone = p => /^0\d{8,9}$/.test(p);
const okMail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 120;
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
function vCust(b) {
  const o = { name: clean(b.name, 60), phone: norm(b.phone), email: clean(b.email, 120).toLowerCase(), addr: clean(b.addr, 150) }, e = {};
  if (o.name.length < 2) e.name = 'נא להזין שם מלא';
  if (!okPhone(o.phone)) e.phone = 'נא להזין מספר טלפון תקין, למשל 050-1234567';
  if (!okMail(o.email)) e.email = 'נא להזין כתובת מייל תקינה';
  if (o.addr.length < 5) e.addr = 'נא להזין כתובת למשלוח';
  return { o, e, bad: !!Object.keys(e).length };
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function nextDelivery() {
  const d = new Date(); d.setHours(9, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 5);
  if (d - new Date() < 172800000) d.setDate(d.getDate() + 7);
  return ymd(d);
}
function active(c) {
  const today = ymd(new Date());
  return db.orders.filter(o => o.cid === c.id && (o.status === 'pending' || o.status === 'paid' || (o.status === 'ordered' && o.date >= today))).sort((a, b) => a.date < b.date ? -1 : 1)[0];
}
const daysUntil = d => Math.round((new Date(d + 'T00:00:00') - new Date(ymd(new Date()) + 'T00:00:00')) / 864e5);
const eff = o => (o.status === 'paid' && o.date < ymd(new Date())) ? 'delivered' : o.status;
const pubOrder = c => { const o = active(c); return o ? { date: o.date, flower: o.flower, addr: o.addr, status: o.status, ref: o.ref, canCancel: daysUntil(o.date) >= 3 } : { date: nextDelivery(), flower: FLOWERS[0], addr: c.addr, status: 'draft', ref: null, canCancel: false }; };
const pubCust = c => ({ name: c.name, phone: c.phone, email: c.email, addr: c.addr });
const newRef = () => { let r; do { r = 'פ-' + (1000 + crypto.randomInt(9000)); } while (db.orders.some(o => o.ref === r)); return r; };
const uid = () => crypto.randomBytes(8).toString('hex');

/* ---------- HTTP ---------- */
class HttpError extends Error { constructor(code, msg, fields) { super(msg); this.code = code; this.fields = fields; } }
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((ok, no) => {
    if (!/application\/json/.test(req.headers['content-type'] || '')) return no(new HttpError(415, 'סוג בקשה לא נתמך'));
    let d = ''; req.on('data', c => { d += c; if (d.length > 20000) { no(new HttpError(413, 'הבקשה גדולה מדי')); req.destroy(); } });
    req.on('end', () => { try { ok(d ? JSON.parse(d) : {}); } catch (e) { no(new HttpError(400, 'בקשה לא תקינה')); } });
  });
}
const needCust = req => { const c = getCust(req); if (!c) throw new HttpError(401, 'נדרשת התחברות'); return c; };
const needAdmin = req => { if (!isAdmin(req)) throw new HttpError(401, 'נדרשת התחברות מנהל'); };
const adminRow = o => { const c = db.customers.find(x => x.id === o.cid) || {}; return { id: o.id, date: o.date, flower: o.flower, addr: o.addr, status: o.status, ref: o.ref, refund: o.refund || null, customer: { name: c.name || '', phone: c.phone || '', email: c.email || '' } }; };

async function api(req, res, p) {
  const m = req.method;
  /* --- לקוחות --- */
  if (p === '/api/register' && m === 'POST') {
    if (limited(req, 'reg', 10)) throw new HttpError(429, 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות');
    const v = vCust(await body(req)); if (v.bad) throw new HttpError(400, 'פרטים חסרים', v.e);
    let c = db.customers.find(x => x.phone === v.o.phone);
    if (c) throw new HttpError(409, 'כבר קיים חשבון עם הטלפון הזה. אפשר להיכנס.', { phone: 'כבר קיים חשבון עם הטלפון הזה, בחרו "יש לי כבר חשבון"' });
    c = Object.assign({ id: uid(), created: Date.now() }, v.o); db.customers.push(c); save();
    logCust(req, res, c);
    sendMail(c.email, 'ברוכים הבאים ל־flowers', mailWrap('נרשמתם בהצלחה, ' + esc(c.name), 'שמחים שהצטרפתם! אפשר להיכנס לאפליקציה, לבחור פרחים ולהזמין את הזר הראשון שלכם.'));
    notifyAdmin('לקוח/ה חדש/ה נרשם/ה: ' + c.name + ' ' + c.phone);
    return send(res, 200, { customer: pubCust(c), order: pubOrder(c) });
  }
  if (p === '/api/login' && m === 'POST') {
    if (limited(req, 'login', 10)) throw new HttpError(429, 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות');
    const b = await body(req), c = db.customers.find(x => x.phone === norm(b.phone) && x.email === clean(b.email, 120).toLowerCase());
    if (!c) throw new HttpError(401, 'לא נמצא חשבון עם הפרטים האלה. אפשר ליצור חשבון חדש.');
    logCust(req, res, c); return send(res, 200, { customer: pubCust(c), order: pubOrder(c) });
  }
  if (p === '/api/logout' && m === 'POST') { setCookie(req, res, 'fc', '', 0); return send(res, 200, {}); }
  if (p === '/api/me' && m === 'GET') { const c = needCust(req); return send(res, 200, { customer: pubCust(c), order: pubOrder(c) }); }
  if (p === '/api/me' && m === 'PUT') {
    const c = needCust(req), v = vCust(await body(req)); if (v.bad) throw new HttpError(400, 'פרטים חסרים', v.e);
    if (db.customers.some(x => x.id !== c.id && x.phone === v.o.phone)) throw new HttpError(409, 'הטלפון כבר רשום', { phone: 'הטלפון כבר רשום בחשבון אחר' });
    Object.assign(c, v.o); save(); return send(res, 200, { customer: pubCust(c), order: pubOrder(c) });
  }
  if (p === '/api/order' && m === 'POST') {
    const c = needCust(req), b = await body(req), a = active(c);
    if (a && a.status !== 'ordered') throw new HttpError(409, 'ההזמנה כבר שולמה ולא ניתן לשנותה');
    const flower = FLOWERS.includes(b.flower) ? b.flower : null, addr = clean(b.addr, 150);
    if (!flower) throw new HttpError(400, 'נא לבחור פרחים'); if (addr.length < 5) throw new HttpError(400, 'נא להזין כתובת למשלוח');
    const o = a || { id: uid(), cid: c.id, date: nextDelivery(), ref: newRef(), created: Date.now() };
    Object.assign(o, { flower, addr, status: 'ordered', updated: Date.now() }); if (!a) db.orders.push(o); save();
    return send(res, 200, { order: pubOrder(c) });
  }
  if (p === '/api/order/paid' && m === 'POST') {
    const c = needCust(req), o = active(c);
    if (!o || o.status !== 'ordered') throw new HttpError(409, 'אין הזמנה שממתינה לתשלום');
    o.status = 'pending'; o.updated = Date.now(); save();
    notifyAdmin(`${o.ref}: ${c.name} (${c.phone}) מדווח/ת ששילם/ה ₪${PRICE} בביט. ${o.flower}, ${o.date}. נא לאשר באפליקציית הניהול.`);
    return send(res, 200, { order: pubOrder(c) });
  }
  if (p === '/api/order/received' && m === 'POST') {
    const c = needCust(req), o = active(c);
    if (!o || o.status !== 'paid') throw new HttpError(409, 'אפשר לאשר קבלה רק אחרי שההזמנה שולמה');
    o.status = 'delivered'; o.updated = Date.now(); save();
    notifyAdmin(`${o.ref}: ${c.name} אישר/ה שקיבל/ה את הזר.`);
    return send(res, 200, { order: pubOrder(c) });
  }
  if (p === '/api/order/cancel' && m === 'POST') {
    const c = needCust(req), o = active(c);
    if (!o) throw new HttpError(409, 'אין הזמנה לביטול');
    if (daysUntil(o.date) < 3) throw new HttpError(409, 'אי אפשר לבטל פחות משלושה ימים לפני המשלוח');
    const was = o.status; o.status = 'cancelled'; o.updated = Date.now(); if (was !== 'ordered') o.refund = 'due'; save();
    notifyAdmin(`${o.ref}: ${c.name} (${c.phone}) ביטל/ה הזמנה.` + (o.refund === 'due' ? ` יש להחזיר ₪${PRICE} בביט.` : ''));
    return send(res, 200, { order: pubOrder(c) });
  }
  if (p === '/api/history' && m === 'GET') {
    const c = needCust(req), list = db.orders.filter(o => o.cid === c.id).sort((a, b) => a.date < b.date ? 1 : -1).map(o => ({ date: o.date, flower: o.flower, status: eff(o), refund: o.refund || null }));
    const paid = list.filter(o => o.status === 'paid' || o.status === 'delivered').length;
    return send(res, 200, { list, stats: { count: list.length, received: list.filter(o => o.status === 'delivered').length, spent: paid * PRICE } });
  }
  /* --- מנהל --- */
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(req, 'adm', 8)) throw new HttpError(429, 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות');
    const b = await body(req);
    if (String(b.user) !== db.admin.user || !checkPw(b.password, db.admin)) throw new HttpError(401, 'שם משתמש או סיסמה שגויים');
    setCookie(req, res, 'fa', sign({ s: db.admin.salt, exp: Date.now() + 12 * 36e5 }), 12 * 3600); return send(res, 200, { user: db.admin.user });
  }
  if (p === '/api/admin/logout' && m === 'POST') { setCookie(req, res, 'fa', '', 0); return send(res, 200, {}); }
  if (p === '/api/admin/me' && m === 'GET') { needAdmin(req); return send(res, 200, { user: db.admin.user }); }
  if (p === '/api/admin/orders' && m === 'GET') { needAdmin(req); return send(res, 200, { orders: db.orders.map(adminRow).sort((a, b) => a.date < b.date ? 1 : -1) }); }
  if (p === '/api/admin/password' && m === 'POST') {
    needAdmin(req); const b = await body(req);
    if (!checkPw(b.current, db.admin)) throw new HttpError(400, 'הסיסמה הנוכחית שגויה');
    const user = clean(b.user, 40) || db.admin.user, pw = String(b.password || '');
    if (pw && pw.length < 8) throw new HttpError(400, 'הסיסמה החדשה חייבת להכיל לפחות 8 תווים');
    db.admin = Object.assign({ user }, pw ? hashPw(pw) : { salt: db.admin.salt, hash: db.admin.hash }); flush();
    setCookie(req, res, 'fa', sign({ s: db.admin.salt, exp: Date.now() + 12 * 36e5 }), 12 * 3600); return send(res, 200, { user });
  }
  let mm = p.match(/^\/api\/admin\/orders(?:\/([a-f0-9]+))?$/);
  if (mm && (m === 'POST' || m === 'PUT' || m === 'DELETE')) {
    needAdmin(req);
    if (m === 'DELETE') { const i = db.orders.findIndex(o => o.id === mm[1]); if (i < 0) throw new HttpError(404, 'לא נמצא'); db.orders.splice(i, 1); save(); return send(res, 200, {}); }
    const b = await body(req), e = {}, name = clean(b.name, 60), phone = norm(b.phone), email = clean(b.email, 120).toLowerCase(), addr = clean(b.addr, 150);
    if (name.length < 2) e.name = 'שם'; if (!okPhone(phone)) e.phone = 'טלפון'; if (email && !okMail(email)) e.email = 'מייל'; if (addr.length < 5) e.addr = 'כתובת';
    if (!FLOWERS.includes(b.flower)) e.flower = 'פרחים'; if (!STATUSES.includes(b.status)) e.status = 'סטטוס'; if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) e.date = 'תאריך';
    if (Object.keys(e).length) throw new HttpError(400, 'שדות לא תקינים: ' + Object.values(e).join(', '), e);
    let o;
    if (m === 'PUT') { o = db.orders.find(x => x.id === mm[1]); if (!o) throw new HttpError(404, 'לא נמצא'); }
    let c = o && db.customers.find(x => x.id === o.cid);
    if (!c) c = db.customers.find(x => x.phone === phone);
    if (!c) { c = { id: uid(), created: Date.now(), addr }; db.customers.push(c); }
    Object.assign(c, { name, phone, email }); if (!c.addr) c.addr = addr;
    const was = o && o.status;
    if (!o) { o = { id: uid(), created: Date.now(), ref: newRef() }; db.orders.push(o); }
    Object.assign(o, { cid: c.id, date: b.date, flower: b.flower, addr, status: b.status, updated: Date.now() });
    if (b.status === 'cancelled' && (was === 'paid' || was === 'pending') && !o.refund) o.refund = 'due';
    if (b.refund === 'done' || b.refund === 'due') o.refund = b.refund;
    save();
    if (b.status === 'paid' && was !== 'paid') sendMail(c.email, 'התשלום אושר – flowers', mailWrap('התשלום התקבל', `הזמנה ${esc(o.ref)} אושרה. הזר (${esc(o.flower)}) יגיע אליכם בתאריך ${esc(o.date)}. תודה!`));
    return send(res, 200, { order: adminRow(o) });
  }
  throw new HttpError(404, 'לא נמצא');
}

/* ---------- קבצים סטטיים ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" };
function reminderIcs(req, res) {
  const q = new URL(req.url, 'http://x').searchParams, day = Math.min(6, Math.max(0, parseInt(q.get('day'), 10) || 0)), tm = /^\d{2}:\d{2}$/.test(q.get('time') || '') ? q.get('time') : '18:00';
  const [h, mi] = tm.split(':').map(Number), d = new Date(); d.setHours(h, mi, 0, 0);
  while (d.getDay() !== day || d < new Date()) d.setDate(d.getDate() + 1);
  const z = n => String(n).padStart(2, '0'), L = x => x.getFullYear() + z(x.getMonth() + 1) + z(x.getDate()) + 'T' + z(x.getHours()) + z(x.getMinutes()) + '00', e = new Date(d.getTime() + 900000);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//flowers//HE', 'BEGIN:VEVENT', 'UID:flowers-' + day + tm.replace(':', '') + '@flowers', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d+/g, ''), 'DTSTART:' + L(d), 'DTEND:' + L(e), 'RRULE:FREQ=WEEKLY;BYDAY=' + ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][day], 'SUMMARY:בחירת פרחים לשבוע – flowers', 'DESCRIPTION:להיכנס לאפליקציה ולבחור את הפרחים והכתובת למשלוח הקרוב.', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:flowers', 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="flowers-reminder.ics"', 'Cache-Control': 'no-store' });
  res.end(ics);
}
function serve(req, res, p) {
  if (p === '/reminder.ics') return reminderIcs(req, res);
  if (p === '/') p = '/index.html'; if (p === '/admin') p = '/admin.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  if (FLAT && (path.dirname(f) !== __dirname || !FLAT_OK.test(path.basename(f)))) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('לא נמצא'); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('לא נמצא'); }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': /\.(png|svg)$/.test(f) ? 'public, max-age=86400' : 'no-cache' }, SEC));
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p.startsWith('/api/')) {
    try { await api(req, res, p); }
    catch (e) { if (e instanceof HttpError) send(res, e.code, { error: e.message, fields: e.fields }); else { console.error(e); send(res, 500, { error: 'שגיאת שרת' }); } }
  } else serve(req, res, p);
}).listen(PORT, () => console.log('flowers רץ על פורט ' + PORT));
