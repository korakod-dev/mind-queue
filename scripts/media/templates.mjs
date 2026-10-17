import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, WORK, SHOTS, BASE, hostKey, sleep, HERE } from "./paths.mjs";
const segs = JSON.parse(readFileSync(path.join(WORK, "segments.json"), "utf8"));
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const css = `
body{margin:0;width:1920px;height:1080px;background:linear-gradient(135deg,#fbf7f1 0%,#e6f3ee 100%);font-family:Prompt,sans-serif;color:#23403d;position:relative;overflow:hidden}
.top{position:absolute;left:30px;right:30px;top:14px;height:44px;display:flex;align-items:center;justify-content:space-between}
.step{display:flex;align-items:center;gap:14px;font-size:32px;font-weight:800;color:#1d4743}
.chip{width:44px;height:44px;border-radius:12px;background:#2e8c80;color:#fff;display:grid;place-items:center;font-size:26px}
.brand{font-size:22px;color:#5b7471;font-weight:600}
.scr{position:absolute;left:30px;top:70px;width:1232px;height:693px;border:14px solid #1f2a29;border-radius:18px;background:#000}
.ph{position:absolute;left:1430px;top:66px;width:334px;height:723px;border:14px solid #1f2a29;border-radius:46px;background:#000}
.lab{position:absolute;font-size:18px;font-weight:700;background:#1f2a29;color:#e9f6f2;padding:3px 14px;border-radius:999px;transform:translateX(-50%)}
.cap{position:absolute;left:30px;top:836px;width:1860px;height:214px;border-radius:20px;background:#1d4743;color:#fff;box-sizing:border-box;padding:30px 44px;display:flex;flex-direction:column;justify-content:center;gap:12px}
.cap .a{font-size:42px;font-weight:800;line-height:1.25}
.cap .b{font-size:28px;color:#bfe7de;font-weight:600}`;
for (let i = 0; i < segs.length; i++) {
  const s = segs[i];
  const sp = s.v !== 1 ? ` <span style="font-size:20px;color:#5b7471;font-weight:600">(เร่ง ${s.v}×)</span>` : "";
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600;700;800&display=swap" rel="stylesheet"><style>${css}</style></head><body>
  <div class="top"><div class="step"><span class="chip">${s.n}</span>${s.t}${sp}</div><div class="brand">คิวหน้าห้องจิตแพทย์ · วิธีเล่น (คิวเดียว 3 นาที)</div></div>
  <div class="scr"></div><div class="ph"></div>
  <div class="lab" style="left:660px;top:790px">จอใหญ่ (โปรเจกเตอร์)</div>
  <div class="lab" style="left:1611px;top:806px">มือถือผู้เล่น</div>
  <div class="cap"><div class="a">${s.a}</div><div class="b">${s.b}</div></div></body></html>`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(WORK, `tpl${i}.png`) });
}
await b.close(); console.log("tpl ok", segs.length);
