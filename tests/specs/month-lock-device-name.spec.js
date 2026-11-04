const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ล็อกปิดเดือน: เดือนที่ปิดแก้ข้อมูลไม่ได้ (ยกเว้นสถานะโอน/จ่าย), ปิด/ปลดล็อกได้จากตั้งค่า — และรายการกิจกรรมมีชื่อเครื่อง
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const store = {
    ['day:2026-09-10']: mkDay({ orders: { '01': { p1: 2 } }, purchases: [{ id: 'pu1', productId: 'p1', qty: 2, price: 180, seller: 'มนต์', paid: false }] }),
    ['day:2026-10-20']: mkDay({}),
    closedMonths: { '2026-09': { at: '2026-10-01T00:00:00Z', dev: 'iPhone' } },
    rawLots: [],
  };
  const page = await openApp(browser, { store, date: '2026-10-20', viewport: { width: 1024, height: 1000 } });

  const r = await page.evaluate(async () => {
    await loadClosedMonths_();
    const out = {};
    const tryIt = async f => { try { await f(); return 'ok'; } catch (e) { return e.monthLocked ? 'locked' : 'err:' + e.message; } };
    out.addPurchase = await tryIt(() => writeDayArrayOp_('2026-09-10', 'purchases', { push: { id: 'x', productId: 'p1', qty: 1, price: 1 } }));
    out.saveDay = await tryIt(() => window.storage.set('day:2026-09-10', JSON.stringify({})));
    out.markPaid = await tryIt(() => writeBillingPaid_('2026-09-10', '01', { paid: true, paidDate: '2026-10-05' }));
    out.purchasePaid = await tryIt(() => writeDayArrayOp_('2026-09-10', 'purchases', { matchField: 'id', matchValue: 'pu1', set: { paid: true } }));
    out.purchaseQty = await tryIt(() => writeDayArrayOp_('2026-09-10', 'purchases', { matchField: 'id', matchValue: 'pu1', set: { qty: 9 } }));
    out.oldLot = await tryIt(() => writeRootArrayOp_('rawLots', { push: { id: 'L9', productId: 'p4', buyDate: '2026-09-05', qtyTotal: 1, draws: [] } }, () => {}));
    out.openMonth = await tryIt(() => writeDayArrayOp_('2026-10-20', 'purchases', { push: { id: 'y', productId: 'p1', qty: 1, price: 1 } }));
    out.data = window.__store['day:2026-09-10'].purchases.map(e => [e.id, e.qty, !!e.paid]);
    out.toast = document.getElementById('toast').textContent;
    return out;
  });
  check('Edits to a closed month are blocked (order/purchase/whole-day/new lot)', r.addPurchase === 'locked' && r.saveDay === 'locked' && r.purchaseQty === 'locked' && r.oldLot === 'locked', r);
  check('Payment status still works in a closed month', r.markPaid === 'ok' && r.purchasePaid === 'ok', r);
  check('Open months are unaffected', r.openMonth === 'ok', r);
  check('Closed-month data stayed as it was (except paid flag)', JSON.stringify(r.data) === '[["pu1",2,true]]', r.data);
  check('User sees a clear lock message', r.toast.includes('ปิดแล้ว'), r.toast);

  // ตั้งค่า: ปิดเดือน 2026-10 แล้วปลดล็อก
  await page.evaluate(() => { window.confirm = () => true; });
  const s = await page.evaluate(async () => {
    await switchTab('settings');
    document.getElementById('closeMonthSelect').value = '2026-10';
    document.getElementById('closeMonthBtn').click();
    await new Promise(r => setTimeout(r, 400));
    const closed = Object.keys(window.__store.closedMonths).sort();
    const label = document.getElementById('dwhDateLabel').textContent;
    document.querySelector('[data-unlockmonth="2026-10"]').click();
    await new Promise(r => setTimeout(r, 400));
    return { closed, label, after: Object.keys(window.__store.closedMonths).sort(), list: document.getElementById('closedMonthsList').textContent };
  });
  check('Close month from Settings; header shows the lock', JSON.stringify(s.closed) === '["2026-09","2026-10"]' && s.label.includes('ปิดเดือนแล้ว'), s);
  check('Unlock from Settings', JSON.stringify(s.after) === '["2026-09"]' && s.list.includes('Sep 2026'), s);

  // ชื่อเครื่องในรายการกิจกรรม
  const dev = await page.evaluate(async () => {
    document.getElementById('deviceNameInput').value = 'แท็บเล็ตหน้าร้าน';
    document.getElementById('deviceNameSaveBtn').click();
    await loadActivityLog();
    await logActivity_('ทดสอบชื่อเครื่อง');
    await new Promise(r => setTimeout(r, 200));
    const key = Object.keys(window.__store).find(k => k.startsWith('actlog:'));
    const last = window.__store[key].slice(-1)[0];
    return { dev: last.dev, feed: document.getElementById('dashActivityFeed').textContent };
  });
  check('Activity log entries carry the device name', dev.dev === 'แท็บเล็ตหน้าร้าน' && dev.feed.includes('แท็บเล็ตหน้าร้าน'), dev);

  await finish(browser);
})();
