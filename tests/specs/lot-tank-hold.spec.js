const path = require('path');
const fs = require('fs');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// การ์ด "ตัดต้นทุนสต็อกล็อต": ภาพถังล็อต (อ่านอย่างเดียว ตัวเลขจาก rawLots จริง) + ปุ่มกดค้าง 1 วินาที
// กฎเหล็ก: ระบบห้ามตัดต้นทุนเอง — เรนเดอร์/แตะสั้น/click/ปล่อยก่อนครบ ต้องไม่มีการเขียนใดๆ ตัดได้ทางเดียวคือค้างครบ 1 วิ
const TODAY = '2026-11-12';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');

function seedLots(){
  return [
    { id: 'L1', productId: 'p4', seller: 'ตลาด', buyDate: '2026-11-01', qtyTotal: 100, pricePerKg: 200, billId: 'B1', draws: [
      { id: 'D1', date: '2026-11-10', qtyUsed: 12, sellableQty: 12, totalCost: 2400, costedQty: 6, claimedQty: 1 },   // ค้าง 5
      { id: 'D2', date: TODAY,        qtyUsed: 8,  sellableQty: 8,  totalCost: 1600, costedQty: 0, claimedQty: 0 },   // รอบใหม่ ค้าง 8
      { id: 'D3', date: '2026-11-13', qtyUsed: 20, sellableQty: 20, totalCost: 4000, costedQty: 0, claimedQty: 0 },   // วันหลัง currentDate — ไม่นับ
      { id: 'D4', date: '2026-11-02', qtyUsed: 30, sellableQty: 30, totalCost: 6000 },                                 // รอบเก่าไม่มี costedQty — ไม่นับ
      { id: 'D5', date: '2026-11-05', qtyUsed: 4,  sellableQty: 4,  totalCost: 800,  costedQty: 4, claimedQty: 0 },   // ตัดครบแล้ว — ไม่นับ
    ] },
    { id: 'L2', productId: 'p4', seller: 'แพปลา', buyDate: '2026-11-03', qtyTotal: 50, pricePerKg: 210, billId: 'B2', draws: [
      { id: 'D6', date: '2026-11-11', qtyUsed: 3.5, sellableQty: 3.5, totalCost: 735, costedQty: 1, claimedQty: 0.5 }, // ค้าง 2
    ] },
    { id: 'L3', productId: 'p7', seller: 'มนต์', buyDate: '2026-11-08', qtyTotal: 10, pricePerKg: 200, billId: 'B3', draws: [
      { id: 'D7', date: TODAY, qtyUsed: 2, sellableQty: 10, totalCost: 400, costedQty: 0, claimedQty: 0 },             // กระปุก ค้าง 10
    ] },
    { id: 'L4', productId: 'p1', seller: 'มนต์', buyDate: '2026-11-08', qtyTotal: 5, pricePerKg: 250, billId: 'B4', draws: [
      { id: 'D8', date: '2026-11-11', qtyUsed: 0.8, sellableQty: 0.8, totalCost: 200, costedQty: 0.2, claimedQty: 0.1 }, // sellable<1 ค้าง 0.5
    ] },
  ];
}
function seedStore(extra){
  return Object.assign({
    ['day:' + TODAY]: mkDay({ orders: { '01': { p4: 40, p7: 30, p1: 5 } }, leftoverOut: { p4: 10, p7: 10, p1: 0.5 } }),
    ['day:2026-11-11']: mkDay({}),
    rawLots: seedLots(),
  }, extra || {});
}

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  let fakeNow = new Date(TODAY + 'T10:00:00+07:00').getTime();

  async function open(extraStore){
    const page = await openApp(browser, { store: seedStore(extraStore), date: TODAY });
    await page.clock.setFixedTime(new Date(fakeNow));
    await page.evaluate(async () => {
      window.__toasts = [];
      const orig = window.showToast;
      window.showToast = m => { window.__toasts.push(String(m)); return orig(m); };
      window.__savedEvts = [];
      window.addEventListener('karmto-saved', e => { window.__savedEvts.push(e.detail || {}); });
      window.confirm = () => { window.__confirmAsked = (window.__confirmAsked || 0) + 1; return window.__confirmAnswer !== false; };
      rawLotsCache_ = null;
      await loadClosedMonths_();
      await switchTab('purchase');
    });
    await stripBanner(page);
    return page;
  }
  // นาฬิกาถูกตรึง (Date.now ไม่เดิน แต่ setTimeout เดินจริง) — ขยับเวลาเองระหว่างเคส กันธงเวลา (hint/fired) ของเคสก่อนมากลบเคสถัดไป
  const tick = async (page, ms = 5000) => { fakeNow += ms; await page.clock.setFixedTime(new Date(fakeNow)); };
  const reset = page => page.evaluate(() => { window.__writes = []; window.__toasts = []; window.__savedEvts = []; window.__confirmAsked = 0; });
  const state = page => page.evaluate((today) => {
    const lots = window.__store.rawLots;
    const dr = {};
    lots.forEach(l => (l.draws || []).forEach(d => { dr[d.id] = d.costedQty; }));
    const pu = (window.__store['day:' + today].purchases || []).map(e => ({ productId: e.productId, qty: e.qty, sellableQty: e.sellableQty, lotSettle: !!e.lotSettle, alloc: e.lotSettleAllocations }));
    const sum = Object.values(dr).reduce((s, v) => s + Number(v || 0), 0);
    return { dr, pu, costedSum: Math.round(sum * 100) / 100, writes: window.__writes.map(w => w.op + ':' + w.key), toasts: window.__toasts.slice(), saved: window.__savedEvts.filter(d => d.op === 'lotHold').length,
      hold: !!lotHold_, busy: lotHoldBusy_, inflight: lotSettleInFlight_ };
  }, TODAY);
  const moneyWrites = st => st.writes.filter(w => /rawLots|^[a-zA-Z]+:day:/.test(w));
  const btnSel = pid => `[data-lotsettleconfirm="${pid}"]`;
  const inpSel = pid => `[data-lotsettleqty="${pid}"]`;
  const center = async (page, pid) => {
    await page.evaluate(sel => document.querySelector(sel).scrollIntoView({ block: 'center' }), btnSel(pid));
    const b = await page.locator(btnSel(pid)).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const setQty = async (page, pid, v) => { await page.fill(inpSel(pid), String(v)); };
  const label = (page, pid) => page.evaluate(sel => document.querySelector(sel + ' [data-lotholdlabel]').textContent, btnSel(pid));
  const idle = page => page.waitForFunction(() => !lotHoldBusy_ && !lotSettleInFlight_ && !lotHold_, null, { timeout: 15000 });
  // กดค้างด้วยเมาส์จริง ms มิลลิวินาที แล้วปล่อย
  const mouseHold = async (page, pid, ms) => {
    const c = await center(page, pid);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };

  // ============ A) ตัวเลขถัง + เรนเดอร์ไม่เขียน ============
  let page = await open();
  await reset(page);
  const before = JSON.stringify(await page.evaluate(() => window.__store.rawLots));

  const tank = await page.evaluate(async (today) => {
    const lots = await loadRawLots();
    const out = {};
    for (const pid of ['p4', 'p7', 'p1']) {
      const t = lotTankStats_(pid, lots, today);
      const pend = await lotPendingStock_(pid, lots, today);
      out[pid] = { t, pendQty: pend.qty, items: pend.items.map(i => i.drawId) };
    }
    out.allDates = lotTankStats_('p4', lots, '2026-12-31').sellable;
    return out;
  }, TODAY);
  check('ถัง p4: ขายได้/ตัดแล้ว/เคลม/รอตัด = ผลรวมจากรอบเบิกที่ยังค้างใน rawLots (23.5 / 7 / 1.5 / 15)',
    tank.p4.t.sellable === 23.5 && tank.p4.t.costed === 7 && tank.p4.t.claimed === 1.5 && tank.p4.t.pend === 15, tank.p4.t);
  check('ถัง: pend ตรงกับ lotPendingStock_ ทุกสินค้า',
    tank.p4.t.pend === tank.p4.pendQty && tank.p7.t.pend === tank.p7.pendQty && tank.p1.t.pend === tank.p1.pendQty,
    { p4: [tank.p4.t.pend, tank.p4.pendQty], p7: [tank.p7.t.pend, tank.p7.pendQty], p1: [tank.p1.t.pend, tank.p1.pendQty] });
  const drawIds = tank.p4.t.draws.map(d => d.id);
  check('ถัง: รอบเบิกวันหลัง currentDate (D3) / ไม่มี costedQty (D4) / ตัดครบแล้ว (D5) ไม่ถูกนับ',
    JSON.stringify(drawIds) === '["D1","D6","D2"]' && JSON.stringify(tank.p4.items) === '["D1","D6","D2"]', drawIds);
  check('ถัง: ถ้าไม่จำกัดวัน รอบวันหลังจึงค่อยถูกนับ (ยืนยันว่าตัวกรองวันทำงานจริง)', tank.allDates === 43.5, tank.allDates);

  const dom = await page.evaluate(() => {
    const row = document.querySelector('[data-lottanktoggle="p4"]').closest('.lot-row');
    const tk = row.querySelector('.lot-tank');
    const g = sel => { const el = tk.querySelector(sel); return el ? Number(el.style.flexGrow) : null; };
    const over = tk.querySelector('.lt-over');
    return {
      legend: row.querySelector('.lot-legend').textContent,
      cost: g('.lt-cost'), pend: g('.lt-pend'), claim: g('.lt-claim'), over: over ? over.style.height : null,
      draws: Array.from(row.querySelectorAll('[data-lottankdraws] > div')).map(d => d.textContent),
      drawsShown: getComputedStyle(row.querySelector('[data-lottankdraws]')).display !== 'none',
      expanded: tk.getAttribute('aria-expanded'), aria: tk.getAttribute('aria-label'),
      rowVisible: !!row.offsetParent, inputVal: row.querySelector('[data-lotsettleqty]').value,
      btnLabel: row.querySelector('[data-lotholdlabel]').textContent,
      txt: row.querySelector('.lot-row-txt').textContent,
    };
  });
  check('การ์ด: legend แสดงตัวเลขถังตรงข้อมูล + ป้าย "เฉพาะรอบที่ยังค้างตัด"',
    dom.legend.includes('ขายได้ 23.5 กก.') && dom.legend.includes('ตัดแล้ว 7') && dom.legend.includes('รอตัด 15') && dom.legend.includes('เคลม 1.5') && dom.legend.includes('เฉพาะรอบที่ยังค้างตัด'), dom.legend);
  check('การ์ด: ชั้นในถังเป็นสัดส่วนต่อขายได้ (ตัดแล้ว 29.79 / รอตัด 63.83 / เคลม 6.38)', dom.cost === 29.79 && dom.pend === 63.83 && dom.claim === 6.38, dom);
  check('การ์ด: ส่วน "ขายออกแล้วยังไม่ตัด" ในแถบรอตัด = 5/15 (33.33%)', dom.over === '33.33%' && dom.txt.includes('ขายออกไปแล้วแต่ยังไม่ตัดต้นทุนอีก 5'), { over: dom.over, txt: dom.txt });
  check('การ์ด: รายการรอบเบิกมี 3 รอบที่ค้าง (10/11, 11/11, 12/11) ไม่มี 13/11 และ 02/11 — เริ่มต้นพับอยู่',
    dom.draws.length === 3 && dom.draws[0].includes('เบิก 10/11') && dom.draws[0].includes('ขายได้ 12 · ตัดแล้ว 6 · รอ 5 กก.') && dom.draws[0].includes('เคลม 1')
    && dom.draws[1].includes('เบิก 11/11') && dom.draws[2].includes('เบิก 12/11') && dom.draws[2].includes('ขายได้ 8 · ตัดแล้ว 0 · รอ 8 กก.')
    && !dom.draws.join('|').includes('13/11') && !dom.draws.join('|').includes('02/11') && dom.drawsShown === false && dom.expanded === 'false', dom.draws);
  check('การ์ด: แถวมองเห็นได้ ช่องจำนวนเป็นค่าแนะนำ (ไม่เกินค้าง 15) และป้ายปุ่มบอกจำนวน+หน่วย', dom.rowVisible && dom.inputVal === '15' && dom.btnLabel === 'กดค้างเพื่อตัด 15 กก.', { v: dom.inputVal, l: dom.btnLabel });

  await page.click('[data-lottanktoggle="p4"]');
  const opened = await page.evaluate(() => { const tk = document.querySelector('[data-lottanktoggle="p4"]'); return { e: tk.getAttribute('aria-expanded'), shown: getComputedStyle(tk.closest('.lot-row').querySelector('[data-lottankdraws]')).display !== 'none' }; });
  check('แตะถัง → กางรายการรอบเบิก (aria-expanded=true)', opened.e === 'true' && opened.shown, opened);

  // ถัง sellable<1 ต้องเต็มสัดส่วน
  const small = await page.evaluate(() => {
    const tk = document.querySelector('[data-lottanktoggle="p1"]');
    const kids = Array.from(tk.children);
    const grow = kids.reduce((s, k) => s + Number(k.style.flexGrow || 0), 0);
    const h = kids.reduce((s, k) => s + k.getBoundingClientRect().height, 0);
    return { grow: Math.round(grow * 100) / 100, h: Math.round(h * 10) / 10, inner: tk.clientHeight, legend: tk.closest('.lot-row').querySelector('.lot-legend').textContent };
  });
  check('ถัง sellable<1 (0.8): ชั้นรวมกันเต็มถังตามสัดส่วน ไม่เหลือที่ว่าง', small.grow === 100 && Math.abs(small.h - small.inner) <= 1.5 && small.legend.includes('ขายได้ 0.8') && small.legend.includes('รอตัด 0.5'), small);

  await page.evaluate(async () => { await renderLotSettleCards_(); await renderLotSettleCards_(); });
  let st = await state(page);
  const after = JSON.stringify(await page.evaluate(() => window.__store.rawLots));
  check('เรนเดอร์การ์ด/แตะถัง: ไม่มีการเขียนใดๆ เลย', st.writes.length === 0, st.writes);
  check('เรนเดอร์การ์ด: rawLots ไม่เปลี่ยน รอบใหม่ (D2, D7) ยัง costedQty 0 และไม่มีรายการต้นทุนซื้อ', after === before && st.dr.D2 === 0 && st.dr.D7 === 0 && st.pu.length === 0, { D2: st.dr.D2, D7: st.dr.D7, pu: st.pu.length });
  check('หลังเรนเดอร์ใหม่ ถังยังกางค้างตามเดิม (จำสถานะในหน่วยความจำ)', await page.evaluate(() => document.querySelector('[data-lottanktoggle="p4"]').getAttribute('aria-expanded') === 'true'));

  // screenshot 420px (ธีมปกติ + neon) + ไม่ล้นจอ
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.locator('#lotSettleCards').screenshot({ path: path.join(SHOT_DIR, 'lot-tank-hold-420-macaron.png') });
  const ovf1 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.evaluate(() => applyTheme_('neon', 'full'));
  await page.waitForTimeout(300);
  await page.locator('#lotSettleCards').screenshot({ path: path.join(SHOT_DIR, 'lot-tank-hold-420-neon.png') });
  const ovf2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.evaluate(() => applyTheme_('', ''));
  check('จอ 420px: การ์ดไม่ล้นจอ (ธีมปกติ + neon)', ovf1 && ovf2, { macaron: ovf1, neon: ovf2 });
  const touchSize = await page.evaluate(() => { const r = document.querySelector('[data-lotsettleconfirm="p4"]').getBoundingClientRect(); return { h: r.height, w: r.width }; });
  check('ปุ่มกดค้างสูงอย่างน้อย 44px', touchSize.h >= 44, touchSize);

  // ============ B) แตะสั้น / click / ปล่อยก่อนครบ → ไม่ตัด ============
  await setQty(page, 'p4', 3);
  check('ป้ายปุ่มอ่านค่าสดจากช่อง ("กดค้างเพื่อตัด 3 กก.")', await label(page, 'p4') === 'กดค้างเพื่อตัด 3 กก.', await label(page, 'p4'));

  await tick(page); await reset(page);
  await page.evaluate(sel => document.querySelector(sel).click(), btnSel('p4'));
  await page.waitForTimeout(1300);
  st = await state(page);
  check('click (จากสคริปต์) → ไม่ตัด ไม่เขียน และบอก "กดค้าง 1 วินาทีเพื่อตัด"', moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2 && st.toasts.includes('กดค้าง 1 วินาทีเพื่อตัด'), st);

  await tick(page); await reset(page);
  await mouseHold(page, 'p4', 150);
  await page.waitForTimeout(1300);
  st = await state(page);
  check('แตะสั้น 150ms → ไม่ตัด ไม่เขียน มีคำแนะนำให้กดค้าง', moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2 && st.toasts.includes('กดค้าง 1 วินาทีเพื่อตัด'), st);

  await tick(page); await reset(page);
  {
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(400);
    const mid = await page.evaluate(() => { const b = document.querySelector('[data-lotsettleconfirm="p4"]'); const i = document.querySelector('[data-lotsettleqty="p4"]'); return { go: b.classList.contains('go'), ro: i.readOnly, hold: !!lotHold_ }; });
    check('ระหว่างค้าง: ปุ่มมีคลาส .go และช่องจำนวนถูกล็อก (readOnly)', mid.go && mid.ro && mid.hold, mid);
    await page.waitForTimeout(400);
    await page.mouse.up();
  }
  await page.waitForTimeout(1300);
  st = await state(page);
  const restored = await page.evaluate(() => { const b = document.querySelector('[data-lotsettleconfirm="p4"]'); const i = document.querySelector('[data-lotsettleqty="p4"]'); return { go: b.classList.contains('go'), ro: i.readOnly }; });
  check('ปล่อยที่ ~0.8 วิ (ก่อนครบ) → ไม่ตัด ไม่เขียน แม้รอต่อจนเลย 1 วิ และปุ่ม/ช่องคืนสภาพ', moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2 && !restored.go && !restored.ro && !st.hold, { st, restored });

  // นิ้ว/เมาส์เลื่อนออกนอกปุ่มระหว่างค้าง → ยกเลิก
  await tick(page); await reset(page);
  {
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.move(c.x, c.y - 120, { steps: 3 });
    await page.waitForTimeout(1100);
    await page.mouse.up();
  }
  st = await state(page);
  check('ลากออกนอกปุ่มระหว่างค้าง → ไม่ตัด ไม่เขียน', moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2, st);

  // ============ C) ช่องว่าง / 0 → ไม่เริ่ม ============
  for (const v of ['', '0']) {
    await tick(page); await reset(page);
    await setQty(page, 'p4', v);
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const started = await page.evaluate(() => ({ hold: !!lotHold_, go: document.querySelector('[data-lotsettleconfirm="p4"]').classList.contains('go') }));
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await page.waitForTimeout(200);
    st = await state(page);
    check(`ช่องจำนวน "${v}" → ไม่เริ่มค้าง ไม่ตัด ไม่เขียน และบอก "กรอกจำนวนที่จะตัดก่อน"`,
      !started.hold && !started.go && moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2 && st.toasts.includes('กรอกจำนวนที่จะตัดก่อน') && await label(page, 'p4') === 'กดค้างเพื่อตัด', { started, st });
  }

  // ============ D) เรนเดอร์ใหม่ระหว่างค้าง / สลับวันระหว่างค้าง → ไม่ตัด ============
  await tick(page); await reset(page);
  await setQty(page, 'p4', 3);
  {
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.evaluate(() => renderLotSettleCards_());
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  st = await state(page);
  check('การ์ดเรนเดอร์ใหม่ระหว่างค้าง (ปุ่มเดิมหลุดจากจอ) → ไม่ตัด ไม่เขียน', moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2 && !st.hold && !st.busy, st);

  await tick(page); await reset(page);
  await setQty(page, 'p4', 3);
  {
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.evaluate(() => { currentDate = '2026-11-11'; });
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  st = await state(page);
  const otherDayPu = await page.evaluate(() => (window.__store['day:2026-11-11'].purchases || []).length);
  await page.evaluate((d) => { currentDate = d; }, TODAY);
  check('วันที่เปลี่ยนระหว่างค้าง → ไม่ตัด ไม่เขียน (ทั้งวันเดิมและวันใหม่)', moneyWrites(st).length === 0 && st.pu.length === 0 && otherDayPu === 0 && st.costedSum === 11.2, { st, otherDayPu });

  // ============ E) ค้างครบ 1 วิ → ตัดชุดเดียว เท่าช่องกรอก ============
  await tick(page); await reset(page);
  await page.evaluate(() => renderLotSettleCards_());
  await setQty(page, 'p4', 3);
  {
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(1250);
    await idle(page);
    const midSt = await state(page);
    check('ค้างครบ 1 วิ (ยังไม่ปล่อย) → ตัดแล้ว: purchases เพิ่มชุดเดียว (p4 3 กก. จากรอบเก่าสุด D1)',
      midSt.pu.length === 1 && midSt.pu[0].productId === 'p4' && midSt.pu[0].sellableQty === 3 && midSt.pu[0].lotSettle && midSt.pu[0].alloc.length === 1 && midSt.pu[0].alloc[0].drawId === 'D1' && midSt.pu[0].alloc[0].qty === 3, midSt.pu);
    check('ค้างครบ: costedQty เพิ่มเท่าช่องกรอกพอดี (D1 6→9, รวม 11.2→14.2) รอบอื่นไม่ถูกแตะ',
      midSt.dr.D1 === 9 && midSt.costedSum === 14.2 && midSt.dr.D2 === 0 && midSt.dr.D3 === 0 && midSt.dr.D4 === undefined && midSt.dr.D6 === 1 && midSt.dr.D7 === 0, midSt.dr);
    check('ค้างครบ: ป้าย "บันทึกแล้ว" ของการตัดเด้งครั้งเดียว และ toast "ตัดต้นทุนวันนี้แล้ว"', midSt.saved === 1 && midSt.toasts.includes('ตัดต้นทุนวันนี้แล้ว'), { saved: midSt.saved, toasts: midSt.toasts });
    await page.mouse.up(); // ปล่อยนิ้วหลังตัดเสร็จ → เกิด click ตามมา
    await page.waitForTimeout(1400);
  }
  st = await state(page);
  check('ปล่อยนิ้วหลังค้างครบ (click ที่ตามมา) → ไม่ตัดซ้ำ และไม่ขึ้นคำแนะนำทับผลจริง',
    st.pu.length === 1 && st.costedSum === 14.2 && st.saved === 1 && !st.toasts.includes('กดค้าง 1 วินาทีเพื่อตัด'), st);
  const lockAfter = await page.evaluate(() => window.__store.lotSettleLock);
  check('ตัดเสร็จ: ปล่อยกุญแจ lotSettleLock แล้ว และปุ่มกลับมาใช้ได้', lockAfter && lockAfter.dev === null && await page.evaluate(() => Array.from(document.querySelectorAll('[data-lotsettleconfirm]')).every(b => !b.disabled && !b.hasAttribute('aria-busy'))), lockAfter);
  const afterCut = await page.evaluate(() => { const row = document.querySelector('[data-lottanktoggle="p4"]').closest('.lot-row'); return row.querySelector('.lot-legend').textContent; });
  check('หลังตัด ถังอัปเดตตามข้อมูลจริง (ตัดแล้ว 10 / รอตัด 12)', afterCut.includes('ตัดแล้ว 10') && afterCut.includes('รอตัด 12'), afterCut);

  // ============ F) คีย์บอร์ด Space / Enter ============
  for (const key of ['Space', 'Enter']) {
    await tick(page); await reset(page);
    const b0 = await state(page);
    await setQty(page, 'p4', 1);
    await page.focus(btnSel('p4'));
    await page.keyboard.down(key);
    await page.waitForTimeout(300);
    await page.keyboard.up(key);
    await page.waitForTimeout(1300);
    st = await state(page);
    check(`คีย์บอร์ด ${key} กดสั้น → ไม่ตัด ไม่เขียน`, moneyWrites(st).length === 0 && st.pu.length === b0.pu.length && st.costedSum === b0.costedSum, st);

    await tick(page); await reset(page);
    await page.focus(btnSel('p4'));
    await page.keyboard.down(key);
    await page.waitForTimeout(1250);
    await idle(page);
    await page.keyboard.up(key);
    await page.waitForTimeout(400);
    st = await state(page);
    check(`คีย์บอร์ด ${key} ค้างครบ 1 วิ → ตัด 1 กก. ครั้งเดียว (ปล่อยปุ่มแล้วไม่ตัดซ้ำ)`,
      st.pu.length === b0.pu.length + 1 && Math.abs(st.costedSum - (b0.costedSum + 1)) < 0.001 && st.saved === 1, { pu: st.pu.length, sum: st.costedSum, was: b0.costedSum, saved: st.saved });
  }
  // ปุ่มค้าง (auto-repeat) ไม่เริ่มค้างรอบใหม่ซ้อน
  await tick(page); await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p4', 1);
    const r = await page.evaluate(async () => {
      const b = document.querySelector('[data-lotsettleconfirm="p4"]');
      b.focus();
      b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
      for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 100)); b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true })); }
      b.blur(); // โฟกัสหลุด → ยกเลิก
      await new Promise(r => setTimeout(r, 1200));
      return true;
    });
    st = await state(page);
    check('โฟกัสหลุด (blur) ระหว่างค้างด้วยคีย์บอร์ด → ไม่ตัด', r && st.pu.length === b0.pu.length && st.costedSum === b0.costedSum && moneyWrites(st).length === 0, st);
  }

  // ============ G) กระปุก (p7): 2.6 → 3, 0.4 → ไม่เริ่ม ============
  await tick(page); await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p7', '0.4');
    const l04 = await label(page, 'p7');
    await mouseHold(page, 'p7', 1300);
    await page.waitForTimeout(300);
    st = await state(page);
    check('p7 กระปุก พิมพ์ 0.4 (ปัดได้ 0) → ไม่เริ่ม ไม่ตัด ไม่เขียน', l04 === 'กดค้างเพื่อตัด' && moneyWrites(st).length === 0 && st.dr.D7 === 0 && st.pu.length === b0.pu.length && st.toasts.includes('กรอกจำนวนที่จะตัดก่อน'), { l04, st });

    await tick(page); await reset(page);
    await setQty(page, 'p7', '2.6');
    const l26 = await label(page, 'p7');
    const c = await center(page, 'p7');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(1250);
    await idle(page);
    await page.mouse.up();
    await page.waitForTimeout(300);
    st = await state(page);
    const p7pu = st.pu.filter(e => e.productId === 'p7');
    check('p7 กระปุก พิมพ์ 2.6 → ป้าย "3 กระปุก" และตัดจริง 3 (costedQty 0→3, purchases ชุดเดียว sellableQty 3)',
      l26 === 'กดค้างเพื่อตัด 3 กระปุก' && st.dr.D7 === 3 && p7pu.length === 1 && p7pu[0].sellableQty === 3 && st.pu.length === b0.pu.length + 1, { l26, D7: st.dr.D7, p7pu });
  }

  // ============ H) ค้าง 2 แถวพร้อมกัน / ค้างซ้ำระหว่าง busy → ตัดครั้งเดียว ============
  await tick(page); await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p4', 1);
    await setQty(page, 'p1', '0.5');
    // สองนิ้วกดสองแถวพร้อมกัน (จำลองด้วย PointerEvent คนละ pointerId; type touch + มี contextmenu จากการกดค้างบนจอสัมผัส)
    const two = await page.evaluate(async () => {
      const a = document.querySelector('[data-lotsettleconfirm="p4"]'), b = document.querySelector('[data-lotsettleconfirm="p1"]');
      const ev = (t, id) => new PointerEvent(t, { pointerId: id, pointerType: 'touch', button: 0, bubbles: true, cancelable: true });
      a.dispatchEvent(ev('pointerdown', 11));
      b.dispatchEvent(ev('pointerdown', 12));
      const holdPid = lotHold_ && lotHold_.pid, bGo = b.classList.contains('go');
      await new Promise(r => setTimeout(r, 500));
      const cm = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      a.dispatchEvent(cm);
      const stillHolding = !!lotHold_;
      await new Promise(r => setTimeout(r, 800));
      return { holdPid, bGo, prevented: cm.defaultPrevented, stillHolding };
    });
    await idle(page);
    await page.waitForTimeout(300);
    st = await state(page);
    check('ค้าง 2 แถวพร้อมกัน → แถวที่สองไม่เริ่ม ตัดเฉพาะแถวแรกครั้งเดียว (p4 +1) p1 ไม่ถูกตัด',
      two.holdPid === 'p4' && !two.bGo && st.pu.length === b0.pu.length + 1 && st.pu[st.pu.length - 1].productId === 'p4' && Math.abs(st.costedSum - (b0.costedSum + 1)) < 0.001 && st.dr.D8 === 0.2, { two, sum: st.costedSum, was: b0.costedSum, D8: st.dr.D8 });
    check('จอสัมผัส: contextmenu จากการกดค้างถูกกันเมนู (preventDefault) แต่ไม่ยกเลิกการค้าง', two.prevented && two.stillHolding, two);
  }

  await tick(page); await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p4', 1);
    await setQty(page, 'p1', '0.5');
    // ทำให้การตัดช้า (อ่านกุญแจช้า) แล้วพยายามค้างซ้ำทุกทางระหว่างที่ยังตัดไม่เสร็จ
    await page.evaluate(() => {
      const raw = Object.getPrototypeOf(window.storage);
      const origGet = raw.get;
      window.__restoreGet = () => { raw.get = origGet; };
      raw.get = async function (key) { if (key === 'lotSettleLock') await new Promise(r => setTimeout(r, 900)); return origGet.call(this, key); };
    });
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    const busy = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[data-lotsettleconfirm]'));
      const a = document.querySelector('[data-lotsettleconfirm="p4"]'), b = document.querySelector('[data-lotsettleconfirm="p1"]');
      const out = { busy: lotHoldBusy_, allDisabled: all.every(x => x.disabled && x.getAttribute('aria-busy') === 'true'), label: a.querySelector('[data-lotholdlabel]').textContent };
      out.startAgainSame = lotHoldStart_(a, null, 'key');
      out.startOther = lotHoldStart_(b, null, 'key');
      b.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'touch', button: 0, bubbles: true, cancelable: true }));
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      a.click(); b.click();
      out.holdAfter = !!lotHold_;
      return out;
    });
    await page.mouse.up();
    const c2 = await center(page, 'p1');
    await page.mouse.move(c2.x, c2.y);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await idle(page);
    await page.waitForTimeout(1300);
    await page.evaluate(() => window.__restoreGet());
    st = await state(page);
    check('ระหว่างกำลังตัด: ปุ่มทุกแถว disabled + aria-busy ป้าย "กำลังตัด…"', busy.busy && busy.allDisabled && busy.label === 'กำลังตัด…', busy);
    check('ค้างซ้ำระหว่าง busy (ปุ่มเดิม/แถวอื่น/นิ้ว/คีย์บอร์ด/click) → ไม่เริ่ม และตัดครั้งเดียว (purchases +1, costedQty +1, p1 ไม่ถูกตัด)',
      busy.startAgainSame === false && busy.startOther === false && !busy.holdAfter && st.pu.length === b0.pu.length + 1 && Math.abs(st.costedSum - (b0.costedSum + 1)) < 0.001 && st.dr.D8 === 0.2 && st.saved === 1,
      { busy, pu: st.pu.length, was: b0.pu.length, sum: st.costedSum, wasSum: b0.costedSum, D8: st.dr.D8, saved: st.saved });
  }

  // ============ I) จำนวนเกินค้าง + ยกเลิก confirm() → ไม่ตัด ไม่มีป้ายบันทึกแล้ว ============
  await tick(page); await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p4', 999);
    await page.evaluate(() => { window.__confirmAnswer = false; });
    await mouseHold(page, 'p4', 1300);
    await idle(page);
    await page.waitForTimeout(300);
    st = await state(page);
    const asked = await page.evaluate(() => window.__confirmAsked);
    await page.evaluate(() => { window.__confirmAnswer = true; });
    check('จำนวนเกินค้าง → ถามยืนยัน; กดยกเลิก → ไม่ตัด ไม่มีป้าย "บันทึกแล้ว" ของการตัด', asked === 1 && st.pu.length === b0.pu.length && st.costedSum === b0.costedSum && st.saved === 0 && !st.writes.some(w => /rawLots|:day:/.test(w)), { asked, st });
  }
  await page.context().close();

  // ============ J) เดือนปิดแล้ว → ถูกบล็อก ============
  page = await open({ closedMonths: { '2026-11': { at: '2026-11-12T00:00:00Z', dev: 'iPhone' } } });
  await reset(page);
  {
    const b0 = await state(page);
    await setQty(page, 'p4', 3);
    await mouseHold(page, 'p4', 1300);
    await idle(page);
    await page.waitForTimeout(400);
    st = await state(page);
    const toastNow = await page.evaluate(() => document.getElementById('toast').textContent);
    check('เดือนปิดแล้ว + กดค้างครบ → ถูกบล็อก: ไม่มีรายการต้นทุนซื้อ costedQty กลับเท่าเดิมทุกรอบ ไม่มีป้ายบันทึกแล้ว',
      st.pu.length === 0 && JSON.stringify(st.dr) === JSON.stringify(b0.dr) && st.saved === 0, { dr: st.dr, was: b0.dr, saved: st.saved, writes: st.writes });
    check('เดือนปิดแล้ว: ผู้ใช้เห็นข้อความล็อก', st.toasts.some(t => t.includes('ปิดแล้ว')) || toastNow.includes('ปิดแล้ว'), { toasts: st.toasts, toastNow });
  }
  await page.context().close();

  // ============ K) prefers-reduced-motion: ยังต้องค้าง 1 วิ ============
  page = await open();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reset(page);
  {
    const rm = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await setQty(page, 'p4', 2);
    await mouseHold(page, 'p4', 600);
    await page.waitForTimeout(1200);
    st = await state(page);
    check('reduced-motion: ปล่อยที่ 0.6 วิ → ไม่ตัด ไม่เขียน', rm && moneyWrites(st).length === 0 && st.pu.length === 0 && st.costedSum === 11.2, { rm, st });
    await tick(page); await reset(page);
    const c = await center(page, 'p4');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    const at700 = await state(page);
    await page.waitForTimeout(550);
    await idle(page);
    await page.mouse.up();
    await page.waitForTimeout(300);
    st = await state(page);
    check('reduced-motion: ที่ 0.7 วิยังไม่ตัด ต้องค้างครบ 1 วิจึงตัด 2 กก. ครั้งเดียว', at700.pu.length === 0 && at700.costedSum === 11.2 && st.pu.length === 1 && st.pu[0].sellableQty === 2 && st.costedSum === 13.2, { at700: at700.costedSum, sum: st.costedSum, pu: st.pu });
  }
  await page.context().close();

  await finish(browser);
})();
