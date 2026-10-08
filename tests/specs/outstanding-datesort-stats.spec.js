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
  const page = await browser.newPage({ viewport: { width: 420, height: 1600 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // Seed 4 unpaid bills + 1 paid bill, out of chronological order, to test date sort + stats
  await page.evaluate(async () => {
    const mkDay = (iso, orders, billingPaid) => ({ orders, leftoverOut:{}, leftoverSince:{}, billingPaid: billingPaid||{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    window.__store['day:2026-09-25'] = mkDay('2026-09-25', { '10': { p1: 5 }, '01': { p1: 3 } });
    window.__store['day:2026-09-20'] = mkDay('2026-09-20', { '02': { p1: 4 } });
    window.__store['day:2026-10-01'] = mkDay('2026-10-01', { '01': { p1: 2 } }, { '01': { paid:true, paidDate:'2026-10-02', transferAmount:200, billedAmount:200 } });
    currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08'] = mkDay('2026-10-08', {});
    dayCache_['2026-10-08'] = dayData;
    await switchTab('billing');
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test: stats box shows total/paid/unpaid counts + amounts =====
  const stats = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#outstandingStats .statchip')).map(c=>c.textContent.trim());
    return chips;
  });
  console.log('Stats chips:', JSON.stringify(stats));
  // 4 total bills (3 unpaid: 10|09-25 amt, 01|09-25, 02|09-20; 1 paid: 01|10-01)
  allPass &= check('Stats show 4 total bills', stats.some(c=>c.includes('ทั้งหมด') && c.includes('4 บิล')), stats);
  allPass &= check('Stats show 3 unpaid bills', stats.some(c=>c.includes('ค้างโอน') && c.includes('3 บิล')), stats);
  allPass &= check('Stats show 1 paid bill', stats.some(c=>c.includes('โอนแล้ว') && c.includes('1 บิล')), stats);

  // ===== Test: date-sort button cycles through 3 states =====
  const dateSortBtn = () => page.locator('#outstandingDateSortToggle');
  const initialLabel = await page.evaluate(()=>document.getElementById('outstandingDateSortToggle').textContent);
  allPass &= check('Date-sort button starts in "off" label', initialLabel.includes('เรียงตามวันที่'), initialLabel);

  // Click 1: newest -> oldest
  await dateSortBtn().click();
  await page.waitForTimeout(400);
  await stripBanner(page);
  const afterClick1 = await page.evaluate(() => ({
    label: document.getElementById('outstandingDateSortToggle').textContent,
    order: Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r=>r.getAttribute('data-outstandingrow')),
    delaySortBtnDisplay: getComputedStyle(document.getElementById('outstandingSortToggle')).display,
  }));
  console.log('After click 1 (newest->oldest):', JSON.stringify(afterClick1));
  allPass &= check('Label shows newest->oldest after click 1', afterClick1.label.includes('ล่าสุด→เก่าสุด'), afterClick1.label);
  // หมายเหตุ: filter เริ่มต้นคือ "ค้างโอน" (unpaid) จึงไม่โชว์บิลที่จ่ายแล้ว (01|2026-10-01) ในลิสต์ — ถูกต้องตามดีไซน์เดิม
  allPass &= check('Rows sorted by date descending (newest first) among unpaid rows', JSON.stringify(afterClick1.order) === JSON.stringify(['2026-09-25|01','2026-09-25|10','2026-09-20|02']), afterClick1.order);
  allPass &= check('Delay-sort button hidden while date-sort is active', afterClick1.delaySortBtnDisplay === 'none', afterClick1.delaySortBtnDisplay);

  // Click 2: oldest -> newest
  await dateSortBtn().click();
  await page.waitForTimeout(400);
  await stripBanner(page);
  const afterClick2 = await page.evaluate(() => ({
    label: document.getElementById('outstandingDateSortToggle').textContent,
    order: Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]')).map(r=>r.getAttribute('data-outstandingrow')),
  }));
  console.log('After click 2 (oldest->newest):', JSON.stringify(afterClick2));
  allPass &= check('Label shows oldest->newest after click 2', afterClick2.label.includes('เก่าสุด→ล่าสุด'), afterClick2.label);
  allPass &= check('Rows sorted by date ascending (oldest first) among unpaid rows', JSON.stringify(afterClick2.order) === JSON.stringify(['2026-09-20|02','2026-09-25|01','2026-09-25|10']), afterClick2.order);

  // Click 3: back to off (reverts to delay sort)
  await dateSortBtn().click();
  await page.waitForTimeout(400);
  await stripBanner(page);
  const afterClick3 = await page.evaluate(() => ({
    label: document.getElementById('outstandingDateSortToggle').textContent,
    delaySortBtnDisplay: getComputedStyle(document.getElementById('outstandingSortToggle')).display,
  }));
  console.log('After click 3 (off):', JSON.stringify(afterClick3));
  allPass &= check('Label reverts to "เรียงตามวันที่" (off) after click 3', afterClick3.label.includes('เรียงตามวันที่') && !afterClick3.label.includes('→'), afterClick3.label);
  allPass &= check('Delay-sort button reappears once date-sort is off', afterClick3.delaySortBtnDisplay !== 'none', afterClick3.delaySortBtnDisplay);

  // ===== Test: both sort buttons + stats box hidden in branch-filter view =====
  await page.selectOption('#outstandingBranchFilter', '01');
  await page.waitForTimeout(400);
  await stripBanner(page);
  const branchView = await page.evaluate(() => ({
    sortBtnDisplay: getComputedStyle(document.getElementById('outstandingSortToggle')).display,
    dateSortBtnDisplay: getComputedStyle(document.getElementById('outstandingDateSortToggle')).display,
    statsHtml: document.getElementById('outstandingStats').innerHTML.trim(),
  }));
  console.log('Branch-filter view:', JSON.stringify(branchView));
  allPass &= check('Both sort buttons hidden when a single branch is selected', branchView.sortBtnDisplay==='none' && branchView.dateSortBtnDisplay==='none', branchView);
  allPass &= check('Stats box cleared when a single branch is selected (branchDetail has its own)', branchView.statsHtml==='', branchView.statsHtml);

  // Deselect branch -> date-sort button should still be visible (not recheck mode) and stats repopulate
  await page.selectOption('#outstandingBranchFilter', '');
  await page.waitForTimeout(400);
  await stripBanner(page);
  const afterDeselect = await page.evaluate(() => ({
    dateSortBtnDisplay: getComputedStyle(document.getElementById('outstandingDateSortToggle')).display,
    statsHasChips: document.querySelectorAll('#outstandingStats .statchip').length,
  }));
  allPass &= check('Date-sort button visible again after deselecting branch', afterDeselect.dateSortBtnDisplay !== 'none', afterDeselect);
  allPass &= check('Stats box repopulated after deselecting branch', afterDeselect.statsHasChips === 5, afterDeselect);

  // ===== Test: date-sort button hidden during recheck mode =====
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await stripBanner(page);
  const recheckView = await page.evaluate(() => ({
    dateSortBtnDisplay: getComputedStyle(document.getElementById('outstandingDateSortToggle')).display,
    sortBtnDisplay: getComputedStyle(document.getElementById('outstandingSortToggle')).display,
  }));
  console.log('Recheck mode view:', JSON.stringify(recheckView));
  allPass &= check('Date-sort button hidden during recheck mode', recheckView.dateSortBtnDisplay==='none', recheckView);
  allPass &= check('Delay-sort button also hidden during recheck mode', recheckView.sortBtnDisplay==='none', recheckView);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
