#!/usr/bin/env bash
# กันลืมขั้นตอนก่อน commit: ถ้า index.html เปลี่ยน ต้องผ่าน check-syntax และ APP_BUILD ต้องต่างจาก origin/main
# เรียกจาก PreToolUse (Bash) ใน .claude/settings.json — exit 2 = บล็อกคำสั่ง พร้อมเหตุผลทาง stderr
input="$(cat)"
printf '%s' "$input" | grep -Eq '"command"[[:space:]]*:[[:space:]]*"[^"]*git commit' || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}" || exit 0
git diff --cached --name-only 2>/dev/null | grep -q '^index.html$' || git diff --name-only 2>/dev/null | grep -q '^index.html$' || exit 0
if ! out="$(node tests/check-syntax.js 2>&1)"; then
  echo "บล็อก commit: inline script ใน index.html พัง — $out" >&2; exit 2
fi
new="$(grep -o "const APP_BUILD = '[^']*'" index.html | head -1)"
old="$(git show origin/main:index.html 2>/dev/null | grep -o "const APP_BUILD = '[^']*'" | head -1)"
if [ -n "$old" ] && [ "$new" = "$old" ]; then
  echo "บล็อก commit: index.html เปลี่ยนแต่ APP_BUILD ยังเท่ากับ main ($old) — เพิ่มเลขก่อน มือถือจะได้รีโหลดเวอร์ชันใหม่" >&2; exit 2
fi
exit 0
