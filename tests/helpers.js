// ตัวช่วยกลางสำหรับ spec ใหม่ — mock window.storage ที่จำลองพฤติกรรม patchField/patchOps ฝั่ง Apps Script ให้ครบทุกรูปแบบ op
// ที่แอปส่งจริง (push / remove / set / nested / matchAll / matchDefault / path+value / deleteKey) เพื่อให้เทสเขียน-อ่านข้อมูล
// ได้เหมือนของจริง ไม่ใช่แค่ no-op — เปิดเบราว์เซอร์ผ่าน sandbox.launch เสมอ (บล็อก backend จริง)
const { chromium } = require('playwright');
const { launch } = require('./sandbox');

const BASE = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';

async function stripBanner(page){
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      if(el.textContent && el.textContent.includes('เชื่อมต่อฐานข้อมูลไม่ได้') && el.children.length === 0) el.closest('div')?.remove();
    });
  });
}

async function installMockStorage(page){
  await page.evaluate(() => {
    window.__store = {};
    window.__writes = [];
    const clone = v => JSON.parse(JSON.stringify(v));
    const matches = (item, op) => {
      const v = item ? item[op.matchField] : undefined;
      return (v === undefined || v === null || v === '') && op.matchDefault !== undefined ? op.matchDefault === op.matchValue : v === op.matchValue;
    };
    const applyArrayOp = (arr, op) => {
      if(op.push !== undefined){ arr.push(op.push); return; }
      if(op.remove){
        for(let i = arr.length - 1; i >= 0; i--){
          if(matches(arr[i], op.remove)){ arr.splice(i, 1); if(!op.remove.matchAll) break; }
        }
        return;
      }
      if(op.matchField){
        const idxs = [];
        arr.forEach((it, i) => { if(matches(it, op)) idxs.push(i); });
        const targets = op.matchAll ? idxs : idxs.slice(0, 1);
        targets.forEach(i => {
          const item = arr[i];
          if(op.set) Object.assign(item, op.set);
          if(op.nested){
            const n = op.nested;
            if(!Array.isArray(item[n.field])) item[n.field] = [];
            applyArrayOp(item[n.field], n);
          }
        });
      }
    };
    const getAt = (root, path) => { let t = root; for(const seg of path){ if(t[seg] === undefined) t[seg] = {}; t = t[seg]; } return t; };
    window.storage = {
      async get(key){ if(!(key in window.__store)) throw new Error('Key not found: ' + key); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async set(key, value){ window.__writes.push({op:'set', key}); window.__store[key] = JSON.parse(value); return {key, value: JSON.stringify(window.__store[key]), shared:false}; },
      async delete(key){ delete window.__store[key]; return {key, deleted:true, shared:false}; },
      async list(prefix){ return {keys: Object.keys(window.__store).filter(k => k.startsWith(prefix || '')), prefix, shared:false}; },
      async patchField(key, path, value){
        window.__writes.push({op:'patchField', key, path});
        let root = window.__store[key] === undefined ? {} : clone(window.__store[key]);
        const parent = getAt(root, path.slice(0, -1));
        parent[path[path.length - 1]] = value;
        window.__store[key] = root;
        return {key, value: JSON.stringify(root), shared:false};
      },
      async patchOps(key, ops, rootIsArray){
        window.__writes.push({op:'patchOps', key, ops: clone(ops)});
        let root = window.__store[key] === undefined ? (rootIsArray ? [] : {}) : clone(window.__store[key]);
        for(const op of (Array.isArray(ops) ? ops : [ops])){
          if(op.path){
            const parent = getAt(root, op.path.slice(0, -1));
            const last = op.path[op.path.length - 1];
            if(op.deleteKey) delete parent[last]; else parent[last] = op.value;
            continue;
          }
          const arrPath = op.arrayPath || [];
          let arr;
          if(arrPath.length === 0) arr = root;
          else {
            const parent = getAt(root, arrPath.slice(0, -1));
            const last = arrPath[arrPath.length - 1];
            if(!Array.isArray(parent[last])) parent[last] = [];
            arr = parent[last];
          }
          applyArrayOp(arr, op);
        }
        window.__store[key] = root;
        return {key, value: JSON.stringify(root), shared:false};
      },
    };
    window.bulkGetStorageImpl = async keys => { const out = {}; keys.forEach(k => { out[k] = window.__store[k] !== undefined ? JSON.stringify(window.__store[k]) : null; }); return out; };
    window.bulkSetStorageImpl = async items => { items.forEach(it => { window.__store[it.key] = JSON.parse(it.value); }); return {ok:true}; };
  });
}

// วันว่างตามโครงสร้างเดียวกับ emptyDay() ในแอป แล้วทับด้วยฟิลด์ที่ส่งมา
function mkDay(over){
  return Object.assign({orders:{}, leftoverOut:{}, leftoverSince:{}, billingPaid:{}, billExtra:{}, billNote:{}, billNoteShowOnBill:{}, billClaimNotes:{}, expenses:[], personalIncome:[], personalExpense:[], purchases:[], purchaseGroupPayment:{}, messageOverrides:{}, feeNote:'', dashNote:''}, over || {});
}

// เปิดแอปพร้อม mock storage + seed ข้อมูล (map ของ key -> value) แล้วตั้ง currentDate/dayData ให้ตรง
async function openApp(browser, {viewport = {width: 420, height: 1400}, store = {}, date} = {}){
  const page = await browser.newPage({viewport});
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.message));
  await page.goto(BASE, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof settings !== 'undefined' && settings && settings.branches, null, {timeout: 15000});
  await stripBanner(page);
  await installMockStorage(page);
  await page.evaluate(({store, date}) => {
    Object.assign(window.__store, store);
    if(date){
      currentDate = date;
      dayData = window.__store['day:' + date] ? normalizeDay_(JSON.parse(JSON.stringify(window.__store['day:' + date]))) : emptyDay();
      dayCache_[date] = dayData;
    }
  }, {store, date});
  return page;
}

function makeChecker(){
  let allPass = true;
  const check = (label, cond, extra) => {
    const pass = !!cond;
    if(!pass) allPass = false;
    console.log((pass ? 'PASS' : 'FAIL') + ' — ' + label + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
    return pass;
  };
  const finish = async browser => {
    console.log('\n=== SUMMARY ===');
    console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
    await browser.close();
    process.exit(allPass ? 0 : 1);
  };
  return {check, finish};
}

module.exports = { chromium, launch: () => launch(chromium), stripBanner, installMockStorage, mkDay, openApp, makeChecker };
