const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// 🧭 ศูนย์บัญชาการวันนี้ (ค้างรับเลยกำหนด / ขาดต้นทุนซื้อ / ของเหลือเกินอายุ → แตะแล้วพาไปหน้านั้น)
// 📉 เตือนกำไรหดตอนกรอกต้นทุนซื้อ (เทียบเฉลี่ย 30 วัน) + ถามยืนยันก่อนบันทึก
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const T = '2026-10-20';
  const base = (iso, price) => mkDay({ purchases: [{ id: 'b' + iso, productId: 'p4', qty: 10, price, seller: 'มนต์' }] });
  const store = {
    ['day:2026-10-10']: mkDay({ orders: { '07': { p1: 4 } } }),                                   // ค้าง 10 วัน
    ['day:2026-10-18']: mkDay({ orders: { '01': { p1: 2 } }, billingPaid: { '01': { paid: true, paidDate: '2026-10-19' } } }),
    ['day:2026-10-19']: mkDay({ leftoverOut: { p2: 3 }, leftoverSince: { p2: '2026-10-16' } }),     // ค้าง 4 วัน (เกณฑ์ 2)
    ['day:' + T]: mkDay({ orders: { '01': { p1: 5 } } }),                                          // วันนี้ยังไม่กรอกต้นทุน
    ['day:2026-10-05']: base('2026-10-05', 130), ['day:2026-10-06']: base('2026-10-06', 130), ['day:2026-10-07']: base('2026-10-07', 130),
    rawLots: [],
  };
  const page = await openApp(browser, { store, date: T, viewport: { width: 420, height: 1100 } });
  await page.clock.setFixedTime(new Date(T + 'T09:00:00+07:00'));

  const c = await page.evaluate(async () => { await switchTab('dashboard'); await renderTodayCommand_(); const el = document.getElementById('cmdCenter'); return { text: el.textContent, rows: el.querySelectorAll('.cmd-row').length, red: el.querySelectorAll('.cmd-dot.red').length }; });
  check('Overdue receivable (10 days) is listed; paid bill is not', c.text.includes('ค้างรับเลย 3 วัน 1 บิล') && c.text.includes('10 วัน'), c.text.slice(0, 300));
  check('Missing purchase cost today and leftover past shelf life are flagged red', c.text.includes('วันนี้ยังขาดต้นทุนซื้อ') && c.text.includes('กุ้งดอง') && c.text.includes('เสี่ยงเสีย') && c.red >= 3, c);
  const go = await page.evaluate(async () => { document.querySelector('#cmdCenter [data-cmdgo="purchase"]').click(); await new Promise(r => setTimeout(r, 500)); return document.querySelector('.tab.active, [data-tab].active') ? [...document.querySelectorAll('.panel.active')].map(p => p.id) : []; });
  check('Tapping a row opens the page to fix it', go.includes('panel-purchase'), go);

  // กำไรหด: ปูจืด ปกติซื้อ 130 (กำไร ~70/กก. ที่ราคาขาย 200) วันนี้ 180 → กำไร 20
  const m = await page.evaluate(async () => {
    const s = document.getElementById('purchProduct'); s.value = 'p4'; s.onchange();
    await new Promise(r => setTimeout(r, 700));
    document.getElementById('purchQty').value = 10; document.getElementById('purchPrice').value = 180;
    await updatePurchMarginHint_();
    const el = document.getElementById('purchMarginHint');
    const hint = { shown: el.style.display !== 'none', warn: el.classList.contains('warn'), text: el.textContent };
    let asked = ''; window.confirm = msg => { asked = msg; return false; };
    await addPurchase();
    const saved = window.__store['day:2026-10-20'].purchases.length;
    document.getElementById('purchPrice').value = 125; await updatePurchMarginHint_();
    const okHint = document.getElementById('purchMarginHint').className;
    return { hint, asked, saved, okHint, sale: priceOnDate('p4', '2026-10-20') };
  });
  check('Live warning while typing a cost that shrinks margin', m.hint.shown && m.hint.warn && m.hint.text.includes('กำไรเหลือ 20'), m);
  check('Asks before saving; cancelling saves nothing', m.asked.includes('ต่ำกว่าปกติ') && m.saved === 0, m);
  check('Normal cost shows a calm hint (no warning)', m.okHint.includes('ok'), m.okHint);
  await finish(browser);
})();
