const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// ส่งขาด (day.shortQty): ออเดอร์เต็มเหมือนเดิม แต่บิล/เงินทุกจุด/Brand fee คิดจากจำนวนที่ส่งจริง + บรรทัด "ส่งขาด" ฿0 ในบิล
// + หมวดรายจ่าย "ค่าส่ง/ลาล่า"
const TODAY = '2026-11-16';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const seed = paid => ({
  ['day:' + TODAY]: mkDay({ orders: { '21': { p1: 2, p7: 5 }, '22': { p7: 3 } }, billingPaid: paid ? { '21': { paid: true, paidDate: TODAY } } : {} }),
});

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seed(false), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.evaluate(async () => { window.__toasts = []; const o = window.showToast; window.showToast = m => { window.__toasts.push(String(m)); return o(m); }; await switchTab('billing'); });
  await stripBanner(page);
  const P = await page.evaluate(() => ({ p1: priceOnDate('p1', currentDate), p7: priceOnDate('p7', currentDate) }));
  const amt = c => page.evaluate(c => branchBillAmount(dayData.orders[c], currentDate, dayData, c), c);
  const ordersBefore = await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders));

  // หมวดรายจ่าย
  const cats = await page.evaluate(() => settings.expenseCategories.slice());
  check('หมวด "ค่าส่ง/ลาล่า" มีและอยู่ก่อน "อื่นๆ"', cats.includes('ค่าส่ง/ลาล่า') && cats.indexOf('ค่าส่ง/ลาล่า') < cats.indexOf('อื่นๆ') && cats[cats.length - 1] === 'อื่นๆ', cats);

  // เปิดบิลสาขา 21 → ใส่ส่งขาดนางรม 1
  await page.click('[data-viewbill="21"]');
  await page.waitForSelector('#receipt-21 [data-nsshort="p7"]', { timeout: 5000 });
  await page.evaluate(() => { window.__writes = []; });
  await page.fill('#receipt-21 [data-nsshort="p7"]', '1');
  await page.dispatchEvent('#receipt-21 [data-nsshort="p7"]', 'change');
  await page.waitForFunction(() => dayData.shortQty['21'] && dayData.shortQty['21'].p7 === 1 && !noStockBusy_, null, { timeout: 8000 });
  const w = await page.evaluate(() => window.__writes.filter(x => x.key === 'day:2026-11-16').map(x => x.op + ' ' + JSON.stringify(x.path)));
  check('เขียนครั้งเดียว patchField shortQty.21.p7', w.length === 1 && w[0] === 'patchField ["shortQty","21","p7"]', w);
  check('ออเดอร์ไม่ถูกแก้ (นางรมยัง 5)', (await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders))) === ordersBefore);
  check('บิลสาขา 21 คิดนางรม 4', (await amt('21')) === 2 * P.p1 + 4 * P.p7);
  check('สาขา 22 ไม่กระทบ', (await amt('22')) === 3 * P.p7);

  await page.waitForSelector('#receipt-21 [data-shortline="p7"]', { timeout: 5000 });
  const rc = await page.evaluate(() => { const r = computeReceiptData('21'); return { sub: r.subtotal, items: r.items.map(i => (i.p ? i.p.id : i.name) + ':' + i.qty + ':' + i.amount + (i.shortLine ? ':short' : '')) }; });
  check('ใบบิล: นางรม 4 คิดเงิน + บรรทัดส่งขาด 1 ฿0', rc.items.includes('p7:4:' + Math.round(4 * P.p7)) && rc.items.includes('p7:1:0:short') && rc.sub === Math.round(2 * P.p1) + Math.round(4 * P.p7), rc);
  const line = await page.evaluate(() => { const tr = document.querySelector('#receipt-21 [data-shortline="p7"]'); return { t: tr.textContent, s: !!tr.querySelector('s') }; });
  check('การ์ดบิล: บรรทัดส่งขาดขีดฆ่า + ป้าย "ส่งขาด"', line.s && /ส่งขาด/.test(line.t), line);
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async t => { window.__clip = t; }; });
  await page.click('[data-copybill="21"]');
  await page.waitForFunction(() => window.__clip, null, { timeout: 3000 });
  const clip = await page.evaluate(() => window.__clip);
  check('ข้อความคัดลอก: "1 กระปุก เนื้อหอยนางรม — ส่งขาด = 0" และนางรม 4 คิดเงิน', /1 กระปุก\s+เนื้อหอยนางรม\s+— ส่งขาด = 0/.test(clip) && /4 กระปุก\s+เนื้อหอยนางรม\s+\S+ x 4/.test(clip), clip.split('\n').filter(l => /นางรม/.test(l)));
  const tag = await page.evaluate(() => (document.querySelector('[data-shortrow="21"]') || {}).textContent || '');
  check('แถวบิลติดป้าย ✂️ ส่งขาด: เนื้อหอยนางรม 1', /ส่งขาด/.test(tag) && /นางรม 1/.test(tag), tag);
  await page.screenshot({ path: path.join(SHOT_DIR, 'short-delivery-bill.png'), clip: await page.evaluate(() => { const r = document.getElementById('bb-21').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.min(1300, r.height) }; }) }).catch(() => {});
  check('ไม่ล้นจอ 420px', await page.evaluate(() => document.documentElement.scrollWidth <= 420));

  // fee + ยอดอื่นๆ
  const fee = await page.evaluate(() => { renderFeeToday(); return { t: computeFeeTotals(dayData.orders, dayData).p7, note: (document.querySelector('[data-feenostock]') || {}).textContent || '' }; });
  check('Brand fee นับนางรมตามส่งจริง (4+3=7)', fee.t === 7, fee);
  check('หน้า fee บอกส่งขาด', /ส่งขาด เนื้อหอยนางรม 1 \(สาขา 21\)/.test(fee.note), fee.note);
  const c = await page.evaluate(async () => { slipMatchCands_ = null; return (await loadSlipCandidates_(true)).find(x => x.code === '21').amt; });
  check('จับคู่สลิปใช้ยอดหลังหักส่งขาด', c === 2 * P.p1 + 4 * P.p7, c);
  check('จำนวนสั่งของยังนับตามออเดอร์ (8)', await page.evaluate(() => computeTotals(dayData.orders).p7 === 8));

  // ค่าไม่ถูกต้อง
  for(const bad of ['6', '-1', '0.15', 'abc']){
    await page.evaluate(() => { window.__writes = []; window.__toasts = []; });
    const ok = await page.evaluate(v => setShortQty_('21', 'p7', v, null), bad);
    const nw = await page.evaluate(() => window.__writes.filter(x => x.key === 'day:2026-11-16' && x.op !== 'get').length);
    check(`ค่า "${bad}" ถูกปฏิเสธ ไม่เขียน`, ok === false && nw === 0);
  }
  // ยกเลิก (ใส่ว่าง = 0)
  await page.evaluate(() => setShortQty_('21', 'p7', '', null));
  check('ใส่ว่าง = ยกเลิกส่งขาด', (await amt('21')) === 2 * P.p1 + 5 * P.p7);
  await page.close();

  // บิลจ่ายแล้วถูกบล็อก
  const page2 = await openApp(browser, { store: seed(true), date: TODAY });
  await page2.evaluate(async () => { window.__toasts = []; const o = window.showToast; window.showToast = m => { window.__toasts.push(String(m)); return o(m); }; await switchTab('billing'); window.__writes = []; });
  const ok2 = await page2.evaluate(() => setShortQty_('21', 'p7', '1', null));
  const r2 = await page2.evaluate(() => ({ w: window.__writes.filter(x => x.key === 'day:2026-11-16' && x.op !== 'get').length, t: window.__toasts.join('|') }));
  check('บิลสาขาที่ติ๊กจ่ายแล้ว → บล็อก ไม่เขียน', ok2 === false && r2.w === 0 && /ติ๊กจ่ายแล้ว/.test(r2.t), r2);

  // ร้านที่มีธงแล้วและลบหมวดทิ้ง → ไม่เด้งกลับ
  const back = await page2.evaluate(async () => {
    const s0 = JSON.parse(JSON.stringify(settings)); s0.expenseCategories = s0.expenseCategories.filter(c => c !== 'ค่าส่ง/ลาล่า'); s0._expCatLalamove = true;
    window.__store.settings = s0; await loadSettings(); return settings.expenseCategories.includes('ค่าส่ง/ลาล่า');
  });
  check('ลบหมวดแล้ว (มีธง) → ไม่เด้งกลับ', back === false);
  await finish(browser);
})();
