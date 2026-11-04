const { launch, makeChecker } = require('../helpers');

// รหัสเข้าใช้ระบบ: แนบรหัสจากเครื่องไปทุกคำขอ, เซิร์ฟเวอร์ตอบ unauthorized → ถามรหัส และห้ามแปลเป็น "ยังไม่มีข้อมูล"
(async () => {
  const browser = await launch();
  const { check, finish } = makeChecker();
  const BASE = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';
  const page = await browser.newPage();
  const seen = [];
  const KEY = 'ลับมาก-123';
  await page.route(/script\.google\.com/, async route => {
    const req = route.request();
    const url = new URL(req.url());
    let k = url.searchParams.get('k') || '';
    let body = null;
    if (req.method() === 'POST') { try { body = JSON.parse(req.postData() || '{}'); k = body.k || ''; } catch (e) {} }
    seen.push({ method: req.method(), action: url.searchParams.get('action') || (body && body.action), k });
    const ok = k === KEY;
    const json = !ok ? { error: 'unauthorized' }
      : (url.searchParams.get('action') === 'list' ? { keys: [] } : (body && body.action === 'bulkGet' ? { values: {} } : { error: 'not_found' }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());

  // 1) ยังไม่มีรหัส → เซิร์ฟเวอร์ปฏิเสธ → ขึ้นหน้าต่างถามรหัส, และ get() ไม่แปลว่า "Key not found"
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const r1 = await page.evaluate(async () => {
    let msg = '';
    try { await window.storage.get('settings'); } catch (e) { msg = e.message; }
    return { dialog: !!document.getElementById('apiKeyDlgInput'), msg };
  });
  check('Without a passcode the app asks for it', r1.dialog, r1);
  check('Unauthorized is never treated as "no data yet" (would risk overwriting with blanks)', r1.msg.startsWith('Unauthorized') && !r1.msg.startsWith('Key not found'), r1.msg);

  // 2) ใส่รหัส → โหลดใหม่ → ทุกคำขอแนบรหัส (ทั้ง GET และ POST)
  await page.fill('#apiKeyDlgInput', KEY);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#apiKeyDlgOk')]);
  seen.length = 0;
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { try { await window.bulkGetStorageImpl(['x']); } catch (e) {} try { await window.storage.list('day:'); } catch (e) {} });
  const withKey = seen.filter(s => s.k === KEY).length;
  check('After entering it, every request (GET and POST) carries the passcode', seen.length > 0 && withKey === seen.length && seen.some(s => s.method === 'POST'), seen.slice(0, 6));
  check('No unauthorized prompt once the passcode is right', await page.evaluate(() => !document.getElementById('apiKeyDlgInput')));
  check('Passcode lives only on this device (not in the page source)', !(await page.content()).includes(KEY));

  await finish(browser);
})();
