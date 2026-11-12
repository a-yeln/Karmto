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
        return { getResponseCode: () => 200, getBlob: () => ({ setName(){}, getName: () => 'x.jpg', getContentType: () => 'image/jpeg' }) };
      }
      if(url.indexOf('/member/') >= 0) return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ displayName: 'สาขา 5' }) };
      if(url.indexOf('/push') >= 0) return { getResponseCode: () => 200, getContentText: () => '{}' };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ key: 'x', value: '[]' }) };
    } },
    Drive: { Files: { insert: () => ({ id: 'doc1' }) } },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => opts.ocrText || '' }) }) },
    DriveApp: { getFileById: () => ({ setTrashed(){} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger(){}, newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => triggers.push({ fn, n }) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, props, fetches, triggers };
}
const BASE_PROPS = { LINE_WEBHOOK_TOKEN: 'tok123', LINE_CHANNEL_ACCESS_TOKEN: 'chan', KARMTO_API_URL: 'https://karmto.example/exec', LINE_GROUP_ID: 'Cgroup1' };
const ev = (type, extra = {}) => Object.assign({ type: 'message', timestamp: Date.parse('2026-11-12T03:21:00Z'), source: { type: 'group', groupId: 'Cgroup1', userId: 'Uabc' }, message: Object.assign({ id: '5001', type }, extra) });
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

  post(env, 'tok123', [ev('image'), Object.assign(ev('image', { id: '5002' }), { source: { type: 'group', groupId: 'Cother', userId: 'U1' } }), Object.assign(ev('image', { id: '5003' }), { source: { type: 'user', userId: 'U1' } }), ev('sticker', { id: '5004' }), ev('text', { id: '5005', text: 'พรุ่งนี้ขอกุ้งเพิ่ม' })]);
  const q = queue(env);
  check('รับเฉพาะกลุ่มที่ตั้งไว้ + เฉพาะรูป/ข้อความ', q.map(x => x.mid).join(',') === '5001,5005', q.map(x => x.mid));
  post(env, 'tok123', [ev('image')]);
  check('LINE ส่งซ้ำ (messageId เดิม) → ไม่เข้าคิวซ้ำ', queue(env).length === 2);
  check('webhook ไม่เรียกเน็ตเลย (ตอบเร็ว)', env.fetches.length === 0);

  const envBig = makeEnv(BASE_PROPS);
  for(let i = 0; i < 60; i++) post(envBig, 'tok123', [ev('text', { id: String(10000 + i), text: 'ข'.repeat(300) })]);
  post(envBig, 'tok123', [ev('image', { id: '99999' })]);
  const bytes = Buffer.byteLength(envBig.props.LINE_QUEUE, 'utf8');
  check('คิวไม่เกินเพดาน Script Properties (~9KB) และรูปล่าสุดยังอยู่', bytes <= 8500 && queue(envBig).some(x => x.mid === '99999'), bytes);

  const envNoGroup = makeEnv(Object.assign({}, BASE_PROPS));
  delete envNoGroup.props.LINE_GROUP_ID;
  post(envNoGroup, 'tok123', [ev('image')]);
  check('ยังไม่ตั้ง LINE_GROUP_ID → แค่จำ Group ID ไว้ ไม่เก็บอะไร', queue(envNoGroup).length === 0 && envNoGroup.props.LINE_SEEN_GROUP_IDS === 'Cgroup1');
}

// ============ C) ประมวลผลคิว ============
{
  const ocrText = 'โอนเงินสำเร็จ\n12 พ.ย. 69 10:21 น.\nนาย สมชาย ใจดี\nจำนวน:\n1,250.00 บาท';
  const env = makeEnv(BASE_PROPS, { ocrText });
  post(env, 'tok123', [ev('image'), ev('text', { id: '5005', text: 'พรุ่งนี้ขอกุ้งเพิ่ม' })]);
  env.ctx.processKarmtoLineQueue();
  const apiCalls = env.fetches.filter(f => f.url === 'https://karmto.example/exec').map(f => JSON.parse(f.o.payload));
  check('เขียน 2 ครั้ง (สลิป + ข้อความ) เป็น patchOps push ทีละรายการ', apiCalls.length === 2 && apiCalls.every(c => c.action === 'patchOps' && c.rootIsArray === true && c.ops.length === 1 && c.ops[0].push && Array.isArray(c.ops[0].arrayPath) && c.ops[0].arrayPath.length === 0), apiCalls.map(c => c.action));
  const slip = apiCalls[0];
  check('คีย์ตามวันเวลาไทย lineInbox:2026-11-12', slip.key === 'lineInbox:2026-11-12', slip.key);
  const it = slip.ops[0].push;
  check('รายการสลิปมียอด/วันที่/ผู้โพสต์', it.id === 'L5001' && it.type === 'slip' && it.amount === 1250 && it.slipDate === '2026-11-12' && it.postedBy === 'สาขา 5', it);
  check('ไม่มีฟิลด์เงินของบิล (paid/billingPaid) ในสิ่งที่บอทเขียน', !/billingPaid|"paid"|transferAmount/.test(JSON.stringify(apiCalls)));
  check('ข้อความ → type text', apiCalls[1].ops[0].push.type === 'text' && apiCalls[1].ops[0].push.text === 'พรุ่งนี้ขอกุ้งเพิ่ม');
  check('ไม่มีการ reply และไม่ push (ยังไม่ตั้ง LINE_NOTIFY_USER_ID)', !env.fetches.some(f => /\/reply|\/push|\/broadcast|\/multicast/.test(f.url)));
  check('คิวว่างหลังทำเสร็จ', queue(env).length === 0);
  env.ctx.processKarmtoLineQueue();
  check('รันซ้ำไม่เขียนซ้ำ', env.fetches.filter(f => f.url === 'https://karmto.example/exec').length === 2);

  const envN = makeEnv(Object.assign({}, BASE_PROPS, { LINE_NOTIFY_USER_ID: 'U' + 'a'.repeat(32) }), { ocrText });
  post(envN, 'tok123', [ev('text', { id: '6001', text: 'ของมาไม่ครบ' })]);
  envN.ctx.processKarmtoLineQueue();
  const pushes = envN.fetches.filter(f => /\/push/.test(f.url)).map(f => JSON.parse(f.o.payload));
  check('ตั้ง LINE_NOTIFY_USER_ID → push หา AY คนเดียว ไม่ใช่กลุ่ม', pushes.length === 1 && pushes[0].to === 'U' + 'a'.repeat(32) && pushes[0].to !== 'Cgroup1');

  const envBill = makeEnv(BASE_PROPS, { ocrText: 'ใบแจ้งหนี้\nรวม 1,250 บาท' });
  post(envBill, 'tok123', [ev('image', { id: '7001' })]);
  envBill.ctx.processKarmtoLineQueue();
  check('รูปบิล/ออเดอร์ → ข้าม ไม่เขียนอะไร', !envBill.fetches.some(f => f.url === 'https://karmto.example/exec') && queue(envBill).length === 0);

  const envGone = makeEnv(BASE_PROPS, { contentCode: 404, ocrText });
  post(envGone, 'tok123', [ev('image', { id: '8001' })]);
  envGone.ctx.processKarmtoLineQueue();
  check('messageId ที่ LINE ไม่รู้จัก (ปลอม) → ไม่เขียนอะไร', !envGone.fetches.some(f => f.url === 'https://karmto.example/exec') && queue(envGone).length === 0);

  const envKey = makeEnv(Object.assign({}, BASE_PROPS, { KARMTO_KEY: 'pass1' }), { ocrText });
  post(envKey, 'tok123', [ev('image', { id: '9001' })]);
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
