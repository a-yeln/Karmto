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
  const page = await browser.newPage({ viewport: { width: 420, height: 1200 } });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto((process.env.BASE_URL || 'http://localhost:8765') + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await stripBanner(page);
  await installMockStorage(page);

  let allPass = true;

  await page.evaluate(async () => {
    window.__store['day:2026-10-08'] = { orders: { '11': { p1:1, p2:1, p3:6, p4:1, p5:1, p7:20 } }, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:'' };
    currentDate = '2026-10-08'; dayData = window.__store['day:2026-10-08']; dayCache_['2026-10-08'] = dayData;
    await switchTab('order'); // ทำให้ panel-order โชว์ (switchTab ไม่ได้เรียก renderOrderList() เอง — อันนั้นถูกเรียกตอนโหลดแอปครั้งแรกเท่านั้น)
    renderOrderList();
  });
  await page.waitForTimeout(500);
  await stripBanner(page);

  // ===== Test 1: per-row 🏷️ button exists on the order row =====
  const rowBtn = await page.evaluate(() => !!document.querySelector('#orderList [data-printticket="11"]'));
  allPass &= check('🏷️ icon button exists on the order row', rowBtn);

  // ===== Test 2: "save all" button exists in the card header =====
  const allBtnExists = await page.evaluate(() => !!document.getElementById('saveAllOrderTicketsBtn'));
  allPass &= check('"บันทึกออเดอร์ทุกสาขาเป็นภาพ" button exists', allBtnExists);

  // ===== Test 3: clicking the per-row button generates a non-empty image with no JS errors =====
  // html2canvas โหลดจาก cdnjs.cloudflare.com จริงๆ ไม่ได้ในแซนด์บ็อกซ์นี้ (proxy บล็อก) — stub เป็น canvas เปล่าแทน (เหมือน
  // mock window.storage) เพื่อทดสอบแค่ว่าโค้ดเราเรียกมันถูกจังหวะ ได้ blob ออกมาจริง ไม่ใช่ทดสอบไลบรารีภายนอก
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    window.html2canvas = async () => { const c = document.createElement('canvas'); c.width = 10; c.height = 10; return c; };
    window.__origCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__lastBlobSize = b.size; return 'blob:stub'; };
    // บังคับให้ไหลไปทางดาวน์โหลด/zip เสมอ (ไม่ใช่ navigator.share) กันผลเทสต์ไม่แน่นอนตามว่า headless Chromium รุ่นนั้นมี Web Share API หรือเปล่า
    navigator.canShare = undefined;
    navigator.share = undefined;
  });
  await page.click('#orderList [data-printticket="11"]');
  await page.waitForTimeout(2500);
  const blobSize = await page.evaluate(() => window.__lastBlobSize);
  allPass &= check('Clicking 🏷️ generated a non-empty image blob', typeof blobSize === 'number' && blobSize > 0, blobSize);
  allPass &= check('No JS exceptions while generating the ticket image', errors.length === 0, errors);

  // ===== Test 4: clicking "save all" also produces an image =====
  // headless Chromium ไม่มี navigator.canShare -> ไหลไปทาง fallback zip ซึ่งต้องใช้ JSZip (โหลดจาก cdnjs เหมือนกัน บล็อกเหมือนกัน) stub ด้วย
  await page.evaluate(() => {
    window.__lastBlobSize = null;
    window.JSZip = class { file(){} async generateAsync(){ return new Blob(['stub']); } };
  });
  await page.click('#saveAllOrderTicketsBtn');
  await page.waitForTimeout(3000);
  const blobSize2 = await page.evaluate(() => window.__lastBlobSize);
  allPass &= check('Clicking "save all" also produced an image', typeof blobSize2 === 'number' && blobSize2 > 0, blobSize2);

  // ===== Test 5: ticket always lists all 7 products (not just the ones ordered), with unordered ones dimmed and blank qty =====
  const ticket = await page.evaluate(() => {
    const html = buildOrderTicketHTML('11', '2026-10-08', {p1:1,p2:1,p3:6,p4:1,p5:1,p7:20});
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const rows = Array.from(wrap.querySelectorAll('.orderticket-row'));
    const info = rows.map(r => ({
      name: r.querySelector('.orderticket-itemname').textContent.trim(),
      qtyText: r.querySelector('.orderticket-qty').textContent.trim(),
      unordered: r.classList.contains('orderticket-row-unordered'),
    }));
    wrap.remove();
    return { html, info };
  });
  console.log('Ticket rows:', JSON.stringify(ticket.info, null, 2));
  allPass &= check('Ticket lists all 7 products, not just ordered ones', ticket.info.length === 7, ticket.info.length);
  const cherry = ticket.info.find(r => r.name === 'เนื้อหอยเชอรี่');
  allPass &= check('Unordered item (เนื้อหอยเชอรี่) is present with blank qty and dimmed', !!cherry && cherry.qtyText === '' && cherry.unordered === true, cherry);
  const oyster = ticket.info.find(r => r.name === 'เนื้อหอยนางรม');
  allPass &= check('Ordered item (เนื้อหอยนางรม) shows qty 20 กระปุก and is NOT dimmed', !!oyster && oyster.qtyText.includes('20') && oyster.qtyText.includes('กระปุก') && oyster.unordered === false, oyster);
  allPass &= check('Ticket has no leftover "check every box" footer text', !ticket.html.includes('ติ๊ก'), 'ok');

  // ===== Test 5b: kicker is just the KARMTO brand mark now (the "ป้ายแพ็คออเดอร์" label text was cut, per feedback) =====
  allPass &= check('Kicker no longer shows "ป้ายแพ็คออเดอร์" text', !ticket.html.includes('ป้ายแพ็คออเดอร์'), 'ok');
  allPass &= check('Kicker still shows the KARMTO brand mark', ticket.html.includes('🦀 KARMTO'), 'ok');

  // ===== Test 5c: "สาขา" prefix + big branch code on one line, plain area name on its own separate line below (no
  // redundant repeat of the code number within the name line) =====
  const headParts = await page.evaluate((html) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const r = {
      saxa: wrap.querySelector('.orderticket-saxa')?.textContent,
      code: wrap.querySelector('.orderticket-code')?.textContent,
      name: wrap.querySelector('.orderticket-name')?.textContent,
    };
    wrap.remove();
    return r;
  }, ticket.html);
  console.log('Branch 11 head parts:', JSON.stringify(headParts));
  allPass &= check('"สาขา" prefix shown next to the big code number', headParts.saxa === 'สาขา', headParts.saxa);
  allPass &= check('Big branch-code element shows just "11"', headParts.code === '11', headParts.code);
  allPass &= check('Name line shows ONLY the area name on its own line (no redundant "11" repeated)', headParts.name === 'ลำลูกกาคลอง4', headParts.name);

  // ===== Test 6: branch 00 (flagship store) shows the short label "ธงหมูกระทะ" on the ticket specifically (not a literal
  // "สาขา 00", and not the full branchName() area text used everywhere else in the app) — and has no "สาขา" prefix,
  // matching how the rest of the app never shows "สาขา 00" for the flagship store =====
  const ticket00 = await page.evaluate(() => buildOrderTicketHTML('00', '2026-10-08', {p1:1}));
  const codeName00 = await page.evaluate((html) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const bigname = wrap.querySelector('.orderticket-bigname');
    const date = wrap.querySelector('.orderticket-date');
    const block = wrap.querySelector('.orderticket-00block');
    const r = {
      saxa: wrap.querySelector('.orderticket-saxa')?.textContent,
      code: wrap.querySelector('.orderticket-code')?.textContent,
      subrowName: wrap.querySelector('.orderticket-name')?.textContent,
      bigname: bigname?.textContent,
      // "บาลานซ์" ตามที่ขอ — ชื่อใหญ่ + วันที่ ต้องอยู่ในกล่องกึ่งกลางเดียวกัน (ไม่ใช่แยกฝั่งซ้าย-ขวาแบบสาขาที่มีเลขโค้ด)
      bignameAndDateCentered: block && bigname && date && bigname.parentElement === block && date.parentElement === block,
    };
    wrap.remove();
    return r;
  }, ticket00);
  console.log('Branch 00 head parts:', JSON.stringify(codeName00));
  allPass &= check('Branch 00 has no "สาขา" prefix', codeName00.saxa === undefined, codeName00.saxa);
  allPass &= check('Branch 00 shows NO code number at all (per feedback: "ไม่ต้องใส่ 00")', codeName00.code === undefined, codeName00.code);
  allPass &= check('Branch 00 has no separate subrow name element (uses the centered big-name block instead)', codeName00.subrowName === undefined, codeName00.subrowName);
  allPass &= check('Branch 00 shows "ธงหมูกระทะ" big and full (per feedback: "ให้ตัวใหญ่เต็มคำ")', codeName00.bigname === 'ธงหมูกระทะ', codeName00.bigname);
  allPass &= check('Branch 00 big name + date are centered together in one balanced block (per feedback: "บาลานซ์ด้วย")', codeName00.bignameAndDateCentered, codeName00.bignameAndDateCentered);
  const branchNameUnchanged = await page.evaluate(() => branchName('00'));
  allPass &= check('branchName("00") itself is untouched elsewhere in the app', branchNameUnchanged !== 'ธงหมูกระทะ' && branchNameUnchanged.length > 0, branchNameUnchanged);

  // ===== Test 6b: two-line header layout per latest feedback ("ให้สาขา บรรทัดเดียวกับ 🦀 , ให้ลำลูกกา บรรทัดเดียวกับวันที่")
  // Line 1 (orderticket-topline): "สาขา {code}" + the KARMTO kicker, same row.
  // Line 2 (orderticket-subrow): area name + date pill, same row — separate from line 1. =====
  const lineCheck = await page.evaluate((html) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    const saxa = wrap.querySelector('.orderticket-saxa');
    const codeEl = wrap.querySelector('.orderticket-code');
    const kicker = wrap.querySelector('.orderticket-kicker');
    const name = wrap.querySelector('.orderticket-name');
    const date = wrap.querySelector('.orderticket-date');
    const topline = wrap.querySelector('.orderticket-topline');
    const subrow = wrap.querySelector('.orderticket-subrow');
    const r = {
      codeAndKickerSameLine: codeEl && kicker && codeEl.closest('.orderticket-topline') === topline && kicker.parentElement === topline,
      nameAndDateSameLine: name && date && name.parentElement === subrow && date.parentElement === subrow,
      codeAndNameOnDifferentLines: codeEl && name && codeEl.closest('.orderticket-topline') !== name.closest('.orderticket-subrow') && !topline.contains(name),
    };
    wrap.remove();
    return r;
  }, ticket.html);
  console.log('Line layout check:', JSON.stringify(lineCheck));
  allPass &= check('"สาขา {code}" and the 🦀 KARMTO kicker share the same line (topline)', lineCheck.codeAndKickerSameLine, lineCheck);
  allPass &= check('Area name and date pill share the same line (subrow)', lineCheck.nameAndDateSameLine, lineCheck);
  allPass &= check('Code line and name line are separate rows (not merged into one)', lineCheck.codeAndNameOnDifferentLines, lineCheck);

  // ===== Test 7: html2canvas capture uses backgroundColor:null (not opaque white), avoiding square "white corner" artifacts
  // around the card's rounded border when viewed on a non-white background — see comment at saveOrderTicketAsImage =====
  const bgColorUsage = await page.evaluate(() => {
    const src = saveOrderTicketAsImage.toString() + saveAllOrderTicketsAsImages.toString();
    return { hasNull: src.includes('backgroundColor:null'), hasOpaqueWhite: src.includes("backgroundColor:'#ffffff'") };
  });
  allPass &= check('Order ticket capture uses backgroundColor:null (no opaque-white corner artifact)', bgColorUsage.hasNull && !bgColorUsage.hasOpaqueWhite, bgColorUsage);

  console.log('\n=== SUMMARY ===');
  console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  await browser.close();
  process.exit(allPass ? 0 : 1);
})();
