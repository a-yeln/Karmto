const { launch, mkDay, openApp, makeChecker, stripBanner } = require('../helpers');

// คีย์ day: รูปแบบแปลก (มี HTML) ต้องไม่ไหลไปถึง innerHTML/attribute — แสดงผลอย่างเดียว ไม่เขียนข้อมูล
// ตัวกรองกลางคือ dayIsos_ (แสดงผล/คำนวณเท่านั้น; exportAllData ต้องยังเก็บทุกคีย์ ไม่ให้ไฟล์สำรองตกหล่น)
const TODAY = '2026-11-12';
const EVIL = 'day:2026-11-<img src=x id=evil>';
const bill = amt => ({ custom: [{ name: 'ของ', qty: 1, price: amt }] });

function seedStore(){
  const evilDay = mkDay({
    orders: { '01': bill(999) },
    expenses: [{ id: 'e-evil', seller: 'ผู้ขายแปลก', category: 'อื่นๆ', amount: 500, paid: false }],
  });
  return {
    ['day:' + TODAY]: mkDay({ orders: { '02': bill(1250) }, expenses: [{ id: 'e1', seller: 'ผู้ขาย', category: 'อื่นๆ', amount: 300, paid: false }] }),
    ['day:2026-11-05']: mkDay({ orders: { '03': bill(800) } }),
    [EVIL]: evilDay,
  };
}
const noEvil = page => page.evaluate(() => !document.getElementById('evil') && !document.querySelector('[id*="evil"],img[src="x"]'));

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const page = await openApp(browser, { store: seedStore(), date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await stripBanner(page);
  await page.evaluate(() => { window.__writes = []; });

  // ตัวกรองกลาง
  check('dayIsos_ ตัดคีย์แปลก เหลือเฉพาะ YYYY-MM-DD', await page.evaluate(() => {
    const r = dayIsos_({ keys: ['day:2026-11-05', 'day:2026-11-<img src=x id=evil>', 'day:abc'] });
    return r.length === 1 && r[0] === '2026-11-05';
  }));
  check('dayIsos_ รับผลว่าง/ไม่มี keys ได้', await page.evaluate(() => dayIsos_(null).length === 0 && dayIsos_({}).length === 0));

  // P&L (แดชบอร์ด) + ศูนย์บัญชาการ
  await page.evaluate(async () => { await switchTab('dashboard'); });
  await page.waitForTimeout(800);
  check('แดชบอร์ด (P&L + ศูนย์บัญชาการ): ไม่เกิด element id=evil', await noEvil(page));
  check('แดชบอร์ดยังใช้งานได้ (มีเนื้อหา)', await page.evaluate(() => document.getElementById('panel-dashboard').textContent.trim().length > 50));
  check('P&L ยังคำนวณเดือนได้ ไม่นับวันแปลก', await page.evaluate(async () => {
    const isos = dayIsos_(await window.storage.list('day:2026-11'));
    return isos.slice().sort().join(',') === '2026-11-05,2026-11-12';
  }));
  check('computeTodayCommand_ ทำงานได้', await page.evaluate(async () => { const r = await computeTodayCommand_(); return !!r; }));

  // Notifications (ช่องว่างข้อมูล)
  await page.evaluate(async () => { await switchTab('noti'); });
  await page.waitForTimeout(500);
  check('Notifications: ไม่เกิด element id=evil', await noEvil(page));
  check('Notifications ยังโหลดได้', await page.evaluate(() => document.getElementById('panel-noti').textContent.trim().length > 20));

  // ค้างจ่าย / ค้างโอน
  await page.evaluate(async () => { await switchTab('billing'); await renderOutstanding(); });
  await page.waitForTimeout(500);
  check('ค้างโอน: ไม่เกิด element id=evil', await noEvil(page));
  check('ค้างโอนยังโชว์บิลปกติ', await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length >= 2));
  check('ค้างโอนไม่มีแถวของวันแปลก', await page.evaluate(() => !Array.from(document.querySelectorAll('[data-outstandingrow]')).some(e => /evil|</.test(e.getAttribute('data-outstandingrow')))));
  await page.evaluate(async () => { await renderOutstandingLineMsgs_(); });
  check('ข้อความทวง LINE: ไม่เกิด element id=evil', await noEvil(page));

  // รายจ่ายทั้งหมด + ยอดค้างจ่ายรวม
  await page.evaluate(async () => { await switchTab('purchase'); await renderAllExpenseList(); });
  await page.waitForTimeout(500);
  check('รายจ่ายทั้งหมด: ไม่เกิด element id=evil', await noEvil(page));
  check('รายจ่ายทั้งหมดยังโชว์รายการปกติ', await page.evaluate(() => document.getElementById('allExpenseList').textContent.includes('ผู้ขาย')));
  check('ยอดค้างจ่ายรวมไม่นับวันแปลก (฿300)', await page.evaluate(async () => { const r = await computeAllExpensePayables(); return r.total === 300 && r.count === 1; }));

  // ไม่มีการเขียนข้อมูลเพิ่ม
  const writes = await page.evaluate(() => window.__writes.filter(w => w.key !== 'dayRevs'));
  check('ไม่มีการเขียนข้อมูล (window.__writes ไม่เพิ่ม)', writes.length === 0, writes);

  // สำรองข้อมูลต้องไม่ตกหล่น: ยังเก็บคีย์แปลกไว้ในไฟล์สำรอง (ไม่กรองใน exportAllData)
  const src = await page.evaluate(() => exportAllData.toString());
  check('exportAllData ไม่ใช้ dayIsos_ (ไฟล์สำรองครบทุกคีย์)', !/dayIsos_/.test(src));

  await finish(browser);
})();
