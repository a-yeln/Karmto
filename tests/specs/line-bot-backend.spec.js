// backend/LineBot.gs — รันในเครื่องด้วย vm + จำลองบริการ Apps Script (ไม่ต่อ LINE/Google จริง)
// ตรวจ: ตัวอ่านสลิป (ไม่เดา), webhook กันรหัส/กลุ่ม, คิว → push ลง lineInbox:วัน แบบ patchOps, ไม่ตอบ/ไม่ส่งเข้ากลุ่มเด็ดขาด
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let allPass = true;
const check = (label, cond, extra) => {
  if(!cond) allPass = false;
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));
};
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'LineBot.gs'), 'utf8');

function makeEnv(propsInit, opts = {}){
  const props = Object.assign({}, propsInit);
  const cache = {};
  const fetches = [];
  const triggers = [];
  const removed = [];
  const ctx = {
    Logger: { log(){} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock(){}, tryLock(){ return true; }, releaseLock(){} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType(){ return { text: t }; } }) },
    Utilities: { formatDate: (d, tz, f) => {
      const b = new Date(d.getTime() + 7 * 3600 * 1000).toISOString();
      return f === 'yyyy-MM-dd' ? b.slice(0, 10) : b.slice(0, 19);
    } },
    UrlFetchApp: { fetch: (url, o) => {
      fetches.push({ url, o: o || {} });
      if(url.indexOf('/content') >= 0){
        if(opts.contentCode) return { getResponseCode: () => opts.contentCode, getBlob: () => null, getContentText: () => '' };
        return { getResponseCode: () => 200, getBlob: () => ({ setName(){}, getName: () => 'x.jpg', getContentType: () => opts.ctype || 'image/jpeg', getBytes: () => ({ length: opts.size || 50000 }) }) };
      }
      if(url.indexOf('/member/') >= 0) return opts.memberCode ? { getResponseCode: () => opts.memberCode, getContentText: () => '' } : { getResponseCode: () => 200, getContentText: () => JSON.stringify({ displayName: 'สาขา 5' }) };
      if(url.indexOf('/push') >= 0) return { getResponseCode: () => 200, getContentText: () => '{}' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ key: 'x', value: '[]' }) };
    } },
    Drive: { Files: { insert: () => ({ id: 'doc1' }), remove: id => removed.push(id) } },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => opts.ocrText || '' }) }) },
    DriveApp: { getFileById: () => ({ setTrashed(){} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger(){}, newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => triggers.push({ fn, n }) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, props, fetches, triggers, removed };
}
const TOK = 'tok123tok123tok123tok123';
const G = 'C' + '1'.repeat(32), G2 = 'C' + '2'.repeat(32), UA = 'U' + 'b'.repeat(32);
const BASE_PROPS = { LINE_WEBHOOK_TOKEN: 'tok123tok123tok123tok123', LINE_CHANNEL_ACCESS_TOKEN: 'chan', KARMTO_API_URL: 'https://karmto.example/exec', LINE_GROUP_ID: G };
const ev = (type, extra = {}) => Object.assign({ type: 'message', timestamp: Date.parse('2026-11-12T03:21:00Z'), source: { type: 'group', groupId: G, userId: UA }, message: Object.assign({ id: '5001', type }, extra) });
const post = (env, t, events) => env.ctx.doPost({ parameter: { t }, postData: { contents: JSON.stringify({ destination: 'Ubot', events }) } });
const queue = env => JSON.parse(env.props.LINE_QUEUE || '[]');

// ============ A) ตัวอ่านสลิป ============
{
  const { ctx } = makeEnv(BASE_PROPS);
  const kplus = 'โอนเงินสำเร็จ\n12 พ.ย. 69 10:21 น.\nนาย สมชาย ใจดี\nธ.กสิกรไทย\nxxx-x-x1234-x\nนางสาว มาลี ทะเล\nเลขที่รายการ: 016316102135ABC12345\nจำนวน:\n1,250.00 บาท\nค่าธรรมเนียม:\n0.00 บาท';
  const a = ctx.parseSlipText_(kplus);
  check('K+: เป็นสลิป', a.isSlip === true);
  check('K+: ยอด 1250 (ไม่นับค่าธรรมเนียม 0.00)', a.amount === 1250, a.amountCands);
  check('K+: วันที่ 69 → 2026-11-12', a.date === '2026-11-12', a.date);
  check('K+: เวลา 10:21', a.time === '10:21', a.time);
  check('K+: ผู้โอน/ผู้รับ ตามลำดับชื่อ', a.sender === 'นาย สมชาย ใจดี' && a.receiver === 'นางสาว มาลี ทะเล', [a.sender, a.receiver]);
  check('K+: ธนาคาร กสิกรไทย + เลขอ้างอิง', a.bank === 'กสิกรไทย' && a.ref === '016316102135ABC12345', [a.bank, a.ref]);

  const scb = 'SCB\nโอนเงินสำเร็จ\n12 Nov 2026 - 09:05\nจาก MR SOMCHAI J\nไปยัง ร้านก้ามโต\nจำนวนเงิน 980.50';
  const b = ctx.parseSlipText_(scb);
  check('SCB: ยอดอยู่บรรทัดเดียวกับป้าย 980.50', b.amount === 980.5, b.amountCands);
  check('SCB: วันที่อังกฤษ', b.date === '2026-11-12' && b.time === '09:05', [b.date, b.time]);

  const two = ctx.parseSlipText_('โอนเงินสำเร็จ\nจำนวน 1,250.00 บาท\nยอดรวม 1,300.00 บาท\n12/11/2569');
  check('สองยอดต่างกัน → ไม่เดา amount = null แต่บอกยอดที่เจอ', two.amount === null && two.amountCands.length === 2 && two.isSlip, two);
  check('dd/mm/พ.ศ.4 หลัก', two.date === '2026-11-12', two.date);

  const fee = ctx.parseSlipText_('โอนเงินสำเร็จ\nจำนวน: 20.00 บาท\nยอดคงเหลือ 5,000.00 บาท');
  check('ยอดคงเหลือไม่นับ + 20.00 บาท ไม่ถูกอ่านเป็นเวลา', fee.amount === 20 && fee.time === null, fee);

  const order = ctx.parseSlipText_('สาขา 05 สั่ง\nกุ้ง 3 กก.\nหมึก 2 กก.');
  check('รูปออเดอร์ → ไม่ใช่สลิป', order.isSlip === false);
  const bill = ctx.parseSlipText_('ใบแจ้งหนี้ ก้ามโต\nรวม 1,250 บาท');
  check('รูปบิล (ไม่มีคำของสลิป) → ไม่ใช่สลิป', bill.isSlip === false);
  check('วันที่ไม่มีจริง (31 พ.ย.) → null', ctx.slipIso_(31, 11, '69') === null);
}

// ============ B) webhook ============
{
  const env = makeEnv(BASE_PROPS);
  post(env, 'wrong', [ev('image')]);
  check('รหัส ?t= ผิด → ไม่รับอะไร', queue(env).length === 0);
  const env0 = makeEnv(Object.assign({}, BASE_PROPS, { LINE_WEBHOOK_TOKEN: undefined }));
  delete env0.props.LINE_WEBHOOK_TOKEN;
  post(env0, '', [ev('image')]);
  check('ยังไม่ตั้ง LINE_WEBHOOK_TOKEN → ไม่รับอะไร', queue(env0).length === 0);

  post(env, TOK, [ev('image'), Object.assign(ev('image', { id: '5002' }), { source: { type: 'group', groupId: G2, userId: UA } }), Object.assign(ev('image', { id: '5003' }), { source: { type: 'user', userId: UA } }), ev('sticker', { id: '5004' }), ev('text', { id: '5005', text: 'พรุ่งนี้ขอกุ้งเพิ่ม' })]);
  const q = queue(env);
  check('รับเฉพาะกลุ่มที่ตั้งไว้ + เฉพาะรูป/ข้อความ', q.map(x => x.mid).join(',') === '5001,5005', q.map(x => x.mid));
  post(env, TOK, [ev('image')]);
  check('LINE ส่งซ้ำ (messageId เดิม) → ไม่เข้าคิวซ้ำ', queue(env).length === 2);
  check('webhook ไม่เรียกเน็ตเลย (ตอบเร็ว)', env.fetches.length === 0);

  // ความปลอดภัยเพิ่ม
  const envShort = makeEnv(Object.assign({}, BASE_PROPS, { LINE_WEBHOOK_TOKEN: 'short1' }));
  post(envShort, 'short1', [ev('image')]);
  check('รหัส webhook สั้นกว่า 24 ตัว → ไม่รับอะไร', queue(envShort).length === 0);
  const envFmt = makeEnv(BASE_PROPS);
  post(envFmt, TOK, [Object.assign(ev('image'), { source: { type: 'group', groupId: 'Cfake', userId: UA } })]);
  check('groupId รูปแบบผิด → ไม่รับ', queue(envFmt).length === 0);
  const envTs = makeEnv(BASE_PROPS);
  post(envTs, TOK, [Object.assign(ev('image'), { timestamp: Date.parse('2020-01-01T00:00:00Z') })]);
  check('ไม่เชื่อ timestamp จาก event (ใช้เวลารับจริง)', Math.abs(queue(envTs)[0].ts - Date.now()) < 60000);


  const envBig = makeEnv(BASE_PROPS);
  for(let i = 0; i < 60; i++) post(envBig, TOK, [ev('text', { id: String(10000 + i), text: 'ข'.repeat(300) })]);
  post(envBig, TOK, [ev('image', { id: '99999' })]);
  const bytes = Buffer.byteLength(envBig.props.LINE_QUEUE, 'utf8');
  check('คิวไม่เกินเพดาน Script Properties (~9KB) และรูปล่าสุดยังอยู่', bytes <= 8500 && queue(envBig).some(x => x.mid === '99999'), bytes);

  const envNoGroup = makeEnv(Object.assign({}, BASE_PROPS));
  delete envNoGroup.props.LINE_GROUP_ID;
  post(envNoGroup, TOK, [ev('image')]);
  check('ยังไม่ตั้ง LINE_GROUP_ID → แค่จำ Group ID ไว้ ไม่เก็บอะไร', queue(envNoGroup).length === 0 && envNoGroup.props.LINE_SEEN_GROUP_IDS === G);
}

// ============ C) ประมวลผลคิว ============
{
  const ocrText = 'โอนเงินสำเร็จ\n12 พ.ย. 69 10:21 น.\nนาย สมชาย ใจดี\nจำนวน:\n1,250.00 บาท';
  const env = makeEnv(BASE_PROPS, { ocrText });
  post(env, TOK, [ev('image'), ev('text', { id: '5005', text: 'พรุ่งนี้ขอกุ้งเพิ่ม' })]);
  env.ctx.processKarmtoLineQueue();
  const apiCalls = env.fetches.filter(f => f.url === 'https://karmto.example/exec').map(f => JSON.parse(f.o.payload));
  check('เขียน 2 ครั้ง (สลิป + ข้อความ) เป็น patchOps: ลบ id เดิม + push ทีละรายการ (กันซ้ำตอนลองใหม่)', apiCalls.length === 2 && apiCalls.every(c => c.action === 'patchOps' && c.rootIsArray === true && c.ops.length === 2 && c.ops[0].remove && c.ops[0].remove.matchField === 'id' && c.ops[0].remove.matchValue === c.ops[1].push.id && c.ops[1].push && c.ops.every(o => Array.isArray(o.arrayPath) && o.arrayPath.length === 0)), apiCalls.map(c => c.ops));
  apiCalls.forEach(c => { c.ops = [c.ops[1]]; });
  const slip = apiCalls[0];
  const bkk = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  check('คีย์ตามวันที่รับ (เวลาไทย) lineInbox:YYYY-MM-DD', slip.key === 'lineInbox:' + bkk, slip.key);
  const it = slip.ops[0].push;
  check('รายการสลิปมียอด/วันที่/ผู้โพสต์', it.id === 'L5001' && it.type === 'slip' && it.amount === 1250 && it.slipDate === '2026-11-12' && it.postedBy === 'สาขา 5', it);
  check('ไม่มีฟิลด์เงินของบิล (paid/billingPaid) ในสิ่งที่บอทเขียน', !/billingPaid|"paid"|transferAmount/.test(JSON.stringify(apiCalls)));
  check('ข้อความ → type text', apiCalls[1].ops[0].push.type === 'text' && apiCalls[1].ops[0].push.text === 'พรุ่งนี้ขอกุ้งเพิ่ม');
  check('ไม่มีการ reply และไม่ push (ยังไม่ตั้ง LINE_NOTIFY_USER_ID)', !env.fetches.some(f => /\/reply|\/push|\/broadcast|\/multicast/.test(f.url)));
  check('คิวว่างหลังทำเสร็จ', queue(env).length === 0);
  env.ctx.processKarmtoLineQueue();
  check('รันซ้ำไม่เขียนซ้ำ', env.fetches.filter(f => f.url === 'https://karmto.example/exec').length === 2);

  const envN = makeEnv(Object.assign({}, BASE_PROPS, { LINE_NOTIFY_USER_ID: 'U' + 'a'.repeat(32) }), { ocrText });
  post(envN, TOK, [ev('text', { id: '6001', text: 'ของมาไม่ครบ' })]);
  envN.ctx.processKarmtoLineQueue();
  const pushes = envN.fetches.filter(f => /\/push/.test(f.url)).map(f => JSON.parse(f.o.payload));
  check('ตั้ง LINE_NOTIFY_USER_ID → push หา AY คนเดียว ไม่ใช่กลุ่ม', pushes.length === 1 && pushes[0].to === 'U' + 'a'.repeat(32) && pushes[0].to !== G);


  const envFake = makeEnv(BASE_PROPS, { ocrText, memberCode: 404 });
  post(envFake, TOK, [ev('text', { id: '6100', text: 'โอนไปบัญชีนี้แทน' })]);
  envFake.ctx.processKarmtoLineQueue();
  check('ข้อความจากคนที่ไม่ใช่สมาชิกจริง (LINE ไม่รู้จัก) → ทิ้ง ไม่เก็บ', !envFake.fetches.some(f => f.url === 'https://karmto.example/exec'));
  const envPdf = makeEnv(BASE_PROPS, { ocrText, ctype: 'application/pdf' });
  post(envPdf, TOK, [ev('image', { id: '6200' })]);
  envPdf.ctx.processKarmtoLineQueue();
  check('ไฟล์ที่ไม่ใช่รูป → ข้าม', !envPdf.fetches.some(f => f.url === 'https://karmto.example/exec'));
  check('ไฟล์ OCR ถูกลบถาวร', env.removed.length >= 1);
  const envAcct = makeEnv(BASE_PROPS, { ocrText: ocrText + '\nบัญชี 1234567890' });
  post(envAcct, TOK, [ev('image', { id: '6300' })]);
  envAcct.ctx.processKarmtoLineQueue();
  const acctTxt = JSON.parse(envAcct.fetches.find(f => f.url === 'https://karmto.example/exec').o.payload).ops[1].push.text;
  check('ข้อความดิบปิดเลขยาวเหลือ 4 ตัวท้าย', /xxxxxx7890/.test(acctTxt) && !/1234567890/.test(acctTxt), acctTxt);

  const envBill = makeEnv(BASE_PROPS, { ocrText: 'ใบแจ้งหนี้\nรวม 1,250 บาท' });
  post(envBill, TOK, [ev('image', { id: '7001' })]);
  envBill.ctx.processKarmtoLineQueue();
  check('รูปบิล/ออเดอร์ → ข้าม ไม่เขียนอะไร', !envBill.fetches.some(f => f.url === 'https://karmto.example/exec') && queue(envBill).length === 0);

  const envGone = makeEnv(BASE_PROPS, { contentCode: 404, ocrText });
  post(envGone, TOK, [ev('image', { id: '8001' })]);
  envGone.ctx.processKarmtoLineQueue();
  check('messageId ที่ LINE ไม่รู้จัก (ปลอม) → ไม่เขียนอะไร', !envGone.fetches.some(f => f.url === 'https://karmto.example/exec') && queue(envGone).length === 0);

  const envKey = makeEnv(Object.assign({}, BASE_PROPS, { KARMTO_KEY: 'pass1' }), { ocrText });
  post(envKey, TOK, [ev('image', { id: '9001' })]);
  envKey.ctx.processKarmtoLineQueue();
  const kc = envKey.fetches.find(f => f.url === 'https://karmto.example/exec');
  check('แนบ KARMTO_KEY ไปกับคำขอ', kc && JSON.parse(kc.o.payload).k === 'pass1');

  const envT = makeEnv(BASE_PROPS);
  envT.ctx.installKarmtoLineBot();
  check('ติดตั้ง trigger ทุก 1 นาที', envT.triggers.length === 1 && envT.triggers[0].fn === 'processKarmtoLineQueue' && envT.triggers[0].n === 1);
}

// ไม่มีโค้ด reply ในไฟล์เลย
check('ไฟล์ไม่มี endpoint reply/broadcast/multicast', !/\/reply|broadcast|multicast/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));

console.log('\n=== SUMMARY ===');
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
