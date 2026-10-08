const { chromium } = require('playwright');

async function stripBanner(page) {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if (el.textContent && el.textContent.includes('เชื่อมต่อฐานข้อมูลไม่ได้') && el.children.length === 0) {
        el.closest('div')?.remove();
      }
    });
  });
}

async function installMockStorage(page) {
  await page.evaluate(() => {
    window.__store = {};
    window.storage = {
      async get(key){ if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ delete window.__store[key]; return {key, deleted:true, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){
        let root = window.__store[key]; if(root === undefined) root = {}; root = JSON.parse(JSON.stringify(root));
        let target = root; for(let i=0;i<path.length-1;i++){ const seg=path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
        if(path.length>0) target[path[path.length-1]] = value;
        window.__store[key] = root; return {key, value: JSON.stringify(root), shared:false};
      },
      async patchOps(key, ops, rootIsArray){
        let root = window.__store[key]; if(root===undefined) root = rootIsArray ? [] : {};
        root = JSON.parse(JSON.stringify(root));
        const opsArr = Array.isArray(ops) ? ops : [ops];
        for(const op of opsArr){
          if(op.path){
            let target = root; for(let i=0;i<op.path.length-1;i++){ const seg=op.path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
            target[op.path[op.path.length-1]] = op.value;
          }
        }
        window.__store[key] = root;
        return {key, value: JSON.stringify(root), shared:false};
      },
    };
    window.bulkGetStorageImpl = async (keys) => { const out={}; keys.forEach(k=>{ out[k]=window.__store[k]!==undefined?JSON.stringify(window.__store[k]):null; }); return out; };
  });
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // Seed: today (2026-10-08) has 2 branches with orders, one already paid 3 days late (paidDate = 2026-10-05, order iso = 2026-10-02)
  // Also seed an older unpaid bill (2026-09-20) still pending, to test delay-from-today for unpaid bills.
  await page.evaluate(async () => {
    const mkDay = (iso, orders, billingPaid, billExtra) => ({ orders, leftoverOut:{}, leftoverSince:{}, billingPaid: billingPaid||{}, billExtra: billExtra||{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    // Order placed 2026-10-02, paid late on 2026-10-05 (3 days delay from order date, NOT from "today")
    window.__store['day:2026-10-02'] = mkDay('2026-10-02', { '01': { p1: 10 } }, { '01': { paid:true, paidDate:'2026-10-05', transferAmount: 1700, billedAmount: 1700 } });
    // Still-unpaid bill from 2026-09-20 (so delay should be computed from "today" = 2026-10-08)
    window.__store['day:2026-09-20'] = mkDay('2026-09-20', { '02': { p1: 5 } });
    // Today's own orders for the "บิลรายสาขา" stats row — 2 branches, 1 paid
    window.__store['day:2026-10-08'] = mkDay('2026-10-08', { '01': { p1: 8 }, '02': { p1: 4 } }, { '01': { paid:true, paidDate:'2026-10-08', transferAmount: 1400, billedAmount: 1360 } });
    currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08']; dayCache_['2026-10-08'] = dayData;
    await switchTab('billing');
  });
  await page.waitForTimeout(600);
  await stripBanner(page);

  // ===== Part 2: บิลรายสาขา today-stats chips =====
  const billingStats = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#billingTodayStats .statchip'));
    return chips.map(c => c.textContent.trim());
  });
  console.log('บิลรายสาขา stat chips:', JSON.stringify(billingStats));
  allPass &= check('4 stat chips shown on บิลรายสาขา card', billingStats.length === 4, billingStats.length);
  allPass &= check('Branch count chip shows 2', billingStats.some(t=>t.includes('สาขาที่ออเดอร์') && t.includes('2')), billingStats[0]);
  allPass &= check('Paid count chip shows 1/2', billingStats.some(t=>t.includes('ชำระแล้ว') && t.includes('1/2')), billingStats[1]);

  // ===== Part 3: บิลรายสาขา row — one line, amount big/bold, code+name+amount together, amount right-aligned =====
  const billingRow = await page.evaluate(() => {
    const row = document.querySelector('#billingList .branchbill');
    const toprow = row.querySelector('.toprow');
    const amtEl = toprow.querySelector('.amt.big');
    return {
      hasAmtCol: !!row.querySelector('.amtcol'),
      toprowText: toprow.textContent.replace(/\s+/g,' ').trim(),
      amtHasBigClass: !!amtEl,
      // amount must be a direct sibling of .left (not nested inside it) so it right-aligns consistently
      // regardless of branch-name length, instead of drifting with the name like inline text would
      amtIsOutsideLeft: amtEl ? !amtEl.closest('.left') : false,
    };
  });
  console.log('บิลรายสาขา first row:', JSON.stringify(billingRow));
  allPass &= check('No more .amtcol column (merged into one line)', !billingRow.hasAmtCol);
  allPass &= check('Amount has .big modifier class (bigger/bolder)', billingRow.amtHasBigClass);
  allPass &= check('Amount sits outside .left (right-aligned column, not drifting with name length)', billingRow.amtIsOutsideLeft);

  // ===== Switch to "ทุกบิล" (month-scoped to October) to see the paid row's delay-from-paidDate behavior =====
  await page.click('[data-outstatusfilter="all"]');
  await page.waitForTimeout(500);
  await stripBanner(page);

  const outstandingRowsAll = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(row => {
      const left = row.querySelector('.toprow .left');
      const badge = row.querySelector('.badge-delay');
      const amtEl = row.querySelector('.toprow .amt.big');
      return {
        key: row.getAttribute('data-outstandingrow'),
        leftText: left.textContent.replace(/\s+/g,' ').trim(),
        hasAmtCol: !!row.querySelector('.amtcol'),
        delayText: badge ? badge.textContent.trim() : null,
        amtHasBig: !!amtEl,
        amtIsOutsideLeft: amtEl ? !amtEl.closest('.left') : false,
      };
    });
  });
  console.log('รายการที่ต้องตามโอน rows (filter=ทุกบิล, October):', JSON.stringify(outstandingRowsAll, null, 2));

  // Direct pixel-alignment check: money amounts conventionally right-align so digits line up — the amount's RIGHT
  // edge (flush against the fixed-width acts2 buttons) must be the same x across rows with different-length branch
  // names ("สาขา 01 ประชาอุทิศ" vs "สาขา 02 เทิดราชัน"), proving they actually line up visually, not just share a class.
  const amtPositions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow] .toprow .amt.big')).map(el => Math.round(el.getBoundingClientRect().right));
  });
  console.log('Amount right-edge x positions across rows:', JSON.stringify(amtPositions));
  allPass &= check('Amounts right-align at the same x position across rows with different-length branch names', new Set(amtPositions).size === 1, amtPositions);

  const paidRow = outstandingRowsAll.find(r => r.key === '2026-10-02|01');
  allPass &= check('Paid row found', !!paidRow);
  if(paidRow){
    allPass &= check('Paid row: date appears first in .left (one line, date-first)', /^\d\d\/\d\d\/\d\d\d\d/.test(paidRow.leftText), paidRow.leftText);
    allPass &= check('Paid row: no more .amtcol (one-line layout)', !paidRow.hasAmtCol);
    allPass &= check('Paid row: amount has big/bold class', paidRow.amtHasBig);
    allPass &= check('Paid row: amount sits outside .left (right-aligned column)', paidRow.amtIsOutsideLeft);
    // Order date 2026-10-02, paid on 2026-10-05 -> delay should be 3 days (from paidDate), NOT (today 2026-10-08 - order date = 6 days)
    allPass &= check('Paid row: delay computed from PAID DATE (3 วัน), not today (would be 6 วัน)', paidRow.delayText === '3 วัน', paidRow.delayText);
  }

  // ===== Switch to "ค้างโอน" (default, scans ALL days with no month scope) to check the still-unpaid September bill's delay =====
  await page.click('[data-outstatusfilter="unpaid"]');
  await page.waitForTimeout(500);
  await stripBanner(page);
  const outstandingRowsUnpaid = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(row => {
      const badge = row.querySelector('.badge-delay');
      const left = row.querySelector('.toprow .left');
      return { key: row.getAttribute('data-outstandingrow'), delayText: badge ? badge.textContent.trim() : null, leftText: left.textContent.replace(/\s+/g,' ').trim() };
    });
  });
  console.log('รายการที่ต้องตามโอน rows (filter=ค้างโอน):', JSON.stringify(outstandingRowsUnpaid, null, 2));
  const unpaidRow = outstandingRowsUnpaid.find(r => r.key === '2026-09-20|02');
  allPass &= check('Unpaid (September) row found under ค้างโอน filter', !!unpaidRow, outstandingRowsUnpaid);
  if(unpaidRow){
    allPass &= check('Unpaid row: date appears first', /^\d\d\/\d\d\/\d\d\d\d/.test(unpaidRow.leftText), unpaidRow.leftText);
    // Still unpaid -> delay must track the REAL current date (todayISO()), not a hardcoded day count (the actual
    // wall-clock date can tick forward mid-session), and must NOT be pinned to the order date (that would always read 0).
    const expectedDelay = await page.evaluate(() => Math.round((new Date(todayISO())-new Date('2026-09-20'))/86400000));
    allPass &= check(`Unpaid row: delay computed from TODAY (${expectedDelay} วัน) since no paidDate exists yet`, unpaidRow.delayText === `${expectedDelay} วัน`, unpaidRow.delayText);
  }
  allPass &= check('Exactly 2 unpaid bills total (Sept 20 branch 02 + today\'s own branch 02 order)', outstandingRowsUnpaid.length === 2, outstandingRowsUnpaid.length);

  // ===== Part 1: Recheck mode round summary =====
  await page.click('[data-outstatusfilter="unpaid"]');
  await page.waitForTimeout(400);
  await stripBanner(page);
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  const summaryBefore = await page.evaluate(() => {
    const el = document.getElementById('recheckRoundSummary');
    const chips = Array.from(el.querySelectorAll('.statchip')).map(c=>c.textContent.trim());
    return { display: getComputedStyle(el).display, chips };
  });
  console.log('Recheck round summary (before any check):', JSON.stringify(summaryBefore));
  allPass &= check('Recheck summary visible when mode is on', summaryBefore.display !== 'none');
  // 2 unpaid bills total under this filter: 2026-09-20|02 and 2026-10-08|02
  allPass &= check('Shows "ทั้งหมด 2 บิล"', summaryBefore.chips.some(c=>c.includes('ทั้งหมด') && c.includes('2')), summaryBefore.chips);
  allPass &= check('Shows "เช็คแล้ว 0 บิล" initially', summaryBefore.chips.some(c=>c.includes('เช็คแล้ว') && c.includes('0')), summaryBefore.chips);
  allPass &= check('Shows "0%" initially', summaryBefore.chips.some(c=>c.includes('0%')), summaryBefore.chips);

  // Mark ONE of the 2 unpaid bills as checked ("ยังไม่โอนจริง")
  await page.evaluate(() => {
    const row = document.querySelector('#outstandingList [data-outstandingrow]');
    row.querySelector('[data-recheckstart]').click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const row = document.querySelector('#outstandingList [data-outstandingrow]');
    row.querySelector('[data-recheckresult="still_unpaid"]').click();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  const summaryAfter = await page.evaluate(() => {
    const el = document.getElementById('recheckRoundSummary');
    return Array.from(el.querySelectorAll('.statchip')).map(c=>c.textContent.trim());
  });
  console.log('Recheck round summary (after checking 1 of 2 bills):', JSON.stringify(summaryAfter));
  allPass &= check('Shows "เช็คแล้ว 1 บิล" after checking one', summaryAfter.some(c=>c.includes('เช็คแล้ว') && c.includes('1')), summaryAfter);
  allPass &= check('Shows "50%" after checking 1 of 2', summaryAfter.some(c=>c.includes('50%')), summaryAfter);
  allPass &= check('Shows "เหลือ 1 บิล"', summaryAfter.some(c=>c.includes('เหลือ') && c.includes('1')), summaryAfter);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
