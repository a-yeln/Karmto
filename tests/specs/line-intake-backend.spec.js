// backend/LineBot.gs — ทางรับรูปจากภายนอก (intake) + ตัวคัดรูปออเดอร์ + เลขบัญชีปิดบางหลัก
// รันในเครื่องด้วย vm + จำลองบริการ Apps Script (ไม่ต่อ LINE/Google จริง)
// กฎเหล็ก: บอทเขียนได้แค่ lineInbox:/lineOrders: แบบ patchOps — ไม่แตะคีย์วัน/เงิน/ออเดอร์จริง
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

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
  const files = [];   // ไฟล์ในโฟลเดอร์พักรูป
  const deleted = []; // ลบถาวร
  let folder = null;
  const mkFile = (blob) => {
    const f = { id: 'f' + (files.length + 1), name: blob.name, desc: '', trashed: false, blob,
      getId(){ return this.id; }, getName(){ return this.name; }, isTrashed(){ return this.trashed; },
      getDescription(){ return this.desc; }, setDescription(d){ this.desc = d; }, setTrashed(v){ this.trashed = v; },
      getSize(){ return this.blob.bytes.length; },
      getBlob(){ return { setName(){}, getName: () => 'x', getContentType: () => this.blob.mime, getBytes: () => this.blob.bytes }; } };
    files.push(f);
    return f;
  };
  const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const mkFolder = () => ({ isTrashed: () => false, getId: () => 'folder1',
    getFilesByName: n => iter(files.filter(f => f.name === n && deleted.indexOf(f.id) < 0)),
    getFiles: () => iter(files.filter(f => deleted.indexOf(f.id) < 0)),
    createFile: blob => mkFile(blob) });
  const ctx = {
    Logger: { log(){} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock(){}, tryLock(){ return true; }, releaseLock(){} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType(){ return { text: t }; } }) },
    Utilities: {
      getUuid: () => '12345678-1234-1234-1234-' + String(Math.random()).slice(2, 14).padEnd(12, '0'),
      formatDate: (d, tz, f) => { const b = new Date(d.getTime() + 7 * 3600 * 1000).toISOString(); return f === 'yyyy-MM-dd' ? b.slice(0, 10) : b.slice(0, 19); },
      base64Decode: s => { if(!/^[A-Za-z0-9+/=]+$/.test(s)) throw new Error('bad'); return Array.from(Buffer.from(s, 'base64')).map(v => v > 127 ? v - 256 : v); },
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (alg, bytes) => Array.from(crypto.createHash('md5').update(Buffer.from(bytes.map(v => v & 255))).digest()).map(v => v > 127 ? v - 256 : v),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    UrlFetchApp: { fetch: (url, o) => {
      fetches.push({ url, o: o || {} });
      if(opts.apiDown && !/\?action=get/.test(url)) return { getResponseCode: () => 500, getContentText: () => '' };
      if(url.indexOf('?action=get') >= 0) return { getResponseCode: () => 200, getContentText: () => JSON.stringify(opts.existing ? { key: 'x', value: JSON.stringify(opts.existing) } : { error: 'Key not found' }) };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ key: 'x', value: '[]' }) };
    } },
    Drive: { Files: { insert: () => ({ id: 'doc1' }), remove: id => deleted.push(id) } },
    DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => (typeof opts.ocrText === 'function' ? opts.ocrText() : (opts.ocrText || '')) }) }) },
    DriveApp: { getFileById: () => ({ setTrashed(){} }), getFoldersByName: () => { throw new Error('ห้ามหาโฟลเดอร์ด้วยชื่อ'); }, getFolderById: id => { if(folder && id === 'folder1') return folder; throw new Error('not found'); }, createFolder: () => { folder = mkFolder(); return folder; } },
    ScriptApp: { getService: () => ({ getUrl: () => opts.execUrl || null }), getProjectTriggers: () => [], deleteTrigger(){}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create(){} }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, props, fetches, files, deleted, cache };
}
const ITOK = 'intake123intake123intake123';
const BASE = { LINE_WEBHOOK_TOKEN: 'tok123tok123tok123tok123', KARMTO_INTAKE_TOKEN: ITOK, KARMTO_API_URL: 'https://karmto.example/exec' };
const JPG = n => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(400, n)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), Buffer.alloc(400, 7)]).toString('base64');
const post = (env, t, body, a = 'intake') => JSON.parse(env.ctx.doPost({ parameter: { a, t }, postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
const writes = env => env.fetches.filter(f => f.o.method === 'post').map(f => JSON.parse(f.o.payload));
const SLIP = 'โอนเงินสำเร็จ\n12 พ.ย. 69 10:21 น.\nนาย สมชาย ใจดี\nธ.กสิกรไทย\nxxx-x-x1234-x\nนางสาว มาลี ทะเล\nXXX-X-X9876-X\nเลขที่รายการ: 016316102135ABC12345\nจำนวน:\n1,250.00 บาท';
const ORDER = 'สาขา 5 บางนา\nBm9 กุ้งแช่ (กก.) 3\nBm9 ปูม้า (กก.) 2\nหอยนางรม (กระปุก) 10';
const BILL = 'ใบแจ้งยอด สาขา 5 บางนา\nกุ้งแช่ 3 กก.\nยอดรวม 1,250 บาท';

// ============ A) ฟังก์ชันล้วน ============
{
  const { ctx } = makeEnv(BASE);
  const s = ctx.parseSlipText_(SLIP);
  check('สลิป: เลขบัญชีปิดบางหลัก ตัวแรก = ผู้โอน ตัวที่สอง = ผู้รับ', s.senderAcct === 'xxx-x-x1234-x' && s.receiverAcct === 'xxx-x-x9876-x', [s.senderAcct, s.receiverAcct]);
  check('สลิป: ยอด/ผู้โอนเดิมยังอ่านได้เหมือนเดิม', s.amount === 1250 && s.sender === 'นาย สมชาย ใจดี');
  const n = ctx.parseSlipText_('โอนเงินสำเร็จ\n12-11-2026\nจำนวน 500.00 บาท\nเลขที่รายการ 123456789');
  check('วันที่/เลขอ้างอิงที่ไม่มีตัวปิด ไม่ถูกนับเป็นเลขบัญชี', n.senderAcct === null, n.senderAcct);
  const p = ctx.parseSlipText_('โอนเงินสำเร็จ\nพร้อมเพย์ xxxxxx1234\nจำนวน 500.00 บาท');
  check('รูปแบบ xxxxxx1234 อ่านได้', p.senderAcct === 'xxxxxx1234', p.senderAcct);

  check('ออเดอร์: มีสาขา + บรรทัดจำนวน → เป็นร่าง (เก็บขึ้นบรรทัดใหม่)', ctx.orderDraftText_(ORDER) === ORDER, ctx.orderDraftText_(ORDER));
  check('รูปบิล (มีคำเรื่องเงิน) → ไม่เก็บ', ctx.orderDraftText_(BILL) === null);
  check('ไม่มีคำว่าสาขา/ธง → ไม่เก็บ', ctx.orderDraftText_('กุ้งแช่ 3\nปูม้า 2') === null);
  check('มีแต่ชื่อสาขา ไม่มีจำนวน → ไม่เก็บ', ctx.orderDraftText_('สาขา 5 บางนา\nสวัสดีค่ะ') === null);
  check('ธง + จำนวน → เป็นร่าง', /^ธง/.test(ctx.orderDraftText_('ธง ลาดพร้าว\nกุ้งแช่ 3') || ''));
  const long = ctx.orderDraftText_('สาขา 5\n' + Array.from({ length: 80 }, (_, i) => 'กุ้ง ' + i + ' ' + 'ก'.repeat(100)).join('\n'));
  check('ข้อความร่างถูกจำกัดความยาว (≤ 900 ตัว, ≤ 30 บรรทัด)', long.length <= 900 && long.split('\n').length <= 30, long.length);
  check('เลขยาว ≥ 6 หลักในร่างถูกปิด', /xxxxxx7890/.test(ctx.orderDraftText_('สาขา 5\nโทร 1234567890\nกุ้ง 3')));
}

// ============ B) ด่านรับ ============
{
  const env = makeEnv(BASE);
  check('รหัสผิด → ตอบ ok เฉยๆ ไม่เก็บไฟล์', post(env, 'wrong', { image: JPG(1) }).ok === true && env.files.length === 0);
  check('รหัส webhook ใช้กับทางรับรูปไม่ได้ (รหัสแยกกัน)', (post(env, BASE.LINE_WEBHOOK_TOKEN, { image: JPG(1) }), env.files.length === 0));
  check('JSON พัง → bad_json', post(env, ITOK, '{oops').error === 'bad_json');
  check('ไม่มีรูป → no_image', post(env, ITOK, {}).error === 'no_image');
  check('ไม่ใช่ JPEG/PNG (ดูหัวไฟล์จริง) → not_image', post(env, ITOK, { image: Buffer.alloc(500, 65).toString('base64') }).error === 'not_image' && env.files.length === 0);
  check('base64 เพี้ยน → bad_image', post(env, ITOK, { image: '###' + JPG(1) }).error === 'bad_image');
  check('ใหญ่เกิน 5MB → too_big', post(env, ITOK, { image: 'A'.repeat(8 * 1024 * 1024) }).error === 'too_big');
  const r1 = post(env, ITOK, { image: JPG(1), sender: 'สาขา 5 <b>x</b>\n', sentAt: '2026-11-12 10:21' });
  check('JPEG ถูกต้อง → รับ ได้ id รูปแบบ H+24 hex', r1.ok === true && /^H[0-9a-f]{24}$/.test(r1.id), r1);
  check('พักไฟล์ 1 ใบ + ชื่อผู้ส่งถูกล้างอักขระ < >', env.files.length === 1 && JSON.parse(env.files[0].desc).sender === 'สาขา 5 b x /b', env.files[0] && env.files[0].desc);
  check('รูปเดิมส่งซ้ำ → dup ไม่พักซ้ำ', post(env, ITOK, { image: JPG(1) }).dup === true && env.files.length === 1);
  check('รับ data: URL และ PNG', post(env, ITOK, { image: 'data:image/png;base64,' + PNG }).ok === true && env.files.length === 2 && env.files[1].blob.mime === 'image/png');
  check('ด่านรับไม่เขียนอะไรลง Karmto เอง (แค่พักไฟล์)', writes(env).length === 0);

  const env2 = makeEnv(Object.assign({}, BASE, { KARMTO_INTAKE_TOKEN: 'short' }));
  check('รหัสสั้นเกิน = ไม่รับเลย', (post(env2, 'short', { image: JPG(1) }), env2.files.length === 0));
  const env3 = makeEnv(BASE);
  env3.cache['intake:' + new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)] = '1500';
  check('เกินโควตาต่อวัน → daily_limit', post(env3, ITOK, { image: JPG(2) }).error === 'daily_limit' && env3.files.length === 0);
  const env4 = makeEnv(BASE, { execUrl: 'https://script.google.com/macros/s/abc/exec' });
  delete env4.props.KARMTO_INTAKE_TOKEN;
  const url = env4.ctx.showKarmtoIntakeUrl();
  check('showKarmtoIntakeUrl สร้างรหัสยาว ≥ 24 และลิงก์ลงท้าย ?a=intake&t=', /\/exec\?a=intake&t=[0-9a-f]{40,}$/.test(url) && env4.props.KARMTO_INTAKE_TOKEN.length >= 24, url);
}

// ============ C) ตัวประมวลผล ============
{
  const texts = [SLIP, ORDER, BILL];
  let i = 0;
  const env = makeEnv(BASE, { ocrText: () => texts[i++] });
  post(env, ITOK, { image: JPG(1), sender: 'สาขา 5' });
  post(env, ITOK, { image: JPG(2), sender: 'สาขา 5' });
  post(env, ITOK, { image: JPG(3), sender: 'AY' });
  env.ctx.processKarmtoLineQueue();
  const w = writes(env);
  check('3 รูป → เขียน 2 ครั้ง (สลิป 1 + ร่างออเดอร์ 1) รูปบิลข้าม', w.length === 2, w.map(x => x.key));
  check('ทุกการเขียนเป็น patchOps ลง lineInbox:/lineOrders: เท่านั้น', w.every(x => x.action === 'patchOps' && /^(lineInbox|lineOrders):\d{4}-\d{2}-\d{2}$/.test(x.key) && x.rootIsArray === true), w.map(x => x.key));
  const slip = w.find(x => /^lineInbox:/.test(x.key)).ops[1].push;
  check('สลิป: ยอด/ผู้โอน/เลขบัญชีปิดบางหลัก/ผู้ส่งในกลุ่ม/ทางเข้า intake', slip.type === 'slip' && slip.amount === 1250 && slip.senderAcct === 'xxx-x-x1234-x' && slip.postedBy === 'สาขา 5' && slip.via === 'intake', slip);
  check('สลิป: ข้อความดิบปิดเลขยาว', !/\d{6,}/.test(slip.text), slip.text);
  const ord = w.find(x => /^lineOrders:/.test(x.key)).ops[1].push;
  check('ร่างออเดอร์: type order + ข้อความ + ไม่มีฟิลด์จำนวน/ราคาที่บอทคิดเอง', ord.type === 'order' && ord.text === ORDER && Object.keys(ord).sort().join(',') === 'at,id,postedBy,text,type,via', Object.keys(ord));
  check('ประมวลผลแล้วลบไฟล์ถาวรทั้ง 3 ใบ (รวมที่ข้าม)', env.deleted.filter(d => /^f\d$/.test(d)).length === 3, env.deleted);
  env.ctx.processKarmtoLineQueue();
  check('รันซ้ำไม่เขียนซ้ำ', writes(env).length === 2);
  check('รูปเดิมส่งมาอีกหลังประมวลผลแล้ว → dup', post(env, ITOK, { image: JPG(1) }).dup === true);
  check('ไม่มีการเรียก LINE API เลย (ไม่ตอบ/ไม่ส่งเข้ากลุ่ม)', !env.fetches.some(f => /line\.me/.test(f.url)));
  check('บอทเขียนคีย์อื่นไม่ได้ (karmtoKeyPush_ ปฏิเสธ)', (() => { try { env.ctx.karmtoKeyPush_('day:2026-11-12', { id: 'x' }); return false; } catch (e) { return true; } })());

  // API ล่ม → เก็บไฟล์ไว้ลองใหม่ ครบ 3 ครั้งค่อยทิ้ง
  const env2 = makeEnv(BASE, { ocrText: SLIP, apiDown: true });
  post(env2, ITOK, { image: JPG(9) });
  env2.ctx.processKarmtoLineQueue();
  check('เขียนไม่สำเร็จ → ยังไม่ลบไฟล์ นับ tries = 1', env2.deleted.indexOf('f1') < 0 && JSON.parse(env2.files[0].desc).tries === 1, env2.files[0].desc);
  env2.ctx.processKarmtoLineQueue(); env2.ctx.processKarmtoLineQueue();
  check('พังครบ 3 ครั้ง → ทิ้งไฟล์', env2.deleted.indexOf('f1') >= 0);

  // ไฟล์แปลกปลอมในโฟลเดอร์
  const env3 = makeEnv(BASE, { ocrText: SLIP });
  post(env3, ITOK, { image: JPG(4) });
  env3.files[0].name = 'evil.exe';
  env3.ctx.processKarmtoLineQueue();
  check('ไฟล์ชื่อไม่ตรงรูปแบบ → ลบทิ้ง ไม่อ่าน ไม่เขียน', env3.deleted.indexOf('f1') >= 0 && writes(env3).length === 0);
}

// ============ D) โฟลเดอร์จำด้วย ID + ตรวจซ้ำตอนประมวลผล + เพดานต่อคีย์ ============
{
  const env = makeEnv(BASE, { ocrText: SLIP });
  post(env, ITOK, { image: JPG(1) });
  check('จำ ID โฟลเดอร์ที่สร้างเองใน Script Properties (ไม่หาด้วยชื่อ)', env.props.KARMTO_INTAKE_FOLDER_ID === 'folder1');
  post(env, ITOK, { image: JPG(2) });
  env.files[0].blob.bytes = Array.from(Buffer.alloc(500, 65)); // ไฟล์ที่ไม่ใช่รูป (ไม่ได้เข้าทางด่านรับ)
  env.files[1].blob.bytes = Array.from({ length: 5 * 1024 * 1024 + 10 }, () => 0);
  env.ctx.processKarmtoLineQueue();
  check('ไฟล์ในโฟลเดอร์ที่ไม่ใช่รูป/ใหญ่เกิน → ลบทิ้ง ไม่อ่าน ไม่เขียน', env.deleted.indexOf('f1') >= 0 && env.deleted.indexOf('f2') >= 0 && writes(env).length === 0, env.deleted);

  const full = Array.from({ length: 80 }, (_, i) => ({ id: 'X' + i }));
  const env2 = makeEnv(BASE, { ocrText: SLIP, existing: full });
  post(env2, ITOK, { image: JPG(3) });
  env2.ctx.processKarmtoLineQueue();
  check('คีย์วันเต็มเพดาน (80 รายการ) → ไม่เขียนเพิ่ม และไม่ค้างไฟล์', writes(env2).length === 0 && env2.deleted.indexOf('f1') >= 0);
}

console.log('\n=== SUMMARY ===');
console.log(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
process.exit(allPass ? 0 : 1);
