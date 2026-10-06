/**
 * All Thai UI strings (spec section 7 + approved additions).
 * `{name}` placeholders are filled by fmt().
 */
window.STR = {
  // --- spec section 7
  joinTitle: "คิวหน้าห้องจิตแพทย์",
  joinNickname: "ชื่อเล่น",
  joinEmoji: "เลือกอีโมจิของคุณ",
  joinButton: "เข้าร่วม",
  waitForHost: "รอผู้นำเสนอเริ่มเกม…",
  tapButton: "จองคิวพบจิตแพทย์",
  tapWin: "คุณได้พบหมอแล้ว! รับรางวัลหน้าห้อง",
  ticketLabel: "บัตรคิวของคุณ",
  ticketWait: "กรุณารอเรียกคิว",
  nowCalling: "ขณะนี้เรียกคิวที่",
  cancelDraw: "มีผู้ยกเลิกนัด! เชิญคิวที่ {number}",
  breatheIn: "หายใจเข้า",
  breatheOut: "หายใจออก",
  bubbleTab: "จิ้มฟองคลายเครียด",
  breatheTab: "หายใจไปพร้อมกัน",
  endBig: "ระหว่างรอหมอ… เพื่อนดูแลกันได้ 💛",
  endPhone: "รับขนมจากเพื่อนได้เลย 🍬",
  hotline: "สายด่วนสุขภาพจิต 1323",
  reconnecting: "กำลังเชื่อมต่อใหม่…",

  // --- approved additions
  lookAtScreen: "ดูที่จอหน้าห้องเลย 👀",
  getReady: "เตรียมตัว…",
  timeLeft: "เหลือ {s} วินาที",
  tapCount: "คุณกดไป {n} ครั้ง",
  claimCodeLabel: "รหัสรับรางวัล",
  drawWin: "มีผู้ยกเลิกนัด — ถึงคิวคุณแล้ว! รับรางวัลหน้าห้อง",
  roomPops: "ทั้งห้องจิ้มฟองไปแล้ว {n} ลูก",
  joinedCount: "เข้าร่วมแล้ว {x} / {total}",
  errNickname: "กรุณาใส่ชื่อเล่น (ไม่เกิน 12 ตัวอักษร)",
  noWinner: "ไม่มีใครกดทันเลย!",
  resetConfirm: "รีเซ็ตเกมทั้งหมด?",

  // --- big-screen lines (spec 4.3 – 4.5)
  roomTaps: "ทั้งห้องกดไป {total} ครั้ง เพื่อแย่งคิวเดียว",
  queueAhead: "คิวของห้องนี้ยังอยู่อีกประมาณ {n} คิว",
  reveal1: "ประเทศไทยมีจิตแพทย์ทั่วไปประมาณ {psychiatristsPer100k} คน ต่อประชากร 1 แสนคน",
  reveal2: "จิตแพทย์ 1 คน ดูแลประชากรราว {peoplePerPsychiatrist} คน",
  reveal3: "จิตแพทย์ 1 คน ต้องรองรับห้องแบบพวกเรา {joined} คน ถึง {roomsNeeded} ห้อง !!!",

  // --- presenter-only control bar (never shown to players)
  ctlNext: "ถัดไป ▶",
  ctlDraw: "สุ่มยกเลิกนัด",
  ctlReset: "รีเซ็ต",
  ctlHide: "ซ่อน",
  ctlFullscreen: "เต็มจอ",
  ctlOnline: "ออนไลน์ {n}",
  hostNoKey: "ต้องเปิดด้วย /host?key=… ที่ถูกต้อง",
};

/** Fill `{name}` placeholders. */
window.fmt = function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? String(vars[k]) : ""));
};

/** Integer with thousands separator, e.g. 142857 → "142,857". */
window.num = function num(n) {
  return Math.round(Number(n) || 0).toLocaleString("en-US");
};
