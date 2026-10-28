const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// ปฏิทิน: จุดเหลือง = มีรายจ่ายกิจการ, จุดเล็กลง, ✅ กลางช่อง = ต้นทุนซื้อตรงออเดอร์ + ลงรายจ่ายแล้ว,
// ไอคอนปฏิทินบนปุ่มแสดงเดือนย่อ 3 ตัวอักษร + เลขวันที่จริงวันนี้, รายการล่าสุดขึ้นวันที่
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const exp = { id: 'e1', category: 'ค่าแรง', amount: 700, seller: '' };
  const store = {
    'day:2026-10-10': mkDay({ orders: { '01': { p1: 5 } }, purchases: [{ id: 'p-a', productId: 'p1', qty: 5, price: 100 }], expenses: [exp] }),
    'day:2026-10-11': mkDay({ orders: { '01': { p1: 5 } }, purchases: [{ id: 'p-b', productId: 'p1', qty: 3, price: 100 }], expenses: [exp] }),
    'day:2026-10-12': mkDay({ expenses: [exp] }),
    'day:2026-10-13': mkDay({ orders: { '01': { p1: 5 } }, purchases: [{ id: 'p-c', productId: 'p1', qty: 5, price: 100 }] }),
  };
  const page = await openApp(browser, { store, date: '2026-10-12', viewport: { width: 1280, height: 900 } });
  await page.evaluate(() => { settings.calendarDotsEnabled = true; });
  await page.click('#calBtn');
  await page.waitForSelector('[data-caliso="2026-10-10"] .cal-dots', { timeout: 5000 });
  await page.waitForTimeout(300);
  const cell = iso => page.evaluate(iso => {
    const el = document.querySelector(`[data-caliso="${iso}"]`);
    const dot = el.querySelector('.cal-dots span');
    return {
      buy: !!el.querySelector('.dot-buy'), sell: !!el.querySelector('.dot-sell'), exp: !!el.querySelector('.dot-exp'),
      check: !!el.querySelector('.cal-check'), dotW: dot ? dot.getBoundingClientRect().width : null,
    };
  }, iso);
  const c10 = await cell('2026-10-10'), c11 = await cell('2026-10-11'), c12 = await cell('2026-10-12'), c13 = await cell('2026-10-13');
  check('Balanced purchase + orders + expense: all three dots and ✅', c10.buy && c10.sell && c10.exp && c10.check, c10);
  check('Purchase short of orders: no ✅ even with expense', c11.buy && c11.sell && c11.exp && !c11.check, c11);
  check('Expense only: yellow dot only, no ✅', c12.exp && !c12.buy && !c12.sell && !c12.check, c12);
  check('Balanced but no business expense: no ✅, no yellow dot', c13.buy && c13.sell && !c13.exp && !c13.check, c13);
  check('Dots are smaller than before (was 5px)', c10.dotW > 0 && c10.dotW < 5, c10.dotW);

  const icon = await page.evaluate(() => ({ mon: document.getElementById('calIconMon').textContent, day: document.getElementById('calIconDay').textContent, iso: todayISO() }));
  const [, m, d] = icon.iso.split('-').map(Number);
  check('Icon top band shows the 3-letter English month of today', icon.mon === ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][m - 1], icon);
  check('Icon number is the real date today', icon.day === String(d), icon);

  await page.evaluate(() => { activityLogCache_ = [{ id: 'a1', ts: new Date(2026, 9, 5, 14, 7).getTime(), text: 'เพิ่มสาขา 99 ทดสอบ' }]; renderActivityFeed_(); });
  const feed = await page.evaluate(() => { const e = document.querySelector('#dashActivityFeed .dwtile-feed-time'); return e && e.textContent; });
  check('Latest-activity entry shows its date and time (dd/mm hh:mm)', feed === '05/10 14:07', feed);

  const wd = await page.evaluate(() => ['2026-10-25','2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31'].map(weekdayShortTH_));
  check('Weekday abbreviations Sun..Sat = อา จ อ พ พฤ ศ ส', JSON.stringify(wd) === JSON.stringify(['อา','จ','อ','พ','พฤ','ศ','ส']), wd);
  await page.evaluate(() => loadForDate('2026-10-26'));
  await page.waitForTimeout(600);
  const bar = await page.evaluate(() => ({ badge: document.getElementById('dwhWeekday').textContent, label: document.getElementById('dwhDateLabel').textContent }));
  check('Date bar badge shows the weekday of the selected date', bar.badge === 'จ' && bar.label === '26/10/2026 (จ)', bar);

  await finish(browser);
})();
