"""Turn the recorded screencast frames into exact 30 fps clips and write the segment plan.

Reads .work/log.json (from record.mjs); writes .work/host.mp4, .work/phone.mp4, .work/marks.json,
.work/segments.json (which part of the game each video step shows, its speed and captions).
"""
import bisect, json, os, shutil, subprocess

WORK = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".work-online" if os.environ.get("ONLINE") == "1" else ".work")
os.chdir(WORK)
d = json.load(open("log.json"))
T0 = min(d["host"][0], d["phone"][0]); end = d["log"][-1]["t"]
n = int((end - T0) * 30)
for name in ["host", "phone"]:
    ts = d[name]; out = f"seq_{name}"
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    for k in range(n):  # latest captured frame for each output frame
        i = max(0, bisect.bisect_right(ts, T0 + k / 30) - 1)
        os.symlink(os.path.abspath(f"{name}/{i:06d}.jpg"), f"{out}/{k:06d}.jpg")
M = {e["n"]: round(e["t"] - T0, 3) for e in d["log"]}
json.dump(M, open("marks.json", "w"))
r = lambda x: round(x, 2)
E, G = M["EVENTS"], M["EV:gamble"]
segs = [
 dict(s=2.0, e=r(M["LOBBY_END"] - 0.1), v=1, n=1, t="เข้าร่วมเกม", a="ระหว่างคนเข้าห้อง ทุกคนสแกน QR ตั้งชื่อเล่น + เลือกอีโมจิ", b="ผู้นำเสนอกด Space ครั้งเดียว — เกมเดินเองทั้งหมด · กด P หยุดชั่วคราวได้ทุกเมื่อ"),
 dict(s=r(M["INTRO"] + 0.05), e=r(M["INTRO"] + 7.5), v=1, n=2, t="บัตรผู้ป่วย", a="มือถือพลิกบัตรความเร่งด่วน 🔴 ด่วนมาก · 🟡 ปานกลาง · 🟢 ไม่รีบ", b="ตัวละครสมมติ ระบบสุ่มให้ — ทำให้ทุกคนมีเดิมพัน"),
 dict(s=r(M["RACE"] + 0.05), e=r(M["LINEUP"] - 0.05), v=1, n=3, t="ไฟเขียว", a="รอไฟแดง… พอเขียวแล้วรัวกด! กดก่อนไฟเขียว = ลัดคิว ไปท้ายแถว", b="ลำดับคิวนับจากการกดครั้งแรกหลังไฟเขียวเท่านั้น"),
 dict(s=r(M["LINEUP"] + 0.05), e=r(M["LINEUP"] + 13), v=1, n=4, t="ต่อแถว", a="จอใหญ่เฉลยหักมุม: คนกดเยอะที่สุดไม่ได้คิวแรก", b="มือถือเปลี่ยนเป็น 👆 “ดูจอใหญ่” + เลขคิวตัวเล็ก — ให้ทุกคนเงยหน้า"),
 dict(s=r(E), e=r(G + 14.5), v=1.5, n=5, t="ห้องรอ: อุปสรรคในการพบจิตแพทย์", a="แต่ละเหตุการณ์บอก “ในชีวิตจริง” ว่าสะท้อนอุปสรรคอะไร", b="🏥 คิวว่างต่างจังหวัด: ทุกคนมองมือถือ เลือก “ย้าย / รอที่เดิม” ใน 14 วินาที"),
 dict(s=r(G + 14.5), e=r(M["CALL"] - 0.1), v=2, n=5, t="ห้องรอ: อุปสรรคในการพบจิตแพทย์", a="📄 เอกสารไม่ครบ · 🔀 ระบบคิวล่ม · 📞 มีคนยกเลิกนัด", b="แถวสลับสด ๆ · เลขคิวบนมือถือเปลี่ยนสี + สั่นเมื่อขยับ"),
 dict(s=r(M["CALL"] + 0.1), e=r(M["CALL"] + 17), v=1, n=6, t="เรียกคิว", a="กลองรัว → “ติ๊งต่อง ขอเชิญหมายเลข 1” — รางวัลเดียวของเกม", b="แถวเปลี่ยนสีตามความเร่งด่วน · มือถือสรุป: “🔴 ด่วนมาก ยังรออยู่ X คน”"),
 dict(s=r(M["GUESS"]), e=r(M["ZOOM"] - 0.1), v=1.5, n=7, t="ทายตัวเลข", a="จิตแพทย์ 1 คน ต้องดูแลห้องแบบเรากี่ห้อง?", b="ตอบในมือถือ กราฟคำตอบขึ้นสดบนจอ"),
 dict(s=r(M["ZOOM"]), e=r(M["END"] - 0.1), v=1.4, n=8, t="ซูมออก", a="เฉลย → ห้องเรากลายเป็นจุดเดียวในพันกว่าห้อง", b="ได้พบหมอเพราะความเร็วและโชค… ไม่ใช่ว่าใครต้องการที่สุด"),
 dict(s=r(M["END"]), e=r(M["END"] + 14.6), v=1, n=9, t="ปิดท้าย", a="ทุกคนได้ขนมจากเพื่อน — หัวแถวส่งต่อกันไป", b="หันไปถามเพื่อนข้าง ๆ ว่า “ช่วงนี้เป็นไงบ้าง?” · ผู้ช่วยเทียบรหัสแล้วให้รางวัลพิเศษ"),
 dict(s=r(M["END"] + 15), e=r(M["END"] + 28), v=1, n=10, t="ข้อความสุดท้าย", a="ทำไมจิตแพทย์ถึงมีน้อย? — จบใหม่น้อย ภาระงานหนัก หลายคนออกจากระบบ", b="“ถึงเวลาแล้วหรือยัง… ที่เราจะช่วยกันดูแล และรักษาจิตแพทย์ไว้ในระบบต่อไป?” · สายด่วน 1323"),
]
json.dump(segs, open("segments.json", "w"), ensure_ascii=False, indent=0)
for name, vf in [("host", "scale=1600:900,format=yuv420p"), ("phone", "scale=780:1688,format=yuv420p")]:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", f"seq_{name}/%06d.jpg", "-vf", vf, "-c:v", "libx264", "-crf", "16", "-preset", "fast", f"{name}.mp4"], check=True)
print("clips ok · video length", round(sum((s["e"] - s["s"]) / s["v"] for s in segs), 1), "s")
