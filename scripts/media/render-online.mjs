// Online-class version of the atmosphere video: renders .work/online/*.jpg frame by frame.
import { chromium } from "playwright-core";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { WORK, HERE } from "./paths.mjs";
const segs = JSON.parse(readFileSync(path.join(WORK, "segments.json"), "utf8")), marks = JSON.parse(readFileSync(path.join(WORK, "marks.json"), "utf8"));
const caps = [
  ["เข้าร่วม · ออนไลน์จากบ้าน", "ผู้นำเสนอแชร์หน้าจอ ทุกคนสแกน QR จากจอตัวเอง หรือกดลิงก์ในแชท", "อย่าลืมเปิด “แชร์เสียงคอมพิวเตอร์” ตอนแชร์จอ ทุกคนจะได้ยินเพลงและเสียงเรียกคิว"],
  ["บัตรผู้ป่วย", "แต่ละคนเปิดบัตรผู้ป่วยในมือถือที่บ้าน", "เปิดไมค์คุยกันได้: “ได้แดง!” “ไม่รีบ 555”"],
  ["ไฟเขียว", "ไฟเขียวขึ้นบนมือถือทุกเครื่องพร้อมกัน", "ภาพแชร์จออาจช้ากว่า 1–2 วินาที แต่ไฟบนมือถือตรงตามเวลาเซิร์ฟเวอร์ ทุกบ้านจึงยุติธรรม"],
  ["ต่อแถว", "ทุกคนหาอีโมจิตัวเองบนจอที่แชร์", "จอเฉลยเอง: กดเยอะสุดก็ไม่ได้คิวแรก — หัวเราะกันผ่านไมค์"],
  ["ห้องรอ · อุปสรรคในการพบจิตแพทย์", "🏥 ย้าย รพ. ไหม? ทุกคนก้มดูมือถือที่บ้าน", "คุยกันในห้องประชุมได้เลย: “ไกลบ้านมากเลย” — โยงกับชีวิตจริงได้ทันที"],
  ["ห้องรอ · อุปสรรคในการพบจิตแพทย์", "เอกสารไม่ครบ · ระบบคิวล่ม · มีคนยกเลิกนัด", "ส่งอีโมจิจากมือถือ ลอยขึ้นบนจอที่แชร์ให้ทุกบ้านเห็น"],
  ["เรียกคิว", "“ขอเชิญหมายเลข 1” — ผู้ชนะเห็นรหัสในมือถือ", "ออนไลน์: ให้ผู้ชนะแจ้งรหัสในแชทส่วนตัว แล้วส่งรางวัลให้ภายหลัง"],
  ["ทายตัวเลข", "ทุกคนตอบในมือถือ", "กราฟคำตอบขึ้นสดบนจอที่แชร์"],
  ["ซูมออก", "ทุกบ้านเงียบ ดูจอที่แชร์", "ห้องเราเป็นแค่จุดเดียวในพันกว่าห้อง"],
  ["ปิดท้าย", "ส่งขนมกันไม่ได้ ก็ส่งใจได้", "ชวนกันพิมพ์ถามเพื่อนในแชทว่า “ช่วงนี้เป็นไงบ้าง?” · สายด่วน 1323"],
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
