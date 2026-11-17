# ผังองค์กรทีม Agent ของ Karmto

ไฟล์นี้คือ "ผังฝ่าย" ของทีม — ใครอยู่ฝ่ายไหน ใครเป็นเจ้าของสกิลไหน และแต่ละ agent ต้องมีสกิลอะไร
`tools/check-skills.js` อ่านสองตาราง **"เจ้าของสกิล"** และ **"สกิลที่แต่ละ agent ต้องมี"** ข้างล่างไปเทียบกับ frontmatter จริง
— แก้ตารางต้องแก้ frontmatter ให้ตรงกัน (และกลับกัน) แล้วรัน `node tools/check-skills.js` ทุกครั้ง

## กติกาที่ใช้กับทุกฝ่าย (ห้ามฝ่าฝืน)
- **subagent เรียก subagent ต่อไม่ได้** — Claude หลักเป็นคนแจกงานจริงตามใบสั่งงานของผู้จัดการ/หัวหน้าฝ่าย
- หัวหน้าฝ่ายมีหน้าที่ 3 อย่างเท่านั้น:
  (ก) เขียนใบสั่งงาน/prompt สำเร็จรูปให้ลูกทีม
  (ข) รีวิวผลงานลูกทีมที่ Claude หลักส่งมาให้ แล้วตัดสิน "ผ่าน" / "ส่งกลับ" พร้อมเหตุผล
  (ค) เสนอ diff แก้สกิลที่ตัวเองเป็นเจ้าของ — **ไม่แก้สกิลเอง** Claude หลักเป็นคนลงมือแก้
- **money-guard และ security-guard เท่านั้นที่ตัดสิน ผ่าน/ไม่ผ่าน** ในเรื่องเงินและความปลอดภัย
  หัวหน้าฝ่ายหรือผู้จัดการ **กลับคำ "ไม่ผ่าน" ไม่ได้เด็ดขาด**; guard ไม่ผ่าน หรือ **ยังไม่ได้รัน** = ห้าม merge
- เจ้าของ (AY) ใช้แอปคนเดียว; **repo เป็นสาธารณะ** — ใครก็อ่านโค้ดและลิงก์ Apps Script `/exec` ใน `index.html` และ
  `backend/BackupTrigger.gs` ได้ → ห้ามมี key/token/รหัสใดๆ ใน repo หรือประวัติ git; secret อยู่ใน Script Properties เท่านั้น
- `KARMTO_KEY` (`backend/AuthGuard.gs`) **ยังไม่ได้ตั้ง** → ตอนนี้ใครมีลิงก์ก็อ่าน/เขียนข้อมูลได้ — ทางแก้จริงคือเจ้าของตั้งเอง
  (เช็คลิสต์ใน `karmto-security-guard.md`) ไม่ใช่โค้ด
- ห้ามแตะข้อมูลจริง ห้ามตัดต้นทุนเอง ตามกฎเหล็กใน `CLAUDE.md`

## ผังฝ่าย
```
AY (เจ้าของ ตัดสินจริง)
 └─ Claude หลัก (แจกงานตามใบสั่ง, commit/PR/merge)
     └─ karmto-manager (ผู้จัดการ)
         ├─ karmto-ay-proxy            ตัวแทน AY (โหมดเงา)
         ├─ karmto-head-build          ฝ่ายสร้าง
         │   ├─ karmto-designer
         │   ├─ karmto-builder
         │   └─ karmto-gs-backend
         ├─ karmto-head-quality        ฝ่ายคุณภาพ
         │   ├─ karmto-plan-reviewer
         │   ├─ karmto-test-writer
         │   ├─ karmto-bug-hunter
         │   ├─ karmto-ui-checker
         │   ├─ karmto-perf-guard
         │   └─ karmto-release
         ├─ karmto-head-money          ฝ่ายเงิน
         │   ├─ karmto-money-guard     (ตัดสินผ่าน/ไม่ผ่านเอง หัวหน้ากลับคำไม่ได้)
         │   ├─ karmto-accountant
         │   └─ karmto-data-auditor
         └─ karmto-security-guard      ฝ่ายความปลอดภัย (เป็นหัวหน้าฝ่ายเอง; ตัวรองดู RESERVE.md)
```

## เจ้าของสกิล
เจ้าของ = ผู้รับผิดชอบเสนอ diff ให้สกิลนั้นตรงของจริงเสมอ (Claude หลักเป็นคนแก้ไฟล์)

| เจ้าของ | สกิล |
|---|---|
| karmto-head-build | `karmto-codebase-map`, `karmto-ui-style`, `karmto-apps-script`, `karmto-order-ocr`, `karmto-fix-workflow`, `karmto-ui-thai-conventions` |
| karmto-head-quality | `karmto-testing`, `karmto-release-checklist` |
| karmto-head-money | `karmto-iron-rules`, `karmto-money-review`, `karmto-lot-costing`, `karmto-reconcile`, `karmto-domain-glossary`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-security-guard | `karmto-security-audit` |
| karmto-manager | `karmto-ay-way` |

## สกิลที่แต่ละ agent ต้องมี
ต้องตรงกับบรรทัด `skills:` ใน frontmatter ของ `.claude/agents/<agent>.md` ทุกตัว (ลำดับไม่สำคัญ)

| agent | สกิล |
|---|---|
| karmto-manager | `karmto-ay-way`, `karmto-iron-rules`, `karmto-release-checklist`, `karmto-codebase-map` |
| karmto-ay-proxy | `karmto-ay-way`, `karmto-iron-rules` |
| karmto-head-build | `karmto-codebase-map`, `karmto-ui-style`, `karmto-apps-script`, `karmto-order-ocr`, `karmto-fix-workflow`, `karmto-ay-way`, `karmto-ui-thai-conventions` |
| karmto-designer | `karmto-ay-way`, `karmto-ui-style`, `karmto-codebase-map`, `karmto-iron-rules`, `karmto-ui-thai-conventions` |
| karmto-builder | `karmto-iron-rules`, `karmto-codebase-map`, `karmto-ui-style`, `karmto-ay-way`, `karmto-order-ocr`, `karmto-domain-glossary`, `karmto-fix-workflow`, `karmto-ui-thai-conventions`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-gs-backend | `karmto-apps-script`, `karmto-security-audit`, `karmto-iron-rules`, `karmto-order-ocr`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-head-quality | `karmto-testing`, `karmto-release-checklist`, `karmto-fix-workflow`, `karmto-codebase-map` |
| karmto-plan-reviewer | `karmto-iron-rules`, `karmto-codebase-map`, `karmto-testing`, `karmto-security-audit`, `karmto-domain-glossary`, `karmto-storage-data-model` |
| karmto-test-writer | `karmto-testing`, `karmto-iron-rules`, `karmto-codebase-map`, `karmto-order-ocr`, `karmto-domain-glossary`, `karmto-fix-workflow`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-bug-hunter | `karmto-testing`, `karmto-codebase-map`, `karmto-iron-rules`, `karmto-domain-glossary`, `karmto-fix-workflow`, `karmto-storage-data-model` |
| karmto-ui-checker | `karmto-ui-style`, `karmto-ay-way`, `karmto-ui-thai-conventions` |
| karmto-perf-guard | `karmto-codebase-map`, `karmto-testing`, `karmto-storage-data-model` |
| karmto-release | `karmto-release-checklist`, `karmto-testing` |
| karmto-head-money | `karmto-iron-rules`, `karmto-money-review`, `karmto-lot-costing`, `karmto-reconcile`, `karmto-domain-glossary`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-money-guard | `karmto-money-review`, `karmto-iron-rules`, `karmto-lot-costing`, `karmto-codebase-map`, `karmto-domain-glossary`, `karmto-storage-data-model`, `karmto-line-message` |
| karmto-accountant | `karmto-reconcile`, `karmto-money-review`, `karmto-ay-way`, `karmto-domain-glossary` |
| karmto-data-auditor | `karmto-lot-costing`, `karmto-iron-rules`, `karmto-ay-way`, `karmto-domain-glossary` |
| karmto-security-guard | `karmto-security-audit`, `karmto-iron-rules`, `karmto-codebase-map`, `karmto-ay-way`, `karmto-line-message` |

## เมื่อไหร่ต้องอัปเดตสกิล (ใครทำ)
| สัญญาณ | ใครเสนอ diff | แก้อะไร |
|---|---|---|
| เลขบรรทัดใน `karmto-codebase-map` เลื่อน (check-skills เตือน/ฟ้อง) หรือฟังก์ชันเปลี่ยนชื่อ | head-build | `karmto-codebase-map` |
| AY ติ๊ก ❌ ใน `.claude/ay-proxy/decisions.md` | manager แก้ `karmto-ay-way` ก่อน → หัวหน้าฝ่ายที่เกี่ยวข้องแก้สกิลของตัวเองตาม | `karmto-ay-way` + สกิลของฝ่ายนั้น |
| มีกฎเงินใหม่ในกฎเหล็กของ `CLAUDE.md` | head-money | `karmto-iron-rules` / `karmto-money-review` / `karmto-lot-costing` |
| เพิ่มคีย์ storage ใหม่ | head-money (+ security-guard ถ้าเป็นข้อมูลส่วนตัว) | `karmto-storage-data-model` + เช็ค `BACKUP_EXTRA_ROOT_KEYS`/`BACKUP_PREFIXES` ใน `index.html` เทียบ `backend/BackupTrigger.gs` (check-skills ฟ้องถ้าไม่ตรง) |
| มีศัพท์ธุรกิจใหม่ หรือบั๊กที่ผูกกับศัพท์ | head-money | `karmto-domain-glossary` |
| ข้อเท็จจริงด้านความปลอดภัยในสกิลผิด หรือมี endpoint `.gs` ใหม่ | security-guard | `karmto-security-audit` |
| บั๊กเดิมเกิดซ้ำ 2 ครั้ง | head-quality | เพิ่มสูตรกันซ้ำใน `karmto-testing` |
| ขั้นตอนปล่อยงานเปลี่ยน (เช่น ด่านใหม่ใน CI) | head-quality | `karmto-release-checklist` |
| แก้โครงข้อความ LINE/ปุ่มคัดลอก หรือบอท LINE | head-money | `karmto-line-message` |
| เปลี่ยนแบบแผนป้ายออเดอร์/เมนู/ปุ่มเรียง/ข้อความบล็อกในแอป | head-build | `karmto-ui-thai-conventions` |

## ด่านของแต่ละรอบงาน
คัดลอก `.claude/gates/TEMPLATE.md` เป็น `.claude/gates/current.md` (ไม่ขึ้น git) แล้วเติมทีละแถว — ผู้จัดการเทียบทีละแถวตอนจบรอบ แถวว่าง = ส่งกลับ
