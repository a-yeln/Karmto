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
  let allPass = true;

  // ===== TEST 1: the "ที่ต้องตามโอน" outstanding list (#outstandingList, renderOutstanding()) =====
  // บั๊กที่รายงาน: ยืนยันบิลแรกเลือกวันที่เองแล้ว บิลที่ 2,3 ที่ยังค้างอยู่ใน DOM ต้อง "ล็อกตาม" วันที่ที่เพิ่งเลือกไปอัตโนมัติ
  // เหมือนบิลแรก (ไม่ใช่โชว์ค่าเดิมที่เรนเดอร์ไว้ตั้งแต่แรกเริ่มของลิสต์ ต้องมากดเลือกวันที่เองใหม่ทุกรอบ)
  {
    const page = await browser.newPage({ viewport: { width: 450, height: 1600 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    await page.evaluate(async () => {
      const mkDay = (iso, orders) => ({ orders, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
      window.__store['day:2026-10-01'] = mkDay('2026-10-01', { '01': { p1: 5 } });
      window.__store['day:2026-10-02'] = mkDay('2026-10-02', { '02': { p1: 3 } });
      window.__store['day:2026-10-03'] = mkDay('2026-10-03', { '03': { p1: 2 } });
      currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08'] = mkDay('2026-10-08', {});
      dayCache_['2026-10-08'] = dayData;
      await switchTab('billing');
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const rowCount = await page.evaluate(() => document.querySelectorAll('#outstandingList [data-outstandingrow]').length);
    allPass &= check('3 unpaid bills shown in the outstanding list', rowCount === 3, rowCount);

    // เปิดช่องกรอกวันที่ของบิลแรก แล้วเลือกวันที่ใหม่ (ไม่ใช่ค่า default) ก่อนกดยืนยัน
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      rows[0].querySelector('[data-outstandingpay]').click();
    });
    await page.waitForTimeout(150);
    const CHOSEN_DATE = '2026-10-05';
    await page.evaluate((chosenDate) => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      const dateInput = rows[0].querySelector('input[type="date"]');
      dateInput.value = chosenDate;
    }, CHOSEN_DATE);
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      rows[0].querySelector('[data-outstandingconfirm]').click();
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const afterFirstConfirm = await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      return {
        rowCount: rows.length,
        remainingDateInputValues: Array.from(rows).map(r => r.querySelector('input[type="date"]')?.value),
      };
    });
    console.log('After confirming bill 1 with a custom date:', JSON.stringify(afterFirstConfirm));
    allPass &= check('Confirmed row removed, 2 remain', afterFirstConfirm.rowCount === 2, afterFirstConfirm.rowCount);
    allPass &= check('Remaining rows\' date inputs auto-locked to the just-confirmed date (not the stale initial default)',
      afterFirstConfirm.remainingDateInputValues.every(v => v === CHOSEN_DATE), afterFirstConfirm.remainingDateInputValues);

    // ยืนยันบิลที่ 2 ต่อ (ไม่แตะวันที่เลย ปล่อยให้ใช้ค่าที่ล็อกตามมา) แล้วเช็คว่าบิลที่ 3 (ตัวสุดท้าย) ก็ยังล็อกตามต่อเนื่อง
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      rows[0].querySelector('[data-outstandingpay]').click();
    });
    await page.waitForTimeout(150);
    const dateInputValueBeforeSecondConfirm = await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      return rows[0].querySelector('input[type="date"]').value;
    });
    allPass &= check('Second row\'s editor opens already showing the locked date', dateInputValueBeforeSecondConfirm === CHOSEN_DATE, dateInputValueBeforeSecondConfirm);
    await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      rows[0].querySelector('[data-outstandingconfirm]').click();
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const afterSecondConfirm = await page.evaluate(() => {
      const rows = document.querySelectorAll('#outstandingList [data-outstandingrow]');
      return { rowCount: rows.length, lastDateInputValue: rows[0]?.querySelector('input[type="date"]')?.value };
    });
    console.log('After confirming bill 2 (3rd/last bill left):', JSON.stringify(afterSecondConfirm));
    allPass &= check('Only the last bill remains', afterSecondConfirm.rowCount === 1, afterSecondConfirm.rowCount);
    allPass &= check('Last remaining row still carries the locked date (locking survives across multiple confirms, not just the first)',
      afterSecondConfirm.lastDateInputValue === CHOSEN_DATE, afterSecondConfirm.lastDateInputValue);

    await page.close();
  }

  // ===== TEST 2: the branch-detail "บิลรายสาขา" quickpay list (renderBranchBillList, #outstandingBranchDetail) =====
  {
    const page = await browser.newPage({ viewport: { width: 450, height: 1600 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    await page.evaluate(async () => {
      const mkDay = (iso, qty) => ({ orders: { '01': { p1: qty } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
      window.__store['day:2026-10-01'] = mkDay('2026-10-01', 10);
      window.__store['day:2026-10-02'] = mkDay('2026-10-02', 5);
      window.__store['day:2026-10-03'] = mkDay('2026-10-03', 7);
      currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08'] = { orders:{}, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
      dayCache_['2026-10-08'] = dayData;
      await switchTab('billing');
    });
    await page.waitForTimeout(400);
    await stripBanner(page);
    await page.selectOption('#outstandingBranchFilter', '01');
    await page.waitForTimeout(400);
    await stripBanner(page);
    await page.click('#outstandingBranchDetail [data-branchbillfilter="unpaid"]');
    await page.waitForTimeout(300);
    await stripBanner(page);

    const rowCount = await page.evaluate(() => document.querySelectorAll('#outstandingBranchDetail .branchbill').length);
    allPass &= check('3 unpaid bills shown for branch 01', rowCount === 3, rowCount);

    const CHOSEN_DATE_2 = '2026-10-06';
    await page.evaluate(() => {
      document.querySelectorAll('#outstandingBranchDetail .branchbill')[0].querySelector('[data-quickpay]').click();
    });
    await page.waitForTimeout(150);
    await page.evaluate((chosenDate) => {
      document.querySelectorAll('#outstandingBranchDetail .branchbill')[0].querySelector('input[type="date"]').value = chosenDate;
    }, CHOSEN_DATE_2);
    await page.evaluate(() => {
      document.querySelectorAll('#outstandingBranchDetail .branchbill')[0].querySelector('[data-quickpayconfirm]').click();
    });
    await page.waitForTimeout(500);
    await stripBanner(page);

    const after = await page.evaluate(() => {
      const cards = document.querySelectorAll('#outstandingBranchDetail .branchbill');
      return {
        rowCount: cards.length,
        remainingDateInputValues: Array.from(cards).map(c => c.querySelector('input[type="date"]')?.value),
      };
    });
    console.log('Branch-detail quickpay list after confirming bill 1:', JSON.stringify(after));
    allPass &= check('Confirmed bill removed from the "unpaid" filter view, 2 remain', after.rowCount === 2, after.rowCount);
    allPass &= check('Remaining branch bills\' date inputs auto-locked to the just-confirmed date', after.remainingDateInputValues.every(v => v === CHOSEN_DATE_2), after.remainingDateInputValues);

    await page.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
