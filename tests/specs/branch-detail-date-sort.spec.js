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
  const browser = await require('../sandbox').launch(chromium);
  const page = await browser.newPage({ viewport: { width: 450, height: 1400 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  await page.evaluate(async () => {
    const mkDay = (iso, qty) => ({ orders: { '01': { p1: qty } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    window.__store['day:2026-10-01'] = mkDay('2026-10-01', 10);
    window.__store['day:2026-10-05'] = mkDay('2026-10-05', 5);
    window.__store['day:2026-10-10'] = mkDay('2026-10-10', 7);
    currentDate = '2026-10-14'; dayData = window.__store['day:2026-10-14'] = { orders:{}, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    dayCache_['2026-10-14'] = dayData;
    await switchTab('billing');
  });
  await page.waitForTimeout(400);
  await stripBanner(page);
  await page.selectOption('#outstandingBranchFilter', '01');
  await page.waitForTimeout(400);
  await stripBanner(page);

  // ===== Test: default order is newest-first (unchanged default behavior) =====
  const initialDates = await page.evaluate(() => Array.from(document.querySelectorAll('#outstandingBranchDetail .branchbill .n')).map(el => el.textContent));
  console.log('Initial order:', JSON.stringify(initialDates));
  allPass &= check('Default order is newest first (10/10, 05/10, 01/10)', initialDates[0].includes('10/10') && initialDates[1].includes('05/10') && initialDates[2].includes('01/10'), initialDates);

  const btnLabel = await page.evaluate(() => document.getElementById('branchDetailDateSortBtn')?.textContent);
  allPass &= check('Sort button shows "ล่าสุด→เก่าสุด" by default', btnLabel && btnLabel.includes('ล่าสุด→เก่าสุด'), btnLabel);

  // ===== Test: clicking the sort button flips to oldest-first =====
  await page.click('#branchDetailDateSortBtn');
  await page.waitForTimeout(300);
  await stripBanner(page);
  const afterClickDates = await page.evaluate(() => Array.from(document.querySelectorAll('#outstandingBranchDetail .branchbill .n')).map(el => el.textContent));
  const afterClickLabel = await page.evaluate(() => document.getElementById('branchDetailDateSortBtn')?.textContent);
  console.log('After one click:', JSON.stringify(afterClickDates), afterClickLabel);
  allPass &= check('After one click, order flips to oldest first (01/10, 05/10, 10/10)', afterClickDates[0].includes('01/10') && afterClickDates[1].includes('05/10') && afterClickDates[2].includes('10/10'), afterClickDates);
  allPass &= check('Button label flips to "เก่าสุด→ล่าสุด"', afterClickLabel && afterClickLabel.includes('เก่าสุด→ล่าสุด'), afterClickLabel);

  // ===== Test: clicking again flips back =====
  await page.click('#branchDetailDateSortBtn');
  await page.waitForTimeout(300);
  await stripBanner(page);
  const afterSecondClickDates = await page.evaluate(() => Array.from(document.querySelectorAll('#outstandingBranchDetail .branchbill .n')).map(el => el.textContent));
  allPass &= check('Second click flips back to newest first', afterSecondClickDates[0].includes('10/10'), afterSecondClickDates);

  // ===== Test: no fresh window.storage.list() fired just to flip sort (reuses precomputed agg) =====
  const listCallCountBeforeThirdClick = await page.evaluate(() => { window.__listCalls = 0; const orig = window.storage.list.bind(window.storage); window.storage.list = async (...args)=>{ window.__listCalls++; return orig(...args); }; return window.__listCalls; });
  await page.click('#branchDetailDateSortBtn');
  await page.waitForTimeout(300);
  const listCallCountAfterThirdClick = await page.evaluate(() => window.__listCalls);
  allPass &= check('Flipping sort direction does not trigger a fresh window.storage.list() call', listCallCountAfterThirdClick === 0, {listCallCountBeforeThirdClick, listCallCountAfterThirdClick});

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
