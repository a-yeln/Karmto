const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ตัดต้นทุนล็อตข้ามเครื่อง: ต้องอ่านล็อตสดจากเซิร์ฟเวอร์ (ไม่ใช้แคชเก่า), มีกุญแจกันสองเครื่องตัดพร้อมกัน,
// และตอนคืนสถานะ (rollback) ต้องหักแค่ส่วนของรอบนี้ ไม่ลบส่วนที่เครื่องอื่นเพิ่งตัดไประหว่างนั้น
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const iso = '2026-10-20';
  const store = {
    ['day:' + iso]: mkDay({}),
    rawLots: [{ id: 'L1', productId: 'p4', seller: 'ตลาด', buyDate: '2026-10-18', qtyTotal: 10, pricePerKg: 200, billId: 'B1',
      draws: [{ id: 'D1', date: iso, qtyUsed: 10, sellableQty: 10, totalCost: 2000, costedQty: 0 }] }],
  };
  const page = await openApp(browser, { store, date: iso, viewport: { width: 1024, height: 1000 } });
  const costed = () => page.evaluate(() => window.__store.rawLots[0].draws[0].costedQty);

  // 1) แคชในเครื่องเก่า (costed 0) แต่อีกเครื่องตัดไปแล้ว 4 → รอบนี้ตัด 3 ต้องได้ 7 ไม่ใช่ 3
  await page.evaluate(async () => { await loadRawLots(); window.__store.rawLots[0].draws[0].costedQty = 4; });
  const r1 = await page.evaluate(async () => (await confirmLotSettle_('p4', { qty: 3, auto: true, skipRerender: true, suppressSuccessToast: true })).ok);
  check('Settle reads lots fresh from the server, adding on top of the other device', r1 === true && await costed() === 7, await costed());

  // 2) อีกเครื่องถือกุญแจอยู่ → ไม่ตัด, แจ้งเตือน
  const r2 = await page.evaluate(async () => {
    const toasts = []; const orig = window.showToast; window.showToast = m => { toasts.push(m); };
    window.__store.lotSettleLock = { dev: 'other-device', ts: Date.now() };
    const res = await confirmLotSettle_('p4', { qty: 1 });
    window.showToast = orig;
    return { ok: res.ok, toasts };
  });
  check('Another device holding the settle lock blocks this settle with a message', r2.ok === false && r2.toasts.some(t => t.includes('อีกเครื่อง')) && await costed() === 7, r2);

  // 3) กุญแจหมดอายุแล้ว → ตัดได้, และปล่อยกุญแจหลังเสร็จ
  const r3 = await page.evaluate(async () => {
    window.__store.lotSettleLock = { dev: 'other-device', ts: Date.now() - 60000 };
    const res = await confirmLotSettle_('p4', { qty: 1, auto: true, skipRerender: true, suppressSuccessToast: true });
    return { ok: res.ok, lock: window.__store.lotSettleLock };
  });
  check('An expired lock is taken over, and released afterwards', r3.ok && await costed() === 8 && r3.lock && r3.lock.dev === null, r3);

  // 4) บันทึกรายการต้นทุนพัง → คืนเฉพาะ +1 ของรอบนี้ แม้อีกเครื่องเพิ่ง +1 เข้าไประหว่างนั้น (8 → 9 → อีกเครื่อง 10 → คืน 9)
  const r4 = await page.evaluate(async () => {
    const orig = window.storage.patchOps;
    window.storage.patchOps = async function(key, ops, rootIsArray){
      if(String(key).indexOf('day:') === 0){ window.__store.rawLots[0].draws[0].costedQty += 1; throw new Error('network down'); }
      return orig.call(this, key, ops, rootIsArray);
    };
    const res = await confirmLotSettle_('p4', { qty: 1, auto: true, skipRerender: true, suppressSuccessToast: true });
    window.storage.patchOps = orig;
    return res.ok;
  });
  check('Rollback removes only this settle\'s own share, keeping the other device\'s', r4 === false && await costed() === 9, await costed());

  await finish(browser);
})();
