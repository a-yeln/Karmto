// ทุก spec ต้องเปิดเบราว์เซอร์ผ่าน launch() ตัวนี้เสมอ — บล็อกคำขอทุกอันที่จะออกไปหา backend จริง (Google Apps Script
// ที่เก็บข้อมูลจริงของร้าน) ตั้งแต่ระดับเบราว์เซอร์เลย เพราะตอนเปิดหน้าแอป แอปจะเริ่มโหลด/อาจเขียนข้อมูลจริงก่อนที่ spec จะ
// สลับ window.storage เป็น mock ได้ทัน — ถ้าเครื่องที่รันเทสต่อเน็ตถึง script.google.com ได้ (บางเครื่องได้ บางเครื่องไม่ได้)
// เทสจะไปแตะข้อมูลจริงทันที ใช้ route บล็อก (ไม่ใช่ host-resolver-rules ซึ่งไม่มีผลถ้าเบราว์เซอร์วิ่งผ่าน HTTPS proxy)
const BACKEND_RE = /script\.google(usercontent)?\.com/;
async function launch(chromium){
  const opts = {};
  if(process.env.PW_CHROMIUM_PATH) opts.executablePath = process.env.PW_CHROMIUM_PATH;
  const browser = await chromium.launch(opts);
  const block = r => r.abort();
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const c = await origNewContext(...a); await c.route(BACKEND_RE, block); return c; };
  browser.newPage = async (...a) => { const c = await browser.newContext(...a); const p = await c.newPage(); return p; };
  return browser;
}
module.exports = { launch, BACKEND_RE };
