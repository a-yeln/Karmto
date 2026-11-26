const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner, installMockStorage } = require('../helpers');

// แยกส่ง ชุด 2 (เสริมหลัง money-guard เจอช่องว่าง): ทะเบียนบันทึก/ลบออเดอร์ที่ "รอส่ง" (queuedOrderWrites_, localStorage karmto.queuedOrderWrites)
//  A) ออฟไลน์บันทึก/ลบ → การ์ดถูกล้างได้ → อีกเครื่องติ๊กจ่ายบิลนั้น → ต่อเน็ต flush → ต้องเตือน (toast ระบุรหัส+วันที่ + log) โดยไม่เขียน/ไม่ย้อน billingPaid
//  B) readDayFreshForPaid_: ออนไลน์แต่คิวออฟไลน์ไม่ว่าง → ส่งคิวก่อนแล้วอ่านวันสด (ไม่ใช้แคช); ส่งไม่หมด/พัง = ใช้แคชและบอกผู้ใช้; ไม่วนซ้ำ
//  C) saveRow exception ก่อนเขียน = การ์ด error ไม่ค้าง saving; หลังเขียน = "บันทึกแล้ว แต่แสดงผลไม่ครบ"; ปุ่มลบในลิสต์ล้ม = มี toast ไม่มี error หลุด
// ตรึงวันที่ 20/11/2026 ด้วย setFixedTime แล้วปล่อยเวลาเดินด้วย setSystemTime (เฟส "done" ของการ์ดอิง Date.now())
const TODAY = '2026-11-20';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const PAID = (n) => ({ paid: true, paidDate: '2026-11-21', transferAmount: n, billedAmount: n });
const dayStore = over => ({ ['day:' + TODAY]: mkDay(over || { orders: {} }) });

async function boot(browser, { store, viewport } = {}) {
  const page = await openApp(browser, { store: Object.assign({ rawLots: [] }, store || dayStore()), date: TODAY, viewport });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00'));
  const dlg = { log: [], mode: 'dismiss' };
  const errs = [];
  page.on('dialog', async d => { dlg.log.push({ type: d.type(), message: d.message() }); if (dlg.mode === 'accept') await d.accept(); else await d.dismiss(); });
  page.on('pageerror', e => errs.push(e.message));
  await installHooks(page);
  await page.evaluate(async () => { await switchTab('order'); refreshOrderTab(); });
  await stripBanner(page);
  return { page, dlg, errs };
}
// ตะขอชั้นนอกสุดของ storage: บันทึกลำดับ get/patchField ของวัน (พิสูจน์ "ส่งคิวก่อนอ่านสด") + หน่วง/ทำให้ล้มได้ + ดัก toast
const installHooks = page => page.evaluate(() => {
  window.__toasts = []; window.__seq = []; window.__patchTries = 0;
  const ot = window.showToast;
  window.showToast = function (m) { window.__toasts.push(String(m)); return ot.apply(this, arguments); };
  const base = window.storage, w = Object.create(base);
  w.get = async function (key, ...r) { if (/^day:/.test(key)) window.__seq.push('get:' + key); if (window.__getHook) { const x = await window.__getHook(key); if (x !== undefined) return x; } return base.get(key, ...r); };
  w.patchField = async function (key, p, v) { if (/^day:/.test(key)) { window.__seq.push('patch:' + JSON.stringify(p)); window.__patchTries++; } if (window.__patchHook) { const x = await window.__patchHook(key, p, v); if (x !== undefined) return x; } return base.patchField(key, p, v); };
  w.patchOps = async function (key, ops, ria) { if (window.__opsHook) { const x = await window.__opsHook(key, ops, ria); if (x !== undefined) return x; } return base.patchOps(key, ops, ria); };
  window.storage = w;
});
const quiet = page => page.evaluate(() => new Promise(res => {
  let last = -1, n = 0;
  const tick = () => { const q = Object.keys(pendingDayRevs_).length === 0 && window.__writes.length === last; n = q ? n + 1 : 0; last = window.__writes.length; if (n >= 6) return res(); requestAnimationFrame(tick); };
  tick();
}));
const resetW = async page => { await quiet(page); await page.evaluate(() => { window.__writes = []; }); };
const waitState = (page, s, ms = 9000) => page.waitForFunction(s => document.getElementById('orderFormCard').dataset.save === s, s, { timeout: ms });
const waitReg = (page, n, ms = 9000) => page.waitForFunction(n => queuedOrderWrites_.length === n, n, { timeout: ms });
const openForm = (page, code) => page.evaluate(c => { openBranchForm_(c); document.activeElement && document.activeElement.blur(); }, code);
const fillP = (page, pid, v) => page.fill(`#productInputs .prodinput[data-pid="${pid}"]`, String(v));
const toasts = page => page.evaluate(() => window.__toasts.slice());
const storeDay = page => page.evaluate(iso => JSON.parse(JSON.stringify(window.__store['day:' + iso] || null)), TODAY);
const queueLen = page => page.evaluate(() => readOfflineQueue_().length);
const dayW = ws => ws.filter(w => /^day:/.test(w.key));
const wr = page => page.evaluate(() => window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path, ops: w.ops })));
// ข้อความ log กิจกรรมทั้งหมด (actlog:*) ที่ตรงรูปแบบ
const actlog = (page, re) => page.evaluate(src => Object.keys(window.__store).filter(k => /^actlog:/.test(k)).flatMap(k => window.__store[k].map(e => e.text)).filter(t => new RegExp(src).test(t)), re.source);
const warnToasts = (ts, code) => ts.filter(t => new RegExp(`บิลสาขา ${code} วันที่ 20/11/2026 ถูกติ๊กจ่ายระหว่างออฟไลน์ ออเดอร์ที่ส่งทีหลังอาจทับ`).test(t));
const goOffline = page => page.evaluate(() => { window.__forceOffline = true; });
const flushOnline = page => page.evaluate(async () => { window.__forceOffline = false; await flushOfflineQueue_(); });
const otherDevicePays = (page, code, n) => page.evaluate(({ code, n, p }) => { const d = window.__store['day:2026-11-20']; d.billingPaid = Object.assign({}, d.billingPaid, { [code]: p }); }, { code, n, p: PAID(n) });
async function offlineSave(page, code, qty, { clearCard = true } = {}) {
  await openForm(page, code);
  await goOffline(page);
  await fillP(page, 'p1', qty);
  await page.click('#saveRowBtn');
  await waitState(page, 'queued');
  if (clearCard) { await page.click('[data-ossnext]'); await page.waitForFunction(() => orderSavedView_ === null, null, { timeout: 4000 }); }
}

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  // ============ A1: ออฟไลน์บันทึก 02 → การ์ดถูกล้าง → อีกเครื่องติ๊กจ่าย → flush = เตือน ============
  {
    const { page, errs } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 2 }, '05': { p1: 1 }, '13': { p1: 4 } } }) });
    await openForm(page, '02'); await goOffline(page);
    await fillP(page, 'p1', 5);
    await page.click('#saveRowBtn');
    await waitState(page, 'queued');
    const R = await page.evaluate(() => ({ reg: JSON.parse(JSON.stringify(queuedOrderWrites_)), ls: JSON.parse(localStorage.getItem('karmto.queuedOrderWrites') || 'null') }));
    check('A1: ออฟไลน์บันทึก 02 → ลงทะเบียน 1 รายการ {iso 20/11, code 02, op save, paidAtWrite false} และเก็บลง localStorage karmto.queuedOrderWrites', R.reg.length === 1 && R.reg[0].iso === TODAY && R.reg[0].code === '02' && R.reg[0].op === 'save' && R.reg[0].paidAtWrite === false && R.ls && R.ls.length === 1 && R.ls[0].qid === R.reg[0].qid, R);
    await page.click('[data-ossnext]');
    await page.waitForFunction(() => orderSavedView_ === null, null, { timeout: 4000 });
    check('A1: กด "→ สาขาถัดไป" = การ์ด ⏳ ถูกล้าง แต่ทะเบียนยังอยู่ (ไม่ผูกกับการ์ด)', await page.evaluate(() => orderSavedView_ === null && document.getElementById('orderFormCard').dataset.save !== 'queued' && queuedOrderWrites_.length === 1));
    await otherDevicePays(page, '02', 99);
    const paidBefore = JSON.stringify((await storeDay(page)).billingPaid);
    await page.evaluate(() => { window.__toasts.length = 0; window.__seq.length = 0; });
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    check('A1: ยังออฟไลน์ + คิวไม่ว่าง → เรียกตรวจแล้วรายการคงอยู่ ไม่เตือน ไม่อ่านวันสด', await page.evaluate(() => queuedOrderWrites_.length === 1 && !window.__toasts.some(t => /ถูกติ๊กจ่าย/.test(t))) && !(await page.evaluate(() => window.__seq.some(s => /^get:/.test(s)))));
    await resetW(page);
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'queued-warn-toast-macaron.png') }).catch(() => {});
    const ts = await toasts(page);
    check('A1: flush เสร็จ → toast ระบุรหัส+วันที่ "บิลสาขา 02 วันที่ 20/11/2026 ถูกติ๊กจ่ายระหว่างออฟไลน์ ออเดอร์ที่ส่งทีหลังอาจทับ — ตรวจที่หน้าบิล" (1 ข้อความ)', warnToasts(ts, '02').length === 1 && ts.filter(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)).length === 1, ts);
    await page.waitForFunction(() => Object.keys(window.__store).some(k => /^actlog:/.test(k) && JSON.stringify(window.__store[k]).includes('ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง')), null, { timeout: 5000 });
    const lg = await actlog(page, /บิลสาขา 02 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/);
    check('A1: จด log กิจกรรม 1 รายการ (ระบุรหัส + วันที่ 20/11/2026)', lg.length === 1 && /20\/11\/2026/.test(lg[0]), lg);
    const w = await wr(page), sd = await storeDay(page);
    check('A1: ไม่เขียน/ไม่ย้อน billingPaid: เขียนแค่ patchField ["orders","02"] ที่ค้างคิว (ไม่มี set, ไม่มี path/op ของ billingPaid) ค่า billingPaid ของอีกเครื่องเหมือนเดิมทุกตัวอักษร', dayW(w).length === 1 && dayW(w)[0].op === 'patchField' && JSON.stringify(dayW(w)[0].path) === '["orders","02"]' && !w.some(x => x.op === 'set') && !JSON.stringify(w).includes('billingPaid') && JSON.stringify(sd.billingPaid) === paidBefore && sd.orders['02'].p1 === 5, { w, sd: sd.billingPaid });
    check('A1: ทะเบียนว่าง + localStorage ถูกลบ (เคลียร์เฉพาะที่ตรวจได้จริง)', await page.evaluate(() => queuedOrderWrites_.length === 0 && localStorage.getItem('karmto.queuedOrderWrites') === null));
    // ไม่เตือนซ้ำ: เรียกตรวจ/ซิงก์ซ้ำหลายทางพร้อมกัน
    await page.evaluate(async () => { await Promise.all([checkQueuedOrderWrites_(), checkQueuedOrderWrites_(), syncFromOtherDevices_()]); });
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    const ts2 = await toasts(page);
    check('A1: ตรวจ/ซิงก์ซ้ำอีกหลายครั้ง → ไม่เตือนซ้ำ (toast ยัง 1, log ยัง 1)', warnToasts(ts2, '02').length === 1 && (await actlog(page, /ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1, ts2.filter(t => /ถูกติ๊กจ่าย/.test(t)));
    check('A1: ไม่มี exception หลุดในหน้า', errs.length === 0, errs);
    await page.close();
  }

  // ============ A2: ไม่ถูกติ๊กจ่าย = ไม่เตือน ============
  {
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 2 } } }) });
    await offlineSave(page, '03', 2);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await flushOnline(page);
    await waitReg(page, 0);
    const sd = await storeDay(page);
    check('A2: บิลไม่ถูกติ๊กจ่ายระหว่างออฟไลน์ → ไม่มี toast เตือน ไม่มี log เตือน ทะเบียนว่าง ออเดอร์ 03 ถึง server', !(await toasts(page)).some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)) && (await actlog(page, /ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 0 && sd.orders['03'].p1 === 2 && Object.keys(sd.billingPaid).length === 0);
    await page.close();
  }

  // ============ A3: ลบออเดอร์ออฟไลน์ (op delete) ก็เตือน ============
  {
    const { page, dlg } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 2 }, '05': { p1: 1 } } }) });
    dlg.mode = 'accept';
    await goOffline(page);
    await page.click('#orderList [data-del="01"]');
    await waitReg(page, 1);
    const E = await page.evaluate(() => JSON.parse(JSON.stringify(queuedOrderWrites_)));
    check('A3: ลบออฟไลน์ → ลงทะเบียน {code 01, op delete, paidAtWrite false} + toast "ลบไว้ในเครื่องแล้ว รอส่งเมื่อมีเน็ต"', E[0].code === '01' && E[0].op === 'delete' && E[0].paidAtWrite === false && (await toasts(page)).some(t => /ลบไว้ในเครื่องแล้ว รอส่งเมื่อมีเน็ต/.test(t)), E);
    await otherDevicePays(page, '01', 5);
    const before = JSON.stringify((await storeDay(page)).billingPaid);
    await resetW(page);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    const sd = await storeDay(page), w = await wr(page);
    check('A3: flush การลบ → เตือนบิลสาขา 01 วันที่ 20/11/2026 (toast 1 + log 1)', warnToasts(await toasts(page), '01').length === 1 && (await actlog(page, /บิลสาขา 01 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1);
    check('A3: การลบที่ค้างคิวถึง server (orders[01] หาย) แต่ billingPaid[01] ของอีกเครื่องไม่ถูกแตะ/ไม่ถูกลบ; ไม่มีเขียนเกี่ยวกับ billingPaid', !sd.orders['01'] && !!sd.orders['05'] && JSON.stringify(sd.billingPaid) === before && !JSON.stringify(w).includes('billingPaid') && !w.some(x => x.op === 'set'), { sd: sd.billingPaid, w: w.map(x => x.op + ':' + x.key) });
    await page.close();
  }

  // ============ A4: หลายบิล = toast เดียว (log แยกต่อบิล) ============
  {
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '02', 1);
    await offlineSave(page, '03', 2);
    await waitReg(page, 2);
    await otherDevicePays(page, '02', 11); await otherDevicePays(page, '03', 22);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    const ts = (await toasts(page)).filter(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t));
    await page.waitForFunction(() => Object.keys(window.__store).flatMap(k => /^actlog:/.test(k) ? window.__store[k].map(e => e.text) : []).filter(t => /ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/.test(t)).length >= 2, null, { timeout: 5000 });
    check('A4: 2 บิลถูกติ๊กจ่ายระหว่างออฟไลน์ → รวมเป็น toast เดียว "⚠️ 2 บิลถูกติ๊กจ่ายระหว่างออฟไลน์ …"', ts.length === 1 && /^⚠️ 2 บิลถูกติ๊กจ่ายระหว่างออฟไลน์/.test(ts[0]), ts);
    check('A4: log กิจกรรมแยกต่อบิล (02 และ 03 อย่างละ 1)', (await actlog(page, /บิลสาขา 02 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1 && (await actlog(page, /บิลสาขา 03 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1);
    check('A4: ไม่เขียน billingPaid ของทั้งสองบิล (11 และ 22 ยังอยู่)', (await storeDay(page)).billingPaid['02'].transferAmount === 11 && (await storeDay(page)).billingPaid['03'].transferAmount === 22);
    await page.close();
  }

  // ============ A5: คิวยังไม่หมด / อ่านวันสดไม่ได้ = รายการคงอยู่ ไม่เคลียร์ ============
  {
    // (i) ส่งคิวไม่สำเร็จ (patchField ล้ม) → คิวไม่ว่าง → ไม่ตรวจ ไม่อ่านวันสด ทะเบียนคงอยู่; แก้แล้วส่งใหม่ → เตือน
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '02', 3);
    await otherDevicePays(page, '02', 33);
    await page.evaluate(() => { window.__patchHook = async () => { throw new Error('server down'); }; window.__seq.length = 0; window.__toasts.length = 0; });
    await flushOnline(page);
    const A = await page.evaluate(() => ({ reg: queuedOrderWrites_.length, q: readOfflineQueue_().length, gets: window.__seq.filter(s => /^get:/.test(s)).length, warn: window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), ls: !!localStorage.getItem('karmto.queuedOrderWrites') }));
    check('A5: ส่งคิวไม่สำเร็จ (คิวยังไม่ว่าง) → ทะเบียนคงอยู่ (1) + localStorage ยังอยู่ + ไม่อ่านวันสด + ไม่เตือน', A.reg === 1 && A.q > 0 && A.gets === 0 && !A.warn && A.ls, A);
    await page.evaluate(() => { window.__patchHook = null; });
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    check('A5: แก้แล้วส่งใหม่จนคิวว่าง → ตรวจ+เตือน 1 ครั้ง แล้วทะเบียนว่าง', warnToasts(await toasts(page), '02').length === 1 && await page.evaluate(() => localStorage.getItem('karmto.queuedOrderWrites') === null));
    await page.close();
  }
  {
    // (ii) คิวว่างแล้วแต่อ่านวันสดไม่ได้ → คงรายการไว้ ไม่เคลียร์; อ่านได้รอบหน้า (checkQueuedOrderWrites_ ตรงๆ / ซิงก์) → เตือนครั้งเดียว
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '02', 3);
    await otherDevicePays(page, '02', 44);
    await page.evaluate(() => { window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); }; window.__toasts.length = 0; });
    await flushOnline(page);
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    const B = await page.evaluate(() => ({ reg: queuedOrderWrites_.length, q: readOfflineQueue_().length, warn: window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), ls: !!localStorage.getItem('karmto.queuedOrderWrites') }));
    check('A5: คิวว่างแต่อ่านวันสดไม่ได้ (get ล้ม) → ทะเบียนคงอยู่ (1) ไม่เคลียร์ ไม่เตือนลอยๆ localStorage ยังอยู่', B.q === 0 && B.reg === 1 && !B.warn && B.ls, B);
    await page.evaluate(() => { window.__getHook = null; });
    await page.evaluate(async () => { await syncFromOtherDevices_(); });
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    check('A5: รอบซิงก์ถัดไปอ่านได้ → เตือน 1 ครั้ง + ทะเบียนว่าง (ไม่ตกหล่น)', warnToasts(await toasts(page), '02').length === 1 && (await actlog(page, /ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1);
    await page.close();
  }

  // ============ A6: ปิดแท็บเปิดใหม่ (reload; localStorage คงอยู่) แล้ว flush = ยังเตือน ============
  {
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '02', 6);
    const qid = await page.evaluate(() => queuedOrderWrites_[0].qid);
    const lsQueue = await page.evaluate(() => readOfflineQueue_().length);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof settings !== 'undefined' && settings && settings.branches, null, { timeout: 15000 });
    await stripBanner(page);
    await installMockStorage(page);
    // "เซิร์ฟเวอร์" ตอนนี้: อีกเครื่องติ๊กจ่าย 02 ไปแล้วระหว่างที่แอปถูกปิด (ยังไม่มีออเดอร์ 02 เพราะคำสั่งยังค้างอยู่ในเครื่องเรา)
    await page.evaluate(({ d, p }) => {
      window.__store['day:' + d] = { orders: { '01': { p1: 1 } }, billingPaid: { '02': p } };
      currentDate = d; dayData = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:' + d]))); dayCache_[d] = dayData;
    }, { d: TODAY, p: PAID(66) });
    await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00')); await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00'));
    await installHooks(page);
    const R = await page.evaluate(() => ({ reg: queuedOrderWrites_.map(e => ({ qid: e.qid, code: e.code, iso: e.iso, op: e.op })), q: readOfflineQueue_().length }));
    check('A6: เปิดแอปใหม่ → ทะเบียนโหลดกลับจาก localStorage ครบ (qid เดิม 02/20-11) และคิวออฟไลน์ยังอยู่', R.reg.length === 1 && R.reg[0].qid === qid && R.reg[0].code === '02' && R.reg[0].iso === TODAY && R.q === lsQueue && R.q > 0, { R, lsQueue });
    await page.evaluate(async () => { window.__forceOffline = false; await flushOfflineQueue_(); });
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    const sd = await storeDay(page);
    check('A6: หลังเปิดใหม่แล้ว flush → ยังเตือน (บิลสาขา 02 วันที่ 20/11/2026) + ไม่ย้อน billingPaid (66 ยังอยู่)', warnToasts(await toasts(page), '02').length === 1 && sd.billingPaid['02'].transferAmount === 66 && sd.orders['02'].p1 === 6);
    await page.close();
  }

  // ============ A7: เส้นอ่านหลายรูป OCR (patchOps) ที่ต่อคิวก็ลงทะเบียน ============
  {
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } }, billingPaid: { '06': PAID(7) } }) });
    await page.evaluate(() => {
      window.parseOrderImage = async f => ({ branchCode: f.name.startsWith('a') ? '05' : '06', branchArea: '', items: [{ name: 'กุ้งแช่ (กก.) 3 กก.', qty: 3 }], unmatched: [] });
      window.__forceOffline = true;
    });
    await resetW(page);
    await page.evaluate(async () => { await readOrderImages([{ name: 'a.png' }, { name: 'b.png' }]); });
    const R = await page.evaluate(() => ({ reg: queuedOrderWrites_.map(e => ({ code: e.code, op: e.op, paidAtWrite: e.paidAtWrite, iso: e.iso })), st: document.getElementById('orderImageStatus').textContent }));
    check('A7: OCR หลายรูปตอนออฟไลน์ → patchOps ต่อคิว และลงทะเบียนทั้ง 05 (ยังไม่จ่าย) และ 06 (มี billingPaid อยู่แล้ว → paidAtWrite=true)', R.reg.length === 2 && R.reg.find(e => e.code === '05').paidAtWrite === false && R.reg.find(e => e.code === '06').paidAtWrite === true && R.reg.every(e => e.op === 'save' && e.iso === TODAY), R);
    check('A7: ยังไม่มีอะไรถึง server ตอนออฟไลน์ (ไม่มีเขียน day:)', dayW(await wr(page)).length === 0 && !(await storeDay(page)).orders['05']);
    await otherDevicePays(page, '05', 55);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    const ts = (await toasts(page)).filter(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t));
    check('A7: flush → เตือนเฉพาะ 05 (ถูกติ๊กจ่ายระหว่างออฟไลน์) ส่วน 06 ที่จ่ายก่อนกดแล้ว ไม่เตือนซ้ำ — toast เดียว', ts.length === 1 && warnToasts(ts, '05').length === 1 && (await storeDay(page)).billingPaid['05'].transferAmount === 55 && (await storeDay(page)).billingPaid['06'].transferAmount === 7);
    await page.close();
  }

  // ============ A8: ทิ้งรายการทะเบียนที่ "อ่านวันสดพลาดต่อเนื่อง >7 วัน นับจาก readyAt" + log; อ่านสำเร็จไม่มีวันถูกทิ้ง ============
  // (พฤติกรรมจริงในโค้ด ณ ตอนนี้: ลองอ่านวันสดก่อนเสมอไม่ว่ารายการอายุเท่าไร; readyAt = เวลาที่ผ่านด่าน ออนไลน์+คิวว่าง ครั้งแรก — ไม่ใช่เวลากดบันทึก)
  const DAY = 86400000;
  const seedReg = (page, entries) => page.evaluate(({ entries, today }) => {
    const now = Date.now(), DAY = 86400000;
    queuedOrderWrites_ = entries.map((e, i) => Object.assign({ qid: 'q-' + i, iso: today, code: '02', op: 'save', paidAtWrite: false, at: now - 1000 }, ((x) => { const o = Object.assign({}, x); if (o.atAgo != null) { o.at = now - o.atAgo * DAY; delete o.atAgo; } if (o.readyAgo != null) { o.readyAt = now - o.readyAgo * DAY; delete o.readyAgo; } return o; })(e)));
    persistQueuedOrderWrites_();
    window.__seq.length = 0; window.__toasts.length = 0;
  }, { entries, today: TODAY });
  const skipRe = /ข้ามการตรวจบิลจ่ายของออเดอร์ที่รอส่ง/;
  const regState = page => page.evaluate(() => ({ reg: queuedOrderWrites_.map(e => ({ qid: e.qid, readyAt: e.readyAt })), ls: JSON.parse(localStorage.getItem('karmto.queuedOrderWrites') || 'null'), gets: window.__seq.filter(x => /^get:/.test(x)) }));
  {
    // A8a: อ่านได้ → ต่อให้ at เก่ากว่า 7 วัน (และ readyAt เก่ากว่า 7 วัน) ก็ยังตรวจ+เตือนตามเดิม ไม่ถูกทิ้ง ไม่มี log "ข้าม"
    const { page } = await boot(browser, { store: Object.assign(dayStore({ orders: { '01': { p1: 1 } } }), { 'day:2026-11-10': mkDay({ orders: { '02': { p1: 1 } }, billingPaid: { '02': PAID(20) } }) }) });
    await seedReg(page, [{ iso: '2026-11-10', atAgo: 9, readyAgo: 8, qid: 'q-old' }]);
    await resetW(page);
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 5000 });
    await quiet(page);
    const R = await regState(page);
    const ts = await toasts(page);
    check('A8a: รายการเก่า (กดบันทึก 9 วันก่อน, readyAt 8 วันก่อน) แต่อ่านวันสดได้ → ยิง GET วัน 10/11, เตือน "บิลสาขา 02 วันที่ 10/11/2026 ถูกติ๊กจ่าย…" 1 ครั้ง, เคลียร์ทะเบียน (อ่านสำเร็จไม่ถูกทิ้ง)', R.gets.join() === 'get:day:2026-11-10' && ts.filter(t => /บิลสาขา 02 วันที่ 10\/11\/2026 ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)).length === 1 && R.reg.length === 0 && R.ls === null, { R, ts });
    check('A8a: ไม่มี log "ข้ามการตรวจ" (ไม่ถูกทิ้ง) มีแต่ log เตือนบิลจ่าย 1 บรรทัด', (await actlog(page, skipRe)).length === 0 && (await actlog(page, /บิลสาขา 02 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1);
    await page.close();
  }
  {
    // A8b: อ่านไม่ได้ + readyAt เก่ากว่า 7 วัน → ลอง GET ก่อนเสมอ แล้วทิ้ง + log 1 บรรทัดต่อ (วัน,สาขา) ; ไม่ทิ้งอันที่ readyAt 6 วัน ; ไม่เตือนลอยๆ ; ไม่เขียนวัน/billingPaid
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } }, billingPaid: { '02': PAID(22) } }) });
    await seedReg(page, [
      { qid: 'q-s1', iso: '2026-11-10', code: '02', readyAgo: 8 },
      { qid: 'q-s2', iso: '2026-11-10', code: '02', op: 'delete', readyAgo: 9 },   // (วัน,สาขา) เดียวกัน → log บรรทัดเดียว
      { qid: 'q-s3', iso: '2026-11-11', code: '05', readyAgo: 7.5 },
      { qid: 'q-keep', iso: '2026-11-14', code: '06', readyAgo: 6 },                // 6 วัน = ยังไม่ถึง 7 → คงไว้
    ]);
    await page.evaluate(() => { window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); }; });
    await resetW(page);
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    await page.waitForFunction(() => Object.keys(window.__store).some(k => /^actlog:/.test(k) && JSON.stringify(window.__store[k]).includes('ข้ามการตรวจบิลจ่ายของออเดอร์ที่รอส่ง')), null, { timeout: 5000 });
    await quiet(page);
    const R = await regState(page);
    const lg = (await actlog(page, skipRe)).sort();
    check('A8b: อ่านพลาดต่อเนื่อง >7 วัน (readyAt 8/9/7.5 วันก่อน) → ทิ้ง 3 รายการ เหลือ q-keep (readyAt 6 วัน) 1 รายการ + localStorage ตรงกัน', R.reg.length === 1 && R.reg[0].qid === 'q-keep' && R.ls.length === 1 && R.ls[0].qid === 'q-keep', R);
    check('A8b: ลอง GET ก่อนเสมอ (ทุกวันที่มีรายการ: 10/11, 11/11, 14/11 — ไม่ข้าม GET เพราะอายุ)', ['get:day:2026-11-10', 'get:day:2026-11-11', 'get:day:2026-11-14'].every(g => R.gets.includes(g)) && R.gets.length === 3, R.gets);
    check('A8b: log 1 บรรทัดต่อ (วัน,สาขา): 02/10-11 (รวม 2 รายการ) และ 05/11-11 — รูปแบบ "ข้ามการตรวจบิลจ่ายของออเดอร์ที่รอส่ง สาขา X วันที่ Y — อ่านวันนี้จากเซิร์ฟเวอร์ไม่สำเร็จต่อเนื่องเกิน 7 วัน"', lg.length === 2 && lg[0] === 'ข้ามการตรวจบิลจ่ายของออเดอร์ที่รอส่ง สาขา 02 วันที่ 10/11/2026 — อ่านวันนี้จากเซิร์ฟเวอร์ไม่สำเร็จต่อเนื่องเกิน 7 วัน' && lg[1] === 'ข้ามการตรวจบิลจ่ายของออเดอร์ที่รอส่ง สาขา 05 วันที่ 11/11/2026 — อ่านวันนี้จากเซิร์ฟเวอร์ไม่สำเร็จต่อเนื่องเกิน 7 วัน', lg);
    const w = await wr(page);
    check('A8b: ไม่เตือนบิลจ่ายลอยๆ (ไม่ได้อ่านจริง) ไม่เขียนข้อมูลวัน/billingPaid (มีแต่ log กิจกรรม) และ 02 วัน 20/11 (billingPaid 22) ไม่ถูกแตะ', !(await toasts(page)).some(t => /ถูกติ๊กจ่าย/.test(t)) && dayW(w).length === 0 && !JSON.stringify(w).includes('billingPaid') && (await storeDay(page)).billingPaid['02'].transferAmount === 22, w.map(x => x.op + ':' + x.key));
    // รอบถัดไป (อ่านได้แล้ว) q-keep ยังถูกตรวจตามปกติ ไม่ถูกทิ้งไปก่อนเวลา
    await page.evaluate(() => { window.__getHook = null; window.__store['day:2026-11-14'] = { orders: {}, billingPaid: { '06': { paid: true, paidDate: '2026-11-15', transferAmount: 6 } } }; window.__toasts.length = 0; });
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 5000 });
    check('A8b: รอบถัดไปอ่านได้ → q-keep ถูกตรวจ+เตือน (บิลสาขา 06 วันที่ 14/11/2026) แล้วเคลียร์ทะเบียน', (await toasts(page)).filter(t => /บิลสาขา 06 วันที่ 14\/11\/2026 ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)).length === 1 && (await page.evaluate(() => queuedOrderWrites_.length)) === 0, await toasts(page));
    await page.close();
  }
  {
    // A8c: readyAt ถูกประทับตอนผ่านด่าน (ออนไลน์ + คิวว่าง) ครั้งแรกเท่านั้น: ออฟไลน์/คิวค้าง = ไม่ประทับ (เวลาที่ออฟไลน์ไม่นับ); ประทับแล้วไม่ถูกเขียนทับ; เก็บใน localStorage
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await seedReg(page, [{ qid: 'q-a', iso: TODAY, code: '02', atAgo: 20 }]);   // ไม่มี readyAt, กดบันทึกไว้ 20 วันก่อน (ออฟไลน์ยาว)
    await page.evaluate(async () => { window.__forceOffline = true; await checkQueuedOrderWrites_(); });
    const off = await regState(page);
    check('A8c: ออฟไลน์ → ไม่ผ่านด่าน: ไม่ประทับ readyAt ไม่ยิง GET ไม่ทิ้ง (ออฟไลน์นานแค่ไหนก็ไม่นับ)', off.reg.length === 1 && off.reg[0].readyAt === undefined && off.gets.length === 0, off);
    await page.evaluate(() => { window.__forceOffline = false; window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); }; });
    const t1 = await page.evaluate(() => Date.now());
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    const on1 = await regState(page);
    check('A8c: ผ่านด่านครั้งแรก (ออนไลน์ + คิวว่าง) → ประทับ readyAt ≈ ตอนนี้ (ไม่ใช่เวลากดบันทึก 20 วันก่อน), เก็บลง localStorage, ยังไม่ทิ้ง (อ่านพลาดแค่ 1 รอบ), ลอง GET แล้ว', on1.reg.length === 1 && Math.abs(on1.reg[0].readyAt - t1) < 5000 && on1.ls[0].readyAt === on1.reg[0].readyAt && on1.gets.length === 1 && (await actlog(page, skipRe)).length === 0, on1);
    await page.waitForTimeout(30);
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    const on2 = await regState(page);
    check('A8c: ผ่านด่านรอบถัดไป → readyAt เดิมไม่ถูกเขียนทับ (นับต่อเนื่อง)', on2.reg[0].readyAt === on1.reg[0].readyAt && on2.gets.length === 2, { on1: on1.reg, on2: on2.reg });
    await page.close();
  }
  {
    // A8d: คิวออฟไลน์ยังไม่ว่าง (ส่งไม่สำเร็จ) = ไม่ผ่านด่าน → ไม่ประทับ/ไม่ทิ้ง แม้ readyAt เก่ากว่า 7 วัน (ทิ้งได้เฉพาะตอนผ่านด่านแล้วอ่านพลาด)
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '03', 1);            // คิวออฟไลน์ไม่ว่าง
    await page.evaluate(() => { window.__forceOffline = false; queuedOrderWrites_.forEach(e => { e.readyAt = Date.now() - 9 * 86400000; }); persistQueuedOrderWrites_(); window.__seq.length = 0; });
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    const R = await regState(page);
    check('A8d: คิวออฟไลน์ยังค้าง (ยังไม่ผ่านด่าน) → ไม่ทิ้งแม้ readyAt เก่า 9 วัน ไม่ยิง GET ไม่มี log ข้าม', R.reg.length === 1 && R.gets.length === 0 && (await actlog(page, skipRe)).length === 0 && (await queueLen(page)) > 0, R);
    await page.close();
  }

  {
    // A8e: ออฟไลน์นาน 8 วัน (กดบันทึกไว้ 8 วันก่อน) แล้วค่อยส่งคิว + อ่านวันได้ → ต้องยังเตือน (toast+log) และเคลียร์ทะเบียน ไม่ถูกทิ้งเพราะอายุ
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await offlineSave(page, '02', 5);
    await page.evaluate(() => { queuedOrderWrites_.forEach(e => { e.at = Date.now() - 8 * 86400000; }); persistQueuedOrderWrites_(); });
    await otherDevicePays(page, '02', 88);
    await page.evaluate(() => { window.__toasts.length = 0; });
    await flushOnline(page);
    await waitReg(page, 0);
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 6000 });
    await page.waitForFunction(() => Object.keys(window.__store).some(k => /^actlog:/.test(k) && JSON.stringify(window.__store[k]).includes('ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง')), null, { timeout: 5000 });
    await quiet(page);
    check('A8e: ออฟไลน์ 8 วัน (at เก่า 8 วัน) แล้ว flush ที่อ่านวันได้ → toast เตือน 1 + log เตือน 1 + เคลียร์ทะเบียน (ไม่มี log "ข้ามการตรวจ") + billingPaid ไม่ถูกแตะ', warnToasts(await toasts(page), '02').length === 1 && (await actlog(page, /บิลสาขา 02 .*ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง/)).length === 1 && (await actlog(page, skipRe)).length === 0 && await page.evaluate(() => queuedOrderWrites_.length === 0 && localStorage.getItem('karmto.queuedOrderWrites') === null) && (await storeDay(page)).billingPaid['02'].transferAmount === 88 && (await storeDay(page)).orders['02'].p1 === 5);
    await page.close();
  }
  {
    // A8f: อ่านวันสดพลาด 25 รอบติด ขณะ readyAt ใหม่ (แม้กดบันทึกไว้ 20 วันก่อน) → คงรายการ ไม่ทิ้ง ไม่ log; พออ่านสำเร็จหลังพลาด → ตรวจ+เตือน+เคลียร์ (ไม่ทิ้ง)
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } }, billingPaid: { '02': PAID(22) } }) });
    await seedReg(page, [{ qid: 'q-25', iso: TODAY, code: '02', atAgo: 20 }]);
    await page.evaluate(() => { window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); }; });
    await page.evaluate(async () => { for (let i = 0; i < 25; i++) await checkQueuedOrderWrites_(); });
    const R = await regState(page);
    const r0 = R.reg[0] && R.reg[0].readyAt;
    check('A8f: อ่านวันสดพลาด 25 รอบติด (readyAt เพิ่งประทับ) → คงรายการ 1 ลอง GET ครบ 25 ครั้ง readyAt คงที่ ไม่มี log "ข้ามการตรวจ" ไม่เตือนลอยๆ', R.reg.length === 1 && R.gets.length === 25 && r0 > 0 && R.ls[0].readyAt === r0 && (await actlog(page, skipRe)).length === 0 && !(await toasts(page)).some(t => /ถูกติ๊กจ่าย/.test(t)), { n: R.gets.length, reg: R.reg });
    await page.evaluate(() => { window.__getHook = null; });
    await page.evaluate(async () => { await checkQueuedOrderWrites_(); });
    await page.waitForFunction(() => window.__toasts.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), null, { timeout: 5000 });
    check('A8f: อ่านสำเร็จหลังพลาดมาแล้ว 25 รอบ → ไม่ทิ้ง: เตือนบิลสาขา 02 วันที่ 20/11/2026 1 ครั้ง + เคลียร์ทะเบียน', warnToasts(await toasts(page), '02').length === 1 && await page.evaluate(() => queuedOrderWrites_.length === 0));
    await page.close();
  }
  {
    // A8g: readyAt เสีย/ไม่มี (undefined, null, '', 0, ติดลบ, ข้อความ, อ็อบเจ็กต์, NaN) = ประทับใหม่ ไม่ throw ไม่ทิ้ง ; readyAt ในอนาคต = ไม่ทิ้ง ไม่ throw
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    const cerr = [];
    page.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
    const bad = [undefined, null, '', 0, -5, 'abc', { x: 1 }, '2026-11-01'];
    await page.evaluate(({ bad, today }) => {
      const now = Date.now();
      queuedOrderWrites_ = bad.map((v, i) => { const e = { qid: 'q-bad-' + i, iso: today, code: String(10 + i).padStart(2, '0'), op: 'save', paidAtWrite: false, at: now - 1000 }; if (v !== undefined) e.readyAt = v; return e; });
      queuedOrderWrites_.push({ qid: 'q-nan', iso: today, code: '30', op: 'save', paidAtWrite: false, at: now - 1000, readyAt: NaN });
      queuedOrderWrites_.push({ qid: 'q-future', iso: today, code: '31', op: 'save', paidAtWrite: false, at: now - 1000, readyAt: now + 30 * 86400000 });
      persistQueuedOrderWrites_();
      window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); };
      window.__seq.length = 0; window.__toasts.length = 0;
    }, { bad, today: TODAY });
    const t1 = await page.evaluate(() => Date.now());
    const threw = await page.evaluate(async () => { try { await checkQueuedOrderWrites_(); return false; } catch (e) { return String(e); } });
    const R = await page.evaluate(() => ({ reg: queuedOrderWrites_.map(e => ({ qid: e.qid, readyAt: e.readyAt })), ls: JSON.parse(localStorage.getItem('karmto.queuedOrderWrites') || '[]').map(e => ({ qid: e.qid, readyAt: e.readyAt })) }));
    const badOnes = R.reg.filter(e => /^q-bad-|^q-nan/.test(e.qid));
    check('A8g: readyAt เสีย/ไม่มี (undefined, null, "", 0, −5, "abc", {…}, "2026-11-01", NaN) → ประทับใหม่เป็นเวลาปัจจุบันทุกรายการ ไม่ throw ไม่ถูกทิ้ง (10 รายการยังอยู่)', threw === false && R.reg.length === 10 && badOnes.length === 9 && badOnes.every(e => typeof e.readyAt === 'number' && Math.abs(e.readyAt - t1) < 5000) && !cerr.some(t => /checkQueuedOrderWrites_ failed/.test(t)), { threw, badOnes: badOnes.map(e => e.readyAt), cerr });
    check('A8g: ค่าที่ประทับถูกเก็บลง localStorage ด้วย (ตรงกับในหน่วยความจำ) และ log "ข้ามการตรวจ" ไม่ขึ้นเลย', badOnes.every(e => (R.ls.find(x => x.qid === e.qid) || {}).readyAt === e.readyAt) && (await actlog(page, skipRe)).length === 0, R.ls.length);
    const fut = R.reg.find(e => e.qid === 'q-future');
    check('A8g: readyAt ในอนาคต (+30 วัน) ไม่ถูกทิ้ง ไม่ถูกเขียนทับ ไม่ throw', fut && fut.readyAt > t1 + 20 * 86400000);
    await page.close();
  }

  // ============ B: readDayFreshForPaid_ ส่งคิวก่อนอ่านวันสด ============
  {
    const { page, dlg } = await boot(browser, { store: dayStore({ orders: { '08': { p1: 1 } } }) });
    await offlineSave(page, '06', 1);
    await page.evaluate(() => { window.__forceOffline = false; });
    const q0 = await queueLen(page);
    await page.evaluate(() => { window.__store['day:2026-11-20'].billingPaid = { '08': { paid: true, paidDate: '2026-11-22', transferAmount: 1, billedAmount: 1 } }; });
    const cacheUnaware = await page.evaluate(() => !dayCache_['2026-11-20'].billingPaid['08']);
    await openForm(page, '08'); await fillP(page, 'p1', 4);
    await page.evaluate(() => { window.__seq.length = 0; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'dirty' && window.__toasts.some(t => /ยกเลิกแล้ว/.test(t)), null, { timeout: 8000 });
    const S = await page.evaluate(() => window.__seq.slice());
    const iPatch = S.indexOf('patch:["orders","06"]'), iGet = S.findIndex(s => /^get:/.test(s));
    check('B1: ออนไลน์แต่คิวออฟไลน์ไม่ว่าง → ส่งคิวก่อน (patchField orders.06 มาก่อน get วันสด ไม่มี get ก่อนหน้า)', q0 > 0 && cacheUnaware && iPatch >= 0 && iGet > iPatch && S.slice(0, iPatch).every(s => !/^get:/.test(s)), { q0, S });
    check('B1: คิวว่างหลังกด + ออเดอร์ 06 ถึง server แล้ว', (await queueLen(page)) === 0 && (await storeDay(page)).orders['06'].p1 === 1);
    check('B1: อ่านวันสดจริง (ไม่ใช่แคช) เห็นว่า 08 จ่ายแล้วจากเครื่องอื่น → confirm 1 ครั้ง ไม่มีหมายเหตุ "เช็คกับเซิร์ฟเวอร์ไม่ได้"', dlg.log.length === 1 && /จ่ายแล้ว/.test(dlg.log[0].message) && !/เช็คกับเซิร์ฟเวอร์ไม่ได้/.test(dlg.log[0].message), dlg.log);
    check('B1: ยกเลิก → ไม่เขียน 08 (ไม่มี patchField orders.08)', !S.includes('patch:["orders","08"]') && (await storeDay(page)).orders['08'].p1 === 1);
    await page.close();
  }
  {
    // ส่งคิวไม่หมด (patchField ล้ม) → ใช้แคช + บอกผู้ใช้ ; ไม่วน ; ไม่อ่านวันสด
    const { page, dlg } = await boot(browser, { store: dayStore({ orders: { '13': { p1: 2 } }, billingPaid: { '13': PAID(1000) } }) });
    await offlineSave(page, '06', 1);
    await page.evaluate(() => { window.__forceOffline = false; window.__patchHook = async () => { throw new Error('down'); }; });
    await openForm(page, '13'); await fillP(page, 'p1', 9);
    await page.evaluate(() => { window.__seq.length = 0; window.__patchTries = 0; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'dirty' && window.__toasts.some(t => /ยกเลิกแล้ว/.test(t)), null, { timeout: 8000 });
    const C = await page.evaluate(() => ({ tries: window.__patchTries, gets: window.__seq.filter(s => /^get:/.test(s)).length, flushing: offlineFlushing_, q: readOfflineQueue_().length }));
    check('B2: ส่งคิวไม่หมด (server ล้ม) → ใช้แคช: confirm บอกว่า "เช็คกับเซิร์ฟเวอร์ไม่ได้" (บอกผู้ใช้) ไม่อ่านวันสด', dlg.log.length === 1 && /เช็คกับเซิร์ฟเวอร์ไม่ได้/.test(dlg.log[0].message) && C.gets === 0, { dlg: dlg.log.map(d => d.message.slice(-120)), C });
    check('B2: ไม่วนซ้ำ — พยายามส่งคิว 1 ครั้งเท่านั้น (patchField ถูกเรียก 1), offlineFlushing_ ปล่อยแล้ว, คิวยังค้าง', C.tries === 1 && C.flushing === false && C.q > 0, C);
    check('B2: ยกเลิก = ไม่เขียนออเดอร์ 13 (ยัง p1=2) และไม่แตะ billingPaid', (await storeDay(page)).orders['13'].p1 === 2 && (await storeDay(page)).billingPaid['13'].transferAmount === 1000 && dayW(await wr(page)).length === 0);
    // flushOfflineQueue_ โยน exception → ตกไปใช้แคช ไม่พังทั้งการบันทึก
    await page.evaluate(() => { window.__patchHook = null; window.__origFlush = window.flushOfflineQueue_; window.flushOfflineQueue_ = async () => { throw new Error('flush exploded'); }; });
    dlg.log.length = 0;
    await openForm(page, '13'); await fillP(page, 'p1', 8);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'dirty', null, { timeout: 8000 });
    await page.evaluate(() => { window.flushOfflineQueue_ = window.__origFlush; });
    check('B2: flushOfflineQueue_ โยน exception → จับไว้ ใช้แคชต่อ (confirm เตือนว่าเช็ค server ไม่ได้) ไม่ใช่ error "เช็คข้อมูลล่าสุดไม่ได้"', dlg.log.length === 1 && /เช็คกับเซิร์ฟเวอร์ไม่ได้/.test(dlg.log[0].message) && !(await toasts(page)).some(t => /เช็คข้อมูลล่าสุดไม่ได้/.test(t)), dlg.log.map(d => d.message.slice(-100)));
    await page.close();
  }

  // ============ C1: exception ก่อนเขียน ============
  {
    const { page, errs } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await openForm(page, '09'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__origMC = window.isMonthClosed_; window.isMonthClosed_ = () => { throw new Error('boom'); }; window.__toasts.length = 0; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'error');
    const C = await page.evaluate(() => ({ st: document.getElementById('orderFormCard').dataset.save, ph: orderSavedView_ && orderSavedView_.phase, ro: document.querySelector('.prodinput[data-pid="p1"]').readOnly, busy: orderSaving_, btn: document.getElementById('saveRowBtn').textContent.trim(), val: document.querySelector('.prodinput[data-pid="p1"]').value, err: (document.querySelector('#orderSaveState .oss-err') || {}).textContent, toasts: window.__toasts.slice() }));
    check('C1: exception ก่อนเขียน → การ์ด error (ไม่ค้าง saving) ปุ่ม "ลองบันทึกอีกครั้ง" ช่องกรอกแก้ได้ (ไม่ readonly) ค่าที่พิมพ์ยังอยู่', C.st === 'error' && C.ph === 'error' && !C.ro && C.busy === false && C.btn === 'ลองบันทึกอีกครั้ง' && C.val === '2', C);
    check('C1: toast + การ์ดบอก "ยังไม่ได้บันทึก" และไม่มีอะไรถึง storage', C.toasts.some(t => /ยังไม่ได้บันทึก/.test(t)) && /ยังไม่ได้บันทึก/.test(C.err || '') && !(await storeDay(page)).orders['09'] && dayW(await wr(page)).length === 0, C);
    await fillP(page, 'p1', '');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    check('C1: ล้างค่าที่พิมพ์แล้ว userBusy_() = false (ไม่ติดค้างจากเฟส saving/orderSaving_)', await page.evaluate(() => userBusy_()) === false && await page.evaluate(() => orderSaving_) === false);
    await page.evaluate(() => { window.isMonthClosed_ = window.__origMC; });
    await fillP(page, 'p1', 2);
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    check('C1: แก้ปัญหาแล้วกดบันทึกอีกครั้ง → saved ปกติ เขียน 1 ครั้ง', (await storeDay(page)).orders['09'].p1 === 2 && dayW(await wr(page)).length === 1);
    check('C1: ไม่มี exception หลุดเป็น error ของหน้า', errs.length === 0, errs);
    await page.close();
  }

  // ============ C2: exception หลังเขียนแล้ว ============
  for (const offline of [false, true]) {
    const { page } = await boot(browser, { store: dayStore({ orders: { '01': { p1: 1 } } }) });
    await openForm(page, '09'); await fillP(page, 'p1', 2);
    await page.evaluate(off => { window.__origRS = window.orderRowSummary_; window.orderRowSummary_ = () => { throw new Error('boom2'); }; window.__toasts.length = 0; window.__forceOffline = off; }, offline);
    await page.click('#saveRowBtn');
    const want = offline ? 'queued' : 'saved';
    await waitState(page, want);
    const C = await page.evaluate(() => ({ st: document.getElementById('orderFormCard').dataset.save, ph: orderSavedView_ && orderSavedView_.phase, ro: document.querySelector('.prodinput[data-pid="p1"]').readOnly, busy: orderSaving_, toasts: window.__toasts.slice(), reg: queuedOrderWrites_.map(e => e.code + ':' + e.op) }));
    const sd = await storeDay(page);
    const queuedRow = offline ? await page.evaluate(() => (dayCache_['2026-11-20'].orders['09'] || {}).p1) : sd.orders['09'] && sd.orders['09'].p1;
    check(`C2 (${offline ? 'ออฟไลน์' : 'ออนไลน์'}): exception หลังเขียน → เฟส ${want} (ไม่ค้าง saving) ช่องแก้ได้ ข้อมูลถึงที่หมาย (p1=2)`, C.st === want && C.ph === want && !C.ro && C.busy === false && queuedRow === 2, C);
    check(`C2 (${offline ? 'ออฟไลน์' : 'ออนไลน์'}): toast บอก "แต่แสดงผลไม่ครบ" (ออนไลน์: "บันทึก … แล้ว" / ออฟไลน์: "เก็บไว้ในเครื่อง รอส่ง") และไม่บอก "ยังไม่ได้บันทึก"`, C.toasts.some(t => (offline ? /รอส่งเมื่อมีเน็ต แต่แสดงผลไม่ครบ/ : /แล้ว แต่แสดงผลไม่ครบ/).test(t)) && !C.toasts.some(t => /ยังไม่ได้บันทึก/.test(t)), C.toasts);
    if (offline) check('C2 (ออฟไลน์): toast บอกว่าเก็บไว้ในเครื่อง รอส่งเมื่อมีเน็ต + ลงทะเบียนรอส่งแล้วก่อน exception (09:save)', C.toasts.some(t => /เก็บออเดอร์ 09 .* ไว้ในเครื่องแล้ว รอส่งเมื่อมีเน็ต แต่แสดงผลไม่ครบ/.test(t)) && C.reg.join() === '09:save' && dayW(await wr(page)).length === 0, { t: C.toasts, reg: C.reg });
    else check('C2 (ออนไลน์): ไม่ลงทะเบียนรอส่ง (เขียนถึง server จริง)', C.reg.length === 0 && dayW(await wr(page)).length === 1);
    await page.close();
  }

  // ============ C3: ปุ่มลบในลิสต์ล้ม = มี toast ไม่มี unhandled ============
  {
    const { page, dlg, errs } = await boot(browser, { store: dayStore({ orders: { '13': { p1: 2 }, '02': { p1: 1 } }, billingPaid: { '13': PAID(1000) } }) });
    dlg.mode = 'accept';
    await page.evaluate(() => { window.__origRS = window.orderRowSummary_; window.orderRowSummary_ = () => { throw new Error('boom3'); }; window.__toasts.length = 0; });
    await resetW(page);
    await page.click('#orderList [data-del="13"]'); // บิลจ่ายแล้ว → paidDeleteConfirmText_ → orderRowSummary_ พัง
    await page.waitForFunction(() => window.__toasts.some(t => /เกิดข้อผิดพลาดตอนลบ/.test(t)), null, { timeout: 5000 });
    await page.waitForFunction(() => orderDeleteBusy_.size === 0 && !document.querySelector('#orderList [data-del="13"]').disabled, null, { timeout: 5000 });
    check('C3: ปุ่มลบล้ม (exception กลางทาง) → toast "เกิดข้อผิดพลาดตอนลบ — ตรวจที่ลิสต์สาขาก่อนกดซ้ำ" ไม่มี dialog ไม่เขียนอะไร ออเดอร์ 13 + billingPaid อยู่ครบ', dlg.log.length === 0 && (await wr(page)).length === 0 && (await storeDay(page)).orders['13'].p1 === 2 && !!(await storeDay(page)).billingPaid['13']);
    check('C3: ปุ่มถูกปลดล็อก (กดใหม่ได้) ตัวกันซ้ำว่าง และไม่มี unhandled rejection/exception หลุดหน้า', errs.filter(e => /boom3/.test(e)).length === 0, errs);
    await page.evaluate(() => { window.orderRowSummary_ = window.__origRS; });
    await page.click('#orderList [data-del="13"]');
    await page.waitForFunction(() => !window.__store['day:2026-11-20'].orders['13'], null, { timeout: 5000 });
    check('C3: ปัญหาหายแล้วกดลบใหม่ → ลบได้ตามปกติ (confirm แบบจ่ายแล้ว) billingPaid ไม่ถูกแตะ', dlg.log.length === 1 && /จ่ายแล้ว/.test(dlg.log[0].message) && !!(await storeDay(page)).billingPaid['13']);
    await page.close();
  }

  await finish(browser);
})();
