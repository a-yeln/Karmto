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
  const page = await browser.newPage({ viewport: { width: 420, height: 1600 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  // สาขา 13S เป็นสาขา "แยกส่ง" ที่ติดมากับ DEFAULT_BRANCHES (separate:true) — จงใจสั่งโค้ด "13S" ซึ่งเรียงตัวอักษรแล้ว
  // จะโผล่แทรกกลางๆ ระหว่าง 02 กับ 03 ถ้าเรียงแบบเดิม (ตัวอักษรล้วน) แต่ต้องถูกดันไปท้ายสุดด้วยกติกาใหม่
  await page.evaluate(async () => {
    window.__store['day:2026-10-09'] = {
      orders: { '01': { p1: 5, p3: 2 }, '02': { p1: 3, p3: 1 }, '13S': { p1: 2, p3: 4 }, '03': { p1: 1, p3: 1 } },
      leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{},
      expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'',
    };
    currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09']; dayCache_['2026-10-09'] = dayData;
    await switchTab('order');
    renderOrderList();
    await renderMessages();
    await switchTab('billing');
    renderBillingList();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test 1: ออเดอร์ประจำวัน (Order tab's "สาขาที่บันทึกแล้ววันนี้" list) =====
  const orderListCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#orderList .orow .code')).map(el => el.textContent));
  console.log('Order list codes:', JSON.stringify(orderListCodes));
  allPass &= check('Order list: normal branches first (01,02,03), separate branch (13S) pushed to the very end', JSON.stringify(orderListCodes) === JSON.stringify(['01','02','03','13S']), orderListCodes);

  // ===== Test 2: ข้อความสั่งม๊ะก๊าด — normal rows first, "แยกส่ง" heading + separate rows at the end =====
  const mahkardText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.mahkard'));
    return el?.querySelector('.msgtext')?.textContent;
  });
  console.log('Mahkard message:', mahkardText);
  const idx01 = mahkardText.indexOf('01 : ');
  const idx03 = mahkardText.indexOf('03 : ');
  const idxHeading = mahkardText.indexOf('แยกส่ง');
  const idx13S = mahkardText.indexOf('13S : ');
  allPass &= check('Mahkard message: normal branch rows present (01, 03)', idx01 !== -1 && idx03 !== -1, {idx01, idx03});
  allPass &= check('Mahkard message: "แยกส่ง" heading appears after all normal rows, separate row (13S) comes last', idx03 < idxHeading && idxHeading < idx13S, {idx03, idxHeading, idx13S});

  // ===== Test 3: ข้อความแจ้งหนี้ — already had this grouping; confirm it still holds after reusing the shared comparator =====
  const debtText = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.msgblock')).find(el => el.querySelector('.tag.debt'));
    return el?.querySelector('.msgtext')?.textContent;
  });
  const debtIdx03 = debtText.indexOf('3 : ');
  const debtIdxHeading = debtText.indexOf('แยกส่ง');
  const debtIdx13S = debtText.indexOf('13S : ');
  allPass &= check('Debt message: separate branch (13S) still grouped after "แยกส่ง" heading, at the very end', debtIdx03 < debtIdxHeading && debtIdxHeading < debtIdx13S, {debtIdx03, debtIdxHeading, debtIdx13S});

  // ===== Test 4: บิลรายสาขา (renderBillingList, "หน้าบิลเงินสด") — normal branches first, separate last =====
  const billingCodes = await page.evaluate(() => Array.from(document.querySelectorAll('#billingList .branchbill .code')).map(el => el.textContent));
  console.log('Billing list codes:', JSON.stringify(billingCodes));
  allPass &= check('Billing list: normal branches first (01,02,03), separate branch (13S) pushed to the very end', JSON.stringify(billingCodes) === JSON.stringify(['01','02','03','13S']), billingCodes);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
