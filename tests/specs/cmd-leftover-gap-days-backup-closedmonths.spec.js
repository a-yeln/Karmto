const path = require('path');
const fs = require('fs');
const { launch, mkDay, openApp, makeChecker } = require('../helpers');

// 🧭 ศูนย์บัญชาการ: วันย้อนหลังที่ "ยังไม่จดของเหลือ" (เกณฑ์เดียวกับ Notifications: computeDayGaps_ type 'leftover')
// แสดงอย่างเดียว ไม่เขียนข้อมูล • แตะวัน = ไปหน้าของเหลือของวันนั้น • ไม่นับวันนี้/เดือนที่ปิดแล้ว
// + ไฟล์สำรองมีคีย์ closedMonths รูปแบบเดียวกับคีย์อื่น
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const T = '2026-11-25';
  const closed = { '2026-10': { at: 1, dev: 'test' } };
  const store = () => ({
    rawLots: [],
    closedMonths: closed,
    ['day:2026-10-15']: mkDay({ orders: { '01': { p1: 2 } } }),                       // เดือนปิดแล้ว → ไม่แสดง
    ['day:2026-11-20']: mkDay({ orders: { '01': { p1: 3 } } }),                       // ขาด → แสดง
    ['day:2026-11-21']: mkDay({ orders: { '01': { p1: 3 } }, leftoverOut: { p2: 0 } }), // จดแล้ว (0) → ไม่แสดง
    ['day:2026-11-22']: mkDay({ orders: { '02': { p2: 4 } } }),                       // ขาด → แสดง
    ['day:2026-11-23']: mkDay({ expenses: [{ id: 'e1', amount: 50 }] }),                // ไม่มีออเดอร์ → ไม่แสดง
    ['day:2026-11-01"><img src=x id=evil>']: mkDay({ orders: { '01': { p1: 3 } } }), // คีย์แปลก → ต้องไม่เรนเดอร์
    ['day:' + T]: mkDay({ orders: { '01': { p1: 5 } } }),                             // วันนี้ → ไม่แสดง (อยู่ในเช็คลิสต์ 7 ขั้น)
  });
  const open = async () => {
    const page = await openApp(browser, { store: store(), date: T, viewport: { width: 420, height: 1100 } });
    await page.clock.setFixedTime(new Date(T + 'T10:00:00+07:00'));
    await page.route(/fonts\./, r => r.abort());
    await page.evaluate(c => { closedMonths_ = c; }, closed);
    return page;
  };

  const page = await open();
  const r = await page.evaluate(async () => {
    await switchTab('dashboard');
    const w0 = window.__writes.length;
    await renderTodayCommand_();
    const box = document.getElementById('cmdLeftGaps');
    return { has: !!box, text: box ? box.textContent : '', days: box ? [...box.querySelectorAll('[data-leftgap]')].map(b => b.getAttribute('data-leftgap')) : [], wrote: window.__writes.length - w0 };
  });
  check('Lists past days with orders but no leftover recorded, newest first', r.has && JSON.stringify(r.days) === JSON.stringify(['2026-11-22', '2026-11-20']) && r.text.includes('ยังไม่จดของเหลือ 2 วัน'), r);
  check('Skips today, closed month, days already recorded (even 0) and days without orders', !r.days.includes(T) && !r.days.includes('2026-10-15') && !r.days.includes('2026-11-21') && !r.days.includes('2026-11-23'), r.days);
  const evil = await page.evaluate(() => ({ img: !!document.querySelector('#cmdCenter #evil, #cmdCenter img[src="x"]'), btn: [...document.querySelectorAll('[data-leftgap]')].some(b => !/^\d{4}-\d{2}-\d{2}$/.test(b.getAttribute('data-leftgap'))) }));
  check('Odd day: key (with HTML chars) is not rendered as a button or img', !evil.img && !evil.btn, evil);
  check('Rendering writes nothing', r.wrote === 0, r.wrote);
  const same = await page.evaluate(async () => { const gaps = await computeDataGaps(); return gaps.filter(g => g.type === 'leftover' && /^\d{4}-\d{2}-\d{2}$/.test(g.iso) && g.iso < '2026-11-25' && g.iso >= '2026-11-01').map(g => g.iso).sort().reverse(); });
  check('Same days as the Notifications check (same rule)', JSON.stringify(same) === JSON.stringify(r.days), same);

  const go = await page.evaluate(async () => {
    const w0 = window.__writes.length;
    document.querySelector('[data-leftgap="2026-11-20"]').click();
    await new Promise(r => setTimeout(r, 800));
    return { date: currentDate, panels: [...document.querySelectorAll('.panel.active')].map(p => p.id), wrote: window.__writes.length - w0 };
  });
  check('Tapping a day opens the leftover page of that day (no writes)', go.date === '2026-11-20' && go.panels.includes('panel-leftover') && go.wrote === 0, go);
  await page.close();

  // ทุกธีม 420px: ไม่ล้นจอ ปุ่มวันแตะง่าย (≥44px) ตัวอักษรไม่กลืนพื้น
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (const theme of ['', 'mermaid', 'sea', 'neon']) {
    for (const mode of ['full', 'color']) {
      const p = await open();
      const m = await p.evaluate(async ({ theme, mode }) => {
        if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme');
        document.documentElement.setAttribute('data-tmode', mode);
        await switchTab('dashboard'); await renderTodayCommand_();
        const box = document.getElementById('cmdLeftGaps'); box.scrollIntoView({ block: 'center' });
        const chip = box.querySelector('.cmd-chip'); const cs = getComputedStyle(chip);
        return { overflow: document.documentElement.scrollWidth > window.innerWidth, boxRight: box.getBoundingClientRect().right, h: chip.getBoundingClientRect().height, color: cs.color, bg: cs.backgroundColor };
      }, { theme, mode });
      const name = (theme || 'macaron') + '-' + mode;
      check(`[${name}] no horizontal overflow, chip >=44px, text visible`, !m.overflow && m.boxRight <= 420 && m.h >= 44 && m.color !== m.bg, m);
      if (mode === 'full') await p.locator('#cmdCenter').screenshot({ path: path.join(SHOT_DIR, `cmd-leftover-gaps-${name}.png`) }).catch(() => {});
      await p.close();
    }
  }

  // ไฟล์สำรอง: closedMonths อยู่ในชุดสำรอง และอ่านออกเป็นคีย์ระดับบนสุดเหมือนคีย์อื่น (rawLots ฯลฯ)
  const bp = await open();
  const ex = await bp.evaluate(async () => {
    let blob = null; const orig = URL.createObjectURL;
    URL.createObjectURL = b => { blob = b; return orig.call(URL, b); };
    await exportAllData();
    URL.createObjectURL = orig;
    const j = JSON.parse(await blob.text());
    return { inList: BACKUP_EXTRA_ROOT_KEYS.includes('closedMonths'), cm: j.closedMonths, rawLotsIsTop: Array.isArray(j.rawLots) };
  });
  check('Backup file has closedMonths as a top-level key like the others', ex.inList && ex.rawLotsIsTop && ex.cm && ex.cm['2026-10'] && ex.cm['2026-10'].dev === 'test', ex);
  const gs = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'BackupTrigger.gs'), 'utf8');
  check('Daily backup (BackupTrigger.gs) also lists closedMonths', /BACKUP_EXTRA_ROOT_KEYS = \[[^\]]*'closedMonths'/.test(gs));
  await bp.close();
  await finish(browser);
})();
