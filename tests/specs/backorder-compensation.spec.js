const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// ค้างส่ง (บิลเต็ม) + ส่งชดเชย (คีย์รวม backorders)
// กฎ: บิล/fee/ค้างโอนไม่เปลี่ยน; จำนวนของออกจากร้าน (shippedTotals_) ตรงความจริงทั้งวันค้างและวันส่งชดเชย
const D1 = '2026-11-16', D2 = '2026-11-17';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const seed = () => ({
  ['day:' + D1]: mkDay({ orders: { '21': { p1: 2, p7: 5 }, '22': { p7: 3 } } }),
  ['day:' + D2]: mkDay({ orders: { '22': { p7: 2 } } }),
});

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seed(), date: D1 });
  await page.clock.setFixedTime(new Date(D2 + 'T10:00:00+07:00'));
  await page.evaluate(async () => { window.__toasts = []; const o = window.showToast; window.showToast = m => { window.__toasts.push(String(m)); return o(m); }; await switchTab('billing'); });
  await stripBanner(page);
  const P = await page.evaluate(() => ({ p1: priceOnDate('p1', currentDate), p7: priceOnDate('p7', currentDate) }));
  const full21 = 2 * P.p1 + 5 * P.p7;
  const amt = c => page.evaluate(c => branchBillAmount(dayData.orders[c], currentDate, dayData, c), c);
  const ordersBefore = await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders));

  // ===== วันที่ 1: ตั้งค้างส่งนางรม 1 =====
  await page.click('[data-viewbill="21"]');
  await page.waitForSelector('#receipt-21 [data-nsbo="p7"]', { timeout: 5000 });
  await page.evaluate(() => { window.__writes = []; });
  await page.fill('#receipt-21 [data-nsbo="p7"]', '1');
  await page.dispatchEvent('#receipt-21 [data-nsbo="p7"]', 'change');
  await page.waitForFunction(() => (window.__store['backorders:2026-11'] || []).length === 1 && !backorderBusy_, null, { timeout: 8000 });
  const bo = await page.evaluate(() => window.__store['backorders:2026-11'][0]);
  const w1 = await page.evaluate(() => window.__writes.filter(x => x.op !== 'get').map(x => x.op + ' ' + x.key));
  check('สร้างรายการค้างส่ง open (สาขา 21 นางรม 1 จากวันที่ 1)', bo.status === 'open' && bo.code === '21' && bo.pid === 'p7' && bo.qty === 1 && bo.fromIso === D1, bo);
  check('เขียนเฉพาะ backorders แบบ patchOps (ไม่แตะคีย์วัน)', w1.length >= 1 && w1.every(x => x === 'patchOps backorders:2026-11' || /actlog|activityLog/.test(x)), w1);
  check('ออเดอร์ไม่ถูกแก้', (await page.evaluate(() => JSON.stringify(window.__store['day:2026-11-16'].orders))) === ordersBefore);
  check('บิลสาขา 21 ยังเต็ม', (await amt('21')) === full21);
  check('Brand fee นางรมยังนับเต็ม (5+3=8)', await page.evaluate(() => computeFeeTotals(dayData.orders, dayData).p7 === 8));
  check('จำนวนออกจากร้านจริงวันที่ 1: นางรม 7', await page.evaluate(() => shippedTotals_(dayData, currentDate).p7 === 7));
  check('ข้อความสั่งของ/ยอดรวมออเดอร์ยังนับ 8', await page.evaluate(() => computeTotals(dayData.orders).p7 === 8));

  await page.waitForSelector('#receipt-21 [data-boline="p7"]', { timeout: 5000 });
  const boLine = await page.evaluate(() => document.querySelector('#receipt-21 [data-boline="p7"]').textContent);
  check('ใบบิล: "ได้รับ 4 · ค้างส่ง 1 — ร้านส่งชดเชยให้"', /ได้รับ 4/.test(boLine) && /ค้างส่ง 1/.test(boLine) && /ส่งชดเชยให้/.test(boLine), boLine);
  const rc = await page.evaluate(() => computeReceiptData('21').subtotal);
  check('ผลรวมย่อยในใบบิลยังเต็ม', rc === Math.round(2 * P.p1) + Math.round(5 * P.p7), rc);
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = async t => { window.__clip = t; }; });
  await page.click('[data-copybill="21"]');
  await page.waitForFunction(() => window.__clip, null, { timeout: 3000 });
  const clip = await page.evaluate(() => window.__clip);
  check('ข้อความคัดลอก: มีบรรทัด ได้รับ 4 · ค้างส่ง 1', /ได้รับ 4 · ค้างส่ง 1/.test(clip), clip.split('\n').filter(l => /นางรม|ค้างส่ง/.test(l)));
  check('แถวบิลติดป้าย 📦 ค้างส่ง', /ค้างส่ง/.test(await page.evaluate(() => (document.querySelector('[data-borowtag="21"]') || {}).textContent || '')));
  await page.screenshot({ path: path.join(SHOT_DIR, 'backorder-bill.png'), clip: await page.evaluate(() => { const r = document.getElementById('bb-21').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.min(1400, r.height) }; }) }).catch(() => {});

  // ซ้อนกับส่งขาดไม่ได้ (ทั้งสองทาง)
  await page.evaluate(() => { window.__toasts = []; });
  check('ตั้ง ✂️ ส่งขาด ซ้อนค้างส่งไม่ได้', (await page.evaluate(() => setShortQty_('21', 'p7', '1', null))) === false && await page.evaluate(() => window.__toasts.some(t => /ค้างส่ง/.test(t))));
  check('ค้างส่งเกินจำนวนสั่งไม่ได้', (await page.evaluate(() => setBackorderQty_('21', 'p7', '6', null))) === false);

  // ติ๊ก "ไม่มีสินค้า" ทับค้างส่งไม่ได้ (ทั้งวัน และรายสาขา)
  await page.evaluate(() => { window.__toasts = []; window.__writes = []; });
  check('ไม่มีสินค้าทั้งวันทับค้างส่งไม่ได้', (await page.evaluate(() => toggleNoStock_(null, 'p7', null))) === false && await page.evaluate(() => window.__toasts.some(t => /ค้างส่ง/.test(t)) && !window.__writes.some(w => /^day:/.test(w.key) && w.op !== 'get')));
  check('ไม่มีสินค้ารายสาขาทับค้างส่งไม่ได้', (await page.evaluate(() => toggleNoStock_('21', 'p7', null))) === false);
  check('ไม่มีสินค้าสาขาอื่น (ไม่มีค้างส่ง) ยังทำได้ แล้วยกเลิก', (await page.evaluate(() => toggleNoStock_('22', 'p7', null))) === true && (await page.evaluate(() => toggleNoStock_('22', 'p7', null))) === true);
  // การ์ดค้างส่ง
  await page.waitForSelector('#backorderCard [data-bosend]', { timeout: 5000 });
  check('การ์ด 📦 ค้างส่งชดเชย โชว์รายการ', /21/.test(await page.evaluate(() => document.getElementById('backorderCard').textContent)));

  // ===== วันที่ 2: ส่งชดเชย (สาขา 21 ไม่มีออเดอร์) + ค่าส่ง 80 =====
  await page.evaluate(async () => { await loadForDate('2026-11-17'); await switchTab('billing'); window.__writes = []; });
  await page.waitForSelector('#backorderCard [data-bosend]', { timeout: 8000 });
  await page.click('#backorderCard [data-bosend]');
  await page.waitForSelector('#backorderCard [data-bosendcost]');
  await page.fill('#backorderCard [data-bosendcost]', '80');
  await page.click('#backorderCard [data-boconfirm]');
  await page.waitForFunction(() => window.__store['backorders:2026-11'][0].status === 'sent' && !backorderBusy_, null, { timeout: 8000 });
  const sent = await page.evaluate(() => ({ b: window.__store['backorders:2026-11'][0], exp: (window.__store['day:2026-11-17'].expenses || []) }));
  check('ส่งชดเชยแล้ว sentIso = วันที่ 2', sent.b.status === 'sent' && sent.b.sentIso === D2, sent.b);
  check('ค่าส่ง → รายจ่ายหมวด ค่าส่ง/ลาล่า 80 ของวันที่ 2', sent.exp.length === 1 && sent.exp[0].category === 'ค่าส่ง/ลาล่า' && sent.exp[0].amount === 80 && sent.b.costExpenseId === sent.exp[0].id, sent.exp);
  check('จำนวนออกจากร้านวันที่ 2: นางรม 2+1 = 3', await page.evaluate(() => shippedTotals_(dayData, currentDate).p7 === 3));
  check('วันที่ 1 ยังนับ 7 หลังส่ง', await page.evaluate(async () => shippedTotals_(await loadDay('2026-11-16'), '2026-11-16').p7 === 7));
  check('บิลวันที่ 2 ไม่มีสาขา 21 (ไม่เข้าค้างโอน)', await page.evaluate(async () => { slipMatchCands_ = null; return !(await loadSlipCandidates_(true)).some(x => x.code === '21' && x.iso === '2026-11-17'); }));
  await page.waitForSelector('#backorderCard [data-cmpslip="21"] [data-cmpline="p7"]', { timeout: 5000 });
  const slip = await page.evaluate(() => document.querySelector('#backorderCard [data-cmpslip="21"]').textContent);
  check('ใบส่งของชดเชย ฿0 สาขา 21 นางรม 1 (ค้างจาก 16/11)', /ใบส่งของชดเชย/.test(slip) && /฿0/.test(slip) && /16\/11\/2026/.test(slip), slip.replace(/\s+/g, ' ').slice(0, 200));
  await page.screenshot({ path: path.join(SHOT_DIR, 'backorder-card.png'), clip: await page.evaluate(() => { const r = document.getElementById('backorderCard').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY), width: 420, height: Math.max(80, Math.min(1400, r.height)) }; }) }).catch(() => {});
  check('ไม่ล้นจอ 420px', await page.evaluate(() => document.documentElement.scrollWidth <= 420));
  const fee = await page.evaluate(() => { renderFeeToday(); return { n: computeFeeTotals(dayData.orders, dayData).p7, note: (document.querySelector('[data-feebo]') || {}).textContent || '' }; });
  check('fee วันที่ 2 ไม่นับของชดเชย + มีข้อความบอก', fee.n === 2 && /ส่งชดเชย/.test(fee.note), fee);

  // ส่งชดเชยไปสาขาที่มีบิลวันนั้น → บรรทัด ฿0 ยอดไม่เพิ่ม
  await page.evaluate(async () => {
    await writeBackorders_('2026-11-16', { push: { id: 'boX', fromIso: '2026-11-16', code: '22', pid: 'p7', qty: 1, status: 'sent', sentIso: '2026-11-17', costExpenseId: null } });
  });
  const b22 = await page.evaluate(() => { const r = computeReceiptData('22'); return { sub: r.subtotal, comp: r.items.filter(i => i.comp).map(i => i.p.id + ':' + i.qty + ':' + i.amount) }; });
  check('บิลสาขา 22 วันที่ 2 มีบรรทัดชดเชย ฿0 ยอดไม่เพิ่ม', b22.comp.join() === 'p7:1:0' && b22.sub === Math.round(2 * P.p7), b22);
  check('ยอดบิลสาขา 22 ยังเท่าเดิม', (await amt('22')) === 2 * P.p7);

  // ยกเลิกส่ง → ลบรายจ่ายค่าส่ง + กลับเป็น open
  await page.evaluate(() => { window.confirm = () => true; });
  const bid = await page.evaluate(() => window.__store['backorders:2026-11'].find(b => b.code === '21').id);
  await page.click(`#backorderCard [data-bounsend="${bid}"]`);
  await page.waitForFunction(id => window.__store['backorders:2026-11'].find(b => b.id === id).status === 'open' && !backorderBusy_, bid, { timeout: 8000 });
  check('ยกเลิกส่ง: กลับเป็น open และลบรายจ่ายค่าส่ง', await page.evaluate(() => (window.__store['day:2026-11-17'].expenses || []).length === 0));

  // ค่าส่ง id ตายตัว: ถ้ามีรายการค่าส่งค้างจากรอบที่พัง → ไม่เกิดซ้ำ
  await page.evaluate(id => { window.__store['day:2026-11-17'].expenses = [{ id: 'e-bo-' + id, category: 'ค่าส่ง/ลาล่า', amount: 50, paid: false, note: 'ค้าง' }]; dayCache_['2026-11-17'] = null; }, bid);
  // ค่าส่งที่ติ๊กจ่ายแล้ว → ยกเลิกส่งไม่ได้
  await page.evaluate(async id => { await sendBackorder_(id, '2026-11-17', '50', null); const d = window.__store['day:2026-11-17']; d.expenses[0].paid = true; }, bid);
  check('ส่งซ้ำหลังพังกลางทาง ค่าส่งไม่เกิดซ้ำ (1 รายการ)', await page.evaluate(() => window.__store['day:2026-11-17'].expenses.filter(e => /^e-bo-/.test(e.id)).length === 1));
  await page.evaluate(() => { window.__toasts = []; });
  check('ค่าส่งติ๊กจ่ายแล้ว → ยกเลิกส่งถูกบล็อก', (await page.evaluate(id => unsendBackorder_(id, null), bid)) === false && await page.evaluate(() => window.__toasts.some(t => /ติ๊กจ่ายแล้ว/.test(t))));

  // เดือนปิด
  await page.evaluate(() => { closedMonths_ = { '2026-11': true }; window.__writes = []; });
  check('เดือนปิด → ตั้งค้างส่งไม่ได้ ไม่เขียน', (await page.evaluate(() => setBackorderQty_('22', 'p7', '1', null))) === false && await page.evaluate(() => window.__writes.filter(x => x.op !== 'get').length === 0));
  check('backorders: อยู่ในรายการคีย์ที่สำรอง (แยกรายเดือน)', await page.evaluate(() => BACKUP_PREFIXES.includes('backorders:') && !BACKUP_EXTRA_ROOT_KEYS.includes('backorders')));

  await finish(browser);
})();
