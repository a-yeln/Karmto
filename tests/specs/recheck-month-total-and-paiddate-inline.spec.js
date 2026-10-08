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

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  let allPass = true;

  // ===== Test 1: X/Y total (month/year) display in paid/all filter mode =====
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    await page.evaluate(async () => {
      const mkPaidDay = (iso, code, paidDate) => ({ orders: { [code]: { p1: 5 } }, leftoverOut:{}, leftoverSince:{}, billingPaid: {[code]: {paid:true, paidDate, transferAmount:850, billedAmount:850}}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
      // 2 paid bills in October (selected month), 1 more paid bill in August (same year, different month)
      window.__store['day:2026-10-02'] = mkPaidDay('2026-10-02', '01', '2026-10-03');
      window.__store['day:2026-10-05'] = mkPaidDay('2026-10-05', '02', '2026-10-06');
      window.__store['day:2026-08-15'] = mkPaidDay('2026-08-15', '03', '2026-08-16');
      currentDate = '2026-10-08'; dayData = { orders:{}, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
      dayCache_['2026-10-08'] = dayData;
      await switchTab('billing');
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    // Switch to "โอนแล้ว" (paid) filter, which is month-scoped, then enable recheck mode
    await page.click('[data-outstatusfilter="paid"]');
    await page.waitForTimeout(400);
    await stripBanner(page);
    await page.evaluate(() => {
      const cb = document.getElementById('recheckModeToggle');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(600);
    await stripBanner(page);

    const totalChip = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('#recheckRoundSummary .statchip'));
      const c = chips.find(x => x.textContent.includes('ทั้งหมด'));
      return c ? c.textContent.trim() : null;
    });
    console.log('Total chip (paid filter, October selected, year has 3 paid bills total):', totalChip);
    allPass &= check('Shows "2/3" — 2 paid bills in October / 3 paid bills in the whole year 2026', totalChip === '📋 ทั้งหมด2/3', totalChip);

    await page.close();
  }

  // ===== Test 2: บิลรายสาขา — paid date inline on the main line, before the 🧾 icon, same line as name/amount =====
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);
    await page.evaluate(async () => {
      window.__store['day:2026-10-08'] = {
        orders: { '01': { p1: 8 } }, leftoverOut:{}, leftoverSince:{},
        billingPaid: { '01': { paid:true, paidDate:'2026-10-08', transferAmount:1400, billedAmount:1360 } },
        billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{},
        expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:''
      };
      currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08']; dayCache_['2026-10-08'] = dayData;
      await switchTab('billing');
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const rowInfo = await page.evaluate(() => {
      const row = document.querySelector('#billingList .branchbill');
      const acts2 = row.querySelector('.toprow .acts2');
      const children = Array.from(acts2.children).map(c => c.tagName + ':' + c.textContent.trim().slice(0,20));
      return {
        toprowText: row.querySelector('.toprow').textContent.replace(/\s+/g,' ').trim(),
        acts2Children: children,
        dateTagIsFirstChild: acts2.firstElementChild ? acts2.firstElementChild.textContent.includes('08/10/2026') : false,
      };
    });
    console.log('บิลรายสาขา row (paid):', JSON.stringify(rowInfo, null, 2));
    allPass &= check('Paid date appears on the main toprow line', rowInfo.toprowText.includes('08/10/2026'), rowInfo.toprowText);
    allPass &= check('Paid date tag is the FIRST child of .acts2 (right side, before the 🧾 icon button)', rowInfo.dateTagIsFirstChild, rowInfo.acts2Children);
    allPass &= check('acts2 order is [date tag, icon button, paytoggle]', rowInfo.acts2Children.length === 3 && rowInfo.acts2Children[1].startsWith('BUTTON') && rowInfo.acts2Children[2].startsWith('BUTTON'), rowInfo.acts2Children);

    await page.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
