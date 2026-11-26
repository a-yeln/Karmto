const path = require('path');
const { launch, mkDay, openApp, makeChecker, stripBanner, installMockStorage } = require('../helpers');

// แยกส่ง ชุด 2 ส่วน C: การ์ด "🗂️ สาขาวันนี้" (หน้าออเดอร์) — แตะแถบหัว = พับ/กาง (จำต่อเครื่องใน localStorage karmto.branchGridFold, ไม่ลงข้อมูลร้าน)
// หน้า 1 = สาขาไม่แยกส่ง และไม่ติ๊ก "นานๆ สั่งที" • หน้า 2 = แถว 🚚 (ทุกสาขาที่ติ๊กแยกส่ง) ก่อนแถว ⏳ (นานๆ สั่งที ที่ไม่แยกส่ง)
// สาขาที่ติ๊กทั้งแยกส่งและนานๆ ที (13T/16T จริง) = ขึ้นแถว 🚚 แถวเดียว • แตะปุ่ม = เปิดฟอร์มอย่างเดียว ห้ามเขียนข้อมูล
// ตรึงวันที่ด้วย setFixedTime แล้วปล่อยเวลาเดินต่อ (setSystemTime) เพราะการ์ดสถานะบันทึกของฟอร์มอิง Date.now() — วันที่ยังเป็น 20/11/2026 +07:00
const TODAY = '2026-11-20';
const SHOT_DIR = process.env.SHOT_DIR || path.join(__dirname, '..', 'screenshots');
const mkT = (code, extra) => Object.assign({ code, area: '', label: 'สาขา ' + code.replace(/t$/i, '') + '(แยกส่ง)', separate: true, rare: true, billName: '', billAddr: '', billTax: '' }, extra || {});

// ข้อมูลตั้งต้น: DEFAULT_BRANCHES 24 รหัส (13S/16S แยกส่ง) + 13T/16T ติ๊กทั้งแยกส่ง+นานๆ ที + 06/25 นานๆ ที (ไม่แยกส่ง)
// หน้า 1 = 22 − 2 (06, 25) = 20 สาขา • ออเดอร์: 01 (ปกติ), 03 (มีแต่ "+ อื่นๆ"), 13T/16T/13S (แยกส่ง), 25 (นานๆ ที)
const SETUP = { add: [mkT('13T'), mkT('16T')], patch: { '06': { rare: true }, '25': { rare: true } } };
const seedStore = () => ({ rawLots: [], ['day:' + TODAY]: mkDay({ orders: { '01': { p1: 1 }, '03': { custom: [{ name: 'ซอส', qty: 2, price: 30 }] }, '13T': { p1: 1 }, '16T': { p6: 1 }, '13S': { p1: 2 }, '25': { p2: 1 } } }) });

const applySetup = (page, { add = [], remove = [], patch = {}, all = null }) => page.evaluate(({ add, remove, patch, all }) => {
  settings.branches = settings.branches.filter(b => !remove.includes(b.code));
  if (all) settings.branches.forEach(b => Object.assign(b, all));
  add.forEach(b => { if (!settings.branches.some(x => x.code === b.code)) settings.branches.push(b); });
  Object.entries(patch).forEach(([c, p]) => Object.assign(settings.branches.find(b => b.code === c), p));
}, { add, remove, patch, all });

async function boot(browser, { store = seedStore(), viewport, setup = SETUP, clearFold = true } = {}) {
  const page = await openApp(browser, { store, date: TODAY, viewport });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00'));
  page.on('dialog', d => d.dismiss());
  if (clearFold) await page.evaluate(() => { try { localStorage.removeItem('karmto.branchGridFold'); } catch (e) {} });
  await applySetup(page, setup);
  await page.evaluate(async () => { await switchTab('order'); refreshOrderTab(); });
  await stripBanner(page);
  return page;
}
// รีโหลดหน้าแล้วตั้งค่าเหมือนตอนเปิดครั้งแรก (localStorage คงอยู่ข้ามรีโหลดใน context เดียวกัน)
async function reloadApp(page, store = seedStore(), setup = SETUP) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof settings !== 'undefined' && settings && settings.branches, null, { timeout: 15000 });
  await stripBanner(page);
  await installMockStorage(page);
  await page.evaluate(({ store, date }) => { Object.assign(window.__store, store); currentDate = date; dayData = normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:' + date]))); dayCache_[date] = dayData; }, { store, date: TODAY });
  await page.clock.setFixedTime(new Date(TODAY + 'T10:00:00+07:00'));
  await page.clock.setSystemTime(new Date(TODAY + 'T10:00:00+07:00'));
  await applySetup(page, setup);
  await page.evaluate(async () => { await switchTab('order'); refreshOrderTab(); });
  await stripBanner(page);
}

const writes = page => page.evaluate(() => window.__writes.map(w => w.op + ':' + w.key));
// ล้างบันทึกการเขียนหลังงานเบื้องหลัง (dayRevs หน่วง 400ms / actlog) นิ่งแล้ว — กันเช็ค "ไม่เขียนอะไร" แดงแบบสุ่มตอนเครื่องช้า
const resetW = async page => {
  await page.evaluate(() => new Promise(res => {
    let last = -1, n = 0;
    const tick = () => { const quiet = Object.keys(pendingDayRevs_).length === 0 && window.__writes.length === last; n = quiet ? n + 1 : 0; last = window.__writes.length; if (n >= 6) return res(); requestAnimationFrame(tick); };
    tick();
  }));
  await page.evaluate(() => { window.__writes = []; });
};
const lsFold = page => page.evaluate(() => localStorage.getItem('karmto.branchGridFold'));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const setTheme = (page, th, mode = 'full') => page.evaluate(({ th, mode }) => {
  if (th) { document.documentElement.setAttribute('data-theme', th); document.documentElement.setAttribute('data-tmode', mode); }
  else { document.documentElement.removeAttribute('data-theme'); document.documentElement.removeAttribute('data-tmode'); }
}, { th, mode });
const toPage = async (page, n) => {
  await page.evaluate(n => { const el = document.getElementById('branchGrid'); el.scrollTo({ left: n ? el.scrollWidth : 0, behavior: 'instant' }); }, n);
  await page.waitForFunction(n => document.getElementById('branchGridVp').getAttribute('data-page') === String(n), n, { timeout: 4000 });
  await page.waitForTimeout(120);
};
// อ่านโครงการ์ดทั้งหมดจาก DOM
const readGrid = page => page.evaluate(() => {
  const el = document.getElementById('branchGrid');
  const chip = c => ({ code: c.getAttribute('data-bgcode'), label: c.querySelector('.n').textContent, has: c.classList.contains('has'), sel: c.classList.contains('sel'), split: c.classList.contains('split'), rare: c.classList.contains('rare'), tk: !!c.querySelector('.bgc-tk'), hg: !!c.querySelector('.bgc-hgb'), ck: getComputedStyle(c.querySelector('.ck')).display !== 'none' });
  const pages = [...el.querySelectorAll('.bgc-page')];
  const p1 = el.querySelector('.bgc-page.p1');
  const p2 = pages.find(p => !p.classList.contains('p1'));
  const groups = p2 ? [...p2.querySelectorAll('.bgc-grid')].map(g => ({ kind: g.querySelector('.bgc-lead.sep') ? 'sep' : (g.querySelector('.bgc-lead.rare') ? 'rare' : '?'), chips: [...g.querySelectorAll('.bg-chip')].map(chip) })) : [];
  const cnt = document.getElementById('branchGridCount'), sep = document.getElementById('branchGridSep'), vp = document.getElementById('branchGridVp');
  return {
    pageCount: pages.length, p1: p1 ? [...p1.querySelectorAll('.bg-chip')].map(chip) : [], groups, dividers: el.querySelectorAll('.bgc-divider').length,
    count: cnt.textContent, countAria: cnt.getAttribute('aria-label'), sepText: sep.textContent, sepHidden: sep.hidden, sepAria: sep.getAttribute('aria-label'),
    prog: document.getElementById('branchGridProg').style.width, dots: document.getElementById('branchGridDots').children.length, multi: vp.getAttribute('data-multi'), pageNo: vp.getAttribute('data-page'),
    all: [...el.querySelectorAll('.bg-chip')].map(c => c.getAttribute('data-bgcode')),
  };
});
const shotCard = async (page, name) => {
  const clip = await page.evaluate(() => { const el = document.getElementById('branchGridCard'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 10), width: innerWidth, height: Math.min(900, r.height + 20) }; });
  await page.screenshot({ path: path.join(SHOT_DIR, name), clip, fullPage: true }).catch(() => {});
};

(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();

  // ============ C1: โครงหน้า 1 / หน้า 2 + ตัวนับ ============
  {
    const page = await boot(browser);
    await resetW(page);
    const G = await readGrid(page);
    const cfg = await page.evaluate(() => ({
      normal: settings.branches.filter(b => !b.separate && !b.rare).map(b => b.code), sepAll: settings.branches.filter(b => b.separate).map(b => b.code),
      rareOnly: settings.branches.filter(b => b.rare && !b.separate).map(b => b.code), total: settings.branches.length,
    }));
    check('C1: หน้า 1 = สาขาไม่แยกส่งและไม่ "นานๆ สั่งที" เรียงตามลำดับในตั้งค่า (20 สาขา: ไม่มี 06, 25, 13S, 16S, 13T, 16T)', G.p1.map(c => c.code).join() === cfg.normal.join() && G.p1.length === 20 && !G.p1.some(c => ['06', '25', '13S', '16S', '13T', '16T'].includes(c.code)), { p1: G.p1.map(c => c.code), cfg });
    check('C1: หน้า 1 ไม่มีป้าย 🚚/⏳ (ยกเว้นปุ่ม 13 และ 16 ที่ฝั่งแยกส่งมีออเดอร์)', G.p1.filter(c => c.tk).map(c => c.code).join() === '13,16' && !G.p1.some(c => c.hg), G.p1.filter(c => c.tk || c.hg).map(c => c.code));
    check('C1: มีสองหน้า (หน้า 1 + หน้า 2) จุดบอกหน้า 2 จุด data-multi=1', G.pageCount === 2 && G.dots === 2 && G.multi === '1' && G.pageNo === '0', { pc: G.pageCount, dots: G.dots, multi: G.multi });
    check('C1: หน้า 2 เรียงแถว 🚚 ก่อนแถว ⏳ (กลุ่มแรก = sep, กลุ่มสอง = rare) มีเส้นคั่น 1 เส้น', G.groups.map(g => g.kind).join() === 'sep,rare' && G.dividers === 1, G.groups.map(g => g.kind));
    const sep = G.groups[0], rare = G.groups[1];
    check('C1: แถว 🚚 = ทุกสาขาที่ติ๊กแยกส่งตามลำดับตั้งค่า: 13S, 16S, 13T, 16T', sep.chips.map(c => c.code).join() === '13S,16S,13T,16T' && sep.chips.map(c => c.code).join() === cfg.sepAll.join(), sep.chips.map(c => c.code));
    check('C1: ป้ายปุ่มแถว 🚚: 13T→"13", 16T→"16" (ตัด T ท้าย) ส่วน 13S/16S แสดงดิบ', sep.chips.map(c => c.label).join() === '13S,16S,13,16', sep.chips.map(c => c.label));
    check('C1: แถว ⏳ = นานๆ สั่งที ที่ไม่แยกส่ง (06, 25) ทุกปุ่มมีป้ายนาฬิกาทราย และไม่มี 13T/16T', rare.chips.map(c => c.code).join() === '06,25' && rare.chips.every(c => c.hg && c.rare), rare.chips);
    check('C1: 13T/16T (ติ๊กทั้งแยกส่ง+นานๆ ที) ขึ้นแถว 🚚 แถวเดียว — ปุ่มละ 1 ปุ่มในทั้งการ์ด ไม่ซ้ำในแถว ⏳', ['13T', '16T'].every(c => G.all.filter(x => x === c).length === 1) && !rare.chips.some(c => /T$/.test(c.code)) && sep.chips.filter(c => /T$/.test(c.code)).length === 2, G.all.filter(x => /T$/.test(x)));
    check('C1: ทุกสาขาแตะได้ครบ 1 ปุ่มต่อ 1 สาขา (ไม่ตกหล่น ไม่ซ้ำ)', G.all.length === cfg.total && new Set(G.all).size === G.all.length, { n: G.all.length, total: cfg.total });
    check('C1: ปุ่มแถว 🚚 ใช้คลาส split; ปุ่มที่มีออเดอร์ = .has + เครื่องหมายถูก (13S, 13T, 16T ✓ / 16S ไม่)', sep.chips.every(c => c.split) && sep.chips.filter(c => c.has).map(c => c.code).join() === '13S,13T,16T' && sep.chips.filter(c => c.has).every(c => c.ck), sep.chips);
    check('C1: สาขา 03 (มีแต่ "+ อื่นๆ") นับว่าบันทึกแล้ว (.has) และ 25 (นานๆ ที) ขึ้น .has ที่แถว ⏳', G.p1.find(c => c.code === '03').has && rare.chips.find(c => c.code === '25').has && !rare.chips.find(c => c.code === '06').has, { p03: G.p1.find(c => c.code === '03'), rare: rare.chips });
    check('C1: ปุ่ม 13 (ปกติ) ยังไม่ติ๊ก แม้ 13T มีออเดอร์ แต่มีป้าย 🚚 มุมปุ่ม; 16 เช่นเดียวกัน; 01 ติ๊กปกติ', !G.p1.find(c => c.code === '13').has && G.p1.find(c => c.code === '13').tk && !G.p1.find(c => c.code === '16').has && G.p1.find(c => c.code === '16').tk && G.p1.find(c => c.code === '01').has && !G.p1.find(c => c.code === '01').tk, G.p1.filter(c => ['01', '13', '16'].includes(c.code)));
    check('C1: ตัวนับ = หน้า 1 เท่านั้น "2/20" (01 กับ 03; 13T/16T/13S/25 ไม่นับ) + aria-label', G.count === '2/20' && G.countAria === 'บันทึกแล้ว 2 จาก 20 สาขา', { count: G.count, aria: G.countAria });
    check('C1: ชิป 🚚 = จำนวนสาขาแยกส่งที่มีออเดอร์ "🚚3" (13S, 13T, 16T) ไม่ซ่อน', !G.sepHidden && G.sepText.replace(/\s/g, '') === '🚚3' && G.sepAria === 'แยกส่งบันทึกแล้ว 3 สาขา', { t: G.sepText, h: G.sepHidden, a: G.sepAria });
    check('C1: แถบคืบหน้า = 2/20 = 10%', G.prog === '10%', G.prog);
    check('C1: การ์ดนี้เปิดดู/วาดอย่างเดียว ไม่เขียนข้อมูลอะไรเลย', (await writes(page)).length === 0);
    check('C1: ไม่มีข้อความอธิบายยาว "แตะสาขาเพื่อกรอก…" และหัวการ์ดไม่มีปุ่ม/ลูกศร (แตะทั้งแถบ)', await page.evaluate(() => { const c = document.getElementById('branchGridCard'); const h = document.getElementById('branchGridHead'); return !/แตะสาขาเพื่อกรอก/.test(c.textContent) && h.querySelectorAll('button, svg, .collapsible').length === 0 && h.getAttribute('role') === 'button' && h.getAttribute('tabindex') === '0' && /สาขาวันนี้/.test(h.textContent); }));
    // ลำดับใน DOM จริง: แถว 🚚 มาก่อน ⏳ ทั้งตำแหน่งบนจอ (หน้า 2 เลื่อนซ้ายไปดู)
    await toPage(page, 1);
    const pos = await page.evaluate(() => { const lead = c => document.querySelector('#branchGrid .bgc-lead.' + c).getBoundingClientRect(); return { sep: lead('sep').top, rare: lead('rare').top }; });
    check('C1: บนจอหน้า 2: แถว 🚚 อยู่เหนือแถว ⏳', pos.sep < pos.rare, pos);
    await toPage(page, 1);
    check('C1: เลื่อนไปหน้า 2 → จุดบอกหน้า/data-page = 1 (ฟัง scroll)', await page.evaluate(() => document.getElementById('branchGridVp').getAttribute('data-page') === '1' && document.getElementById('branchGridDots').children[1].classList.contains('on') && !document.getElementById('branchGridDots').children[0].classList.contains('on')));
    await page.close();
  }

  // ============ C2: แตะปุ่ม = เปิดฟอร์มอย่างเดียว ไม่เขียน ============
  {
    const page = await boot(browser);
    await resetW(page);
    const form = () => page.evaluate(() => ({ sel: document.getElementById('branchSelect').value, pick: document.getElementById('branchPick').value, side: document.getElementById('orderFormCard').dataset.side, selChips: [...document.querySelectorAll('#branchGrid .bg-chip.sel')].map(c => c.dataset.bgcode), st: document.getElementById('orderFormCard').dataset.save }));
    await page.click('#branchGrid [data-bgcode="05"]');
    const a = await form();
    check('C2: แตะ 05 (หน้า 1) → เปิดฟอร์ม 05 + ไฮไลต์ปุ่มเดียว ไม่เขียนอะไร', a.sel === '05' && a.pick === '05' && a.selChips.join() === '05' && (await writes(page)).length === 0, a);
    await page.click('#branchGrid [data-bgcode="13"]');
    const b = await form();
    check('C2: แตะ 13 (ปกติ ทั้งที่ 13T มีออเดอร์) → ฟอร์มฝั่งส่งปกติ 13 ไม่ใช่แยกส่ง ไม่เขียน', b.sel === '13' && b.side === 'main' && b.selChips.join() === '13' && (await writes(page)).length === 0, b);
    await toPage(page, 1);
    await page.click('#branchGrid [data-bgcode="13T"]');
    const c = await form();
    check('C2: แตะ 13 ในแถว 🚚 (รหัส 13T) → ฟอร์มฝั่งแยกส่ง #branchSelect=13T ดรอปดาวน์สาขาหลัก=13 โทนม่วง', c.sel === '13T' && c.pick === '13' && c.side === 'sep', c);
    check('C2: ไฮไลต์ .sel เฉพาะปุ่ม 13T (แถว 🚚) ไม่ใช่ปุ่ม 13 หน้า 1 และไม่เขียนอะไร', c.selChips.join() === '13T' && (await writes(page)).length === 0, c);
    await page.click('#branchGrid [data-bgcode="13S"]');
    const d = await form();
    check('C2: แตะ 13S (แถว 🚚 แต่ไม่ใช่ T คู่) → ฟอร์ม 13S เดี่ยว', d.sel === '13S' && d.pick === '13S' && d.side === 'sep' && d.selChips.join() === '13S', d);
    await page.click('#branchGrid [data-bgcode="06"]');
    const e = await form();
    check('C2: แตะ 06 (แถว ⏳) → เปิดฟอร์ม 06 ฝั่งปกติ ไม่เขียน', e.sel === '06' && e.side === 'main' && (await writes(page)).length === 0, e);
    check('C2: ตลอดการแตะหลายปุ่ม ไม่มีการเขียนใดๆ และสถานะฟอร์มไม่เป็น dirty/saving', (await writes(page)).length === 0 && ['idle'].includes((await form()).st));
    await page.close();
  }

  // ============ C3: พับ/กางด้วยการแตะหัว + จำ localStorage ============
  {
    const page = await boot(browser);
    await resetW(page);
    const fold = () => page.evaluate(() => ({ closed: document.getElementById('branchGridFold').classList.contains('closed'), aria: document.getElementById('branchGridHead').getAttribute('aria-expanded'), vis: getComputedStyle(document.getElementById('branchGridFold')).visibility, h: Math.round(document.getElementById('branchGridFold').getBoundingClientRect().height), counter: document.getElementById('branchGridCount').getBoundingClientRect().height > 0 }));
    const open0 = await fold();
    check('C3: ค่าเริ่มต้น = กาง (aria-expanded=true, เห็นปุ่ม) และยังไม่มีค่าใน localStorage', !open0.closed && open0.aria === 'true' && open0.h > 60 && await lsFold(page) === null, open0);
    await page.click('#branchGridHead');
    await page.waitForTimeout(450);
    const f1 = await fold();
    check('C3: แตะหัว → พับ: class closed, aria-expanded=false, ซ่อนปุ่มทั้งหมด (visibility hidden สูง 0) ชิปตัวนับในหัวยังเห็น', f1.closed && f1.aria === 'false' && f1.vis === 'hidden' && f1.h === 0 && f1.counter, f1);
    check('C3: จำค่า localStorage karmto.branchGridFold = "1"', await lsFold(page) === '1');
    await page.click('#branchGridHead');
    await page.waitForTimeout(450);
    const f2 = await fold();
    check('C3: แตะหัวอีกครั้ง → กาง + localStorage = "0"', !f2.closed && f2.aria === 'true' && f2.vis === 'visible' && f2.h > 60 && await lsFold(page) === '0', f2);
    // คีย์บอร์ด
    await page.focus('#branchGridHead');
    await page.keyboard.press('Enter'); await page.waitForTimeout(100);
    const k1 = await fold();
    await page.keyboard.press('Space'); await page.waitForTimeout(100);
    const k2 = await fold();
    check('C3: คีย์บอร์ด Enter = พับ, Space = กาง (หัวโฟกัสได้)', k1.closed && k1.aria === 'false' && !k2.closed && k2.aria === 'true', { k1, k2 });
    check('C3: พับ/กางไม่เขียนข้อมูลร้านเลย (มีแต่ localStorage ในเครื่อง)', (await writes(page)).length === 0);
    // รีโหลด: พับไว้ → ยังพับ
    await page.click('#branchGridHead'); await page.waitForTimeout(100);
    check('C3: (ก่อนรีโหลด) พับอยู่ = "1"', await lsFold(page) === '1');
    await reloadApp(page);
    const r1 = await fold();
    check('C3: รีโหลดหน้า → ยังพับอยู่ (อ่านจาก localStorage) aria-expanded=false', r1.closed && r1.aria === 'false' && r1.h === 0, r1);
    await page.click('#branchGridHead'); await page.waitForTimeout(100);
    await reloadApp(page);
    const r2 = await fold();
    check('C3: กางแล้วรีโหลด → ยังกาง', !r2.closed && r2.aria === 'true' && await lsFold(page) === '0', r2);
    // ค่าเสีย/ว่าง → ค่าเริ่ม = กาง
    await page.evaluate(() => localStorage.setItem('karmto.branchGridFold', '<x>'));
    await reloadApp(page);
    const r3 = await fold();
    check('C3: ค่า localStorage เสีย ("<x>") → ตกไปกาง ไม่พัง', !r3.closed && r3.aria === 'true', r3);
    await page.close();
  }

  // ============ C4: วาดใหม่หลังบันทึก scrollLeft ไม่เด้งกลับหน้า 1 ============
  {
    const page = await boot(browser);
    await toPage(page, 1);
    const before = await page.evaluate(() => document.getElementById('branchGrid').scrollLeft);
    await page.click('#branchGrid [data-bgcode="16S"]');
    await page.fill('#productInputs .prodinput[data-pid="p1"]', '2');
    await resetW(page);
    await page.click('#saveRowBtn');
    await page.waitForFunction(() => document.getElementById('orderFormCard').dataset.save === 'saved', null, { timeout: 8000 });
    await page.waitForTimeout(250);
    const A = await page.evaluate(() => ({ left: document.getElementById('branchGrid').scrollLeft, page: document.getElementById('branchGridVp').getAttribute('data-page'), has16S: document.querySelector('#branchGrid [data-bgcode="16S"]').classList.contains('has'), sep: document.getElementById('branchGridSep').textContent.replace(/\s/g, ''), count: document.getElementById('branchGridCount').textContent }));
    check('C4: บันทึก 16S จากหน้า 2 แล้วกริดถูกวาดใหม่ (16S ติ๊ก, 🚚4) แต่ scrollLeft ไม่เด้งกลับหน้า 1', A.has16S && A.sep === '🚚4' && A.left > 0 && A.left >= before - 2 && A.page === '1', { before, A });
    const w = await writes(page);
    check('C4: การบันทึกเขียนแค่ patchField day: (ไม่มี set) — กริดวาดใหม่ไม่เขียนอะไรเพิ่ม', w.filter(x => /^patchField:day:/.test(x)).length === 1 && !w.some(x => x.startsWith('set:')), w);
    check('C4: ตัวนับหน้า 1 ไม่เปลี่ยน (16S แยกส่ง ไม่นับ) = "2/20"', A.count === '2/20', A.count);
    await page.close();
  }

  // ============ C5: ไม่มีสาขาแยกส่ง/นานๆ ที = ไม่มีหน้า 2 ไม่มีจุด/ลูกศร ชิป 🚚 ซ่อน ============
  {
    const page = await boot(browser, { setup: { remove: ['13S', '16S'], all: { rare: false, separate: false } } });
    const G = await readGrid(page);
    const geo = await page.evaluate(() => { const el = document.getElementById('branchGrid'); return { sw: el.scrollWidth, cw: el.clientWidth, peekR: getComputedStyle(document.querySelector('.bgc-peek.r')).opacity, peekL: getComputedStyle(document.querySelector('.bgc-peek.l')).opacity }; });
    check('C5: ไม่มีสาขาแยกส่ง/นานๆ ที → หน้าเดียว (22 ปุ่ม) ไม่มีหน้า 2 ไม่มีจุดบอกหน้า data-multi=0', G.pageCount === 1 && G.groups.length === 0 && G.p1.length === 22 && G.dots === 0 && G.multi === '0', { pc: G.pageCount, dots: G.dots, multi: G.multi, n: G.p1.length });
    check('C5: ลูกศรตกแต่งไม่โผล่ (opacity 0), เลื่อนข้างไม่ได้ (scrollWidth = clientWidth)', geo.peekR === '0' && geo.peekL === '0' && geo.sw <= geo.cw + 1, geo);
    check('C5: ชิป 🚚 ซ่อน (ไม่มีสาขาแยกส่งในตั้งค่า) ตัวนับ "n/22" เท่ากับทุกสาขา', G.sepHidden && /^\d+\/22$/.test(G.count), { h: G.sepHidden, c: G.count });
    await page.close();
    // มีแต่แยกส่ง (ไม่มีนานๆ ที): หน้า 2 มีแถว 🚚 แถวเดียว ไม่มีเส้นคั่น
    const p2 = await boot(browser, { setup: { add: [], patch: {} } });
    const G2 = await readGrid(p2);
    check('C5: มีแต่สาขาแยกส่ง (13S, 16S ติ๊กแยกส่ง ไม่ rare) → หน้า 2 มีแถว 🚚 อย่างเดียว ไม่มีแถว ⏳ ไม่มีเส้นคั่น', G2.pageCount === 2 && G2.groups.map(g => g.kind).join() === 'sep' && G2.dividers === 0 && G2.groups[0].chips.map(c => c.code).join() === '13S,16S', { g: G2.groups.map(g => g.kind), d: G2.dividers });
    await p2.close();
    // มีแต่นานๆ ที: หน้า 2 มีแถว ⏳ อย่างเดียว ชิป 🚚 ซ่อน
    const p3 = await boot(browser, { setup: { remove: ['13S', '16S'], patch: { '06': { rare: true }, '25': { rare: true } } } });
    const G3 = await readGrid(p3);
    check('C5: มีแต่นานๆ ที (06, 25) → หน้า 2 มีแถว ⏳ อย่างเดียว ไม่มีเส้นคั่น และชิป 🚚 ซ่อน', G3.pageCount === 2 && G3.groups.map(g => g.kind).join() === 'rare' && G3.dividers === 0 && G3.sepHidden && G3.p1.length === 20, { g: G3.groups.map(g => g.kind), d: G3.dividers, h: G3.sepHidden });
    await p3.close();
  }

  // ============ C6: escape รหัส/ชื่อสาขาที่มี HTML ============
  {
    const BAD = '"><img src=x onerror="window.__xss=1">', BAD2 = '9T"><b id="inj">x</b>';
    const page = await boot(browser, { setup: { add: [{ code: BAD, area: '<img src=x onerror="window.__xss=2">', separate: false }, { code: BAD2, area: '', label: '<b id="inj2">แยก</b>', separate: true, rare: true }], patch: { '06': { rare: true } } } });
    await page.evaluate(() => { window.__xss = 0; renderBranchGrid_(); });
    const X = await page.evaluate(([b1, b2]) => {
      const chips = [...document.querySelectorAll('#branchGrid [data-bgcode]')];
      const c1 = chips.find(c => c.getAttribute('data-bgcode') === b1), c2 = chips.find(c => c.getAttribute('data-bgcode') === b2);
      return { imgs: document.querySelectorAll('#branchGrid img, #branchGridCard img').length, inj: !!document.querySelector('#inj, #inj2'), xss: window.__xss, has1: !!c1, has2: !!c2, title1: c1 && c1.getAttribute('title'), aria2: c2 && c2.getAttribute('aria-label'), n2: c2 && c2.querySelector('.n').textContent, nChips: chips.length, all: settings.branches.length };
    }, [BAD, BAD2]);
    check('C6: รหัส/ชื่อสาขาที่มี "><img onerror> / <b> → ไม่ถูกฉีดเป็น HTML ในการ์ด และสคริปต์ไม่รัน', X.imgs === 0 && !X.inj && X.xss === 0, X);
    check('C6: ค่าดิบยังครบใน data-bgcode (แตะเปิดฟอร์มได้), title/aria-label เป็นข้อความดิบ, ป้ายแถว 🚚 แสดงเป็นข้อความ', X.has1 && X.has2 && /<img src=x/.test(X.title1 || '') && /<b id="inj2">/.test(X.aria2 || '') && X.n2 === BAD2 && X.nChips === X.all, X);
    await page.click(`#branchGrid [data-bgcode="${BAD.replace(/"/g, '\\"')}"]`).catch(() => {});
    check('C6: แตะปุ่มรหัสแปลกๆ → เปิดฟอร์มรหัสนั้นได้ ไม่เขียน', await page.evaluate(b => document.getElementById('branchSelect').value === b, BAD) && (await writes(page)).length === 0);
    await page.close();
  }

  // ============ C7: จอกว้าง ≥768px = เรียงหน้าซ้อนกัน ไม่สไลด์ ============
  {
    const page = await boot(browser, { viewport: { width: 1100, height: 900 } });
    const D = await page.evaluate(() => {
      const el = document.getElementById('branchGrid'), p1 = el.querySelector('.bgc-page.p1').getBoundingClientRect(), p2 = [...el.querySelectorAll('.bgc-page')].find(p => !p.classList.contains('p1')).getBoundingClientRect();
      return { overflowX: getComputedStyle(el).overflowX, stacked: p2.top >= p1.bottom - 1, sameLeft: Math.abs(p1.left - p2.left) < 2, dots: getComputedStyle(document.getElementById('branchGridDots')).display, peeks: [...document.querySelectorAll('.bgc-peek')].map(x => getComputedStyle(x).display).join(), cols: getComputedStyle(el.querySelector('.bgc-grid')).gridTemplateColumns.split(' ').length, ov: document.documentElement.scrollWidth <= innerWidth };
    });
    check('C7: จอกว้าง: หน้า 2 อยู่ใต้หน้า 1 (ไม่สไลด์ ไม่มี overflow-x) ซ่อนจุด/ลูกศร กริด 8 คอลัมน์ ไม่ล้นจอ', D.overflowX === 'visible' && D.stacked && D.sameLeft && D.dots === 'none' && D.peeks === 'none,none' && D.cols === 8 && D.ov, D);
    await page.close();
  }

  // ============ C8: ไม่ล้นจอ 420px ทุกธีม/โหมด (พับ/กาง × หน้า 1/หน้า 2) + แคปจอ ============
  {
    const page = await boot(browser);
    const res = {}, bad = [];
    for (const [th, mode] of [['', ''], ['mermaid', 'full'], ['mermaid', 'color'], ['sea', 'full'], ['sea', 'color'], ['neon', 'full'], ['neon', 'color']]) {
      const key = (th || 'macaron') + (mode ? '/' + mode : '');
      await setTheme(page, th, mode || 'full');
      for (const pg of [0, 1]) {
        await toPage(page, pg);
        const m = await page.evaluate(() => {
          const card = document.getElementById('branchGridCard').getBoundingClientRect(), vp = document.getElementById('branchGrid').getBoundingClientRect();
          const cur = Number(document.getElementById('branchGridVp').getAttribute('data-page'));
          const pgEl = document.querySelectorAll('#branchGrid .bgc-page')[cur];
          const chips = [...pgEl.querySelectorAll('.bg-chip')].map(c => c.getBoundingClientRect());
          const head = [...document.querySelectorAll('#branchGridHead .bgc-chip, #branchGridHead h3')].map(e => e.getBoundingClientRect());
          return { page: document.documentElement.scrollWidth <= innerWidth, card: card.left >= 0 && card.right <= innerWidth + 0.5, chipsIn: chips.every(r => r.width >= 36 && r.height >= 44 && r.left >= vp.left - 1 && r.right <= vp.right + 1), headIn: head.every(r => r.left >= card.left - 1 && r.right <= card.right + 1) };
        });
        res[key + ':p' + (pg + 1)] = m;
        if (!Object.values(m).every(Boolean)) bad.push([key + ':p' + (pg + 1), m]);
      }
      // พับแล้วก็ไม่ล้น
      await page.evaluate(() => { try { localStorage.setItem('karmto.branchGridFold', '1'); } catch (e) {} applyBranchGridFold_(true); });
      await page.waitForTimeout(80);
      res[key + ':folded'] = await noOverflow(page);
      if (!res[key + ':folded']) bad.push([key + ':folded']);
      await page.evaluate(() => applyBranchGridFold_(false));
      if (key === 'macaron') { await toPage(page, 0); await shotCard(page, 'grid-macaron-p1.png'); await toPage(page, 1); await shotCard(page, 'grid-macaron-p2.png'); }
      if (key === 'neon/full') { await toPage(page, 0); await shotCard(page, 'grid-neon-p1.png'); await toPage(page, 1); await shotCard(page, 'grid-neon-p2.png'); }
      if (key === 'sea/full') { await toPage(page, 1); await shotCard(page, 'grid-sea-p2.png'); }
      if (key === 'mermaid/full') { await toPage(page, 1); await shotCard(page, 'grid-mermaid-p2.png'); }
    }
    check('C8: การ์ดสาขาวันนี้ไม่ล้นจอ 420px ทุกธีม macaron/mermaid/sea/neon × full/color (หน้า 1, หน้า 2, พับ) ปุ่ม ≥ 36×44 ชิปหัวอยู่ในการ์ด', bad.length === 0 && Object.keys(res).length === 7 * 3, bad);
    await page.close();
  }

  await finish(browser);
})();
