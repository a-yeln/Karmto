const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// ป้าย "ไม่มีสินค้า" (day.noStock): ออเดอร์ไม่เปลี่ยน แต่เงินทุกจุดไม่นับสินค้าที่ไม่มี + บิลโชว์ขีดฆ่า ฿0 + Brand fee ไม่นับและมีป้ายบอก
// กฎเหล็ก: เขียนแค่ noStock ทีละช่อง (patchField) ไม่แตะ orders; บิลที่ติ๊กจ่ายแล้วถูกบล็อก; เดือนปิดถูกบล็อก
const TODAY = '2026-11-16';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');

function seedStore(paid){
  return {
    ['day:' + TODAY]: mkDay({
      orders: { '01': { p1: 2, p6: 3 }, '02': { p6: 2 }, '03': { p1: 1 }, '04': { p6: 1 } },
      billingPaid: paid ? { '04': { paid: true, paidDate: TODAY } } : {},
    }),
  };
}
const prices = page => page.evaluate(() => ({ p1: priceOnDate('p1', currentDate), p6: priceOnDate('p6', currentDate) }));

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seedStore(false), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.evaluate(async () => { window.__toasts = []; const o = window.showToast; window.showToast = m => { window.__toasts.push(String(m)); return o(m); }; await switchTab('billing'); });
  await stripBanner(page);
  await page.waitForSelector('#noStockCard [data-nsall]', { timeout: 8000 });
  const P = await prices(page);
  const ordersBefore = await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders));
  const amt = code => page.evaluate(c => branchBillAmount(dayData.orders[c], currentDate, dayData, c), code);

  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#noStockCard [data-nsall]')).map(b => b.dataset.nsall));
  check('การ์ดโชว์เฉพาะสินค้าที่มีคนสั่งวันนี้ (p1, p6)', chips.join(',') === 'p1,p6', chips);
  check('ยังไม่ตั้ง → ยอดบิลเท่าเดิม', (await amt('01')) === 2 * P.p1 + 3 * P.p6);

  await page.evaluate(() => { window.__writes = []; });
  await page.click('#noStockCard [data-nsall="p6"]');
  await page.waitForFunction(() => dayData.noStock.all.p6 === true && !noStockBusy_, null, { timeout: 8000 });
  const w = await page.evaluate(() => window.__writes.filter(x => x.op !== 'get').map(x => ({ op: x.op, key: x.key, path: x.path })));
  const dayW = w.filter(x => x.key === 'day:2026-11-16');
  check('ทั้งวัน: เขียนครั้งเดียว patchField noStock.all.p6', dayW.length === 1 && dayW[0].op === 'patchField' && JSON.stringify(dayW[0].path) === '["noStock","all","p6"]', w);
  check('ออเดอร์ไม่ถูกแก้', (await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders))) === ordersBefore);
  check('บิลสาขา 01 หักเชอรี่ เหลือแค่กุ้งแช่', (await amt('01')) === 2 * P.p1);
  check('บิลสาขา 02 (สั่งแต่เชอรี่) = 0', (await amt('02')) === 0);
  check('บิลสาขา 03 (ไม่ได้สั่งเชอรี่) ไม่กระทบ', (await amt('03')) === P.p1);
  const row = await page.evaluate(() => (document.querySelector('[data-nostockrow="01"]') || {}).textContent || '');
  check('แถวบิลสาขาติดป้าย "ไม่มีสินค้า: เนื้อหอยเชอรี่"', /ไม่มีสินค้า/.test(row) && /เชอรี่/.test(row), row);
  const sum = await page.evaluate(() => (document.querySelector('[data-nostocksum]') || {}).textContent || '');
  check('การ์ดสรุป: ทุกสาขา + ยอดที่หักรวม', /ทุกสาขา/.test(sum) && sum.includes((6 * P.p6).toLocaleString('th-TH')), sum);

  // บิล
  const rc = await page.evaluate(() => { const r = computeReceiptData('01'); return { sub: r.subtotal, items: r.items.map(i => (i.p ? i.p.id : i.name) + ':' + i.amount + (i.noStock ? ':ns' : '')) }; });
  check('ใบบิล: บรรทัดเชอรี่ ยอด 0 + ไม่รวมในผลรวมย่อย', rc.items.includes('p6:0:ns') && rc.sub === Math.round(2 * P.p1), rc);
  await page.click('[data-viewbill="01"]');
  await page.waitForSelector('#receipt-01 [data-nostockline="p6"]', { timeout: 5000 });
  const line = await page.evaluate(() => { const tr = document.querySelector('#receipt-01 [data-nostockline="p6"]'); return { t: tr.textContent, s: !!tr.querySelector('s') }; });
  check('การ์ดบิล: บรรทัดเชอรี่ขีดฆ่า + "ไม่มีสินค้า" + 0', line.s && /ไม่มีสินค้า/.test(line.t) && /0$/.test(line.t.trim()), line);
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async t => { window.__clip = t; }; });
  await page.click('[data-copybill="01"]');
  await page.waitForFunction(() => window.__clip, null, { timeout: 3000 });
  const clip = await page.evaluate(() => window.__clip);
  check('ข้อความคัดลอก: เชอรี่ — ไม่มีสินค้า = 0', /เนื้อหอยเชอรี่\s+— ไม่มีสินค้า = 0/.test(clip), clip.split('\n').filter(l => /เชอรี่/.test(l)));
  await page.screenshot({ path: path.join(SHOT_DIR, 'no-stock-bill.png'), clip: await page.evaluate(() => { const r = document.getElementById('bb-01').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.min(1100, r.height) }; }) }).catch(() => {});
  check('ไม่ล้นจอ 420px', await page.evaluate(() => document.documentElement.scrollWidth <= 420));

  // Brand fee
  const fee = await page.evaluate(() => { renderFeeToday(); return { t: computeFeeTotals(dayData.orders, dayData), note: (document.querySelector('[data-feenostock]') || {}).textContent || '', raw: computeFeeTotals(dayData.orders) }; });
  check('Brand fee ไม่นับเชอรี่ที่ไม่มีสินค้า', fee.t.p6 === 0 && fee.t.p1 === 3 && fee.raw.p6 === 6, fee);
  check('หน้า Brand fee บอกว่าเกิดอะไรขึ้น', /ไม่มีสินค้า/.test(fee.note) && /เชอรี่/.test(fee.note) && /ไม่นับ fee/.test(fee.note), fee.note);
  const md = await page.evaluate(async () => (await getMonthDays('2026-11')).find(r => r.iso === '2026-11-16'));
  check('ตาราง fee รายเดือน: วันนี้ไม่นับเชอรี่ + มีข้อความ noStock', md.totals.p6 === 0 && /เชอรี่/.test(md.noStock), md.noStock);

  // ยอดเงินจุดอื่นๆ
  const money = await page.evaluate(async () => {
    slipMatchCands_ = null;
    const c = await loadSlipCandidates_(true);
    const dn = dayNetProfit_ ? await Promise.resolve(dayNetProfit_(currentDate, dayData)) : null;
    return { cand01: (c.find(x => x.code === '01') || {}).amt, cand02: c.find(x => x.code === '02') || null, dn };
  });
  check('จับคู่สลิป: ใช้ยอดหลังหัก, สาขาที่ยอด 0 ไม่ขึ้นเป็นบิลค้าง', money.cand01 === 2 * P.p1 && money.cand02 === null, money);

  // ยกเว้นสาขา 01 (ได้ของ)
  await page.evaluate(() => { window.__writes = []; });
  await page.click('[data-nsbranch="p6"]');
  await page.waitForFunction(() => dayData.noStock.branch['01'] && dayData.noStock.branch['01'].p6 === false && !noStockBusy_, null, { timeout: 8000 });
  const w2 = await page.evaluate(() => window.__writes.filter(x => x.key === 'day:2026-11-16').map(x => JSON.stringify(x.path)));
  check('รายสาขา: เขียน noStock.branch.01.p6 = false (ยกเว้นจากทั้งวัน)', w2.length === 1 && w2[0] === '["noStock","branch","01","p6"]', w2);
  check('สาขา 01 กลับมาคิดเชอรี่ / สาขา 02 ยังไม่มี', (await amt('01')) === 2 * P.p1 + 3 * P.p6 && (await amt('02')) === 0);
  const sum2 = await page.evaluate(() => noStockSummaryText_(dayData));
  check('สรุปบอก "ทุกสาขา ยกเว้น 01"', /ทุกสาขา ยกเว้น 01/.test(sum2), sum2);
  check('ออเดอร์ยังไม่ถูกแก้', (await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders))) === ordersBefore);

  // ยกเลิกทั้งวัน
  await page.click('#noStockCard [data-nsall="p6"]');
  await page.waitForFunction(() => dayData.noStock.all.p6 === false && !noStockBusy_, null, { timeout: 8000 });
  check('แตะซ้ำ = ยกเลิก สาขา 02 กลับมาคิดเชอรี่', (await amt('02')) === 2 * P.p6);

  // ข้อความสั่งผู้ขาย/จำนวนรวม ยังใช้จำนวนที่สั่ง
  check('จำนวนรวมสำหรับสั่งของยังนับเชอรี่ตามออเดอร์', await page.evaluate(() => computeTotals(dayData.orders).p6 === 6));
  await page.close();

  // ============ บิลที่จ่ายแล้วถูกบล็อก ============
  const page2 = await openApp(browser, { store: seedStore(true), date: TODAY });
  await page2.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page2.evaluate(async () => { window.__toasts = []; const o = window.showToast; window.showToast = m => { window.__toasts.push(String(m)); return o(m); }; await switchTab('billing'); });
  await stripBanner(page2);
  await page2.waitForSelector('#noStockCard [data-nsall="p6"]', { timeout: 8000 });
  await page2.evaluate(() => { window.__writes = []; });
  await page2.click('#noStockCard [data-nsall="p6"]');
  await page2.waitForFunction(() => window.__toasts.some(t => /ติ๊กจ่ายแล้ว/.test(t)), null, { timeout: 8000 });
  const blocked = await page2.evaluate(() => ({ w: window.__writes.filter(x => x.op !== 'get' && /^day:/.test(x.key)).length, t: window.__toasts.find(t => /ติ๊กจ่ายแล้ว/.test(t)), ns: JSON.stringify(window.__store['day:2026-11-16'].noStock || null) }));
  check('ทั้งวันกระทบบิลที่จ่ายแล้ว (สาขา 04) → บล็อก ไม่เขียน บอกสาขา', blocked.w === 0 && /04/.test(blocked.t) && blocked.ns === 'null', blocked);

  // เดือนปิด
  await page2.evaluate(() => { closedMonths_ = { '2026-11': true }; window.__toasts = []; window.__writes = []; });
  await page2.click('#noStockCard [data-nsall="p1"]');
  await page2.waitForTimeout(400);
  check('เดือนปิด → ไม่เขียน', await page2.evaluate(() => window.__writes.filter(x => /^day:/.test(x.key) && x.op !== 'get').length === 0 && window.__toasts.some(t => /ปิดแล้ว/.test(t))));

  // ธีมอื่น ไม่ล้นจอ
  for(const th of ['sea', 'neon', 'mermaid']){
    await page2.evaluate(t => { closedMonths_ = {}; document.documentElement.setAttribute('data-theme', t); }, th);
    check(`ธีม ${th}: การ์ดไม่ล้นจอ 420px`, await page2.evaluate(() => document.documentElement.scrollWidth <= 420));
  }
  await page2.screenshot({ path: path.join(SHOT_DIR, 'no-stock-card-mermaid.png'), clip: await page2.evaluate(() => { const r = document.getElementById('noStockCard').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.max(60, Math.min(400, r.height)) }; }) }).catch(() => {});

  await finish(browser);
})();
