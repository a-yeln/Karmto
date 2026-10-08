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

  // Seed 3 unpaid bills across different branches/dates (out of chronological order on purpose) to test date+branch sort
  await page.evaluate(async () => {
    const mkDay = (iso, orders) => ({ orders, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    window.__store['day:2026-09-25'] = mkDay('2026-09-25', { '10': { p1: 5 }, '01': { p1: 3 } }); // two branches same date -> test branch-code tiebreak
    window.__store['day:2026-09-20'] = mkDay('2026-09-20', { '02': { p1: 4 } }); // oldest date
    window.__store['day:2026-10-01'] = mkDay('2026-10-01', { '01': { p1: 2 } }); // newest date
    currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08'] = mkDay('2026-10-08', {});
    dayCache_['2026-10-08'] = dayData;
    await switchTab('billing');
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // Turn on recheck mode
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test: recheck mode sorts by date (oldest first) then branch code =====
  const order = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r => r.getAttribute('data-outstandingrow'));
  });
  console.log('Row order in recheck mode:', JSON.stringify(order));
  const expectedOrder = ['2026-09-20|02', '2026-09-25|01', '2026-09-25|10', '2026-10-01|01'];
  allPass &= check('Rows sorted by date ascending, then branch code (not by delay)', JSON.stringify(order) === JSON.stringify(expectedOrder), {order, expectedOrder});

  // ===== Test: sort toggle button hidden in recheck mode =====
  const sortBtnDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('outstandingSortToggle')).display);
  allPass &= check('Sort-by-delay toggle button hidden while recheck mode is active', sortBtnDisplay === 'none', sortBtnDisplay);

  // ===== Test: clear-round button on same line as hint, right-aligned =====
  const clearBtnLayout = await page.evaluate(() => {
    const hint = document.querySelector('#recheckRoundSummary .hint');
    const btn = document.getElementById('recheckClearBtn');
    return {
      sameParent: btn ? btn.parentElement === hint : false,
      hintDisplay: hint ? getComputedStyle(hint).display : null,
      justifyContent: hint ? getComputedStyle(hint).justifyContent : null,
    };
  });
  console.log('Clear button layout:', JSON.stringify(clearBtnLayout));
  allPass &= check('Clear-round button shares the same line as the hint text (flex row)', clearBtnLayout.sameParent && clearBtnLayout.hintDisplay === 'flex', clearBtnLayout);
  allPass &= check('That line is space-between (button pushed to the far right)', clearBtnLayout.justifyContent === 'space-between', clearBtnLayout.justifyContent);

  // ===== Test: "เหลือ" chip is clickable and filters to unchecked-only =====
  const beforeFilter = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
  allPass &= check('4 rows shown before filtering', beforeFilter === 4, beforeFilter);

  // Check ONE bill first
  await page.evaluate(() => {
    const row = document.querySelector('#outstandingList [data-outstandingrow]'); // oldest row (2026-09-20|02)
    row.querySelector('[data-recheckstart]').click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const row = document.querySelector('#outstandingList [data-outstandingrow]');
    row.querySelector('[data-recheckresult="still_unpaid"]').click();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // Click the "เหลือ" chip to filter to unchecked-only
  await page.evaluate(() => { document.getElementById('recheckRemainingChip').click(); });
  await page.waitForTimeout(500);
  await stripBanner(page);

  const afterFilter = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r => r.getAttribute('data-outstandingrow'));
    const chip = document.getElementById('recheckRemainingChip');
    return { rows, chipActiveBorder: chip ? getComputedStyle(chip).borderColor : null };
  });
  console.log('After clicking "เหลือ" chip:', JSON.stringify(afterFilter));
  allPass &= check('Only the 3 still-unchecked rows remain visible (the checked one is hidden)', afterFilter.rows.length === 3 && !afterFilter.rows.includes('2026-09-20|02'), afterFilter.rows);

  // Total count in the summary should STILL reflect the full pool (4), not the filtered view (3)
  const totalChipAfterFilter = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#recheckRoundSummary .statchip'));
    const totalChip = chips.find(c => c.textContent.includes('ทั้งหมด'));
    return totalChip ? totalChip.textContent.trim() : null;
  });
  console.log('Total chip while "เหลือ"-only filter is active:', totalChipAfterFilter);
  allPass &= check('"ทั้งหมด" total still shows the full pool (4), unaffected by the unchecked-only view filter', totalChipAfterFilter && totalChipAfterFilter.includes('4'), totalChipAfterFilter);

  // Click again to toggle OFF the filter -> all 4 rows should reappear
  await page.evaluate(() => { document.getElementById('recheckRemainingChip').click(); });
  await page.waitForTimeout(500);
  await stripBanner(page);
  const afterUnfilter = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
  allPass &= check('Clicking "เหลือ" chip again toggles the filter off (all 4 rows shown again)', afterUnfilter === 4, afterUnfilter);

  // Turning recheck mode off should reset the filter flag (verify via re-enabling and checking all rows show)
  await page.evaluate(() => { document.getElementById('recheckRemainingChip').click(); }); // turn filter back on
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await stripBanner(page);
  const afterToggleCycle = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
  allPass &= check('Turning recheck mode off then on again resets the unchecked-only filter (all 4 rows shown)', afterToggleCycle === 4, afterToggleCycle);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
