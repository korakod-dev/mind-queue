// Online-class version of the atmosphere video: renders .work/online/*.jpg frame by frame.
import { chromium } from "playwright-core";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { WORK, HERE } from "./paths.mjs";
const segs = JSON.parse(readFileSync(path.join(WORK, "segments.json"), "utf8")), marks = JSON.parse(readFileSync(path.join(WORK, "marks.json"), "utf8"));
const caps = [
  ["เข้าร่วม · ออนไลน์จากบ้าน", "ผู้นำเสนอเปิด “โหมดออนไลน์” แล้วแชร์หน้าจอพร้อมเสียง", "ผู้เล่นสแกน QR จากจอตัวเอง หรือกดลิงก์ในแชท แล้วแตะ 🔊 เปิดเสียงในมือถือ"],
  ["บัตรผู้ป่วย", "แต่ละคนเปิดบัตรผู้ป่วยในมือถือที่บ้าน", "เปิดไมค์คุยกันได้: “ได้แดง!” “ไม่รีบ 555”"],
  ["ไฟเขียว", "ไฟเขียวขึ้นบนมือถือทุกเครื่องพร้อมกัน พร้อมเสียงจากมือถือเอง", "ภาพแชร์จอช้ากว่า 1–2 วินาที แต่ไฟบนมือถือตรงเวลาเซิร์ฟเวอร์ ทุกบ้านจึงยุติธรรม"],
  ["ต่อแถว", "กดปุ่มตะโกนในมือถือ ข้อความขึ้นบนจอที่แชร์พร้อมชื่อเล่น", "ได้เสียงของห้องกลับมา โดยไม่ต้องเปิดไมค์"],
  ["ห้องรอ · อุปสรรคในการพบจิตแพทย์", "🏥 ย้าย รพ. ไหม? ทุกคนก้มดูมือถือที่บ้าน แล้วกด “ย้ายเลย!”", "อุปสรรคแต่ละอย่างมีบรรทัด “ในชีวิตจริง” บนจอที่แชร์"],
  ["ห้องรอ · อุปสรรคในการพบจิตแพทย์", "เอกสารไม่ครบ · ระบบคิวล่ม · มีคนยกเลิกนัด", "ตะโกน “ไม่ยุติธรรม!” “😭 ถอยไปท้าย” ขึ้นจอให้ทุกบ้านเห็น"],
  ["เรียกคิว", "มือถือเฉลยพร้อมจอที่แชร์ (หน่วง 1.5 วิ) ไม่มีใครโดนสปอยล์", "ผู้ชนะแคปหน้าจอ แล้วส่งรหัสในแชทส่วนตัว รับรางวัลภายหลัง"],
  ["ทายตัวเลข", "ทุกคนตอบในมือถือ", "กราฟคำตอบขึ้นสดบนจอที่แชร์"],
  ["ซูมออก", "ทุกบ้านเงียบ ดูจอที่แชร์", "ห้องเราเป็นแค่จุดเดียวในพันกว่าห้อง"],
  ["ปิดท้าย", "มือถือทุกเครื่องได้การ์ด “ขนมใจ 💛” แทนขนม", "กด “ส่งให้เพื่อน” แล้วถามว่า “ช่วงนี้เป็นไงบ้าง?” · สายด่วน 1323"],
  ["ข้อความสุดท้าย", "ทำไมจิตแพทย์ถึงมีน้อย? — แล้วเราจะช่วยกันรักษาจิตแพทย์ไว้ในระบบได้ไหม", "เป็นสะพานเข้าสู่เนื้อหาการนำเสนอ ผู้นำเสนอยังแชร์จอต่อได้เลย"],
];
// Sharper projector frames for the large shared-screen area (1248×702).
const HD = path.join(WORK, "scr_hd");
rmSync(HD, { recursive: true, force: true }); mkdirSync(HD);
const parts = [], maps = [];
segs.forEach((s, i) => { parts.push(`[0:v]trim=${s.s}:${s.e},setpts=(PTS-STARTPTS)/${s.v},fps=24,scale=1248:702:flags=lanczos[v${i}]`); maps.push(`[v${i}]`); });
spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(WORK, "host.mp4"), "-filter_complex", parts.join(";") + ";" + maps.join("") + `concat=n=${segs.length}:v=1:a=0[o]`, "-map", "[o]", "-q:v", "3", path.join(HD, "%06d.jpg")], { stdio: "inherit" });
const OUTD = path.join(WORK, "online");
rmSync(OUTD, { recursive: true, force: true }); mkdirSync(OUTD);
const b = await chromium.launch({ channel: "chrome", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + path.join(HERE, "online.html"), { waitUntil: "networkidle" });
await p.evaluate(() => Promise.all(["800 34px Prompt", "700 22px Prompt", "600 22px Prompt"].map((f) => document.fonts.load(f))));
const total = await p.evaluate(([s, m, c]) => setup(s, m, c), [segs, marks, caps]);
const n = readdirSync(HD).length;
for (let k = 0; k < n; k++) {
  const url = await p.evaluate(([t, src]) => frame(t, src), [k / 24, `file://${HD}/${String(k + 1).padStart(6, "0")}.jpg`]);
  writeFileSync(path.join(OUTD, `${String(k).padStart(6, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
}
await b.close(); console.log("online frames", n, "total", total.toFixed(1));
