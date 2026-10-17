import { chromium } from "playwright-core";
import path from "node:path";
import { ROOT, WORK, SHOTS, BASE, hostKey, sleep, HERE } from "./paths.mjs";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
const segs = JSON.parse(readFileSync(path.join(WORK, "segments.json"), "utf8")), marks = JSON.parse(readFileSync(path.join(WORK, "marks.json"), "utf8"));
const caps = [
  ["เข้าร่วม · ระหว่างคนเข้าห้อง", "ทุกคนสแกน QR ใส่ชื่อเล่น เลือกอีโมจิ", "ผู้นำเสนอพูดประโยคเดียว กด Space ครั้งเดียว · อยากอธิบายเพิ่มกด P หยุดได้"],
  ["บัตรผู้ป่วย · 10 วินาที", "ทุกคนก้มดูบัตรผู้ป่วยในมือถือ", "“ได้แดง!” “ไม่รีบ 555” — มีเดิมพันโดยไม่ต้องมีใครบิ้ว"],
  ["ไฟเขียว · ~10 วินาที", "ห้องเงียบลุ้นไฟแดง… แล้วระเบิดพร้อมกันตอนไฟเขียว", "คนที่กดก่อนขึ้นจอว่า “ลัดคิว!” — ขำกันทั้งห้อง"],
  ["ต่อแถว · 18 วินาที", "มือถือบอก 👆 “ดูจอใหญ่” — ทั้งห้องเงยหน้าหาอีโมจิตัวเอง", "จอเฉลยเอง: กดเยอะสุดก็ไม่ได้คิวแรก"],
  ["ห้องรอ · 54 วินาที", "อุปสรรคในการพบจิตแพทย์ — การ์ดบอก “ในชีวิตจริง” ทุกใบ", "🏥 คิวว่างต่างจังหวัด: ทุกคนก้มดูมือถือ “ย้ายดีไหม?” — คนข้าง ๆ หันมาคุยกันเอง"],
  ["ห้องรอ · 54 วินาที", "เอกสารไม่ครบ · ระบบคิวล่ม · มีคนยกเลิกนัด", "ทุกคนลุ้นเลขคิวตัวเอง และเห็นว่าแต่ละอุปสรรคคืออะไรในชีวิตจริง"],
  ["เรียกคิว · 20 วินาที", "กลองรัว… “ติ๊งต่อง ขอเชิญหมายเลข 1”", "ผู้ได้พบหมอยกมือ · ผู้ช่วยจดรหัส 3 หลักไว้ก่อน"],
  ["ทายตัวเลข · 12 วินาที", "ทุกคนก้มตอบคำถามในมือถือ", "กราฟคำตอบขึ้นสดบนจอ"],
  ["ซูมออก · 34 วินาที", "ไฟสลัว ห้องเงียบ ทุกคนมองจอ", "ห้องเราเป็นแค่จุดเดียวในพันกว่าห้อง"],
  ["ปิดท้าย · 15 วินาทีแรก", "หัวแถวส่งขนมต่อกัน · ผู้ช่วยเอารางวัลพิเศษไปให้ (เทียบรหัส)", "จอชวน: หันไปถามเพื่อนข้าง ๆ “ช่วงนี้เป็นไงบ้าง?”"],
  ["ข้อความสุดท้าย · ค้างไว้", "ทำไมจิตแพทย์ถึงมีน้อย? — แล้วเราจะช่วยกันรักษาจิตแพทย์ไว้ในระบบได้ไหม", "เป็นสะพานเข้าสู่เนื้อหาการนำเสนอ · สายด่วน 1323 อยู่บนจอตลอด"],
];
const CLS = path.join(WORK, "cls"), SCR = path.join(WORK, "scr");
rmSync(CLS, { recursive: true, force: true }); mkdirSync(CLS);
const b = await chromium.launch({ channel: "chrome", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + path.join(HERE, "classroom.html"), { waitUntil: "networkidle" });
await p.evaluate(() => Promise.all(["800 36px Prompt", "700 22px Prompt", "600 22px Prompt"].map((f) => document.fonts.load(f))));
const total = await p.evaluate(([s, m, c]) => setup(s, m, c), [segs, marks, caps]);
const n = readdirSync(SCR).length;
for (let k = 0; k < n; k++) {
  const url = await p.evaluate(([t, src]) => frame(t, src), [k / 24, `file://${SCR}/${String(k + 1).padStart(6, "0")}.jpg`]);
  writeFileSync(`${CLS}/${String(k).padStart(6, "0")}.jpg`, Buffer.from(url.split(",")[1], "base64"));
}
await b.close(); console.log("frames", n, "total", total.toFixed(1));
