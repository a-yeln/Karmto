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
      async set(key, value){ window.__store[key]=JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ delete window.__store[key]; return {key, deleted:true, shared:false}; },
      async list(prefix){ window.__storageCallLog.push('list:'+prefix); return {keys: Object.keys(window.__store).filter(k=>k.startsWith(prefix||'')), prefix, shared:false}; },
      async patchField(key, path, value){
        window.__storageCallLog.push('patchField:'+key);
        let root = window.__store[key]; if(root === undefined) root = {}; root = JSON.parse(JSON.stringify(root));
        let target = root; for(let i=0;i<path.length-1;i++){ const seg=path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
        if(path.length>0) target[path[path.length-1]] = value;
        window.__store[key] = root; return {key, value: JSON.stringify(root), shared:false};
      },
      async patchOps(key, ops, rootIsArray){ return {key, value: JSON.stringify(window.__store[key]||(rootIsArray?[]:{})), shared:false}; },
    };
    window.bulkGetStorageImpl = async (keys) => { const out={}; keys.forEach(k=>{ out[k]=window.__store[k]!==undefined?JSON.stringify(window.__store[k]):null; }); return out; };
  });
}

function check(label, cond, extra) {
  const pass = !!cond;
  console.log((pass?'PASS':'FAIL') + ' — ' + label + (extra!==undefined ? ' | ' + JSON.stringify(extra) : ''));
  return pass;
}

async function seedTwoUnpaidBills(page) {
  await page.evaluate(async () => {
    const mkDay = (iso, qty) => ({ orders: { '01': { p1: qty } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    window.__store['day:2026-10-01'] = mkDay('2026-10-01', 10);
    window.__store['day:2026-10-02'] = mkDay('2026-10-02', 5);
    currentDate = '2026-10-02'; dayData = window.__store['day:2026-10-02']; dayCache_['2026-10-02'] = dayData;
    await switchTab('billing');
  });
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  let allPass = true;

  // ===== TEST 1: filter='unpaid' — confirming one bill removes just that card, no full reload =====
  {
    const page = await browser.newPage({ viewport: { width: 450, height: 1300 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);
    await seedTwoUnpaidBills(page);
    await page.waitForTimeout(400);
    await stripBanner(page);

    // Select branch '01' in the Outstanding tab's branch filter -> shows renderBranchBillList (default filter 'all', but
    // unpaid tab is what we want to test for removal) — switch to the "unpaid" filter tab explicitly.
    await page.selectOption('#outstandingBranchFilter', '01');
    await page.waitForTimeout(400);
    await stripBanner(page);
    await page.click('#outstandingBranchDetail [data-branchbillfilter="unpaid"]');
    await page.waitForTimeout(300);
    await stripBanner(page);

    const before = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#outstandingBranchDetail .branchbill').length,
      kpiCount: document.querySelector('#outstandingBranchDetail .dash-grid .dash-metric .dm-value')?.textContent,
    }));
    console.log('Before confirm:', JSON.stringify(before));
    allPass &= check('Two unpaid bills shown before confirming', before.rowCount === 2, before.rowCount);

    // Mark the SECOND row's DOM node so we can prove it is NOT replaced (no full list rebuild)
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingBranchDetail .branchbill');
      rows[1].dataset.testMarker = 'untouched-marker';
    });

    const listCallsBefore = await page.evaluate(() => window.__storageCallLog.filter(c=>c.startsWith('list:')).length);

    // Open the quickpay editor on the FIRST bill and confirm it
    await page.evaluate(() => {
      const firstCard = document.querySelectorAll('#outstandingBranchDetail .branchbill')[0];
      firstCard.querySelector('[data-quickpay]').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const firstCard = document.querySelectorAll('#outstandingBranchDetail .branchbill')[0];
      firstCard.querySelector('[data-quickpayconfirm]').click();
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const after = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#outstandingBranchDetail .branchbill').length,
      secondRowMarkerSurvived: document.querySelector('[data-test-marker]') ? true : (document.querySelectorAll('#outstandingBranchDetail .branchbill')[0]?.dataset.testMarker === 'untouched-marker'),
      kpiCount: document.querySelector('#outstandingBranchDetail .dash-grid .dash-metric .dm-value')?.textContent,
      emptyHint: document.querySelector('#outstandingBranchDetail .hint')?.textContent,
    }));
    const listCallsAfter = await page.evaluate(() => window.__storageCallLog.filter(c=>c.startsWith('list:')).length);
    console.log('After confirm:', JSON.stringify(after), 'listCallsBefore/After:', listCallsBefore, listCallsAfter);

    allPass &= check('Confirmed bill row removed; only the untouched one remains', after.rowCount === 1, after.rowCount);
    allPass &= check('The remaining row is the ORIGINAL (unreplaced) DOM node — proof no full list rebuild happened', after.secondRowMarkerSurvived, after.secondRowMarkerSurvived);
    allPass &= check('KPI "บิลค้างโอน" count patched down to 1', after.kpiCount === '1 บิล', after.kpiCount);
    allPass &= check('No fresh window.storage.list() call fired (proof computeBranchAggregates() was NOT re-fetched)', listCallsAfter === listCallsBefore, {listCallsBefore, listCallsAfter});

    await page.close();
  }

  // ===== TEST 2: filter='all' — confirming one bill patches it in place (stays visible, status updates) =====
  {
    const page = await browser.newPage({ viewport: { width: 450, height: 1300 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);
    await seedTwoUnpaidBills(page);
    await page.waitForTimeout(400);
    await stripBanner(page);
    await page.selectOption('#outstandingBranchFilter', '01');
    await page.waitForTimeout(400);
    await stripBanner(page);
    // default filter is 'all' already per branchDetailActiveFilter_ default — confirm via explicit click anyway
    await page.click('#outstandingBranchDetail [data-branchbillfilter="all"]');
    await page.waitForTimeout(300);
    await stripBanner(page);

    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingBranchDetail .branchbill');
      rows[1].dataset.testMarker = 'untouched-marker-2';
    });
    const listCallsBefore = await page.evaluate(() => window.__storageCallLog.filter(c=>c.startsWith('list:')).length);

    await page.evaluate(() => {
      const firstCard = document.querySelectorAll('#outstandingBranchDetail .branchbill')[0];
      firstCard.querySelector('[data-quickpay]').click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const firstCard = document.querySelectorAll('#outstandingBranchDetail .branchbill')[0];
      firstCard.querySelector('[data-quickpayconfirm]').click();
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const after = await page.evaluate(() => {
      const cards = document.querySelectorAll('#outstandingBranchDetail .branchbill');
      const first = cards[0];
      return {
        rowCount: cards.length,
        secondRowMarkerSurvived: cards[1]?.dataset.testMarker === 'untouched-marker-2',
        firstCardPaidBtnText: first.querySelector('[data-quickpay]')?.textContent,
        firstCardHasPaidTag: !!first.querySelector('.paidtag'),
        firstCardHasEditor: !!first.querySelector('[data-quickpayeditor]'),
        kpiCount: document.querySelector('#outstandingBranchDetail .dash-grid .dash-metric .dm-value')?.textContent,
        unpaidTabLabel: document.querySelector('[data-branchbillfilter="unpaid"]')?.textContent,
        paidTabLabel: document.querySelector('[data-branchbillfilter="paid"]')?.textContent,
      };
    });
    const listCallsAfter = await page.evaluate(() => window.__storageCallLog.filter(c=>c.startsWith('list:')).length);
    console.log('Test 2 after confirm (filter=all):', JSON.stringify(after, null, 2), 'listCalls:', listCallsBefore, listCallsAfter);

    allPass &= check('Both rows still shown (filter=all keeps paid bills visible)', after.rowCount === 2, after.rowCount);
    allPass &= check('The second (untouched) row DOM node was not replaced', after.secondRowMarkerSurvived);
    allPass &= check('First card paytoggle now reads "โอนแล้ว"', after.firstCardPaidBtnText === 'โอนแล้ว', after.firstCardPaidBtnText);
    allPass &= check('First card shows a paid tag', after.firstCardHasPaidTag);
    allPass &= check('First card no longer has the quickpay editor form', !after.firstCardHasEditor);
    allPass &= check('KPI unpaid count patched to 1 (2 seeded, 1 confirmed)', after.kpiCount === '1 บิล', after.kpiCount);
    allPass &= check('Filter tab labels updated (ค้างโอน (1) / โอนแล้ว (1))', after.unpaidTabLabel.includes('(1)') && after.paidTabLabel.includes('(1)'), {unpaidTabLabel: after.unpaidTabLabel, paidTabLabel: after.paidTabLabel});
    allPass &= check('No fresh window.storage.list() call fired', listCallsAfter === listCallsBefore, {listCallsBefore, listCallsAfter});

    await page.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
