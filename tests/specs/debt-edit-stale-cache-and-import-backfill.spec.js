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
      // จำลอง patchOps ฝั่งเซิร์ฟเวอร์จริงให้รองรับ matchField/matchValue/set/nested (ตามที่ writeRootArrayOp_ ใช้จริง)
      async patchOps(key, ops, rootIsArray){
        let root = window.__store[key]; if(root===undefined) root = rootIsArray ? [] : {};
        root = JSON.parse(JSON.stringify(root));
        const opsArr = Array.isArray(ops) ? ops : [ops];
        for(const op of opsArr){
          if(op.push!==undefined){ root.push(op.push); continue; }
          if(op.matchField && op.matchValue!==undefined){
            const idx = root.findIndex(x=>x[op.matchField]===op.matchValue);
            if(idx===-1) continue;
            if(op.remove){ root.splice(idx,1); continue; }
            if(op.set){ Object.assign(root[idx], op.set); continue; }
            if(op.nested){
              const item = root[idx];
              const f = op.nested.field;
              if(!item[f]) item[f] = [];
              if(op.nested.push!==undefined) item[f].push(op.nested.push);
              if(op.nested.remove){ const i2 = item[f].findIndex(x=>x[op.nested.remove.matchField]===op.nested.remove.matchValue); if(i2!==-1) item[f].splice(i2,1); }
              continue;
            }
          }
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

  // ===== Test 1: editing a debt must not drop a payment recorded concurrently (from "another device") while the edit form was open =====
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 1200 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    const result = await page.evaluate(async () => {
      window.__store['debts'] = [{ id: 'd1', creditor: 'ร้านค้า X', type: 'เงินกู้', owner: 'WJ', interestRate: 0, dueDate: '', principalStart: 10000, payments: [] }];
      // หน้านี้เคยโหลดรายการหนี้มาก่อนแล้ว (แคชถูกตั้งไว้ในหน่วยความจำ) — จำลอง "เปิดฟอร์มแก้ไขค้างไว้"
      await loadDebts();

      // จำลองอีกเครื่อง/แท็บบันทึกจ่ายหนี้นี้ไปแล้วที่เซิร์ฟเวอร์จริง (เขียนตรงลง window.__store โดยไม่ผ่าน debtsCache_ ของหน้านี้)
      window.__store['debts'][0].payments.push({ id: 'p1', date: '2026-10-20', amount: 2000, interest: 0 });

      // ตอนนี้กรอกฟอร์มแก้ไข (แค่เปลี่ยนเงินต้น) แล้วกดบันทึก
      editingDebtId = 'd1';
      document.getElementById('debtCreditor').value = 'ร้านค้า X';
      document.getElementById('debtType').value = 'เงินกู้';
      document.getElementById('debtOwner').value = 'WJ';
      document.getElementById('debtInterest').value = '0';
      document.getElementById('debtDueDate').value = '';
      document.getElementById('debtPrincipal').value = '12000';
      document.getElementById('debtRemainNow').value = '';
      await addDebt();

      return window.__store['debts'][0];
    });
    console.log('Debt after edit (with a concurrent payment that should survive):', JSON.stringify(result, null, 2));
    allPass &= check('Debt edit saved with the new principal', result.principalStart === 12000, result.principalStart);
    allPass &= check('The concurrently-recorded payment (p1, ฿2000) was NOT dropped by the edit', (result.payments||[]).some(p=>p.id==='p1' && p.amount===2000), result.payments);

    await page.close();
  }

  // ===== Test 2: importAllData backfills purchaseSellers/calendarDotsEnabled/shelfLifeDays on an old/incomplete settings blob =====
  {
    const page = await browser.newPage({ viewport: { width: 420, height: 1200 } });
    page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
    await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await stripBanner(page);
    await installMockStorage(page);

    const after = await page.evaluate(async () => {
      // settings เก่า ไม่มี purchaseSellers/calendarDotsEnabled/shelfLifeDays เลย (จำลองไฟล์สำรองเก่าก่อนฟีเจอร์พวกนี้มี)
      const oldSettings = { branches: [{code:'00', area:'ธงหมูกะทะ หลักสี่'}], priceHistory: {}, billInfo: {}, expenseCategories: ['น้ำแข็ง'], debtOwners: ['WJ'], debtTypes: ['เงินกู้'], personalIncomeCategories: ['เงินเดือน'], personalExpenseCategories: ['ค่าอาหาร'] };
      const payload = { settings: oldSettings };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const file = new File([blob], 'backup.json', { type: 'application/json' });
      await importAllData(file);
      return {
        purchaseSellers: settings.purchaseSellers,
        calendarDotsEnabled: settings.calendarDotsEnabled,
        shelfLifeDays: settings.shelfLifeDays,
        storedPurchaseSellers: window.__store['settings'] && window.__store['settings'].purchaseSellers,
      };
    });
    console.log('Settings after importing an old/incomplete backup:', JSON.stringify(after, null, 2));
    allPass &= check('settings.purchaseSellers backfilled (not undefined)', Array.isArray(after.purchaseSellers) && after.purchaseSellers.length>0, after.purchaseSellers);
    allPass &= check('settings.calendarDotsEnabled backfilled to true', after.calendarDotsEnabled === true, after.calendarDotsEnabled);
    allPass &= check('settings.shelfLifeDays backfilled with product entries', after.shelfLifeDays && Object.keys(after.shelfLifeDays).length>0, after.shelfLifeDays);
    allPass &= check('The backfilled settings were actually persisted to storage (not just in-memory)', Array.isArray(after.storedPurchaseSellers) && after.storedPurchaseSellers.length>0, after.storedPurchaseSellers);

    await page.close();
  }

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
