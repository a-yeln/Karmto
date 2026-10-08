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
    window.__storageCallLog = [];
    window.storage = {
      async get(key){ window.__storageCallLog.push('get:'+key); if(!(key in window.__store)){ throw new Error('Key not found: '+key); } return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__storageCallLog.push('set:'+key); window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ delete window.__store[key]; return {key, deleted:true, shared:false}; },
      async list(prefix){ window.__storageCallLog.push('list:'+prefix); return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){
        window.__storageCallLog.push('patchField:'+key);
        let root = window.__store[key]; if(root === undefined) root = {}; root = JSON.parse(JSON.stringify(root));
        let target = root; for(let i=0;i<path.length-1;i++){ const seg=path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
        if(path.length>0) target[path[path.length-1]] = value;
        window.__store[key] = root; return {key, value: JSON.stringify(root), shared:false};
      },
      async patchOps(key, ops, rootIsArray){
        window.__storageCallLog.push('patchOps:'+key);
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
  const page = await browser.newPage({ viewport: { width: 450, height: 1300 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // Seed TWO unpaid bills so we can confirm only ONE row is touched, not the whole list
  await page.evaluate(async () => {
    window.__store['day:2026-10-01'] = { orders: { '01': { p1: 10 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{'01':0}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    window.__store['day:2026-10-02'] = { orders: { '02': { p2: 5 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{'02':0}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-01'; dayData = window.__store['day:2026-10-01']; dayCache_['2026-10-01'] = dayData;
    await switchTab('billing');
  });
  await page.waitForTimeout(600);
  await stripBanner(page);

  // Turn on recheck mode (custom switch UI intercepts real clicks — toggle via DOM + change event instead)
  await page.evaluate(() => {
    const cb = document.getElementById('recheckModeToggle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  await stripBanner(page);

  const rowCountBefore = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
  allPass &= check('Two unpaid bills shown', rowCountBefore===2, rowCountBefore);

  // Grab a reference to the SECOND row's DOM node so we can check it wasn't replaced (proof the whole list didn't reload)
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
    rows[1].dataset.testMarker = 'untouched-marker';
  });

  // Click "เช็คแล้ว" -> "ยังไม่โอนจริง" (still_unpaid) on the FIRST row (no status change)
  await page.evaluate(() => {
    const firstRow = document.querySelectorAll('#outstandingList [data-outstandingrow]')[0];
    firstRow.querySelector('[data-recheckstart]').click();
  });
  await page.waitForTimeout(200);

  const callCountBeforeConfirm = await page.evaluate(() => window.__storageCallLog.length);
  await page.evaluate(() => {
    const firstRow = document.querySelectorAll('#outstandingList [data-outstandingrow]')[0];
    firstRow.querySelector('[data-recheckresult="still_unpaid"]').click();
  });
  await page.waitForTimeout(400);

  const afterConfirm = await page.evaluate(() => {
    const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
    return {
      rowCount: rows.length,
      secondRowMarkerSurvived: rows[1] && rows[1].dataset.testMarker === 'untouched-marker',
      firstRowMarkText: rows[0].querySelector('.lrow-hint') ? rows[0].querySelector('.lrow-hint').textContent : null,
      didListCallHappenAgain: window.__storageCallLog.slice().some((c,i)=> i>=0 && c.startsWith('list:') ),
      callLogTail: window.__storageCallLog.slice(-6),
    };
  });
  allPass &= check('Row count unchanged (no status change, both rows still shown)', afterConfirm.rowCount===2, afterConfirm.rowCount);
  allPass &= check('Second (untouched) row DOM node was NOT replaced — proof the whole list did not re-render', afterConfirm.secondRowMarkerSurvived, afterConfirm);
  allPass &= check('First row now shows the recheck result text in place', afterConfirm.firstRowMarkText && afterConfirm.firstRowMarkText.includes('เช็คแล้ว'), afterConfirm.firstRowMarkText);

  const listCallsSinceConfirm = await page.evaluate((n) => window.__storageCallLog.slice(n).filter(c=>c.startsWith('list:')).length, callCountBeforeConfirm);
  allPass &= check('Confirming a recheck result does NOT trigger a fresh window.storage.list() (no full list refetch)', listCallsSinceConfirm===0, listCallsSinceConfirm);

  // Now test the status-CHANGE case: mark the remaining untouched unpaid bill (the one with data-recheckstart still
  // present — the first row already has a mark from the previous step) as "found_paid" -> should disappear from
  // the "ค้างโอน" filtered view
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]'));
    const row = rows.find(r => r.querySelector('[data-recheckstart]'));
    row.querySelector('[data-recheckstart]').click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#outstandingList [data-outstandingrow]'));
    const row = rows.find(r => r.querySelector('[data-recheckresult="found_paid"]'));
    row.querySelector('[data-recheckresult="found_paid"]').click();
  });
  await page.waitForTimeout(400);
  const afterStatusChange = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
  allPass &= check('Status-changed bill (now paid) correctly disappears from the "ค้างโอน" filtered view', afterStatusChange===1, afterStatusChange);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
