const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// คิวบันทึกตอนออฟไลน์ (เก็บในเครื่อง → ส่งเองเมื่อเน็ตกลับ, ส่งซ้ำไม่ซ้ำ) + แคชรายชื่อวัน (ไม่พลาดวันที่เพิ่งสร้าง)
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const page = await openApp(browser, { store: { ['day:' + iso]: mkDay({}), rawLots: [] }, date: iso, viewport: { width: 1024, height: 900 } });

  const r = await page.evaluate(async iso => {
    window.__forceOffline = true;
    localStorage.removeItem('karmto_offline_queue');
    const fresh = await writeDayArrayOp_(iso, 'purchases', { push: { id: 'off1', productId: 'p1', qty: 2, price: 180, seller: 'มนต์', paid: false } });
    await writeDayArrayOp_(iso, 'expenses', { push: { id: 'off2', category: 'ค่าน้ำแข็ง', amount: 40, paid: false } });
    let setErr = '';
    try { await window.storage.set('day:' + iso, '{}'); } catch (e) { setErr = e.message; }
    return {
      localShows: fresh.purchases.some(e => e.id === 'off1') && dayCache_[iso].expenses.some(e => e.id === 'off2'),
      serverEmpty: window.__store['day:' + iso].purchases.length === 0,
      queued: JSON.parse(localStorage.getItem('karmto_offline_queue') || '[]').length,
      badge: document.getElementById('offlineQueueBadge').textContent,
      setErr,
    };
  }, iso);
  check('Offline: write is kept on this device and shown right away (server untouched)', r.localShows && r.serverEmpty && r.queued === 2, r);
  check('Offline badge shows pending count', r.badge.includes('รอส่ง 2'), r.badge);
  check('Whole-document overwrite is refused while offline', r.setErr.startsWith('Offline'), r.setErr);

  const r2 = await page.evaluate(async iso => {
    window.__forceOffline = false;
    // จำลองส่งไปแล้วครั้งหนึ่งแต่ตอบกลับไม่ทัน: คิวยังมีอยู่ ส่งซ้ำต้องไม่ได้รายการซ้ำ
    const q = JSON.parse(localStorage.getItem('karmto_offline_queue'));
    await window.storage.patchOps('day:' + iso, q[0].ops, false);
    window.__offlineDbg = 1;
    await flushOfflineQueue_();
    const d = window.__store['day:' + iso];
    return { p: d.purchases.filter(e => e.id === 'off1').length, e: d.expenses.filter(e => e.id === 'off2').length, left: (localStorage.getItem('karmto_offline_queue') || '[]'), badgeHidden: document.getElementById('offlineQueueBadge').style.display === 'none' };
  }, iso);
  check('Back online: queue is sent in order, no duplicates even if one already got through', r2.p === 1 && r2.e === 1 && r2.left === '[]' && r2.badgeHidden, r2);

  // แคชรายชื่อวัน: ขอซ้ำไม่ยิงเซิร์ฟเวอร์ แต่วันที่เพิ่งเขียนต้องโผล่ทันที
  const l = await page.evaluate(async () => {
    let calls = 0;
    const raw = Object.getPrototypeOf(window.storage);
    const orig = raw.list;
    raw.list = async function (p) { calls++; return orig.call(this, p); };
    window.storage.__clearListCache();
    await window.storage.list('day:'); await window.storage.list('day:');
    await writeDayArrayOp_('2026-10-25', 'expenses', { push: { id: 'n1', category: 'x', amount: 1 } });
    const keys = (await window.storage.list('day:')).keys;
    raw.list = orig;
    return { calls, hasNew: keys.includes('day:2026-10-25') };
  });
  check('Day list is cached (one server call) and new days appear immediately', l.calls === 1 && l.hasNew, l);

  await finish(browser);
})();
