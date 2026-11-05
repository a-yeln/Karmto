const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// การ์ดบันทึกต้นทุนซื้อ: ปุ่ม 📋 ข้างช่องจำนวนซื้อ ดึงยอดออเดอร์รวมของสินค้านั้นของวันที่เปิดอยู่ (ไม่บันทึกเอง)
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, { store: { ['day:' + iso]: mkDay({ orders: { '01': { p1: 5, p7: 4 }, '02': { p1: 3.5 } } }) }, date: iso, viewport: { width: 420, height: 1000 } });
  await page.route(/fonts\./, r => r.abort());
  await page.evaluate(async () => { await switchTab('purchase'); window.__writes.length = 0; });
  const r = await page.evaluate(() => {
    const sel = document.getElementById('purchProduct');
    sel.value = 'p1'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('purchFillOrderBtn').click();
    const q1 = document.getElementById('purchQty').value;
    document.getElementById('purchQty').value = ''; document.getElementById('purchSellable').value = '';
    sel.value = 'p7'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('purchFillOrderBtn').click();
    const q7 = document.getElementById('purchQty').value, s7 = document.getElementById('purchSellable').value;
    sel.value = 'p3'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('purchQty').value = '';
    document.getElementById('purchFillOrderBtn').click();
    return { q1, q7, s7, q3: document.getElementById('purchQty').value, toast: document.getElementById('toast').textContent, writes: window.__writes.filter(w => w.key && w.key.startsWith('day:')).length };
  });
  check('Fills the day\'s total order for the product (all branches)', r.q1 === '8.5', r);
  check('Jar products fill "จำนวนที่ทำได้" (order unit) instead of kg', r.q7 === '' && r.s7 === '4', r);
  check('No order → leaves the field and says so; nothing is saved', r.q3 === '' && r.toast.includes('ยังไม่มีออเดอร์') && r.writes === 0, r);
  await page.screenshot({ path: process.env.SHOT || '/dev/null', clip: await page.evaluate(() => { const b = document.getElementById('purchQty').closest('.card').getBoundingClientRect(); return { x: 0, y: Math.max(0, b.top + window.scrollY), width: 420, height: 420 }; }) }).catch(() => {});
  await finish(browser);
})();
