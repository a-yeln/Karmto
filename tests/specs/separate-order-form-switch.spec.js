const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// แยกส่ง ชุด 2 ส่วน F: ฟอร์มบันทึกออเดอร์สลับ "ส่งปกติ | แยกส่ง" (13 กับ 13T) — #branchPick แสดงเฉพาะสาขาหลัก, #branchSelect (ซ่อน) = แหล่งความจริงของรหัส
// กฎเหล็ก: สวิตช์ไม่เขียนข้อมูล / ไม่ติ๊กแยกส่งให้ / ไม่สร้างสาขา / ผูกกับ "ตัวเลข+T ที่ติ๊กแยกส่งแล้ว" เท่านั้น (13S ไม่นับ)
// บันทึกฝั่งแยกส่ง = patchField ['orders','13T'] รหัสเดียว (ไม่ set ทับ ไม่แตะ settings/billingPaid) และ Brand fee ไม่เปลี่ยน
const TODAY = '2026-11-20', OTHER_DAY = '2026-11-21';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const mkB = (code, extra) => Object.assign({ code, area: '', label: 'สาขา ' + code.replace(/t$/i, '') + '(แยกส่ง)', separate: true, billName: '', billAddr: '', billTax: '' }, extra || {});

async function boot(browser, { store = {}, viewport, add = [mkB('13T')], remove = [], patch = {} } = {}) {
  const page = await openApp(browser, { store: Object.assign({ rawLots: [], ['day:' + TODAY]: mkDay({ orders: {} }) }, store), date: TODAY, viewport });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00')); // วันที่ตรึงไว้ที่ 20/11/2026 10:00 แต่ปล่อยเวลาเดินต่อ (เฟส "done" ของการ์ดบันทึกอิง Date.now() — ตรึงตายตัวจะไม่จบ)
  const dlg = { log: [], mode: 'dismiss' };
  page.on('dialog', async d => { dlg.log.push({ type: d.type(), message: d.message() }); if (dlg.mode === 'accept') await d.accept(); else await d.dismiss(); });
  await page.evaluate(() => {
    window.__toasts = [];
    const ot = window.showToast;
    window.showToast = function (m) { window.__toasts.push(String(m)); return ot.apply(this, arguments); };
  });
  await applyBranches(page, { add, remove, patch });
  await page.evaluate(async () => { await switchTab('order'); refreshOrderTab(); });
  await stripBanner(page);
  return { page, dlg };
}
// แก้รายชื่อสาขาในหน่วยความจำของหน้า (ไม่เขียน storage) แล้ววาดหน้าออเดอร์ใหม่
const applyBranches = (page, { add = [], remove = [], patch = {} }) => page.evaluate(({ add, remove, patch }) => {
  settings.branches = settings.branches.filter(b => !remove.includes(b.code));
  add.forEach(b => { if (!settings.branches.some(x => x.code === b.code)) settings.branches.push(b); });
  Object.entries(patch).forEach(([c, p]) => Object.assign(settings.branches.find(b => b.code === c), p));
  refreshOrderTab();
}, { add, remove, patch });
const openForm = (page, code) => page.evaluate(c => { openBranchForm_(c); document.activeElement && document.activeElement.blur(); }, code);
const wr = page => page.evaluate(() => window.__writes.map(w => ({ op: w.op, key: w.key, path: w.path, ops: w.ops })));
const dayW = ws => ws.filter(w => /^day:/.test(w.key));
const otherW = ws => ws.filter(w => !/^(day:|actlog:|dayRevs$)/.test(w.key));
// ล้างบันทึกการเขียนหลังงานเบื้องหลัง (dayRevs หน่วง 400ms / actlog) นิ่งแล้ว — กันเช็ค "ไม่เขียนอะไร" แดงแบบสุ่มตอนเครื่องช้า
const resetW = async page => {
  await page.evaluate(() => new Promise(res => {
    let last = -1, n = 0;
    const tick = () => { const quiet = Object.keys(pendingDayRevs_).length === 0 && window.__writes.length === last; n = quiet ? n + 1 : 0; last = window.__writes.length; if (n >= 6) return res(); requestAnimationFrame(tick); };
    tick();
  }));
  await page.evaluate(() => { window.__writes = []; });
};
const fillP = (page, pid, v) => page.fill(`#productInputs .prodinput[data-pid="${pid}"]`, String(v));
const toasts = page => page.evaluate(() => window.__toasts.slice());
const storeDay = (page, iso = TODAY) => page.evaluate(iso => JSON.parse(JSON.stringify(window.__store['day:' + iso] || null)), iso);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// openBranchForm_ เลื่อนจอแบบ smooth — click({force:true}) ข้ามการเช็คเป้าหมาย/ความนิ่ง จึงต้องรอให้จอหยุดเลื่อนก่อน ไม่งั้นคลิกหลุดไปโดนส่วนหัวที่ตรึงอยู่ (เคย flaky)
const settleScroll = page => page.evaluate(() => new Promise(res => { let last = -1, n = 0; const tick = () => { if (Math.abs(scrollY - last) < 0.5) { if (++n >= 8) return res(); } else n = 0; last = scrollY; requestAnimationFrame(tick); }; tick(); }));
const clickSide = async (page, side, opt) => { if (opt && opt.force) await settleScroll(page); return page.click(`#sepSwitch [data-sepside="${side}"]`, opt); };
const waitSaved = page => page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'saved', null, { timeout: 8000 });
const form = page => page.evaluate(() => {
  const card = document.getElementById('orderFormCard');
  return {
    sel: document.getElementById('branchSelect').value, pick: document.getElementById('branchPick').value, side: card.dataset.side, swHidden: document.getElementById('sepSwitch').hidden,
    sw: [...document.querySelectorAll('#sepSwitch [data-sepside]')].map(b => ({ side: b.dataset.sepside, pressed: b.getAttribute('aria-pressed'), dis: b.getAttribute('aria-disabled') === 'true', text: b.innerText.replace(/\s+/g, ' ').trim(), h: Math.round(b.getBoundingClientRect().height) })),
    save: document.getElementById('saveRowBtn').textContent.trim(), bar: document.getElementById('orderSideBar').textContent, barShown: getComputedStyle(document.getElementById('orderSideBar')).display !== 'none',
    vals: Object.fromEntries([...document.querySelectorAll('#productInputs .prodinput')].map(i => [i.dataset.pid, i.value])), custom: customItemsStaged.map(c => c.name), nInputs: document.querySelectorAll('#productInputs .prodinput').length,
    dot: !document.getElementById('orderDirtyDot').hidden, st: card.dataset.save,
  };
});
const setTheme = (page, th, mode = 'full') => page.evaluate(({ th, mode }) => {
  if (th) { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', mode); }
  else { document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-tmode'); }
}, { th, mode });
const shotCard = async (page, name) => {
  const clip = await page.evaluate(() => { const el = document.getElementById('orderFormCard'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 34), width: innerWidth, height: Math.min(1300, r.height + 50) }; });
  await page.screenshot({ path: path.join(SHOT_DIR, name), clip, fullPage: true }).catch(() => {});
};
const feeAll = page => page.evaluate(() => Object.fromEntries(Object.keys(window.__store).filter(k => /^day:/.test(k)).map(k => { const d = normalizeDay_(JSON.parse(JSON.stringify(window.__store[k]))); return [k, computeFeeTotals(d.orders, d)]; })));
// สร้างร่างค้าง: 13 พิมพ์ p1=3 + สินค้าอื่นๆ "ซอส" → สลับไป 13T พิมพ์ p2=1 + "น้ำจิ้ม" (ผ่าน UI จริงทั้งหมด)
async function addCustom(page, name, qty, price) {
  await page.click('#customItemOpenBtn');
  await page.fill('#customItemName', name); await page.fill('#customItemPrice', String(price)); await page.fill('#customItemQty', String(qty));
  await page.click('#customItemAddBtn');
}
async function makeDrafts(page) {
  await openForm(page, '13');
  await fillP(page, 'p1', 3);
  await addCustom(page, 'ซอส', 2, 30);
  await clickSide(page, 'sep');
  await fillP(page, 'p2', 1);
  await addCustom(page, 'น้ำจิ้ม', 1, 10);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
}

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  // ============ F1: คู่ 13 + 13T (ติ๊กแยกส่ง) ============
  let feeBefore, branchesBefore;
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '02': { p1: 1 }, '13S': { p1: 4 } } }) } });
    feeBefore = await page.evaluate(() => { const d = dayData; return computeFeeTotals(d.orders, d); });
    branchesBefore = await page.evaluate(() => JSON.stringify(settings.branches));
    const O = await page.evaluate(() => ({
      pick: [...document.querySelectorAll('#branchPick option')].map(o => o.value), sel: [...document.querySelectorAll('#branchSelect option')].map(o => o.value),
      selDisplay: getComputedStyle(document.getElementById('branchSelect')).display, selAria: document.getElementById('branchSelect').getAttribute('aria-hidden'),
      swGroup: document.getElementById('sepSwitch').getAttribute('role'), swBtns: document.querySelectorAll('#sepSwitch [data-sepside]').length,
    }));
    check('F1: #branchPick แสดงสาขาหลักเท่านั้น (ไม่มี 13T) แต่มี 13, 13S, 16S ที่เป็นสาขาเดี่ยว', O.pick.includes('13') && !O.pick.includes('13T') && O.pick.includes('13S') && O.pick.includes('16S'), O.pick);
    check('F1: #branchSelect ซ่อน (display:none, aria-hidden) แต่มีทุกรหัสรวม 13T (แหล่งความจริงของรหัส)', O.selDisplay === 'none' && O.selAria === 'true' && O.sel.includes('13T') && O.sel.includes('13') && O.sel.length === O.pick.length + 1, { selDisplay: O.selDisplay, n: [O.sel.length, O.pick.length] });
    check('F1: สวิตช์เป็น role=group มี 2 ปุ่ม', O.swGroup === 'group' && O.swBtns === 2, O);
    await openForm(page, '13');
    const A = await form(page);
    check('F1: เปิด 13 → ฝั่งส่งปกติ กด (aria-pressed) ฝั่งแยกส่งใช้ได้ ไม่ disabled ทั้งสองปุ่ม', A.sel === '13' && A.pick === '13' && A.side === 'main' && A.sw.length === 2 && A.sw[0].pressed === 'true' && A.sw[1].pressed === 'false' && !A.sw[0].dis && !A.sw[1].dis, A.sw);
    check('F1: ปุ่มสวิตช์สูง ≥ 44px (แตะง่ายบนมือถือ) ข้อความ "ส่งปกติ 13" / "แยกส่ง 13T"', A.sw.every(b => b.h >= 44) && /ส่งปกติ 13/.test(A.sw[0].text) && /แยกส่ง 13T/.test(A.sw[1].text), A.sw);
    check('F1: ฝั่งส่งปกติไม่มีป้ายคาดขอบม่วง (data-side=main)', A.bar === '' && !A.barShown && A.side === 'main', A);
    check('F1: ปุ่มบันทึกระบุรหัส "บันทึก 13 (ส่งปกติ)"', A.save === 'บันทึก 13 (ส่งปกติ)', A.save);
    await resetW(page);
    await clickSide(page, 'sep');
    const B = await form(page);
    check('F1: แตะ แยกส่ง → #branchSelect = 13T, ดรอปดาวน์ยังเป็น 13, การ์ดโทนม่วง (data-side=sep), สวิตช์กดฝั่งแยกส่ง, ป้ายคาดขอบ "กำลังกรอก 13T (แยกส่ง)"', B.sel === '13T' && B.pick === '13' && B.side === 'sep' && B.sw[1].pressed === 'true' && B.sw[0].pressed === 'false' && B.bar === 'กำลังกรอก 13T (แยกส่ง)' && B.barShown, B);
    check('F1: ปุ่มบันทึกระบุรหัส "บันทึก 13T (แยกส่ง)"', B.save === 'บันทึก 13T (แยกส่ง)', B.save);
    check('F1: สลับสวิตช์ไม่เขียนข้อมูลอะไรเลย (__writes ว่าง) และไม่แตะ settings', (await wr(page)).length === 0 && await page.evaluate(() => JSON.stringify(settings.branches)) === branchesBefore);
    await shotCard(page, 'switch-sep-macaron.png');
    await setTheme(page, 'neon'); await page.waitForTimeout(150);
    await shotCard(page, 'switch-sep-neon.png');
    await setTheme(page, '');
    // บันทึกฝั่งแยกส่ง: patchField ['orders','13T'] รหัสเดียว
    await fillP(page, 'p1', 2);
    await resetW(page);
    await page.click('#saveRowBtn');
    await waitSaved(page);
    const w = await wr(page);
    const sd = await storeDay(page);
    check('F1: บันทึกฝั่งแยกส่ง → เขียน patchField day: ["orders","13T"] ครั้งเดียว', dayW(w).length === 1 && dayW(w)[0].op === 'patchField' && dayW(w)[0].key === 'day:' + TODAY && JSON.stringify(dayW(w)[0].path) === '["orders","13T"]', dayW(w));
    check('F1: ไม่มี set ทับ / ไม่แตะ settings / rawLots / billingPaid / สาขา 13', !w.some(x => x.op === 'set') && otherW(w).length === 0 && !w.some(x => x.key === 'settings') && !sd.orders['13'] && sd.orders['13T'].p1 === 2 && Object.keys(sd.billingPaid).length === 0, { w, orders: Object.keys(sd.orders) });
    check('F1: ป้ายสวิตช์ฝั่งแยกส่งโชว์ "2 ชิ้น" และฝั่งปกติยังไม่มีออเดอร์', await page.evaluate(() => /2 ชิ้น/.test(document.querySelector('#sepSwitch [data-sepside="sep"]').innerText) && !/ชิ้น/.test(document.querySelector('#sepSwitch [data-sepside="main"]').innerText)));
    // Brand fee: T ยกเว้นเสมอ — บันทึก 13T ไม่ทำให้ยอดคิดค่าแบรนด์ขยับ; บันทึก 13 ปกติ = ขยับตามจำนวนจริง (พิสูจน์ว่าฟังก์ชันทำงาน)
    const feeAfterT = await page.evaluate(() => computeFeeTotals(dayData.orders, dayData));
    check('F1: Brand fee computeFeeTotals ก่อน = หลังบันทึก 13T เป๊ะ (T/13S ยกเว้น ไม่เพิ่มยอดคิดค่าแบรนด์)', JSON.stringify(feeAfterT) === JSON.stringify(feeBefore) && feeBefore.p1 === 1, { feeBefore, feeAfterT });
    await openForm(page, '13'); await fillP(page, 'p1', 5);
    await page.click('#saveRowBtn'); await waitSaved(page);
    const feeAfter13 = await page.evaluate(() => computeFeeTotals(dayData.orders, dayData));
    check('F1: (ตัวควบคุม) บันทึก 13 ปกติ p1=5 → ยอดคิดค่าแบรนด์ p1 เพิ่มจาก 1 เป็น 6', feeAfter13.p1 === 6, feeAfter13);
    check('F1: รายชื่อสาขาใน settings ไม่ถูกแก้ตลอดการสลับ/บันทึก (ไม่ติ๊กแยกส่งให้ ไม่สร้างสาขา)', await page.evaluate(() => JSON.stringify(settings.branches)) === branchesBefore);
    // ✓ ในดรอปดาวน์ = สาขาหลักมีออเดอร์ (13T ไม่นับแทน 13 — ตอนนี้ 13 มีแล้ว)
    check('F1: ดรอปดาวน์สาขาหลักขึ้น ✓ ที่ 13 หลังมีออเดอร์ปกติ', await page.evaluate(() => /✓/.test([...document.querySelectorAll('#branchPick option')].find(o => o.value === '13').textContent)));
    await page.close();
  }

  // ============ F2: ไม่มีแถว T = ช่องแยกส่งเทา "ยังไม่เปิดใช้" ไม่เขียนอะไร + ฟอร์มสาขาเดี่ยวเหมือนเดิม ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: {} }) } });
    const n0 = await page.evaluate(() => settings.branches.length);
    await openForm(page, '02');
    await resetW(page);
    const A = await form(page);
    check('F2: 02 ไม่มีคู่ → ช่องแยกส่งเทา (aria-disabled) ข้อความ "ยังไม่เปิดใช้" ฝั่งปกติกดอยู่', A.sw[1].dis && /ยังไม่เปิดใช้/.test(A.sw[1].text) && A.sw[0].pressed === 'true' && !A.sw[0].dis, A.sw);
    check('F2: ฟอร์มสาขาเดี่ยวเหมือนเดิม: ปุ่ม "บันทึกสาขานี้" ไม่มีป้ายม่วง data-side=main ช่องกรอกสินค้า 7 ช่อง + ปุ่ม "+ อื่นๆ"', A.save === 'บันทึกสาขานี้' && A.bar === '' && A.side === 'main' && A.nInputs === 7 && await page.evaluate(() => !!document.getElementById('customItemOpenBtn')), A);
    await clickSide(page, 'sep', { force: true });
    const T = await toasts(page);
    check('F2: แตะช่องที่ปิดอยู่ (ต้อง click force) → toast "ยังไม่มีสาขาแยกส่งในตั้งค่า — ระบบไม่สร้างให้" ฟอร์มยังเป็น 02', T.some(t => /สาขา 02 ยังไม่มีสาขาแยกส่งในตั้งค่า — ระบบไม่สร้างให้/.test(t)) && (await form(page)).sel === '02', T);
    check('F2: ไม่เขียนอะไรเลย (ไม่สร้างสาขา/ไม่เขียน settings) และจำนวนสาขาเท่าเดิม', (await wr(page)).length === 0 && await page.evaluate(() => settings.branches.length) === n0);
    // ปุ่มจริงของผู้ใช้ปิดอยู่: Playwright ปกติคลิกไม่ได้เพราะ pointer-events — ยืนยันว่าต้อง force
    const normal = await page.click('#sepSwitch [data-sepside="sep"]', { timeout: 800 }).then(() => 'clicked', () => 'blocked');
    check('F2: (ข้อสังเกต) คลิกปกติโดนบล็อกหรือคลิกได้แต่ไม่ทำอะไร — ไม่ว่าทางไหนฟอร์มยังเป็น 02 และไม่เขียน', (await form(page)).sel === '02' && (await wr(page)).length === 0, normal);
    await page.close();
  }

  // ============ F3: มีแถว T แต่ยังไม่ติ๊กแยกส่ง = ปิด + toast บอก + ไม่เขียน settings ไม่ติ๊กให้ ============
  {
    const { page } = await boot(browser, { add: [mkB('13T', { separate: false })] });
    await openForm(page, '13');
    await resetW(page);
    const A = await form(page);
    check('F3: 13T ยังไม่ติ๊กแยกส่ง → ช่องแยกส่งปิด ข้อความ "ยังไม่ได้ติ๊กแยกส่ง"', A.sw[1].dis && /ยังไม่ได้ติ๊กแยกส่ง/.test(A.sw[1].text), A.sw);
    check('F3: ดรอปดาวน์ยังมี 13T เป็นสาขาเดี่ยว (ไม่ใช่ T คู่ ไม่ถูกซ่อน)', await page.evaluate(() => [...document.querySelectorAll('#branchPick option')].some(o => o.value === '13T')));
    await clickSide(page, 'sep', { force: true });
    const T = await toasts(page);
    check('F3: toast "13T ยังไม่ได้ติ๊กแยกส่งในตั้งค่า — ระบบไม่ติ๊กให้" และไม่สลับ (ยังเป็น 13)', T.some(t => t === '13T ยังไม่ได้ติ๊กแยกส่งในตั้งค่า — ระบบไม่ติ๊กให้') && (await form(page)).sel === '13', T);
    const S = await page.evaluate(() => ({ sep: settings.branches.find(b => b.code === '13T').separate, ex: isFeeExempt('13T'), pair: sepPartnerCode_('13'), hint: sepHint_('13') }));
    check('F3: settings ไม่ถูกเขียน/แก้ (13T ยัง separate=false, isFeeExempt=false) ไม่ถือเป็นคู่', S.sep === false && S.ex === false && S.pair === null && S.hint === 'unticked:13T' && (await wr(page)).length === 0 && !(await wr(page)).some(w => w.key === 'settings'), S);
    await page.close();
  }

  // ============ F4: มีทั้ง 13S และ 13T → สวิตช์ผูก T เท่านั้น; 13S = สาขาเดี่ยวโทนม่วง ไม่มีสวิตช์ ============
  {
    const { page } = await boot(browser, {});
    const G = await page.evaluate(() => ({ m13T: sepMainCode_('13T'), m13S: sepMainCode_('13S'), p13: sepPartnerCode_('13'), p13S: sepPartnerCode_('13S'), g13: orderFormGroup_('13'), g13T: orderFormGroup_('13T'), g13S: orderFormGroup_('13S') }));
    check('F4: sepMainCode_(13T)=13, sepMainCode_(13S)=null, partner(13)=13T (ไม่ใช่ 13S)', G.m13T === '13' && G.m13S === null && G.p13 === '13T' && G.p13S === null, G);
    check('F4: orderFormGroup_: 13 {sep:13T}, 13T {main:13,side:sep}, 13S เดี่ยว {main:13S,sep:null}', G.g13.sep === '13T' && G.g13T.main === '13' && G.g13T.side === 'sep' && G.g13S.main === '13S' && G.g13S.sep === null && G.g13S.side === 'main', G);
    await openForm(page, '13'); await clickSide(page, 'sep');
    check('F4: แตะ แยกส่ง จาก 13 → ได้ 13T (ไม่ใช่ 13S)', (await form(page)).sel === '13T');
    await openForm(page, '13S');
    const S = await form(page);
    check('F4: เปิด 13S → ไม่มีสวิตช์ (ซ่อน) แต่ฟอร์มโทนม่วง ป้าย "กำลังกรอก 13S (แยกส่ง)" ปุ่ม "บันทึกสาขานี้"', S.swHidden && S.side === 'sep' && S.bar === 'กำลังกรอก 13S (แยกส่ง)' && S.save === 'บันทึกสาขานี้' && S.pick === '13S', S);
    await page.close();
  }
  // 13S อย่างเดียว (ไม่มีแถว 13T) = 13S ไม่ใช่ T คู่ → 13 ไม่มีคู่ ช่องแยกส่งปิด "ยังไม่เปิดใช้" (ผูก T เท่านั้น)
  {
    const { page } = await boot(browser, { add: [] });
    await openForm(page, '13');
    const A = await form(page);
    const G = await page.evaluate(() => ({ hint: sepHint_('13'), partner: sepPartnerCode_('13'), m13S: sepMainCode_('13S') }));
    check('F4: มีแต่ 13S (ไม่มี 13T) → 13 ไม่มีคู่: ช่องแยกส่งปิด "ยังไม่เปิดใช้", hint none, 13S ไม่ใช่ T คู่', A.sw[1].dis && /ยังไม่เปิดใช้/.test(A.sw[1].text) && G.hint === 'none' && G.partner === null && G.m13S === null, { sw: A.sw, G });
    await page.close();
  }

  // ============ F5: ร่างค้างต่อรหัส ไม่หายตอนสลับไป-กลับ (รวมสินค้าอื่นๆ) ============
  {
    const { page, dlg } = await boot(browser, {});
    await resetW(page);
    await makeDrafts(page);
    const A = await form(page);
    const D = await page.evaluate(() => ({ keys: Object.keys(orderDraftMem_.drafts), d13: orderDraftMem_.drafts['13'] && { p1: orderDraftMem_.drafts['13'].vals.p1, custom: orderDraftMem_.drafts['13'].custom.map(c => c.name) }, busy: userBusy_() }));
    check('F5: สลับไป 13T → ช่องว่างเริ่มใหม่ (p1 ว่าง) แต่ร่าง 13 ถูกเก็บ (p1=3 + ซอส)', A.sel === '13T' && A.vals.p1 === '' && A.vals.p2 === '1' && D.keys.join() === '13' && D.d13.p1 === '3' && D.d13.custom.join() === 'ซอส', { A: A.vals, D });
    check('F5: userBusy_() จริงเมื่อมีร่างอีกฝั่งค้าง (กัน location.reload/ซิงก์ทิ้งร่าง)', D.busy === true);
    await clickSide(page, 'main');
    const B = await form(page);
    check('F5: สลับกลับ 13 → ตัวเลข p1=3 + สินค้าอื่นๆ "ซอส" กลับมาครบ', B.sel === '13' && B.vals.p1 === '3' && B.custom.join() === 'ซอส' && B.dot, B);
    check('F5: การ์ดรายการ "ซอส" โชว์ในฟอร์มและมีร่าง 13T ค้างอยู่ (p2=1 + น้ำจิ้ม)', await page.evaluate(() => /ซอส/.test(document.getElementById('customItemsSection').textContent) && Object.keys(orderDraftMem_.drafts).join() === '13T' && orderDraftMem_.drafts['13T'].custom.map(c => c.name).join() === 'น้ำจิ้ม'));
    await clickSide(page, 'sep');
    const C = await form(page);
    check('F5: สลับไป 13T อีกครั้ง → p2=1 + "น้ำจิ้ม" ยังอยู่ และ p1 ว่าง', C.sel === '13T' && C.vals.p2 === '1' && C.vals.p1 === '' && C.custom.join() === 'น้ำจิ้ม', C);
    check('F5: สลับไป-กลับหลายรอบไม่เขียนข้อมูลเลย', (await wr(page)).length === 0);
    // บันทึกฝั่งหนึ่ง: ร่างอีกฝั่งคงไว้ + การ์ดเตือน; ไปสาขาถัดไปต้องถามก่อนทิ้ง
    await clickSide(page, 'main');            // 13 (p1=3 + ซอส) ; ร่าง 13T ค้าง
    await page.click('#saveRowBtn');
    await waitSaved(page);
    const S = await page.evaluate(() => ({ warn: [...document.querySelectorAll('#orderSaveState .oss-warn')].map(x => x.textContent), keys: Object.keys(orderDraftMem_.drafts), busy: userBusy_(), custom: (document.getElementById('orderSaveState').innerText.match(/ซอส/g) || []).length }));
    const sd = await storeDay(page);
    check('F5: บันทึก 13 → เขียนเฉพาะ orders["13"] (p1=3 + ซอส) ร่าง 13T ไม่ถูกบันทึกเอง', sd.orders['13'].p1 === 3 && sd.orders['13'].custom.length === 1 && !sd.orders['13T'] && dayW(await wr(page)).length === 1, sd.orders);
    check('F5: การ์ดบันทึกแล้วเตือน "⚠️ 13T ยังมีตัวเลขที่พิมพ์ไว้ ยังไม่บันทึก" + ร่าง 13T ยังอยู่ + userBusy_ จริง', S.warn.some(t => /13T ยังมีตัวเลขที่พิมพ์ไว้ ยังไม่บันทึก/.test(t)) && S.keys.join() === '13T' && S.busy && S.custom >= 1, S);
    await page.click('[data-ossnext]');
    const afterDismiss = await form(page);
    check('F5: → สาขาถัดไป ตอนมีร่างค้าง → ถามยืนยันก่อนทิ้ง (confirm 1 ครั้ง); ยกเลิก = ยังอยู่การ์ดเดิม ไม่เปลี่ยนสาขา', dlg.log.length === 1 && /ยังมีตัวเลขที่พิมพ์ไว้/.test(dlg.log[0].message) && afterDismiss.sel === '13' && afterDismiss.st === 'saved', { afterDismiss, dlg: dlg.log });
    await page.close();
  }
  {
    // ยืนยันทิ้ง: ไปสาขาถัดไป + ล้างร่าง
    const { page, dlg } = await boot(browser, {});
    await makeDrafts(page);
    await clickSide(page, 'main'); await page.click('#saveRowBtn'); await waitSaved(page);
    dlg.mode = 'accept'; dlg.log.length = 0; await resetW(page);
    await page.click('[data-ossnext]');
    const F = await page.evaluate(() => ({ sel: document.getElementById('branchSelect').value, drafts: orderDraftMem_ ? Object.keys(orderDraftMem_.drafts).length : 0, busy: userBusy_() }));
    check('F5: ยืนยันทิ้ง → ไปสาขา 14, ร่าง 13T ถูกล้าง, ไม่เขียนข้อมูลเพิ่ม, userBusy_ กลับเป็นเท็จ', dlg.log.length === 1 && /ยังมีตัวเลขที่พิมพ์ไว้ ยังไม่บันทึก/.test(dlg.log[0].message) && F.sel === '14' && F.drafts === 0 && F.busy === false && (await wr(page)).length === 0, { F, dlg: dlg.log });
    check('F5: 13T ไม่ถูกบันทึกลง storage (ร่างที่ทิ้งไม่หลุดเข้าข้อมูลจริง)', !(await storeDay(page)).orders['13T']);
    await page.close();
  }

  // ============ F6: ร่างถูกล้างตอน: เปลี่ยนวัน / ✎ / ปุ่มล้าง / เปลี่ยนสาขาหลัก / openBranchForm_ / OCR เติมฟอร์ม / ลบออเดอร์ ============
  {
    const base = { store: { ['day:' + TODAY]: mkDay({ orders: { '02': { p1: 1 } } }), ['day:' + OTHER_DAY]: mkDay({ orders: {} }) } };
    const draftState = page => page.evaluate(() => ({ drafts: orderDraftMem_ ? Object.keys(orderDraftMem_.drafts) : [], busy: (document.activeElement && document.activeElement.blur(), userBusy_()) }));
    const cases = [
      ['เปลี่ยนวัน (loadForDate)', async page => { await page.evaluate(d => loadForDate(d), OTHER_DAY); }],
      ['✎ แก้ไขแถวในลิสต์', async page => { await page.click('#orderList [data-edit="02"]'); }],
      ['ปุ่ม "ล้าง"', async page => { await page.click('#clearRowBtn'); }],
      ['เลือกสาขาจากดรอปดาวน์', async page => { await page.selectOption('#branchPick', '05'); }],
      ['แตะสาขาในตาราง (openBranchForm_)', async page => { await page.evaluate(() => openBranchForm_('05')); }],
      ['OCR/ร่าง LINE เติมฟอร์ม', async page => { await page.evaluate(() => fillOrderFormFromParsed_({ branchCode: '05', items: [] }, document.getElementById('orderImageStatus'), false)); }],
    ];
    for (const [label, act] of cases) {
      const { page } = await boot(browser, base);
      await makeDrafts(page);
      const pre = await draftState(page);
      await resetW(page);
      await act(page);
      await page.waitForTimeout(150);
      const post = await draftState(page);
      const writes = await wr(page);
      check(`F6: ร่างค้างหายเมื่อ ${label} (ก่อน: ร่าง 13 ค้าง → หลัง: ไม่มีร่าง, userBusy_ ไม่ค้าง) และไม่เขียนอะไร`, pre.drafts.join() === '13' && post.drafts.length === 0 && writes.length === 0, { pre, post, writes });
      if (label === 'เปลี่ยนวัน (loadForDate)') {
        // "ร่าง 13 แล้วเปลี่ยนวัน ไม่ถูกบันทึกลงวันใหม่"
        await openForm(page, '13');
        const v = await form(page);
        check('F6: ร่าง 13 แล้วเปลี่ยนวัน → เปิด 13 ในวันใหม่ ช่องว่าง ไม่มีสินค้าอื่นๆ ค้าง และวันใหม่/วันเดิมไม่ถูกเขียนด้วยร่าง', v.vals.p1 === '' && v.custom.length === 0 && (await wr(page)).length === 0 && !(await storeDay(page, OTHER_DAY)).orders['13'] && !(await storeDay(page)).orders['13'], v);
        await page.evaluate(d => loadForDate(d), TODAY);
        await openForm(page, '13');
        check('F6: กลับวันเดิม → 13 ว่างเหมือนเดิม ไม่มีร่างผีโผล่', (await form(page)).vals.p1 === '' && (await draftState(page)).drafts.length === 0);
      }
      await page.close();
    }
    // ลบออเดอร์ของรหัสที่มีร่าง: ร่างรหัสนั้นหาย
    const { page, dlg } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 1 }, '02': { p1: 1 } } }) } });
    await makeDrafts(page);
    dlg.mode = 'accept';
    await page.evaluate(() => { document.activeElement.blur(); });
    check('F6: (ก่อนลบ) ร่าง 13 ค้างอยู่', (await draftState(page)).drafts.join() === '13');
    await page.click('#orderList [data-del="13"]');
    await page.waitForFunction(() => !window.__store['day:2026-11-20'].orders['13']);
    check('F6: ลบออเดอร์ 13 → ร่างของ 13 ถูกล้าง (ไม่ค้างให้ userBusy_ ติด)', (await draftState(page)).drafts.length === 0);
    await page.close();
  }

  // ============ F7: OCR/LINE ============
  {
    const { page } = await boot(browser, {});
    await resetW(page);
    // parseOcrText อ่าน "สาขา 13T" ได้แค่ 13 → OCR ไม่เลือกฝั่งแยกส่งให้เอง (ผู้ใช้ต้องแตะสวิตช์เอง)
    const parsed = await page.evaluate(() => parseOcrText('🏪 สาขา 13T ประชาชื่น\nBm9 กุ้งแช่ (กก.) 2 กก.'));
    await page.evaluate(p => fillOrderFormFromParsed_(p, document.getElementById('orderImageStatus'), false), parsed);
    const A = await form(page);
    check('F7: รูปที่อ่านว่า "สาขา 13T" ได้รหัส 13 → เติมฟอร์มฝั่งส่งปกติ (ไม่เลือกแยกส่งให้เอง) p1=2 + ชิป "ยังไม่บันทึก"', parsed.branchCode === '13' && A.sel === '13' && A.side === 'main' && A.vals.p1 === '2' && A.dot, { parsed: parsed.branchCode, A });
    // เรียกตรงด้วย {branchCode:'13T'} (OCR/LINE ที่ส่งรหัส T มาตรงๆ)
    await page.evaluate(() => fillOrderFormFromParsed_({ branchCode: '13T', items: [{ name: 'กุ้งแช่', qty: 3 }], unmatched: [] }, document.getElementById('orderImageStatus'), false));
    const B = await form(page);
    check('F7: fillOrderFormFromParsed_({branchCode:"13T"}) → สวิตช์ไปฝั่งแยกส่ง, #branchSelect=13T, ดรอปดาวน์=13, p1=3, ป้ายคาดขอบ', B.sel === '13T' && B.pick === '13' && B.side === 'sep' && B.sw[1].pressed === 'true' && B.vals.p1 === '3' && B.bar === 'กำลังกรอก 13T (แยกส่ง)', B);
    check('F7: เติมฟอร์มอย่างเดียว ไม่บันทึกเอง (__writes ว่าง, ไม่มีออเดอร์ 13T ใน storage) และชิป ● ยังไม่บันทึกขึ้น', (await wr(page)).length === 0 && !(await storeDay(page)).orders['13T'] && B.dot);
    // ทางร่างออเดอร์จาก LINE (applyLineOrderDraft_ → fillOrderFormFromParsed_(…, true))
    await page.evaluate(() => { lineOrderDrafts_ = [{ id: 'L1', day: '2026-11-20', parsed: { branchCode: '13T', items: [{ name: 'หอยนางรม', qty: 4 }], unmatched: [] }, code: '13T', label: 'x', n: 1 }]; applyLineOrderDraft_('L1', '2026-11-20'); });
    const C = await form(page);
    check('F7: ร่างจาก LINE ที่ระบุ 13T → ฝั่งแยกส่ง p7=4 ไม่บันทึกเอง', C.sel === '13T' && C.side === 'sep' && C.vals.p7 === '4' && (await wr(page)).length === 0, C);
    await page.close();
  }

  // ============ F8: ✎ แถว 13T ในลิสต์ → ฝั่งแยกส่ง ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 1 }, '13T': { p1: 2, p6: 1 } } }) } });
    await page.click('#orderList [data-edit="13T"]');
    const A = await form(page);
    check('F8: แตะ ✎ ที่แถว 13T → ฟอร์มฝั่งแยกส่ง ค่าเดิม p1=2 p6=1 ไม่ dirty', A.sel === '13T' && A.pick === '13' && A.side === 'sep' && A.sw[1].pressed === 'true' && A.vals.p1 === '2' && A.vals.p6 === '1' && !A.dot, A);
    check('F8: ป้ายสวิตช์ฝั่งปกติ/แยกส่งโชว์จำนวนชิ้นของแต่ละฝั่ง (1 ชิ้น / 3 ชิ้น)', A.sw[0].text.includes('1 ชิ้น') && A.sw[1].text.includes('3 ชิ้น'), A.sw);
    await page.click('#orderList [data-edit="13"]');
    const B = await form(page);
    check('F8: แตะ ✎ ที่แถว 13 → กลับฝั่งส่งปกติ', B.sel === '13' && B.side === 'main' && B.vals.p1 === '1', B);
    await page.close();
  }

  // ============ F9: escape รหัส/ชื่อสาขาที่มี HTML ในดรอปดาวน์/สวิตช์/ตาราง/ลิสต์/การ์ดบันทึกแล้ว ============
  {
    const BAD = '"><img src=x onerror="window.__xss=1">';
    const { page } = await boot(browser, { add: [mkB('13T', { label: '<b id="inj2">T</b>"<img src=x onerror="window.__xss=2">' }), { code: BAD, area: '<img src=x onerror="window.__xss=3">', separate: false }], store: { ['day:' + TODAY]: mkDay({ orders: { [BAD]: { p1: 1 } } }) } });
    await page.evaluate(() => { window.__xss = 0; });
    await page.evaluate(b => { refreshOrderTab(); renderBranchGrid_(); openBranchForm_(b); }, BAD);
    const X = await page.evaluate(b => ({
      optVal: [...document.getElementById('branchSelect').options].some(o => o.value === b), pickVal: [...document.getElementById('branchPick').options].some(o => o.value === b),
      imgs: document.querySelectorAll('#branchPick img, #branchSelect img, #sepSwitch img, #branchGrid img, #orderList img, #orderFormCard img').length, inj: !!document.querySelector('#inj2'),
      chip: [...document.querySelectorAll('#branchGrid [data-bgcode]')].some(c => c.getAttribute('data-bgcode') === b), edit: [...document.querySelectorAll('#orderList [data-edit]')].some(c => c.getAttribute('data-edit') === b),
      del: [...document.querySelectorAll('#orderList [data-del]')].some(c => c.getAttribute('data-del') === b), sel: document.getElementById('branchSelect').value === b, xss: window.__xss,
    }), BAD);
    check('F9: รหัส/ชื่อที่มี "><img onerror> → ไม่เกิด <img>/<b> ใน ดรอปดาวน์/ตาราง/ลิสต์/ฟอร์ม และสคริปต์ไม่รัน', X.imgs === 0 && !X.inj && X.xss === 0, X);
    check('F9: แต่ค่ารหัสดิบยังครบในแอตทริบิวต์ (option value, data-bgcode, data-edit, data-del) และเปิดฟอร์มรหัสนั้นได้', X.optVal && X.pickVal && X.chip && X.edit && X.del && X.sel, X);
    // การ์ดบันทึกแล้ว: รหัสและชื่อสินค้าอื่นๆ ที่มี HTML
    await page.evaluate(() => { customItemsStaged.push({ name: '<img src=x onerror="window.__xss=4">ซอส', qty: 1, price: 5 }); renderCustomItemsSection_(); onOrderFormChanged_(); });
    await fillP(page, 'p1', 2);
    await page.click('#saveRowBtn');
    await waitSaved(page);
    const Y = await page.evaluate(() => ({ imgs: document.querySelectorAll('#orderSaveState img, #orderFormCard img, #orderList img').length, xss: window.__xss, text: document.getElementById('orderSaveState').textContent, next: [...document.querySelectorAll('[data-ossnext]')].map(b => b.getAttribute('data-ossnext')) }));
    check('F9: การ์ดบันทึกแล้ว (รหัส + ชื่อสินค้าอื่นๆ ที่มี <img>) ไม่ฉีด HTML และแสดงเป็นข้อความ', Y.imgs === 0 && Y.xss === 0 && /<img src=x/.test(Y.text), Y);
    const w = dayW(await wr(page));
    check('F9: เขียน patchField ด้วย path ["orders", รหัสดิบ] (ไม่ถูก escape ในข้อมูลจริง)', w.length >= 1 && w[0].op === 'patchField' && w[0].path[1] === BAD, w.map(x => x.path));
    await page.close();
  }

  // ============ F10: ซิงก์ 60 วินาที หลังแตะสวิตช์ไป 13T ว่าง → สาขา/ตัวเลขไม่เด้ง ============
  {
    const { page } = await boot(browser, {});
    await openForm(page, '13'); await clickSide(page, 'sep');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    check('F10: ที่ 13T ว่าง ไม่โฟกัส → userBusy_ เป็นเท็จ (ซิงก์วาดได้จริง)', await page.evaluate(() => userBusy_()) === false);
    await page.evaluate(() => { window.__store['day:2026-11-20'].orders['05'] = { p2: 1 }; window.__toasts.length = 0; });
    await page.evaluate(async () => { await syncFromOtherDevices_(); });
    const A = await form(page);
    check('F10: ซิงก์วาดใหม่จริง (เห็น 05 + toast) แต่ยังอยู่ที่ 13T ฝั่งแยกส่ง ไม่เด้งไปสาขาแรก (00)', await page.evaluate(() => !!dayData.orders['05']) && (await toasts(page)).some(t => /อัปเดตข้อมูลจากเครื่องอื่นแล้ว/.test(t)) && A.sel === '13T' && A.pick === '13' && A.side === 'sep', A);
    // พิมพ์ค้างแล้วเอาโฟกัสออก → dirty บล็อกซิงก์ ตัวเลขไม่เด้ง
    await page.evaluate(() => setCardFoldByH3('บันทึกออเดอร์ทีละสาขา', false)); // วาดใหม่หลังซิงก์พับฟอร์มตามกติกาเดิมเมื่อวันมีออเดอร์ (updateOrderFormAutoFold) — กางกลับก่อนพิมพ์
    await fillP(page, 'p2', 4);
    await page.evaluate(() => { document.activeElement.blur(); window.__store['day:2026-11-20'].orders['06'] = { p3: 1 }; window.__toasts.length = 0; });
    await page.evaluate(async () => { await syncFromOtherDevices_(); });
    const B = await form(page);
    check('F10: ตัวเลขที่พิมพ์ค้างใน 13T (p2=4) ไม่ถูกซิงก์ทับ (บล็อกด้วย dirty) ไม่มี toast วาดใหม่ และยังเป็น 13T', B.vals.p2 === '4' && B.sel === '13T' && !(await toasts(page)).some(t => /อัปเดตข้อมูลจากเครื่องอื่นแล้ว/.test(t)) && await page.evaluate(() => !dayData.orders['06']), B);
    check('F10: ซิงก์ทั้งสองรอบไม่เขียนข้อมูลอะไรเลย', (await wr(page)).filter(w => !/^dayRevs$/.test(w.key)).length === 0);
    await page.close();
  }

  // ============ F11: findNextUnrecordedBranch ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '13T': { p1: 1 }, '14': { p1: 1 } } }) } });
    const N = await page.evaluate(() => {
      const r = { fromT: findNextUnrecordedBranch('13T'), from12: findNextUnrecordedBranch('12'), from13: findNextUnrecordedBranch('13') };
      const all = settings.branches.map(b => findNextUnrecordedBranch(b.code));
      r.neverT = all.every(c => c !== '13T');
      settings.branches.find(b => b.code === '16').rare = true;
      r.skipRare = findNextUnrecordedBranch('13T');
      return r;
    });
    check('F11: findNextUnrecordedBranch("13T") = สาขาถัดจาก 13 (ข้าม 14 ที่บันทึกแล้ว → 16) ไม่ใช่ต้นลิสต์ 00', N.fromT === '16', N);
    check('F11: "บันทึกแล้ว" = สาขาหลักมีออเดอร์ — 13T มีออเดอร์ แต่ 13 ยังไม่ → ต่อจาก 12 ได้ 13', N.from12 === '13' && N.from13 === '16', N);
    check('F11: ไม่เคยคืนรหัส T คู่ และข้ามสาขา "นานๆ สั่งที" (16 rare → 17)', N.neverT && N.skipRare === '17', N);
    await page.close();
  }

  // ============ F12: T เดี่ยว (19T ไม่มี 19) = ไม่มีสวิตช์ ฟอร์มโทนม่วงอย่างเดียว ============
  {
    const { page } = await boot(browser, { add: [mkB('19T')], remove: ['19'] });
    await openForm(page, '19T');
    const A = await form(page);
    check('F12: 19T ไม่มีสาขา 19 → ไม่มีสวิตช์ (ซ่อน) แต่ฟอร์มโทนม่วง ป้าย "กำลังกรอก 19T (แยกส่ง)" ปุ่ม "บันทึกสาขานี้"', A.swHidden && A.side === 'sep' && A.bar === 'กำลังกรอก 19T (แยกส่ง)' && A.save === 'บันทึกสาขานี้' && A.pick === '19T', A);
    await fillP(page, 'p1', 1); await resetW(page);
    await page.click('#saveRowBtn'); await waitSaved(page);
    const w = dayW(await wr(page));
    check('F12: บันทึก 19T → patchField ["orders","19T"] รหัสเดียว', w.length === 1 && JSON.stringify(w[0].path) === '["orders","19T"]', w);
    await page.close();
  }

  // ============ F13: 01 / 1 / 1T จับคู่ตัวแรกเสมอ เท่ากันสองทาง ============
  {
    const { page } = await boot(browser, { add: [{ code: '1', area: 'ทดสอบหนึ่ง' }, mkB('1T')] });
    const G = await page.evaluate(() => ({ g01: orderFormGroup_('01'), g1T: orderFormGroup_('1T'), g1: orderFormGroup_('1'), m1T: sepMainCode_('1T'), h1: sepHint_('1'), pick: [...document.querySelectorAll('#branchPick option')].map(o => o.value) }));
    check('F13: 01 กับ 1T จับคู่กัน (สองทางเท่ากัน), 1 ไม่แย่งคู่ (เดี่ยว ไม่เปิดใช้)', G.g01.sep === '1T' && G.g1T.main === '01' && G.m1T === '01' && G.g1.sep === null && G.h1 === 'none', G);
    check('F13: ดรอปดาวน์สาขาหลักมีทั้ง 01 และ 1 แต่ไม่มี 1T', G.pick.includes('01') && G.pick.includes('1') && !G.pick.includes('1T'), G.pick);
    await openForm(page, '01'); await clickSide(page, 'sep');
    const A = await form(page);
    await clickSide(page, 'main');
    const B = await form(page);
    await openForm(page, '1');
    const C = await form(page);
    check('F13: 01 → แยกส่ง = 1T, แตะปกติกลับ 01 (ไม่ใช่ 1) ; เปิด 1 → ช่องแยกส่งปิด', A.sel === '1T' && A.pick === '01' && B.sel === '01' && C.sel === '1' && C.sw[1].dis, { A: A.sel, B: B.sel, C: C.sel });
    await page.close();
  }

  // ============ F14: ดรอปดาวน์กลุ่ม "นานๆ สั่งที" ตามสาขาหลัก + ✓ ============
  {
    const { page } = await boot(browser, { patch: { '25': { rare: true }, '13': { rare: true } }, store: { ['day:' + TODAY]: mkDay({ orders: { '25': { p1: 1 } } }) } });
    const P = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#branchPick optgroup')].map(g => ({ label: g.label, opts: [...g.querySelectorAll('option')].map(o => o.value) })), check25: /✓/.test([...document.querySelectorAll('#branchPick option')].find(o => o.value === '25').textContent) }));
    check('F14: สาขาหลักที่ติ๊ก "นานๆ สั่งที" (13, 25) อยู่ใน optgroup เดียว และ 13T ไม่โผล่ในดรอปดาวน์เลย', P.groups.length === 1 && P.groups[0].label === 'นานๆ สั่งที' && P.groups[0].opts.includes('13') && P.groups[0].opts.includes('25') && !P.groups[0].opts.includes('13T'), P);
    check('F14: ✓ ที่สาขาหลักที่มีออเดอร์ (25)', P.check25);
    await page.close();
  }

  // ============ F15: ไม่ล้นจอ 420px ทุกธีม/โหมด ทั้งฝั่งปกติ ฝั่งแยกส่ง และสวิตช์ปิด ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '13': { p1: 2 }, '13T': { p6: 1 } } }) } });
    const res = {};
    for (const [th, mode] of [['', ''], ['mermaid', 'full'], ['mermaid', 'color'], ['sea', 'full'], ['sea', 'color'], ['neon', 'full'], ['neon', 'color']]) {
      await setTheme(page, th, mode || 'full');
      for (const [lbl, code] of [['main', '13'], ['sep', '13T'], ['none', '02'], ['solo', '13S']]) {
        await openForm(page, code);
        await page.waitForTimeout(60);
        const m = await page.evaluate(() => { const r = document.getElementById('orderFormCard').getBoundingClientRect(); return { ov: document.documentElement.scrollWidth <= innerWidth, inView: r.left >= 0 && r.right <= innerWidth, btns: [...document.querySelectorAll('#sepSwitch .seg')].every(b => { const x = b.getBoundingClientRect(); return x.left >= 0 && x.right <= innerWidth; }) }; });
        res[(th || 'macaron') + (mode ? '/' + mode : '') + ':' + lbl] = m.ov && m.inView && m.btns;
      }
    }
    check('F15: ฟอร์ม+สวิตช์ ไม่ล้นจอ 420px ทุกธีม/โหมด × (ปกติ / แยกส่ง / ไม่มีคู่ / เดี่ยว 13S)', Object.values(res).every(Boolean), Object.entries(res).filter(([, v]) => !v));
    await page.close();
  }

  // ============ F17: หัวตรึง (#dwhStickyWrap) → --stick-h จริง + scroll-margin-top ของฟอร์ม: หลังแตะปุ่มสาขา 13T ป้ายคาดขอบไม่อยู่ใต้หัวตรึง (420px) ============
  {
    const { page } = await boot(browser, { viewport: { width: 420, height: 844 }, store: { ['day:' + TODAY]: mkDay({ orders: { '01': { p1: 1 } } }) } });
    const waitVar = () => page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--stick-h').trim() === Math.round(document.getElementById('dwhStickyWrap').getBoundingClientRect().height) + 'px', null, { timeout: 5000 });
    const gridTo = n => page.evaluate(n => { const el = document.getElementById('branchGrid'); el.scrollTo({ left: n ? el.scrollWidth : 0, behavior: 'instant' }); }, n);
    const measure = () => page.evaluate(() => {
      const wrap = document.getElementById('dwhStickyWrap'), w = wrap.getBoundingClientRect(), bar = document.getElementById('orderSideBar'), card = document.getElementById('orderFormCard');
      return { stickVar: getComputedStyle(document.documentElement).getPropertyValue('--stick-h').trim(), wrapH: Math.round(w.height), wrapBottom: w.bottom, pos: getComputedStyle(wrap).position, smt: parseFloat(getComputedStyle(card).scrollMarginTop), side: card.dataset.side,
        barTop: bar.getBoundingClientRect().top, barOk: getComputedStyle(bar).display !== 'none' && bar.getBoundingClientRect().height > 0, cardTop: card.getBoundingClientRect().top, sel: document.getElementById('branchSelect').value, scrollY: Math.round(scrollY) };
    });
    // รอให้เลย์เอาต์นิ่งก่อนแตะ (การ์ดอ่านรูปพับด้วยแอนิเมชัน/การ์ดข้อความวาดทีหลัง ทำให้ตำแหน่งการ์ดฟอร์มขยับระหว่างที่จอเลื่อน) — ผู้ใช้จริงไม่แตะภายในเสี้ยววินาทีแรกของการวาด
    const settleLayout = () => page.evaluate(() => new Promise(res => { let last = '', n = 0; const tick = () => { const c = document.getElementById('orderFormCard').getBoundingClientRect(); const sig = Math.round(c.top + scrollY) + '|' + document.documentElement.scrollHeight + '|' + Math.round(document.getElementById('dwhStickyWrap').getBoundingClientRect().height); if (sig === last) { if (++n >= 12) return res(); } else n = 0; last = sig; requestAnimationFrame(tick); }; tick(); }));
    const tap = async (n, code) => { await page.evaluate(() => window.scrollTo(0, 0)); await gridTo(n); await settleLayout(); await page.click(`#branchGrid [data-bgcode="${code}"]`); await settleScroll(page); await settleLayout(); return measure(); };
    const heights = {}, bad = [];
    for (const [th, mode] of [['', ''], ['mermaid', 'full'], ['sea', 'full'], ['sea', 'color'], ['neon', 'full']]) {
      const key = (th || 'macaron') + (mode ? '/' + mode : '');
      await setTheme(page, th, mode || 'full');
      await waitVar();
      const sep = await tap(1, '13T');
      const main = await tap(0, '13');
      heights[key] = sep.wrapH;
      const okSep = sep.sel === '13T' && sep.side === 'sep' && sep.stickVar === sep.wrapH + 'px' && sep.smt === sep.wrapH + 34 && sep.barOk && sep.barTop >= sep.wrapBottom - 0.5 && ['sticky', 'fixed'].includes(sep.pos);
      const okMain = main.sel === '13' && main.side === 'main' && main.smt === main.wrapH + 12 && main.cardTop >= main.wrapBottom - 0.5;
      if (!okSep || !okMain) bad.push({ key, sep, main });
      if (key === 'macaron' || key === 'sea/full') { await tap(1, '13T'); await page.screenshot({ path: path.join(SHOT_DIR, `sticky-sep-${th || 'macaron'}.png`) }).catch(() => {}); }
    }
    check('F17: ทุกธีม/โหมด (macaron, mermaid, sea full/color, neon) ที่ 420px: --stick-h = ความสูง #dwhStickyWrap จริง, scroll-margin-top การ์ด = stick+12 (ปกติ) / stick+34 (แยกส่ง), หลังแตะ 13T ป้ายคาดขอบ "กำลังกรอก 13T" อยู่ใต้ขอบล่างหัวตรึง และหลังแตะ 13 หัวการ์ดก็พ้นหัวตรึง', bad.length === 0, bad.slice(0, 2));
    check('F17: ค่าวัดจริงตามธีม ไม่ใช่ค่าตายตัว: sea ต่างจาก macaron > 20px และ macaron ≠ ค่าสำรอง 130px', heights['sea/full'] - heights['macaron'] > 20 && heights['macaron'] !== 130, heights);
    // ย่อ/ขยายหัว (statbar-compact) → ResizeObserver ปรับ --stick-h ตามจริง
    await setTheme(page, '');
    await waitVar();
    const before = (await measure()).wrapH;
    await page.evaluate(() => toggleStatBar());
    await waitVar();
    const after = await measure();
    check('F17: ย่อหัว (toggleStatBar) → --stick-h ตามความสูงใหม่ทันที (ResizeObserver) และ scroll-margin-top ตาม', after.wrapH !== before && after.stickVar === after.wrapH + 'px' && after.smt === after.wrapH + (after.side === 'sep' ? 34 : 12), { before, after });
    await page.evaluate(() => toggleStatBar());
    await waitVar();
    // ตัวควบคุม: ถ้า scroll-margin-top เป็น 0 (ไม่เผื่อหัวตรึง) การวัดนี้ต้องจับได้ว่าป้ายถูกหัวบัง — พิสูจน์ว่าเทสไวพอ
    await setTheme(page, 'sea', 'full'); await waitVar();
    await page.addStyleTag({ content: '#orderFormCard,#orderFormCard[data-side="sep"]{scroll-margin-top:0!important;}' });
    const ctl = await tap(1, '13T');
    check('F17: (ตัวควบคุม) ปิด scroll-margin-top → ป้ายคาดขอบถูกหัวตรึงบังจริง (barTop < ขอบล่างหัว) — การวัดจับได้', ctl.barTop < ctl.wrapBottom, ctl);
    await page.close();
  }

  // ============ F16: Brand fee + ข้อมูลทั้งชุดเทส ไม่มีเขียนที่ไม่ควรเกิด ============
  {
    const { page } = await boot(browser, { store: { ['day:' + TODAY]: mkDay({ orders: { '02': { p1: 1 }, '13': { p1: 2 }, '13T': { p1: 5, p2: 3 }, '13S': { p1: 4 } } }) } });
    const f0 = await feeAll(page);
    const b0 = await page.evaluate(() => JSON.stringify(settings.branches));
    await openForm(page, '13'); await clickSide(page, 'sep'); await clickSide(page, 'main'); await openForm(page, '13S'); await openForm(page, '02'); await page.evaluate(() => refreshOrderTab());
    const f1 = await feeAll(page);
    check('F16: Brand fee ทุกวัน ก่อน = หลังเปิด/สลับฟอร์ม เป๊ะ (T/13S ไม่เข้าสูตร: p1 = 02+13 = 3, p2 = 0)', JSON.stringify(f0) === JSON.stringify(f1) && f0['day:' + TODAY].p1 === 3 && f0['day:' + TODAY].p2 === 0, { f0, f1 });
    check('F16: การเปิด/สลับฟอร์ม ไม่เขียน/ไม่แก้ settings และ isFeeExempt ของทุกสาขาเท่าเดิม', (await wr(page)).length === 0 && await page.evaluate(() => JSON.stringify(settings.branches)) === b0);
    await page.close();
  }

  await finish(browser);
})();
