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
          if(op.deleteKey && op.path){
            let target = root; for(let i=0;i<op.path.length-1;i++){ const seg=op.path[i]; if(target[seg]===undefined) target[seg]={}; target=target[seg]; }
            delete target[op.path[op.path.length-1]];
          } else if(op.path){
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

  await page.evaluate(async () => {
    window.__store['day:2026-10-09'] = { orders: { '01': { p1: 5 }, '02': { p1: 3 }, '10': { p1: 2 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-09'; dayData = window.__store['day:2026-10-09']; dayCache_['2026-10-09'] = dayData;
    await switchTab('order');
    await renderMessages();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test 1: one debt block per branch, not one combined block =====
  const debtBlocks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.msgblock')).filter(el => el.querySelector('.tag.debt')).map(el => ({
      label: el.querySelector('.tag').childNodes[0].textContent.trim(),
      text: el.querySelector('.msgtext').textContent,
    }));
  });
  console.log('Debt blocks:', JSON.stringify(debtBlocks, null, 2));
  allPass &= check('3 separate debt message blocks (one per branch with an order)', debtBlocks.length === 3, debtBlocks.length);
  allPass &= check('Each debt block label names its own branch', debtBlocks.every(b => b.label.includes('ข้อความแจ้งหนี้ —')), debtBlocks.map(b=>b.label));
  const branch01Block = debtBlocks.find(b => b.label.includes('01'));
  allPass &= check('Branch 01 debt text does NOT mention other branches (02, 10)', !!branch01Block && !branch01Block.text.includes('02 :') && !branch01Block.text.includes('10 :'), branch01Block);

  // ===== Test 2: each debt block is independently copyable =====
  const copyBtnCount = await page.evaluate(() => {
    const debtMsgBlocks = Array.from(document.querySelectorAll('.msgblock')).filter(el => el.querySelector('.tag.debt'));
    return debtMsgBlocks.filter(el => el.querySelector('[data-copy]')).length;
  });
  allPass &= check('Each of the 3 debt blocks has its own copy button', copyBtnCount === 3, copyBtnCount);

  // ===== Test 3: editing one branch's debt message only overrides that branch, not the others =====
  // การ์ด "ข้อความส่ง" ใหญ่พับไว้เป็นค่าเริ่มต้น (msgCardOpen=false) ต้องกางก่อนถึงจะ interact กับ textarea ข้างในได้จริง
  await page.click('#msgCardToggle');
  await page.waitForTimeout(200);
  const editDebug = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-msgedit]')).find(b => b.closest('.msgblock').querySelector('.tag').textContent.includes('01'));
    const idx = btn.getAttribute('data-msgedit');
    btn.click();
    const wrap = document.getElementById(`msgeditwrap-${idx}`);
    return { idx, wrapDisplay: wrap ? wrap.style.display : 'MISSING', bodyDisplay: document.getElementById(`msgblockbody-${idx}`)?.style.display };
  });
  console.log('Edit click debug:', JSON.stringify(editDebug));
  await page.waitForTimeout(200);
  const editIdx = editDebug.idx;
  await page.fill(`#msgeditarea-${editIdx}`, 'ข้อความทดสอบเฉพาะสาขา 01');
  await page.click(`[data-msgsave="${editIdx}"]`);
  await page.waitForTimeout(500);
  await stripBanner(page);

  const afterEdit = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.msgblock')).filter(el => el.querySelector('.tag.debt')).map(el => ({
      label: el.querySelector('.tag').childNodes[0].textContent.trim(),
      text: el.querySelector('.msgtext').textContent,
      edited: el.querySelector('.tag').textContent.includes('แก้ไขแล้ว'),
    }));
  });
  console.log('After editing branch 01:', JSON.stringify(afterEdit, null, 2));
  const b01After = afterEdit.find(b => b.label.includes('01'));
  const others = afterEdit.filter(b => !b.label.includes('01'));
  allPass &= check('Branch 01 block shows the edited text and is marked edited', !!b01After && b01After.text === 'ข้อความทดสอบเฉพาะสาขา 01' && b01After.edited, b01After);
  allPass &= check('Other branches are untouched by editing branch 01', others.every(b => !b.edited && !b.text.includes('ทดสอบ')), others);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
