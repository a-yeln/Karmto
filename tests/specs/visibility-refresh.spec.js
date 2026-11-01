const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ซิงก์ข้ามเครื่อง: เครื่อง A (ไอโฟน) แก้บิลวันเก่า → เขียนป้าย dayRevs, เครื่อง B (แท็บเล็ต) ที่มีแคชวันนั้นอยู่
// ต้องเห็นของใหม่เมื่อกลับมาที่แอป (เดิมแคชวันเก่าในเครื่องไม่เคยโหลดซ้ำเลย แม้รีเฟรชหน้า)
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const oldDay = '2026-09-10';
  const store = { ['day:' + oldDay]: mkDay({ orders: { '01': { p1: 5, p3: 2 } } }) };
  const page = await openApp(browser, { store, date: oldDay, viewport: { width: 420, height: 900 } });
  await page.evaluate(async d => { await loadForDate(d); }, oldDay);
  check('Old day cached on this device, unpaid', await page.evaluate(d => { writeDayToLocalStorage_(d, dayCache_[d]); return !!readDayFromLocalStorage_(d) && !dayData.billingPaid['01']; }, oldDay));

  // เครื่องเราเองแก้ → ต้องสแตมป์ป้ายบนเซิร์ฟเวอร์ (รวมเป็นคำขอเดียว)
  await page.evaluate(async d => { await writeDayFieldPath_(d, ['billNote', '01'], 'x'); }, oldDay);
  await page.waitForTimeout(700);
  const own = await page.evaluate(d => ({ server: (window.__store.dayRevs || {})[d], local: readLocalDayRev_(d) }), oldDay);
  check('Own write stamps the shared version marker', !!own.server && own.server === own.local, own);
  check('Own write is not treated as a remote change', await page.evaluate(async () => (await syncDayRevs_()).length === 0));

  // จำลองไอโฟนกดจ่ายบิลวันเดียวกัน: เขียนตรงเข้าเซิร์ฟเวอร์ + ป้ายใหม่ (ไม่ผ่านเครื่องนี้)
  await page.evaluate(d => {
    const doc = JSON.parse(JSON.stringify(window.__store['day:' + d]));
    doc.billingPaid['01'] = { paid: true, paidDate: d };
    window.__store['day:' + d] = doc;
    window.__store.dayRevs = Object.assign({}, window.__store.dayRevs, { [d]: 'iphone-rev' });
  }, oldDay);

  await page.evaluate(() => { hiddenAt_ = Date.now() - 10000; document.activeElement && document.activeElement.blur(); });
  await page.evaluate(() => syncFromOtherDevices_());
  const after = await page.evaluate(d => ({ paid: !!dayData.billingPaid['01'], cachePaid: !!(readDayFromLocalStorage_(d) || {billingPaid:{}}).billingPaid['01'], rev: readLocalDayRev_(d) }), oldDay);
  check('Tablet picks up the iPhone edit on resume', after.paid, after);
  check('Device cache refreshed with the new version', after.cachePaid && after.rev === 'iphone-rev', after);

  // ระหว่างพิมพ์อยู่ห้ามวาดใหม่ — รอรอบถัดไป
  await page.evaluate(d => {
    const doc = JSON.parse(JSON.stringify(window.__store['day:' + d]));
    doc.billingPaid['01'] = null; window.__store['day:' + d] = doc;
    window.__store.dayRevs = Object.assign({}, window.__store.dayRevs, { [d]: 'iphone-rev-2' });
    const inp = document.createElement('input'); inp.id = '__t'; document.body.appendChild(inp); inp.focus();
  }, oldDay);
  await page.evaluate(() => syncFromOtherDevices_());
  check('No re-render while the user is typing', await page.evaluate(() => !!dayData.billingPaid['01'] && pendingSyncRender_));
  await page.evaluate(() => { document.getElementById('__t').remove(); });
  await page.evaluate(() => syncFromOtherDevices_());
  check('Deferred refresh applies once the user is done', await page.evaluate(() => !dayData.billingPaid['01'] && !pendingSyncRender_));

  await finish(browser);
})();
