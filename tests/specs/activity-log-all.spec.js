const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// รายการล่าสุด: ทุกกิจกรรมถูกบันทึก แยกคีย์ต่อวัน (actlog:YYYY-MM-DD) กันคีย์เดียวโตจนเกินขนาดที่ Sheets รับได้
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { viewport: { width: 420, height: 900 } });
  const today = await page.evaluate(() => todayISO());
  await page.evaluate(async t => {
    window.__store['day:' + t] = { orders: {}, leftoverOut: {}, leftoverSince: {}, billingPaid: {}, billExtra: {}, billNote: {}, billNoteShowOnBill: {}, billClaimNotes: {}, expenses: [], personalIncome: [], personalExpense: [], purchases: [], purchaseGroupPayment: {}, messageOverrides: {}, feeNote: '', dashNote: '' };
    window.__store.activityLog = [{ id: 'old1', ts: Date.now() - 86400000 * 30, text: 'รายการเก่าแบบเดิม' }];
    await loadForDate(t);
  }, today);
  const code = await page.evaluate(() => settings.branches[0].code);

  // บันทึกออเดอร์ผ่านฟอร์มจริง
  await page.evaluate(async c => {
    await switchTab('order');
    const sel = document.getElementById('branchSelect'); sel.value = c; sel.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.prodinput[data-pid="p1"]').value = '3';
    await saveRow();
  }, code);
  // เปลี่ยนสถานะโอน, บันทึกของเหลือ, เพิ่มรายจ่าย, แก้ตั้งค่า
  await page.evaluate(async ([t, c]) => {
    await writeBillingPaid_(t, c, { paid: true, paidDate: t });
    await writeBillingPaid_(t, c, null);
    await switchTab('leftover');
    document.querySelectorAll('#leftoverOutForm [data-lpid]').forEach(i => { i.value = i.getAttribute('data-lpid') === 'p1' ? '1' : '0'; });
    await saveLeftover();
    await addExpenseCore_('น้ำแข็ง', 'พี่พัฒน์', '', 80, t);
    await saveBillInfo();
  }, [today, code]);
  await page.waitForTimeout(800);

  const log = await page.evaluate(t => ({ day: (window.__store['actlog:' + t] || []).map(e => e.text), legacyGrew: (window.__store.activityLog || []).length }), today);
  const has = re => log.day.some(t => re.test(t));
  check('Order save is logged with branch + items', has(new RegExp(`บันทึกออเดอร์ สาขา ${code}.*🦐3`)), log.day);
  check('Paid / back-to-pending toggles are logged', has(/✅ โอนแล้ว บิลสาขา/) && has(/↩️ เปลี่ยนเป็นรอโอน บิลสาขา/), log.day);
  check('Leftover save is logged', has(/บันทึกของเหลือ 🦐1/), log.day);
  check('Expense add is logged', has(/เพิ่มรายจ่าย น้ำแข็ง/), log.day);
  check('Settings change is logged', has(/แก้ไขตั้งค่า: ข้อมูลออกบิล/), log.day);
  check('New entries go to the per-day key, not the old single key', log.legacyGrew === 1, log);

  await page.evaluate(async () => { await switchTab('noti'); });
  const feed = await page.evaluate(() => ({ text: document.getElementById('dashActivityFeed').textContent, heads: document.querySelectorAll('#dashActivityFeed .actfeed-day').length }));
  check('Feed shows today\'s entries and the old single-key history, grouped by day', feed.text.includes('บันทึกออเดอร์') && feed.text.includes('รายการเก่าแบบเดิม') && feed.heads >= 2, feed.heads);

  await finish(browser);
})();
