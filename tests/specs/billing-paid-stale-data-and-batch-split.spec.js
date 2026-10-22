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
      // จำลอง patchField ฝั่งเซิร์ฟเวอร์จริง: อ่าน-แก้-เขียนเฉพาะฟิลด์ที่ระบุบน "ค่าล่าสุดที่เซิร์ฟเวอร์เก็บจริง" (window.__store)
      // ไม่ใช่ค่าที่ client ส่งมาทั้งก้อน — เพื่อให้จำลองเคส "อีกเครื่องแก้ไขฟิลด์อื่นของวันเดียวกันไปก่อนหน้านี้แล้ว" ได้จริง
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
  let allPass = true;

  // ===== Test 1: writeBillingPaid_'s merged "fresh" doc must land on dayData, not just patch billingPaid in place =====
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 1200 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    await page.evaluate(async () => {
      window.__store['day:2026-10-09'] = { orders: { '01': { p1: 5 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
      currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09']; dayCache_['2026-10-09'] = dayData;
      await switchTab('billing');
    });
    await page.waitForTimeout(400);
    await stripBanner(page);

    // จำลอง "อีกเครื่อง" แก้ billExtra ของสาขา 01 ไปแล้วที่เซิร์ฟเวอร์ (window.__store) โดย dayData ฝั่งนี้ยังไม่รู้เรื่อง (ยังเป็นค่าเก่า)
    await page.evaluate(() => {
      window.__store['day:2026-10-09'].billExtra['01'] = 999;
    });

    // ยืนยันจ่ายสาขา 01 ผ่านหน้าบิลรายสาขาตามปกติ
    await page.click('[data-pay="01"]');
    await page.waitForTimeout(200);
    await page.fill('#payamt-01', '1375');
    await page.click('[data-confirmpay="01"]');
    await page.waitForTimeout(400);
    await stripBanner(page);

    const after = await page.evaluate(() => ({ billExtra01: dayData.billExtra['01'], billingPaid01: dayData.billingPaid['01'] }));
    console.log('After confirming pay with a concurrent server-side billExtra edit:', JSON.stringify(after));
    allPass &= check('dayData picks up the server-merged billExtra (999) instead of staying stale (undefined)', after.billExtra01 === 999, after.billExtra01);
    allPass &= check('dayData.billingPaid for the confirmed branch is also set correctly', after.billingPaid01 && after.billingPaid01.paid === true, after.billingPaid01);

    await page.close();
  }

  // ===== Test 2: batch-pay across multiple dates must apportion transferAmount/billedAmount PER BILL, not stamp the full batch total on every bill =====
  {
    const page = await browser.newPage({ viewport: { width: 450, height: 1600 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    const mkDay = (orders) => ({ orders, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' });
    await page.evaluate(async (mkDayStr) => {
      const mkDay = eval('(' + mkDayStr + ')');
      // สาขา 01 มี 2 บิลค้างคนละวัน: 10/10 (฿500) และ 15/10 (฿700) — รวม ฿1200
      window.__store['day:2026-10-10'] = mkDay({ '01': { p1: Math.round(500/275*10)/10 } });
      window.__store['day:2026-10-15'] = mkDay({ '01': { p1: Math.round(700/275*10)/10 } });
      currentDate = '2026-10-20'; dayData = window.__store['day:2026-10-20'] = mkDay({});
      dayCache_['2026-10-20'] = dayData;
      await switchTab('billing');
    }, mkDay.toString());
    await page.waitForTimeout(400);
    await stripBanner(page);

    await page.selectOption('#outstandingBranchFilter', '01');
    await page.waitForTimeout(400);
    await stripBanner(page);

    // เลือกทั้ง 2 บิล แล้วยืนยันโอนรวมทีเดียวด้วยยอดโอนจริง = ยอดบิลรวมพอดี (ไม่ปรับยอด)
    const billedSum = await page.evaluate(() => {
      document.querySelectorAll('#outstandingBranchDetail [data-billselect]').forEach(cb => cb.click());
      return document.getElementById('branchPaySelSum')?.textContent;
    });
    console.log('Selected sum shown in pay bar:', billedSum);
    await page.waitForTimeout(200);
    await page.click('#branchPayConfirmBtn');
    await page.waitForTimeout(600);
    await stripBanner(page);

    const stored = await page.evaluate(() => ({
      d10: window.__store['day:2026-10-10'].billingPaid['01'],
      d15: window.__store['day:2026-10-15'].billingPaid['01'],
    }));
    console.log('Stored billingPaid per date after batch pay:', JSON.stringify(stored, null, 2));

    const amt10 = Math.round(500/275*10)/10 * 275; // real computed bill amount for 10/10
    const amt15 = Math.round(700/275*10)/10 * 275; // real computed bill amount for 15/10

    allPass &= check('10/10 bill: billedAmount is its OWN amount, not the batch sum', Math.abs(stored.d10.billedAmount - amt10) < 1, {got: stored.d10.billedAmount, expected: amt10});
    allPass &= check('15/10 bill: billedAmount is its OWN amount, not the batch sum', Math.abs(stored.d15.billedAmount - amt15) < 1, {got: stored.d15.billedAmount, expected: amt15});
    allPass &= check('10/10 bill: transferAmount is NOT the full batch total', stored.d10.transferAmount < (amt10 + amt15) - 1, stored.d10.transferAmount);
    allPass &= check('15/10 bill: transferAmount is NOT the full batch total', stored.d15.transferAmount < (amt10 + amt15) - 1, stored.d15.transferAmount);
    const sumOfShares = Math.round((stored.d10.transferAmount + stored.d15.transferAmount) * 100) / 100;
    allPass &= check('The two per-bill transferAmount shares sum back up to the real total transferred (no money lost/gained to rounding)', Math.abs(sumOfShares - (amt10+amt15)) < 0.5, {sumOfShares, expectedTotal: amt10+amt15});
    allPass &= check('batchTotal field preserves the real whole-batch transferred amount for display', Math.abs(stored.d10.batchTotal - (amt10+amt15)) < 1 && Math.abs(stored.d15.batchTotal - (amt10+amt15)) < 1, {d10: stored.d10.batchTotal, d15: stored.d15.batchTotal});

    // ===== เช็คว่า "โอนเข้าแล้ววันนี้" ของวันที่ 15/10 ไม่บวมเท่ากับยอดรวมทั้งชุด (บั๊กเดิม: จะเห็น 1200 ทั้งที่จริงแค่ 700) =====
    await page.evaluate(async () => {
      currentDate = '2026-10-15';
      dayData = await loadDay('2026-10-15');
      dayCache_['2026-10-15'] = dayData;
      await switchTab('billing');
      renderBillingList();
    });
    await page.waitForTimeout(300);
    await stripBanner(page);
    const statsText = await page.evaluate(() => document.getElementById('billingTodayStats')?.textContent || '');
    console.log('15/10 billingTodayStats text:', statsText);
    const expectedShareRounded = Math.round(amt15);
    allPass &= check(`15/10's own "received today" stat reflects only its own ~${expectedShareRounded} share, not the full ${Math.round(amt10+amt15)} batch total`,
      statsText.includes(String(expectedShareRounded)) && !statsText.includes(String(Math.round(amt10+amt15))), statsText);

    await page.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
