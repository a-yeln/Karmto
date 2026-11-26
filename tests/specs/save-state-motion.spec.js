const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// แยกส่ง ชุด 2 ส่วน S + นโยบาย B: สถานะบันทึกออเดอร์ (dirty → saving → done → saved / queued ⏳ / error) + ถามยืนยันเมื่อแก้/ลบออเดอร์ของบิลที่จ่ายแล้ว
// กฎเหล็กที่เทสนี้เฝ้า: เขียนเฉพาะ patchField ['orders',code] / patchOps deleteKey (ห้าม set ทับ ห้ามแตะ billingPaid/rawLots/settings/costedQty),
// บิลจ่ายแล้ว = ถามพร้อมค่าเก่า→ใหม่ (ยกเลิก = ไม่เขียน), อ่านวันสดไม่ได้ = บล็อก, เดือนปิด = ไม่ถาม/ไม่เขียน, ออฟไลน์ = ⏳ รอส่ง ไม่ใช่สำเร็จปลอม
// หมายเหตุเรื่องนาฬิกา: ตรึงวันที่ด้วย setFixedTime ก่อน แล้วปล่อยเวลาเดินต่อด้วย setSystemTime (วันที่ยังเป็น 2026-11-20 10:00 +07:00) เพราะเฟส "done"
// ใช้ Date.now() เทียบ doneUntil — ถ้า Date ถูกตรึงตายตัว เฟส done จะไม่มีวันจบ (ไม่ใช่ปัญหาของแอปจริง) และเทสลำดับ/เวลาต้องการเวลาเดินจริง
const TODAY = '2026-11-20', OTHER_DAY = '2026-11-21';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const T13 = { code: '13T', area: '', label: 'สาขา 13(แยกส่ง)', separate: true, billName: '', billAddr: '', billTax: '' };
const PAID13 = { paid: true, paidDate: '2026-11-19', transferAmount: 1000, billedAmount: 1000 };

// เปิดแอป + mock storage + ตัวจัดการ dialog + ตะขอ get/patchField/patchOps (ชั้นนอกสุด เพื่อหน่วง/ทำให้ล้ม/แทรก "อีกเครื่องเขียน") + ดักข้อความ toast
async function boot(browser, { store = {}, viewport, theme } = {}) {
  const page = await openApp(browser, { store: Object.assign({ rawLots: [] }, store), date: TODAY, viewport });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00'));
  const dlg = { log: [], mode: 'dismiss' };
  page.on('dialog', async d => { dlg.log.push({ type: d.type(), message: d.message() }); if (dlg.mode === 'accept') await d.accept(); else await d.dismiss(); });
  await page.evaluate(t13 => {
    if (!settings.branches.some(b => b.code === '13T')) settings.branches.push(t13);
    window.__toasts = [];
    const ot = window.showToast;
    window.showToast = function (m) { window.__toasts.push(String(m)); return ot.apply(this, arguments); };
    window.__events = { saved: 0 };
    window.addEventListener('karmto-saved', () => window.__events.saved++);
    const base = window.storage, w = Object.create(base);
    w.get = async function (key, ...r) { if (window.__getHook) { const x = await window.__getHook(key); if (x !== undefined) return x; } return base.get(key, ...r); };
    w.patchField = async function (key, p, v) { if (window.__patchHook) { const x = await window.__patchHook(key, p, v); if (x !== undefined) return x; } return base.patchField(key, p, v); };
    w.patchOps = async function (key, ops, ria) { if (window.__opsHook) { const x = await window.__opsHook(key, ops, ria); if (x !== undefined) return x; } return base.patchOps(key, ops, ria); };
    window.storage = w;
  }, T13);
  if (theme) await page.evaluate(th => { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', 'full'); }, theme);
  await page.evaluate(async () => { await switchTab('order'); refreshOrderTab(); }); // วาดฟอร์ม/ลิสต์สาขาที่บันทึกแล้วเหมือนตอนโหลดวันเสร็จจริง
  await stripBanner(page);
  return { page, dlg };
}
const stateOf = page => page.evaluate(() => document.getElementById('orderFormCard').dataset.save);
const waitState = (page, s, ms = 9000) => page.waitForFunction(s => document.getElementById('orderFormCard').dataset.save === s, s, { timeout: ms });
const wr = page => page.evaluate(() => window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path, ops: w.ops })));
const dayW = ws => ws.filter(w => /^day:/.test(w.key));
const otherW = ws => ws.filter(w => !/^(day:|actlog:|dayRevs$)/.test(w.key)); // ต้องว่างเสมอ: ห้ามแตะ rawLots/settings/wasteRecords/lotProductBills ฯลฯ
// ล้างบันทึกการเขียนแบบ "รอให้งานเบื้องหลังนิ่งก่อน": การเขียนก่อนหน้าทิ้งงานตามหลัง 2 อย่าง — ป้าย dayRevs (pushDayRev_ หน่วง 400ms) และ actlog (logActivity_ ไม่ได้ await)
// ถ้าล้างตอนที่สองอย่างนี้ยังไม่ลง __writes จะไปโผล่หลังล้าง ทำให้เช็ค "ไม่เขียนอะไรเลย" แดงแบบสุ่ม (เคยแดงใน S14 ตอนเครื่องช้า) — รอเงื่อนไขจริง ไม่ใช้เวลาตายตัว
const resetW = async page => {
  await page.evaluate(() => new Promise(res => {
    let last = -1, n = 0;
    const tick = () => { const quiet = Object.keys(pendingDayRevs_).length === 0 && window.__writes.length === last; n = quiet ? n + 1 : 0; last = window.__writes.length; if (n >= 6) return res(); requestAnimationFrame(tick); };
    tick();
  }));
  await page.evaluate(() => { window.__writes = []; });
};
// รอจนกดลบ/ยืนยันเสร็จจริง: dialog ขึ้นครบ n ครั้ง + deleteOrder_ ปล่อยตัวกันซ้ำแล้ว (ถึงตรงนี้ถ้าจะเขียนก็เขียนไปแล้ว)
const waitDelete = async (page, dlg, n) => {
  const t0 = Date.now();
  while (dlg.log.length < n) { if (Date.now() - t0 > 8000) throw new Error('dialog ไม่ขึ้นครบ ' + n); await page.waitForTimeout(20); }
  await page.waitForFunction(() => orderDeleteBusy_.size === 0, null, { timeout: 8000 });
};
const fillP = (page, pid, v) => page.fill(`#productInputs .prodinput[data-pid="${pid}"]`, String(v));
const openForm = (page, code) => page.evaluate(c => { openBranchForm_(c); document.activeElement && document.activeElement.blur(); }, code);
const queueOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('karmto_offline_queue') || '[]'));
const toasts = page => page.evaluate(() => window.__toasts.slice());
const storeDay = (page, iso = '2026-11-20') => page.evaluate(iso => JSON.parse(JSON.stringify(window.__store['day:' + iso] || null)), iso);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const setTheme = (page, th, mode = 'full') => page.evaluate(({ th, mode }) => {
  if (th) { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', mode); }
  else { document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-tmode'); }
}, { th, mode });
const shotCard = async (page, name) => {
  const clip = await page.evaluate(() => { const el = document.getElementById('orderFormCard'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 28), width: innerWidth, height: Math.min(1300, r.height + 44) }; });
  await page.screenshot({ path: path.join(SHOT_DIR, name), clip, fullPage: true }).catch(() => {});
};
// ข้อมูลตั้งต้นสำหรับนโยบาย B: 13 จ่ายแล้ว (p1×2, billExtra −20), 02 ยังไม่จ่าย
const paidStore = () => ({ ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 2 }, '02': { p1: 1 } }, billingPaid: { '13': PAID13 }, billExtra: { '13': -20 } }) });
const emptyStore = () => ({ ['day:' + TODAY]: mkDay({ orders: {} }) });
// ยอดบิลที่คาด คิดเองจาก "ราคา × จำนวน + billExtra" (ไม่เรียก branchBillAmount) แล้วจัดรูปด้วย money() ของแอป
const expMoney = (page, qty, extra) => page.evaluate(({ qty, extra }) => money(Object.entries(qty).reduce((s, [pid, q]) => s + q * priceOnDate(pid, '2026-11-20'), 0) + extra), { qty, extra });

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  // ============ S1: ลำดับสถานะ dirty → saving → done → saved (หน่วยเขียน 300ms) ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13');
    check('S1: เปิดฟอร์มสาขาว่าง = idle ไม่มีชิป "ยังไม่บันทึก" และ saveRowBtn เห็นอยู่', await stateOf(page) === 'idle' && await page.evaluate(() => document.getElementById('orderDirtyDot').hidden && document.getElementById('saveRowBtn').getClientRects().length > 0));
    await page.evaluate(() => {
      window.__states = [];
      const card = document.getElementById('orderFormCard');
      const rec = () => { const s = card.dataset.save, l = window.__states[window.__states.length - 1]; if (!l || l.s !== s) window.__states.push({ s, t: Date.now(), anim: (card.querySelector('.oss-card') ? getComputedStyle(card.querySelector('.oss-card')).animationName : '') }); };
      new MutationObserver(rec).observe(card, { attributes: true, attributeFilter: ['data-save'] });
      rec();
      window.__patchHook = async () => { await new Promise(r => setTimeout(r, 300)); window.__patchDoneAt = Date.now(); };
    });
    await fillP(page, 'p1', 2);
    check('S1: พิมพ์ตัวเลข → dirty + ชิป "● ยังไม่บันทึก" โผล่', await stateOf(page) === 'dirty' && await page.evaluate(() => !document.getElementById('orderDirtyDot').hidden));
    check('S1: userBusy_() เป็นจริงขณะ dirty (หลังเอาโฟกัสออกแล้วก็ยังจริง)', await page.evaluate(() => { document.activeElement.blur(); return userBusy_(); }));
    await resetW(page);
    await page.evaluate(() => { window.__savedPopSeen = false; new MutationObserver(() => { if (document.querySelector('.save-pop')) window.__savedPopSeen = true; }).observe(document.body, { childList: true }); });
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    const S = await page.evaluate(() => ({ states: window.__states.map(x => x.s), t: Object.fromEntries(window.__states.map(x => [x.s, x.t])), patchDone: window.__patchDoneAt, doneAnim: (window.__states.find(x => x.s === 'done') || {}).anim }));
    check('S1: ลำดับสถานะ idle→dirty→saving→done→saved ตามนี้เป๊ะ', S.states.join() === 'idle,dirty,saving,done,saved', S.states);
    check('S1: saving นานรวม ≥ 450ms (เขียน 300ms + เติมให้ครบ 450)', S.t.done - S.t.saving >= 440, S.t.done - S.t.saving);
    check('S1: done ไม่ขึ้นก่อน patchField เสร็จจริง (พิสูจน์ว่าเกิดหลัง await)', S.t.done >= S.patchDone && S.t.saving < S.patchDone, { saving: S.t.saving - S.t.idle, patchDone: S.patchDone - S.t.idle, done: S.t.done - S.t.idle });
    check('S1: done คงอยู่ ≈ 700ms ก่อนเป็น saved', S.t.saved - S.t.done >= 680 && S.t.saved - S.t.done < 1500, S.t.saved - S.t.done);
    check('S1: เฟส done มีแอนิเมชันเรืองแสง (ossGlow) เมื่อเปิดแอนิเมชัน', /ossGlow/.test(S.doneAnim || ''), S.doneAnim);
    const w1 = await wr(page);
    check('S1: เขียนแค่ patchField day:วันนี้ ["orders","13"] ครั้งเดียว (ไม่มี set/patchOps วัน/คีย์อื่น)', dayW(w1).length === 1 && dayW(w1)[0].op === 'patchField' && dayW(w1)[0].key === 'day:' + TODAY && JSON.stringify(dayW(w1)[0].path) === '["orders","13"]' && !w1.some(w => w.op === 'set') && otherW(w1).length === 0, w1);
    const sd = await storeDay(page);
    check('S1: ค่าที่ถึง storage ตรง (13 = p1 2) และไม่แตะ billingPaid/สาขาอื่น', sd.orders['13'].p1 === 2 && Object.keys(sd.orders).join() === '13' && Object.keys(sd.billingPaid).length === 0, sd.orders);
    check('S1: ป้าย "✓ บันทึกแล้ว" (karmto-saved) เด้งตอนเขียนสำเร็จจริง', await page.evaluate(() => window.__events.saved >= 1 && window.__savedPopSeen));
    // saved ค้างถาวร: รอเกิน 3 วินาที ต้องไม่มีปุ่มบันทึกสีเข้ม ฟอร์มไม่พับ
    await page.waitForTimeout(3200);
    const K = await page.evaluate(() => {
      const card = document.getElementById('orderFormCard'), body = card.querySelector('.card-body');
      return { st: card.dataset.save, saveBtn: document.getElementById('saveRowBtn').getClientRects().length, inputs: document.getElementById('productInputs').getClientRects().length, btnRow: document.getElementById('orderFormBtnRow').getClientRects().length,
        collapsed: !!(body && body.classList.contains('collapsed')), cardVisible: !!card.querySelector('.oss-card') && card.querySelector('.oss-card').getClientRects().length > 0, text: document.getElementById('orderSaveState').innerText,
        acts: [...document.querySelectorAll('#orderSaveState .oss-actions button')].map(b => b.textContent.trim()), next: (document.querySelector('[data-ossnext]') || {}).dataset && document.querySelector('[data-ossnext]').dataset.ossnext,
        sw: document.getElementById('sepSwitch').innerText };
    });
    check('S1: saved ค้างหลัง >3 วินาที ไม่หายเอง', K.st === 'saved' && K.cardVisible, K);
    check('S1: saved ไม่มีปุ่มบันทึกสีเข้ม/ช่องกรอก (ซ่อน) และฟอร์มไม่พับ', K.saveBtn === 0 && K.btnRow === 0 && K.inputs === 0 && !K.collapsed, K);
    check('S1: การ์ดบอก "บันทึกแล้ว 10:0x" + ชิปสินค้า + รวม 2 ชิ้น + ปุ่ม ✎ แก้ไข / → สาขาถัดไป 14', /บันทึกแล้ว 10:0\d/.test(K.text) && /2/.test(K.text) && /รวม 2 ชิ้น/.test(K.text) && K.acts.join('|') === '✎ แก้ไข|→ สาขาถัดไป 14' && K.next === '14', K);
    check('S1: ป้ายสวิตช์โชว์ ● 2 ชิ้น ที่ฝั่งส่งปกติ', /2 ชิ้น/.test(K.sw), K.sw);
    check('S1: ระหว่างบันทึกไม่มี toast สำเร็จซ้ำ (การ์ดเห็นอยู่ จึงไม่ต้อง toast)', !(await toasts(page)).some(t => /^บันทึก 13 —/.test(t)), await toasts(page));
    await shotCard(page, 'save-state-saved-macaron.png');
    // ธีม/โหมด: การ์ด saved ต้องไม่ล้นจอ 420px
    const ov = {};
    for (const [th, mode] of [['', ''], ['mermaid', 'full'], ['mermaid', 'color'], ['sea', 'full'], ['sea', 'color'], ['neon', 'full'], ['neon', 'color']]) {
      await setTheme(page, th, mode || 'full'); await page.waitForTimeout(120);
      ov[(th || 'macaron') + (mode ? '/' + mode : '')] = await noOverflow(page);
      if (th === 'neon' && mode === 'full') await shotCard(page, 'save-state-saved-neon.png');
    }
    check('S1: การ์ดบันทึกแล้วไม่ล้นจอ 420px ทุกธีม/โหมด (macaron, mermaid, sea, neon × full/color)', Object.values(ov).every(Boolean), ov);
    await setTheme(page, '');
    // ✎ แก้ไข: กลับฟอร์มค่าเดิม ไม่เขียน
    await resetW(page);
    await page.click('[data-ossedit]');
    const ed = await page.evaluate(() => ({ sel: document.getElementById('branchSelect').value, p1: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value, st: document.getElementById('orderFormCard').dataset.save, saveBtn: document.getElementById('saveRowBtn').getClientRects().length > 0 }));
    check('S1: แตะ ✎ แก้ไข = กลับฟอร์มสาขา 13 ค่าเดิม (p1=2) ปุ่มบันทึกกลับมา และไม่เขียน', ed.sel === '13' && ed.p1 === '2' && ed.st === 'idle' && ed.saveBtn && (await wr(page)).length === 0, ed);
    // บันทึกซ้ำแถวเดิม → saved อีกรอบ → แตะ → สาขาถัดไป: ไปรหัสถูก ไม่เขียนอะไร
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    await resetW(page);
    await page.click('[data-ossnext]');
    const nx = await page.evaluate(() => ({ sel: document.getElementById('branchSelect').value, pick: document.getElementById('branchPick').value, st: document.getElementById('orderFormCard').dataset.save, inputs: document.getElementById('productInputs').getClientRects().length > 0 }));
    check('S1: แตะ → สาขาถัดไป = เปิดฟอร์มสาขา 14 ว่าง (การ์ดสถานะหาย) และไม่เขียนอะไร', nx.sel === '14' && nx.pick === '14' && nx.st === 'idle' && nx.inputs && (await wr(page)).length === 0, nx);
    await page.close();
  }

  // ============ S2: ดับเบิลคลิก/เรียกซ้อน = เขียน 1 ครั้ง + saveRow resolve ตอนเขียนเสร็จ ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13');
    await page.evaluate(() => { window.__patchHook = async () => { await new Promise(r => setTimeout(r, 250)); }; });
    await fillP(page, 'p1', 3);
    await resetW(page);
    await page.dblclick('#saveRowBtn');
    await waitState(page, 'saved');
    const a = dayW(await wr(page));
    check('S2: ดับเบิลคลิก #saveRowBtn → patchField day: เขียน 1 ครั้งเท่านั้น', a.length === 1 && a[0].op === 'patchField', a);
    // กดสองครั้งติดกันแบบโปรแกรม (ข้ามการ์ดสถานะ) + เรียก saveRow() ซ้อนกัน
    await openForm(page, '13'); await fillP(page, 'p1', 4);
    await resetW(page);
    const dbl = await page.evaluate(async () => { const b = document.getElementById('saveRowBtn'); b.click(); b.click(); await new Promise(r => setTimeout(r, 900)); return window.__writes.filter(w => /^day:/.test(w.key)).length; });
    check('S2: คลิกซ้ำ 2 ครั้งในเฟรมเดียว (guardedClick) → เขียน 1 ครั้ง', dbl === 1, dbl);
    await openForm(page, '13'); await fillP(page, 'p1', 5);
    await resetW(page);
    const two = await page.evaluate(async () => { const p1 = saveRow(), p2 = saveRow(); const r = await Promise.all([p1, p2]); return { r, n: window.__writes.filter(w => /^day:/.test(w.key)).length, t: window.__toasts.filter(t => /กำลังบันทึกสาขาอื่นอยู่/.test(t)).length }; });
    check('S2: เรียก saveRow() ซ้อนกัน → ครั้งที่ 2 คืน false + แจ้ง toast, เขียน 1 ครั้ง', two.r[0] === true && two.r[1] === false && two.n === 1 && two.t === 1, two);
    // saveRow resolve ตอนเขียนเสร็จ (ไม่รอแอนิเมชัน 450ms/700ms) — activity-log-all.spec.js await ตรงๆ
    await waitState(page, 'saved'); // รอให้แอนิเมชันของการบันทึกก่อนหน้าจบจริง (ไม่ใช้เวลาตายตัว)
    await openForm(page, '13'); await fillP(page, 'p1', 6);
    await page.evaluate(() => { window.__patchHook = async () => { await new Promise(r => setTimeout(r, 120)); }; });
    const ms = await page.evaluate(async () => { const t = Date.now(); const ok = await saveRow(); return { ok, ms: Date.now() - t }; });
    check('S2: saveRow() resolve ทันทีที่เขียนเสร็จ (≈120ms ไม่ถูกหน่วงด้วยแอนิเมชัน 450ms)', ms.ok === true && ms.ms < 400, ms);
    await page.close();
  }

  // ============ S3: ล้ม (patchField reject) + ลองใหม่ + toast ไม่ซ้ำ ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13');
    await page.evaluate(() => { window.__patchHook = async () => { throw new Error('network down'); }; });
    await fillP(page, 'p1', 2); await fillP(page, 'p2', 1.5);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'error');
    const E = await page.evaluate(() => ({ p1: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value, p2: document.querySelector('#productInputs .prodinput[data-pid="p2"]').value, btn: document.getElementById('saveRowBtn').textContent, err: (document.querySelector('#orderSaveState .oss-err') || {}).textContent, anim: getComputedStyle(document.querySelector('#orderSaveState .oss-err')).animationName,
      saveBtnVisible: document.getElementById('saveRowBtn').getClientRects().length > 0, toasts: window.__toasts.filter(t => /บันทึกไม่สำเร็จ/.test(t)).length, saved: window.__events.saved }));
    check('S3: เขียนพัง → การ์ด error ค่าที่พิมพ์ครบ (p1 2, p2 1.5) + ปุ่ม "ลองบันทึกอีกครั้ง"', E.p1 === '2' && E.p2 === '1.5' && E.btn === 'ลองบันทึกอีกครั้ง' && E.saveBtnVisible, E);
    check('S3: ข้อความบอกชัด "ยังไม่ได้บันทึก" + มีสั่น 1 ครั้ง (ossShake)', /ยังไม่ได้บันทึก/.test(E.err || '') && /ossShake/.test(E.anim), E);
    check('S3: toast ล้มขึ้น 1 ครั้ง (ไม่ซ้ำกับของ guardedClick) และไม่มีป้าย ✓ บันทึกแล้ว', E.toasts === 1 && E.saved === 0, E);
    check('S3: พังแล้วไม่มีอะไรถึง storage (ไม่มีออเดอร์ 13)', !(await storeDay(page)).orders['13'] && dayW(await wr(page)).length === 0);
    await shotCard(page, 'save-state-error-macaron.png');
    check('S3: การ์ด error ไม่ล้นจอ 420px', await noOverflow(page));
    // ลองใหม่ (ปุ่มเดิม) → สำเร็จ เขียน 1 ครั้ง
    await page.evaluate(() => { window.__patchHook = null; });
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    const w3 = dayW(await wr(page));
    check('S3: กด "ลองบันทึกอีกครั้ง" → saved และเขียน patchField ["orders","13"] ครั้งเดียว ค่าครบ', w3.length === 1 && JSON.stringify(w3[0].path) === '["orders","13"]' && (await storeDay(page)).orders['13'].p2 === 1.5, w3);
    // เริ่มแก้ใหม่หลังล้ม → กลับเป็น dirty (ไม่ค้างข้อความล้ม)
    await page.evaluate(() => { window.__patchHook = async () => { throw new Error('again'); }; });
    await openForm(page, '13'); await fillP(page, 'p1', 9);
    await page.click('#saveRowBtn'); await waitState(page, 'error');
    await fillP(page, 'p1', 8);
    check('S3: ล้มแล้วพิมพ์แก้ต่อ → กลับเป็น dirty (ข้อความล้มหาย)', await stateOf(page) === 'dirty' && await page.evaluate(() => !document.querySelector('#orderSaveState .oss-err')));
    await page.close();
  }

  // ============ S4: ล้มหลังเปลี่ยนวัน = ยังมี toast + เขียน/ไม่เขียนผิดวัน ============
  {
    const { page } = await boot(browser, { store: Object.assign(emptyStore(), { ['day:' + OTHER_DAY]: mkDay({ orders: {} }) }) });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__patchHook = async () => { await new Promise(r => setTimeout(r, 500)); throw new Error('boom after date change'); }; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.evaluate(async d => { await loadForDate(d); }, OTHER_DAY);
    await page.waitForFunction(() => window.__toasts.some(t => /ยังไม่ได้บันทึก/.test(t)), null, { timeout: 5000 });
    const L = await page.evaluate(() => ({ cur: currentDate, st: document.getElementById('orderFormCard').dataset.save, errBox: !!document.querySelector('#orderSaveState .oss-err'), toasts: window.__toasts.filter(t => /ยังไม่ได้บันทึก/.test(t)) }));
    check('S4: เขียนล้มหลังเปลี่ยนวัน → มี toast บอก "ยังไม่ได้บันทึก" (การ์ดถูกซ่อนแล้ว จึงต้องใช้ toast)', L.toasts.length === 1 && L.cur === OTHER_DAY, L);
    check('S4: วันใหม่ไม่โดนข้อมูลของวันก่อนปน และไม่มีการ์ด error ค้างในฟอร์มวันใหม่', L.st !== 'error' && !L.errBox && !(await storeDay(page, OTHER_DAY)).orders['13'] && !(await storeDay(page)).orders['13'] && dayW(await wr(page)).length === 0, L);
    await page.close();
  }

  // ============ S5: เปลี่ยนวันระหว่างบันทึกสำเร็จ = เขียนวันที่จับไว้ + ดรอปดาวน์/วันใหม่ไม่เพี้ยน + toast ระบุรหัส+วันที่ ============
  {
    const { page } = await boot(browser, { store: Object.assign(emptyStore(), { ['day:' + OTHER_DAY]: mkDay({ orders: { '05': { p1: 1 } } }) }) });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__patchHook = async () => { await new Promise(r => setTimeout(r, 500)); }; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.evaluate(async d => { await loadForDate(d); }, OTHER_DAY);
    await page.waitForFunction(() => window.__toasts.some(t => /^บันทึก 13 —/.test(t)), null, { timeout: 5000 });
    const w5 = dayW(await wr(page));
    const R = await page.evaluate(() => ({ cur: currentDate, sel: document.getElementById('branchSelect').value, firstOpt: document.getElementById('branchSelect').options[0].value, dayOrders: Object.keys(dayData.orders), toast: window.__toasts.find(t => /^บันทึก 13 —/.test(t)) }));
    check('S5: กดบันทึกแล้วเปลี่ยนวัน → เขียนลงวันเดิม (day:2026-11-20) ไม่ใช่วันใหม่', w5.length === 1 && w5[0].key === 'day:' + TODAY && JSON.stringify(w5[0].path) === '["orders","13"]' && (await storeDay(page)).orders['13'].p1 === 2 && !(await storeDay(page, OTHER_DAY)).orders['13'], w5);
    check('S5: วันใหม่ (dayData) ไม่โดนออเดอร์ 13 ปน และดรอปดาวน์ไม่ถูกเด้งไปรหัสที่เขียน (กลับสาขาแรกตามกติกาเปลี่ยนวัน)', R.cur === OTHER_DAY && R.dayOrders.join() === '05' && R.sel === R.firstOpt, R);
    check('S5: การ์ดมองไม่เห็นแล้ว → toast สำเร็จ ระบุรหัส + วันที่ที่บันทึกจริง (20/11/2026)', /13/.test(R.toast) && /20\/11\/2026/.test(R.toast), R.toast);
    await page.close();
  }

  // ============ S6: ออฟไลน์ = ⏳ รอส่ง (ไม่ใช่สำเร็จปลอม) + flush ตรง ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__forceOffline = true; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'queued');
    const Q = await page.evaluate(() => ({ cls: document.querySelector('#orderSaveState .oss-card').className, head: document.querySelector('#orderSaveState .oss-head').textContent, ck: !!document.querySelector('#orderSaveState .oss-ck'), note: (document.querySelector('.oss-note') || {}).textContent, saved: window.__events.saved, pop: !!document.querySelector('.save-pop'), saveBtn: document.getElementById('saveRowBtn').getClientRects().length }));
    const q = await queueOf(page);
    check('S6: res.queued → การ์ด ⏳ "รอส่งเมื่อมีเน็ต" (ไม่มีเครื่องหมายถูก ไม่ใช่การ์ดเขียว/บันทึกแล้ว)', /queued/.test(Q.cls) && /⏳/.test(Q.head) && /รอส่งเมื่อมีเน็ต/.test(Q.head) && !/บันทึกแล้ว/.test(Q.head) && !Q.ck, Q);
    check('S6: ข้อความเก็บไว้ในเครื่อง + ไม่เด้งป้าย ✓ บันทึกแล้ว (karmto-saved = 0)', /เก็บไว้ในเครื่องนี้แล้ว/.test(Q.note || '') && Q.saved === 0 && !Q.pop, Q);
    const qd = q.filter(e => e.key === 'day:' + TODAY);
    check('S6: คิว karmto_offline_queue มี patchField day: ["orders","13"] 1 รายการ (ที่เหลือเป็น actlog เท่านั้น) และไม่มีอะไรถึง server', qd.length === 1 && qd[0].m === 'patchField' && JSON.stringify(qd[0].path) === '["orders","13"]' && q.every(e => e.key === 'day:' + TODAY || /^actlog:/.test(e.key)) && dayW(await wr(page)).length === 0 && !(await storeDay(page)).orders['13'], q);
    await shotCard(page, 'save-state-queued-macaron.png');
    check('S6: การ์ดรอส่งไม่ล้นจอ 420px', await noOverflow(page));
    // ต่อเน็ต → flush → เทียบวันสดตรง → อัปเกรดเป็น saved
    await page.evaluate(async () => { window.__forceOffline = false; await flushOfflineQueue_(); });
    await waitState(page, 'saved');
    const Fq = await page.evaluate(() => ({ head: document.querySelector('#orderSaveState .oss-head').textContent, warn: !!document.querySelector('#orderSaveState .oss-card.warn') }));
    const w6 = dayW(await wr(page));
    check('S6: flush ตรง → การ์ดอัปเกรดเป็น "บันทึกแล้ว" จริง (ไม่ใช่ ⏳ ค้าง) และคิวว่าง', /บันทึกแล้ว/.test(Fq.head) && !Fq.warn && (await queueOf(page)).length === 0, Fq);
    check('S6: ส่งถึง server ด้วย patchField ["orders","13"] ครั้งเดียว ค่า p1=2 ไม่แตะ billingPaid/คีย์อื่น', w6.length === 1 && w6[0].op === 'patchField' && JSON.stringify(w6[0].path) === '["orders","13"]' && (await storeDay(page)).orders['13'].p1 === 2 && Object.keys((await storeDay(page)).billingPaid).length === 0 && otherW(await wr(page)).length === 0, w6);
    await page.close();
  }

  // ============ S7: flush ไม่ตรง (เดือนถูกปิดระหว่างออฟไลน์ → คำสั่งถูกทิ้ง) = เตือนเหลือง ไม่ใช่ "ไม่ได้ส่ง" ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__forceOffline = true; });
    await page.click('#saveRowBtn');
    await waitState(page, 'queued');
    await page.evaluate(async () => { window.__store.closedMonths = { '2026-11': { at: '2026-11-20T00:00:00Z', dev: 'test' } }; await loadClosedMonths_(); window.__forceOffline = false; await flushOfflineQueue_(); });
    await page.waitForFunction(() => !!document.querySelector('#orderSaveState .oss-card.warn'), null, { timeout: 6000 });
    const M = await page.evaluate(() => ({ st: document.getElementById('orderFormCard').dataset.save, head: document.querySelector('#orderSaveState .oss-head').textContent, all: document.getElementById('orderSaveState').innerText }));
    check('S7: flush ไม่ตรง → การ์ดเตือนเหลือง "ส่งแล้ว แต่ค่าบนเซิร์ฟเวอร์ไม่ตรงกับที่กรอก" (ห้ามเขียนว่า "ไม่ได้ส่ง")', /ส่งแล้ว แต่ค่าบนเซิร์ฟเวอร์ไม่ตรง/.test(M.head) && !/ไม่ได้ส่ง/.test(M.all), M);
    check('S7: เดือนปิด → คำสั่งไม่ถึง server (ไม่มีออเดอร์ 13) คิวว่าง ไม่มีเขียน day:', !(await storeDay(page)).orders['13'] && (await queueOf(page)).length === 0 && dayW(await wr(page)).length === 0);
    await page.close();
  }

  // ============ S8: flush ตรง แต่ระหว่างออฟไลน์อีกเครื่องติ๊กจ่ายบิลสาขานี้ = เตือนค้าง + log ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__forceOffline = true; });
    await page.click('#saveRowBtn');
    await waitState(page, 'queued');
    await page.evaluate(async () => { window.__store['day:2026-11-20'].billingPaid = { '13': { paid: true, paidDate: '2026-11-20', transferAmount: 777, billedAmount: 777 } }; window.__forceOffline = false; await flushOfflineQueue_(); });
    await waitState(page, 'saved');
    const P = await page.evaluate(() => ({ warn: [...document.querySelectorAll('#orderSaveState .oss-warn')].map(x => x.textContent) }));
    check('S8: ถูกติ๊กจ่ายระหว่างออฟไลน์ → การ์ดเตือน "ถูกติ๊กจ่ายระหว่างออฟไลน์ ยอดบิลอาจเปลี่ยน ตรวจที่หน้าบิล"', P.warn.some(t => /ถูกติ๊กจ่ายระหว่างออฟไลน์/.test(t)), P);
    await page.waitForFunction(() => Object.keys(window.__store).some(k => /^actlog:/.test(k) && JSON.stringify(window.__store[k]).includes('ถูกติ๊กจ่ายระหว่างที่ออเดอร์รอส่ง')), null, { timeout: 5000 });
    check('S8: จด log กิจกรรมแล้ว + สถานะจ่ายของอีกเครื่องไม่ถูกแตะ (transferAmount 777 ยังอยู่)', (await storeDay(page)).billingPaid['13'].transferAmount === 777 && (await storeDay(page)).orders['13'].p1 === 2);
    await page.close();
  }

  // ============ S9: ออฟไลน์ + แคชบอกจ่ายแล้ว ============
  {
    const { page, dlg } = await boot(browser, { store: paidStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 3);
    await page.evaluate(() => { window.__forceOffline = true; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'dirty' && window.__toasts.some(t => /ยกเลิกแล้ว/.test(t)), null, { timeout: 5000 });
    check('S9: ออฟไลน์ + แคชบอก 13 จ่ายแล้ว → ถามยืนยันด้วยค่าแคช (บอกว่าเช็ค server ไม่ได้)', dlg.log.length === 1 && /จ่ายแล้ว/.test(dlg.log[0].message) && /เช็คกับเซิร์ฟเวอร์ไม่ได้/.test(dlg.log[0].message), dlg.log);
    check('S9: กด "ยกเลิก" → คิว karmto_offline_queue ว่าง ไม่มีเขียน และค่าที่พิมพ์ (p1=3) ยังอยู่', (await queueOf(page)).length === 0 && (await wr(page)).length === 0 && await page.evaluate(() => document.querySelector('#productInputs .prodinput[data-pid="p1"]').value) === '3');
    dlg.mode = 'accept';
    await page.click('#saveRowBtn');
    await waitState(page, 'queued');
    const q9 = (await queueOf(page)).filter(e => e.key === 'day:' + TODAY);
    check('S9: กด "ยืนยัน" ตอนออฟไลน์ → ต่อคิวแค่ patchField ["orders","13"] (ไม่แตะ billingPaid) + การ์ด ⏳', q9.length === 1 && q9[0].m === 'patchField' && JSON.stringify(q9[0].path) === '["orders","13"]' && JSON.stringify((await page.evaluate(() => dayCache_['2026-11-20'].billingPaid['13']))) === JSON.stringify(PAID13), q9);
    await page.close();
  }

  // ============ S10: เดือนปิด = ไม่มี dialog / ไม่เขียน (บันทึกและลบ) แม้บิลจ่ายแล้ว ============
  {
    const { page, dlg } = await boot(browser, { store: Object.assign(paidStore(), { closedMonths: { '2026-11': { at: '2026-11-20T00:00:00Z', dev: 'test' } } }) });
    await page.evaluate(async () => { await loadClosedMonths_(); });
    await openForm(page, '13'); await fillP(page, 'p1', 3);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'error');
    const C = await page.evaluate(() => ({ err: document.querySelector('#orderSaveState .oss-err').textContent, p1: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value }));
    check('S10: เดือนปิด + บิลจ่ายแล้ว + กดบันทึก → ไม่มี dialog ใดๆ ขึ้น', dlg.log.length === 0, dlg.log);
    check('S10: การ์ด error "🔒 เดือน Nov 2026 ปิดแล้ว ยังไม่ได้บันทึก" ค่าที่พิมพ์ยังอยู่ และไม่มีการเขียนเลย', /🔒/.test(C.err) && /Nov 2026/.test(C.err) && /ยังไม่ได้บันทึก/.test(C.err) && C.p1 === '3' && (await wr(page)).length === 0 && (await storeDay(page)).orders['13'].p1 === 2, C);
    await page.evaluate(() => { renderProductInputs(); window.__toasts.length = 0; });
    await page.click('#orderList [data-del="02"]');
    await page.waitForFunction(() => window.__toasts.some(t => /ยังไม่ได้ลบ/.test(t)), null, { timeout: 4000 });
    check('S10: เดือนปิด + กดลบออเดอร์ → ไม่มี dialog, toast 🔒 ยังไม่ได้ลบ, ไม่เขียน, ออเดอร์ 02 ยังอยู่', dlg.log.length === 0 && (await toasts(page)).some(t => /🔒/.test(t)) && (await wr(page)).length === 0 && !!(await storeDay(page)).orders['02'], { dlg: dlg.log, t: await toasts(page) });
    await page.close();
  }

  // ============ S11: นโยบาย B (บันทึก): บิลจ่ายแล้ว ============
  {
    const { page, dlg } = await boot(browser, { store: paidStore() });
    const expOld = await expMoney(page, { p1: 2 }, -20), expNew = await expMoney(page, { p1: 3 }, -20);
    const sumOld = await page.evaluate(() => orderRowSummary_({ p1: 2 })), sumNew = await page.evaluate(() => orderRowSummary_({ p1: 3 }));
    await openForm(page, '13'); await fillP(page, 'p1', 3);
    await resetW(page);
    const before = JSON.stringify((await storeDay(page)).billingPaid);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'dirty' && window.__toasts.some(t => /ยกเลิกแล้ว/.test(t)), null, { timeout: 5000 });
    const m = dlg.log[0] && dlg.log[0].message || '';
    check('S11: บิลจ่ายแล้ว + แก้ออเดอร์ → ขึ้น confirm() 1 ครั้ง บอกสาขา/วันที่/จ่ายเมื่อ/ยอดที่จ่าย', dlg.log.length === 1 && dlg.log[0].type === 'confirm' && /บิลสาขา 13/.test(m) && /20\/11\/2026/.test(m) && /จ่ายแล้ว/.test(m) && /19\/11\/2026/.test(m) && /1,000/.test(m), m);
    check('S11: dialog โชว์ออเดอร์เดิม→ใหม่ (ค่าเก่า/ค่าใหม่)', m.includes('ออเดอร์เดิม: ' + sumOld) && m.includes('ออเดอร์ใหม่: ' + sumNew), m);
    check('S11: dialog โชว์ "ยอดบิล เก่า → ใหม่" ตรงสูตร (ราคา×จำนวน + billExtra −20)', m.includes(`ยอดบิล ${expOld} → ${expNew}`) && /ไม่แก้สถานะจ่ายให้/.test(m), { expOld, expNew, m });
    check('S11: กดยกเลิก → ไม่เขียนเลย (__writes ว่าง) ออเดอร์เดิมยังอยู่ billingPaid ไม่ขยับ ค่าที่พิมพ์คงอยู่', (await wr(page)).length === 0 && (await storeDay(page)).orders['13'].p1 === 2 && JSON.stringify((await storeDay(page)).billingPaid) === before && await page.evaluate(() => document.querySelector('#productInputs .prodinput[data-pid="p1"]').value) === '3');
    dlg.mode = 'accept';
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    const w = await wr(page);
    check('S11: กดยืนยัน → เขียนเฉพาะ patchField ["orders","13"] ครั้งเดียว (ไม่มี set/patchOps วัน/คีย์อื่น)', dayW(w).length === 1 && dayW(w)[0].op === 'patchField' && JSON.stringify(dayW(w)[0].path) === '["orders","13"]' && !w.some(x => x.op === 'set') && otherW(w).length === 0, w);
    check('S11: billingPaid ไม่ขยับแม้แต่ตัวอักษร + ออเดอร์ใหม่ p1=3 + 02 ไม่ถูกแตะ', JSON.stringify((await storeDay(page)).billingPaid) === before && (await storeDay(page)).orders['13'].p1 === 3 && (await storeDay(page)).orders['02'].p1 === 1);
    check('S11: การ์ดบันทึกแล้วเตือน "จ่ายแล้ว — ยืนยันแก้ออเดอร์แล้ว ตรวจยอดที่จ่ายไปให้ตรงบิลใหม่ที่หน้าบิล"', await page.evaluate(() => [...document.querySelectorAll('#orderSaveState .oss-warn')].some(x => /จ่ายแล้ว — ยืนยันแก้ออเดอร์แล้ว/.test(x.textContent))));
    // แถวเท่าเดิม = ไม่ถาม
    dlg.log.length = 0;
    await openForm(page, '13'); // ค่าเดิม p1=3 ไม่แก้
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    check('S11: บิลจ่ายแล้ว แต่แถวเท่าเดิม (ไม่ได้แก้) = ไม่ถาม', dlg.log.length === 0 && JSON.stringify((await storeDay(page)).billingPaid) === before, dlg.log);
    await page.close();
  }

  // ============ S12: บิลยังไม่จ่าย = ไม่มี dialog; get→Key not found / error ขณะแคชมีข้อมูล = บล็อก ============
  {
    const { page, dlg } = await boot(browser, { store: paidStore() });
    await openForm(page, '02'); await fillP(page, 'p1', 4);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    check('S12: บิล 02 ยังไม่จ่าย → ไม่มี dialog และเขียน patchField ["orders","02"] ครั้งเดียว', dlg.log.length === 0 && dayW(await wr(page)).length === 1 && JSON.stringify(dayW(await wr(page))[0].path) === '["orders","02"]' && (await storeDay(page)).orders['02'].p1 === 4);
    // get → Key not found ขณะแคช/dayData มี orders+billingPaid (เซิร์ฟเวอร์แปลง error ทุกแบบเป็น Key not found) = ห้ามถือเป็นวันว่าง
    await openForm(page, '13'); await fillP(page, 'p1', 9);
    await page.evaluate(() => { delete window.__store['day:2026-11-20']; window.__events.saved = 0; });
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'error');
    const B = await page.evaluate(() => ({ err: document.querySelector('#orderSaveState .oss-err').textContent, p1: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value, toast: window.__toasts.some(t => /เช็คข้อมูลล่าสุดไม่ได้/.test(t)) }));
    check('S12: get ตอบ Key not found ขณะแคชมีออเดอร์+billingPaid → บล็อก ไม่ถามเงียบ ไม่เขียน (ไม่มีทั้ง dialog และ patchField)', dlg.log.length === 0 && (await wr(page)).length === 0 && /เช็คข้อมูลล่าสุดไม่ได้/.test(B.err) && B.toast && B.p1 === '9', { B, dlg: dlg.log });
    // error อื่น (เน็ตล่ม) ก็บล็อก
    await page.evaluate(() => { window.__store['day:2026-11-20'] = { orders: { '13': { p1: 2 } }, billingPaid: { '13': { paid: true } } }; window.__getHook = async key => { if (/^day:/.test(key)) throw new Error('Network down'); }; });
    await page.evaluate(() => { renderProductInputs(); });
    await openForm(page, '13'); await fillP(page, 'p1', 9);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'error');
    check('S12: get พังด้วย error อื่น (Network down) → บล็อกเช่นกัน ไม่เขียน', (await wr(page)).length === 0 && dlg.log.length === 0);
    await page.close();
    // วันที่ "ไม่เคยมีข้อมูลจริงๆ" (ทั้ง store และแคชว่าง) → Key not found = วันว่างจริง เขียนได้ตามปกติ (ไม่ถูกบล็อกเกินเหตุ)
    const e2 = await boot(browser, { store: {} });
    await openForm(e2.page, '13'); await fillP(e2.page, 'p1', 2);
    await e2.page.click('#saveRowBtn');
    await waitState(e2.page, 'saved');
    check('S12: วันที่ไม่มีข้อมูลเลย (Key not found จริง) → บันทึกได้ ไม่ถูกบล็อก/ไม่มี dialog', e2.dlg.log.length === 0 && (await storeDay(e2.page)).orders['13'].p1 === 2);
    await e2.page.close();
  }

  // ============ S13: อีกเครื่องติ๊กจ่ายระหว่างเขียน (แทรกใน mock) = เตือน ไม่ย้อนค่า ============
  {
    const { page, dlg } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__patchHook = async key => { window.__store[key].billingPaid = { '13': { paid: true, paidDate: '2026-11-20', transferAmount: 555, billedAmount: 555 } }; }; });
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    const O = await page.evaluate(() => ({ warn: [...document.querySelectorAll('#orderSaveState .oss-warn')].map(x => x.textContent), toast: window.__toasts.filter(t => /เพิ่งถูกติ๊กจ่ายระหว่างบันทึก/.test(t)).length }));
    check('S13: ระหว่างเขียนอีกเครื่องติ๊กจ่าย → การ์ดเตือน "เพิ่งถูกติ๊กจ่ายระหว่างบันทึก ยอดบิลเปลี่ยน ฿… → ฿… ตรวจที่หน้าบิล" + toast', O.warn.some(t => /เพิ่งถูกติ๊กจ่ายระหว่างบันทึก ยอดบิลเปลี่ยน ฿.* → ฿/.test(t)) && O.toast === 1, O);
    await page.waitForFunction(() => Object.keys(window.__store).some(k => /^actlog:/.test(k) && JSON.stringify(window.__store[k]).includes('เพิ่งถูกติ๊กจ่ายระหว่างบันทึก')), null, { timeout: 5000 });
    check('S13: ไม่ย้อน/ไม่แตะสถานะจ่ายของอีกเครื่อง (555 ยังอยู่) + ไม่มี dialog (ตอนกดยังไม่จ่าย) + จด log', (await storeDay(page)).billingPaid['13'].transferAmount === 555 && (await storeDay(page)).orders['13'].p1 === 2 && dlg.log.length === 0);
    await page.close();
  }

  // ============ S14: ลบออเดอร์ (deleteOrder_) ============
  {
    const { page, dlg } = await boot(browser, { store: paidStore() });
    // ยังไม่จ่าย (02): ยกเลิก = ไม่เขียน; ยืนยัน = patchOps deleteKey เดียว
    await resetW(page);
    await page.click('#orderList [data-del="02"]');
    await waitDelete(page, dlg, 1);
    check('S14: ลบ 02 (ยังไม่จ่าย) → confirm ธรรมดา "ลบออเดอร์สาขา 02" ยกเลิก = ไม่เขียน', dlg.log.length === 1 && /ลบออเดอร์สาขา 02/.test(dlg.log[0].message) && !/จ่ายแล้ว/.test(dlg.log[0].message) && (await wr(page)).length === 0 && !!(await storeDay(page)).orders['02']);
    dlg.mode = 'accept'; dlg.log.length = 0;
    await page.click('#orderList [data-del="02"]');
    await page.waitForFunction(() => !window.__store['day:2026-11-20'].orders['02']);
    const w14 = await wr(page);
    check('S14: ยืนยันลบ 02 → patchOps day: [{path:["orders","02"],deleteKey:true}] อย่างเดียว ไม่มี set/คีย์อื่น', dayW(w14).length === 1 && dayW(w14)[0].op === 'patchOps' && JSON.stringify(dayW(w14)[0].ops) === '[{"path":["orders","02"],"deleteKey":true}]' && !w14.some(x => x.op === 'set') && otherW(w14).length === 0, w14);
    // จ่ายแล้ว (13): confirm แบบแตะเงิน โชว์ยอดบิล ฿a → ฿0 + ยอดที่จ่าย
    const expOld = await expMoney(page, { p1: 2 }, -20);
    const sumOld = await page.evaluate(() => orderRowSummary_({ p1: 2 }));
    dlg.mode = 'dismiss'; dlg.log.length = 0;
    await resetW(page);
    await page.click('#orderList [data-del="13"]');
    await waitDelete(page, dlg, 1);
    const dm = dlg.log[0] && dlg.log[0].message || '';
    check('S14: ลบ 13 (จ่ายแล้ว) → confirm โชว์ "ยอดบิล ฿เดิม → ฿0 (ยอดที่จ่ายไปแล้ว ฿1,000 จะค้างอยู่ไม่ตรงบิล)" + ออเดอร์ที่จะลบ', dlg.log.length === 1 && dm.includes(`ยอดบิล ${expOld} → ฿0`) && /ยอดที่จ่ายไปแล้ว ฿1,000/.test(dm) && dm.includes('ออเดอร์ที่จะลบ: ' + sumOld) && /จ่ายแล้ว/.test(dm), dm);
    check('S14: ยกเลิก = ไม่เขียน ออเดอร์ 13 และ billingPaid อยู่ครบ', (await wr(page)).length === 0 && (await storeDay(page)).orders['13'].p1 === 2 && !!(await storeDay(page)).billingPaid['13']);
    dlg.mode = 'accept';
    await page.click('#orderList [data-del="13"]');
    await page.waitForFunction(() => !window.__store['day:2026-11-20'].orders['13']);
    const w14b = await wr(page);
    const sd = await storeDay(page);
    check('S14: ยืนยันลบ 13 (จ่ายแล้ว) → patchOps deleteKey ["orders","13"] เท่านั้น — billingPaid["13"] ยังอยู่ครบ ไม่ถูกลบ/แก้', dayW(w14b).length === 1 && JSON.stringify(dayW(w14b)[0].ops) === '[{"path":["orders","13"],"deleteKey":true}]' && JSON.stringify(sd.billingPaid['13']) === JSON.stringify(PAID13) && sd.billExtra['13'] === -20, { w14b, bp: sd.billingPaid });
    check('S14: toast บอก "ลบแล้ว — บิลสาขา 13 จ่ายแล้ว ตรวจยอดที่หน้าบิล"', (await toasts(page)).some(t => /ลบแล้ว — บิลสาขา 13 จ่ายแล้ว/.test(t)), await toasts(page));
    await page.close();
  }
  {
    // ลบ: get→Key not found ขณะแคชมีข้อมูล = บล็อก; ลบซ้อนรหัสเดียว = 1 dialog/1 เขียน; ลบออฟไลน์ = รอส่ง; ออฟไลน์+จ่ายแล้ว+ยกเลิก = คิวว่าง
    const { page, dlg } = await boot(browser, { store: paidStore() });
    dlg.mode = 'accept';
    await page.evaluate(() => { delete window.__store['day:2026-11-20']; });
    await resetW(page);
    await page.click('#orderList [data-del="02"]');
    await page.waitForFunction(() => window.__toasts.some(t => /เช็คข้อมูลล่าสุดไม่ได้/.test(t)), null, { timeout: 4000 });
    check('S14: ลบ + get→Key not found ขณะแคชมีข้อมูล → บล็อก (ไม่มี dialog ไม่มีเขียน) แจ้ง "ยังไม่ได้ลบ"', dlg.log.length === 0 && (await wr(page)).length === 0 && (await toasts(page)).some(t => /ยังไม่ได้ลบ/.test(t)));
    await page.close();
    const b = await boot(browser, { store: paidStore() });
    b.dlg.mode = 'accept';
    await resetW(b.page);
    const dbl = await b.page.evaluate(async () => { const a = deleteOrder_('02'), c = deleteOrder_('02'); const r = await Promise.all([a, c]); return { r, n: window.__writes.filter(w => /^day:/.test(w.key)).length }; });
    check('S14: ลบรหัสเดียวกันซ้อนกัน → เขียน 1 ครั้ง ถามยืนยัน 1 ครั้ง (ตัวกันต่อรหัส)', dbl.n === 1 && dbl.r[0] === true && dbl.r[1] === false && b.dlg.log.length === 1, { dbl, dlg: b.dlg.log });
    await b.page.close();
    const o = await boot(browser, { store: paidStore() });
    o.dlg.mode = 'accept';
    await o.page.evaluate(() => { window.__forceOffline = true; });
    await resetW(o.page);
    await o.page.click('#orderList [data-del="02"]');
    await o.page.waitForFunction(() => window.__toasts.some(t => /ลบไว้ในเครื่องแล้ว รอส่งเมื่อมีเน็ต/.test(t)), null, { timeout: 4000 });
    const oq = (await queueOf(o.page)).filter(e => e.key === 'day:' + TODAY);
    check('S14: ลบตอนออฟไลน์ → toast "ลบไว้ในเครื่องแล้ว รอส่งเมื่อมีเน็ต" (ไม่ใช่ "ลบแล้ว") คิวมี patchOps deleteKey เดียว ไม่มีเขียนจริง', oq.length === 1 && oq[0].m === 'patchOps' && JSON.stringify(oq[0].ops) === '[{"path":["orders","02"],"deleteKey":true}]' && dayW(await wr(o.page)).length === 0 && !(await toasts(o.page)).some(t => t === 'ลบแล้ว'), { oq, t: await toasts(o.page) });
    await o.page.close();
    const oc = await boot(browser, { store: paidStore() });
    oc.dlg.mode = 'dismiss';
    await oc.page.evaluate(() => { window.__forceOffline = true; });
    await resetW(oc.page);
    await oc.page.click('#orderList [data-del="13"]');
    await waitDelete(oc.page, oc.dlg, 1);
    check('S14: ออฟไลน์ + แคชจ่ายแล้ว + กดยกเลิกลบ → คิวว่าง ไม่เขียน (dialog บอกว่าเช็ค server ไม่ได้)', oc.dlg.log.length === 1 && /เช็คกับเซิร์ฟเวอร์ไม่ได้/.test(oc.dlg.log[0].message) && (await queueOf(oc.page)).length === 0 && (await wr(oc.page)).length === 0);
    await oc.page.close();
  }

  // ============ S15: ลบออเดอร์ระหว่างอีกเครื่องติ๊กจ่าย = เตือน ============
  {
    const { page, dlg } = await boot(browser, { store: paidStore() });
    // 02 ยังไม่จ่ายตอนกดลบ แต่ระหว่างเขียนอีกเครื่องติ๊กจ่าย 02
    dlg.mode = 'accept';
    await page.evaluate(() => { window.__opsHook = async key => { window.__store[key].billingPaid['02'] = { paid: true, paidDate: '2026-11-20', transferAmount: 300, billedAmount: 300 }; }; });
    await page.click('#orderList [data-del="02"]');
    await page.waitForFunction(() => window.__toasts.some(t => /เพิ่งถูกติ๊กจ่ายระหว่างลบ/.test(t)), null, { timeout: 5000 });
    check('S15: ลบแล้วเจอว่าเพิ่งถูกติ๊กจ่ายระหว่างทาง → toast เตือน "ยอดบิลเปลี่ยน … → ฿0 ตรวจที่หน้าบิล" และไม่แตะ billingPaid ของอีกเครื่อง', (await storeDay(page)).billingPaid['02'].transferAmount === 300 && !(await storeDay(page)).orders['02']);
    await page.close();
  }

  // ============ S16: ซิงก์ที่ผ่าน userBusy_ แล้วผู้ใช้เริ่มบันทึกระหว่าง await = ไม่ถูกวาดทับ ============
  {
    const ctl = await boot(browser, { store: emptyStore() });
    const snap0 = JSON.stringify(await storeDay(ctl.page));
    // ตัวควบคุม: ไม่มีผู้ใช้ทำอะไรระหว่าง await + pendingSyncRender_ → ซิงก์วาดใหม่ตามปกติ (พิสูจน์ว่าด่านที่เทสด้านล่างเป็นตัวกันจริง ไม่ใช่ซิงก์ไม่ทำงาน)
    await ctl.page.evaluate(async s => { pendingSyncRender_ = true; window.__getHook = async key => { if (key === 'day:' + currentDate) return { key, value: s, shared: false }; }; await syncFromOtherDevices_(); }, snap0);
    check('S16: (ตัวควบคุม) ซิงก์ปกติที่ผู้ใช้ไม่ได้ทำอะไร → วาดใหม่ + toast "🔄 อัปเดตข้อมูลจากเครื่องอื่นแล้ว"', (await toasts(ctl.page)).some(t => /อัปเดตข้อมูลจากเครื่องอื่นแล้ว/.test(t)));
    await ctl.page.close();

    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13');
    const snap = JSON.stringify(await storeDay(page)); // สแนปช็อตเก่า (ก่อนผู้ใช้บันทึก) = สิ่งที่ซิงก์ "จะ" วาดทับถ้าไม่มีด่าน
    await page.evaluate(s => {
      window.__gateHit = false; let first = true;
      window.__gate = new Promise(r => { window.__gateOpen = r; });
      window.__getHook = async key => { if (first && key === 'day:' + currentDate) { first = false; window.__gateHit = true; await window.__gate; return { key, value: s, shared: false }; } };
      window.__patchHook = async () => { await new Promise(r => setTimeout(r, 500)); };
      document.activeElement && document.activeElement.blur();
      pendingSyncRender_ = true; // เครื่องอื่นแก้วันนี้ (ป้าย dayRevs เปลี่ยน) = ซิงก์ "ต้องวาดใหม่" ถ้าผู้ใช้ไม่ยุ่ง
      window.__syncP = syncFromOtherDevices_();
    }, snap);
    await page.waitForFunction(() => window.__gateHit, null, { timeout: 5000 });
    const busyAtStart = await page.evaluate(() => userBusy_());
    await fillP(page, 'p1', 3);
    await page.click('#saveRowBtn');
    await waitState(page, 'saving');
    await page.evaluate(() => window.__gateOpen());
    await page.evaluate(() => window.__syncP);
    // ถ้าซิงก์วาดทับ (renderProductInputs จากสแนปช็อตเก่า) ช่อง p1 จะถูกล้างเป็นว่าง + มี toast — เช็คทันทีขณะยัง saving
    const Y = await page.evaluate(() => ({ p1val: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value, toast: window.__toasts.some(t => /อัปเดตข้อมูลจากเครื่องอื่นแล้ว/.test(t)), st: document.getElementById('orderFormCard').dataset.save, pending: pendingSyncRender_ }));
    check('S16: ซิงก์เริ่มตอนไม่ยุ่ง (userBusy_ = false) แล้วผู้ใช้กดบันทึกระหว่าง await', busyAtStart === false, busyAtStart);
    check('S16: เมื่อ await จบ ซิงก์เช็ค userBusy_ ซ้ำ → ไม่วาดทับ: ช่อง p1 ยังเป็น 3, ไม่มี toast "อัปเดตจากเครื่องอื่น", การ์ดยัง saving, pendingSyncRender_ ค้างไว้รอบหน้า', Y.p1val === '3' && !Y.toast && Y.st === 'saving' && Y.pending === true, Y);
    await waitState(page, 'saved');
    check('S16: ผลสุดท้าย dayData มีออเดอร์ 13 = 3 (ไม่ถูกสแนปช็อตเก่าทับ)', await page.evaluate(() => dayData.orders['13'] && dayData.orders['13'].p1) === 3);
    check('S16: บันทึกเสร็จเป็น saved ตามปกติ และเขียน 1 ครั้ง ค่าถึง storage', (await storeDay(page)).orders['13'].p1 === 3 && dayW(await wr(page)).length === 1);
    await page.close();
  }

  // ============ S17: dirty ไม่ค้างเมื่อแถวเป็นทศนิยมไม่ปัด (2.25) + userBusy_ ตามสถานะ ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 2.25 }, '02': { p1: 1 } } }) } });
    await openForm(page, '13');
    const D = await page.evaluate(() => ({ val: document.querySelector('#productInputs .prodinput[data-pid="p1"]').value, dirty: orderFormDirty_(), st: document.getElementById('orderFormCard').dataset.save, dot: !document.getElementById('orderDirtyDot').hidden }));
    check('S17: แถวมี p1 = 2.25 (OCR ไม่ปัด) เปิดฟอร์ม → ไม่ dirty ไม่มีชิป ไม่ค้าง', D.val === '2.25' && D.dirty === false && D.st === 'idle' && !D.dot, D);
    await page.evaluate(() => { editingCode = null; });
    check('S17: ไม่ dirty → userBusy_() เป็นเท็จ (ซิงก์/รีโหลด build ใหม่ไม่ถูกบล็อกถาวร)', await page.evaluate(() => userBusy_()) === false);
    await fillP(page, 'p1', 3); await page.evaluate(() => { document.activeElement.blur(); });
    check('S17: แก้ค่า = dirty และ userBusy_() จริงแม้เอาโฟกัสออกแล้ว', await page.evaluate(() => orderFormDirty_() && userBusy_()));
    await fillP(page, 'p1', 2.25); await page.evaluate(() => { document.activeElement.blur(); });
    check('S17: พิมพ์กลับเป็นค่าเดิม (2.25) = ไม่ dirty อีก', await page.evaluate(() => !orderFormDirty_() && !userBusy_()));
    // สินค้าอื่นๆ ที่เพิ่ม = dirty (เทียบสแนปช็อต customItemsStaged)
    await page.evaluate(() => { customItemsStaged.push({ name: 'ซอส', qty: 1, price: 20 }); renderCustomItemsSection_(); onOrderFormChanged_(); });
    check('S17: เพิ่มสินค้าอื่นๆ = dirty', await page.evaluate(() => orderFormDirty_()) === true);
    await page.close();
  }

  // ============ S18: userBusy_ ขณะ saving + สวิตช์/ดรอปดาวน์ถูกล็อกระหว่างบันทึก ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.evaluate(() => { window.__patchHook = async () => { await new Promise(r => setTimeout(r, 900)); }; });
    await page.click('#saveRowBtn');
    await waitState(page, 'saving');
    const G = await page.evaluate(() => {
      const sw = document.getElementById('sepSwitch'), pk = document.getElementById('branchPick'), b = document.querySelector('#sepSwitch [data-sepside="sep"]').getBoundingClientRect();
      return { busy: userBusy_(), swPE: getComputedStyle(sw).pointerEvents, pickPE: getComputedStyle(pk).pointerEvents, saveBtn: document.getElementById('saveRowBtn').textContent.trim(), ro: [...document.querySelectorAll('#productInputs .prodinput')].every(i => i.readOnly), x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.click(G.x, G.y); // ผู้ใช้จริงแตะ "แยกส่ง" ระหว่างบันทึก (pointer-events:none → ไม่โดน)
    check('S18: ระหว่าง saving: userBusy_ จริง, สวิตช์/ดรอปดาวน์ pointer-events:none, ช่องกรอก readonly, ปุ่ม "กำลังบันทึก…"', G.busy && G.swPE === 'none' && G.pickPE === 'none' && G.ro && /กำลังบันทึก/.test(G.saveBtn), G);
    check('S18: แตะสวิตช์ระหว่างบันทึก = ไม่สลับ (ยังเป็นรหัส 13)', await page.evaluate(() => document.getElementById('branchSelect').value) === '13');
    await waitState(page, 'saved');
    check('S18: บันทึกเสร็จ userBusy_ กลับเป็นเท็จ', await page.evaluate(() => userBusy_()) === false);
    await page.close();
  }

  // ============ S19: reduced-motion / ปิดแอนิเมชันในตั้งค่า = ไม่หน่วงเลย ไม่มีแอนิเมชันค้าง ============
  for (const mode of ['reduced-motion', 'karmto.motion=0']) {
    const { page } = await boot(browser, { store: emptyStore() });
    if (mode === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    else await page.evaluate(() => localStorage.setItem('karmto.motion', '0'));
    await openForm(page, '13');
    await page.evaluate(() => {
      window.__states = [];
      const card = document.getElementById('orderFormCard');
      const rec = () => { const s = card.dataset.save, l = window.__states[window.__states.length - 1]; if (!l || l.s !== s) window.__states.push({ s, t: Date.now() }); };
      new MutationObserver(rec).observe(card, { attributes: true, attributeFilter: ['data-save'] });
      rec();
    });
    await fillP(page, 'p1', 2);
    await page.click('#saveRowBtn');
    await waitState(page, 'saved', 3000);
    const Rm = await page.evaluate(() => ({ states: window.__states.map(x => x.s), t: Object.fromEntries(window.__states.map(x => [x.s, x.t])), motion: document.getElementById('orderFormCard').dataset.motion, anim: getComputedStyle(document.querySelector('#orderSaveState .oss-card')).animationName, ckAnim: getComputedStyle(document.querySelector('#orderSaveState .oss-ck svg')).animationName }));
    check(`S19 (${mode}): ไม่หน่วงโชว์ saving และไม่มีเฟส done: ไปถึง saved ภายใน 300ms ของ saving`, !Rm.states.includes('done') && Rm.t.saved - (Rm.t.saving || Rm.t.dirty) < 300, Rm);
    check(`S19 (${mode}): data-motion="off" + ไม่มีแอนิเมชันค้างบนการ์ด/เครื่องหมายถูก`, Rm.motion === 'off' && Rm.anim === 'none' && Rm.ckAnim === 'none', Rm);
    await page.close();
  }

  // ============ S20: error + สั่นเฉพาะตอนเปิดแอนิเมชัน ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openForm(page, '13');
    await page.evaluate(() => { window.__patchHook = async () => { throw new Error('x'); }; });
    await fillP(page, 'p1', 2); await page.click('#saveRowBtn'); await waitState(page, 'error');
    check('S20: reduced-motion: การ์ด error ไม่สั่น (animation none) แต่ข้อความยังขึ้นครบ', await page.evaluate(() => getComputedStyle(document.querySelector('#orderSaveState .oss-err')).animationName) === 'none' && /ยังไม่ได้บันทึก/.test(await page.evaluate(() => document.querySelector('#orderSaveState .oss-err').textContent)));
    await page.close();
  }

  // ============ S21: ซิงก์ระหว่าง saved การ์ดไม่หาย ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13'); await fillP(page, 'p1', 2);
    await page.click('#saveRowBtn'); await waitState(page, 'saved');
    // อีกเครื่องเพิ่มออเดอร์ 05 เข้าวันเดียวกัน → ซิงก์วาดใหม่ (ไม่ยุ่ง) แต่การ์ด saved ของ 13 ยังอยู่
    await page.evaluate(() => { window.__store['day:2026-11-20'].orders['05'] = { p2: 1 }; window.__toasts.length = 0; document.activeElement && document.activeElement.blur(); });
    await page.evaluate(async () => { await syncFromOtherDevices_(); });
    const Z = await page.evaluate(() => ({ st: document.getElementById('orderFormCard').dataset.save, card: !!document.querySelector('#orderSaveState .oss-card'), text: document.getElementById('orderSaveState').innerText, has05: !!dayData.orders['05'], toast: window.__toasts.some(t => /อัปเดตข้อมูลจากเครื่องอื่นแล้ว/.test(t)) }));
    check('S21: ซิงก์วาดทับระหว่าง saved → การ์ดบันทึกแล้วยังอยู่ (ซิงก์ทำงานจริง: เห็น 05 + toast)', Z.has05 && Z.toast && Z.st === 'saved' && Z.card && /บันทึกแล้ว/.test(Z.text), Z);
    await page.close();
  }

  // ============ S22: สาขาแยกส่ง 13T บันทึกจากสวิตช์: การ์ดบอก "แยกส่ง" + เขียนรหัส 13T เดียว ============
  {
    const { page } = await boot(browser, { store: emptyStore() });
    await openForm(page, '13');
    await page.click('#sepSwitch [data-sepside="sep"]');
    await fillP(page, 'p1', 1);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitState(page, 'saved');
    const w = await wr(page);
    const T = await page.evaluate(() => ({ head: document.querySelector('#orderSaveState .oss-head').textContent, next: (document.querySelector('[data-ossnext]') || {}).textContent }));
    check('S22: บันทึกฝั่งแยกส่ง → patchField ["orders","13T"] รหัสเดียว (13 ไม่ถูกแตะ) + การ์ดเขียน 13T · แยกส่ง', dayW(w).length === 1 && JSON.stringify(dayW(w)[0].path) === '["orders","13T"]' && !(await storeDay(page)).orders['13'] && (await storeDay(page)).orders['13T'].p1 === 1 && /13T/.test(T.head) && /แยกส่ง/.test(T.head), { w, T });
    check('S22: → สาขาถัดไป หลังบันทึก 13T = สาขาหลักถัดจาก 13 (14) ไม่ใช่ต้นลิสต์ และไม่ใช่ T', /14$/.test((T.next || '').trim()), T.next);
    await page.close();
  }

  await finish(browser);
})();
