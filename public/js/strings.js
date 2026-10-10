/**
 * All Thai UI strings. `{name}` placeholders are filled by fmt().
 */
window.STR = {
  // --- join / lobby
  joinTitle: "คิวหน้าห้องจิตแพทย์",
  joinNickname: "ชื่อเล่น",
  joinEmoji: "เลือกอีโมจิของคุณ",
  joinButton: "เข้าร่วม",
  waitForHost: "รอเริ่มเกม…",
  joinedCount: "เข้าร่วมแล้ว {x} / {total}",
  errNickname: "กรุณาใส่ชื่อเล่น (ไม่เกิน 12 ตัวอักษร)",
  reconnecting: "กำลังเชื่อมต่อใหม่…",
  lobbyHint: "สแกนแล้วตั้งชื่อเล่น + เลือกอีโมจิ",

  // --- intro + patient card
  introBig: "หมอว่าง 1 คิว",
  introSub: "ผู้ป่วย {n} คน",
  introHint: "ดูบัตรผู้ป่วยในมือถือของคุณ",
  cardHead: "บัตรผู้ป่วย",
  cardNote: "ตัวละครสมมติ ระบบสุ่มให้",
  urg3: "ด่วนมาก",
  urg2: "ปานกลาง",
  urg1: "ไม่รีบ",
  urgIcon3: "🔴",
  urgIcon2: "🟡",
  urgIcon1: "🟢",
  introNext: "เตรียมนิ้ว! รอไฟเขียวแล้วกดจองคิว",

  // --- race
  raceTitle: "จองคิวพบจิตแพทย์",
  raceWait: "รอไฟเขียว…",
  raceWarn: "กดก่อนไฟเขียว = ลัดคิว โดนส่งไปท้ายแถว!",
  raceGo: "กดเลย!!",
  raceOver: "หมดเวลา!",
  tapButtonRed: "รอไฟเขียว",
  tapButtonGreen: "กด!!",
  tapCount: "คุณกดไป {n} ครั้ง",
  foulPhone: "🚫 ลัดคิว! ไปต่อท้ายแถว",
  foulBig: "ลัดคิว!",
  topTappers: "กดเยอะสุดตอนนี้",
  timeLeft: "เหลือ {s} วินาที",

  // --- lineup
  lineupTitle: "ได้ลำดับคิวแล้ว!",
  ironyFastest: "⚡ เร็วที่สุด {who} {sec} วิ → คิวที่ {pos}",
  ironyMost: "💪 กดเยอะที่สุด {who} {taps} ครั้ง → คิวที่ {pos}",
  ironyTotal: "ทั้งห้องกด {total} ครั้ง… แต่นับจริงแค่ครั้งแรกของแต่ละคน 😅",
  ironyFouls: "🚫 ลัดคิว {n} คน → ไปต่อท้ายแถว",
  ironyNone: "ไม่มีใครกดทันเลย! สุ่มลำดับให้แทน",
  youPos: "คิวที่",
  youTaps: "กดไป {n} ครั้ง (นับแค่ครั้งแรก 😅)",
  youReaction: "เร็ว {sec} วินาที",
  youFoul: "ลัดคิว → ไปต่อท้ายแถว",
  doorLabel: "ห้องตรวจ",

  // --- events
  eventsTitle: "ห้องรอ — ระหว่างนี้อาจเกิดอะไรขึ้นก็ได้…",
  ev_docs_t: "📄 เอกสารไม่ครบ!",
  ev_docs_d: "คิวหน้าสุด {n} คน ต้องกลับไปต่อท้าย",
  ev_crash_t: "🔀 ระบบคิวล่ม!",
  ev_crash_d: "สุ่มลำดับใหม่ {n} คน",
  ev_cancel_t: "📞 มีคนยกเลิกนัด!",
  ev_cancel_d: "คิวท้าย ๆ ได้ขึ้นมาเป็นคิวที่ 1",
  ev_gamble_t: "🏥 มีคิวว่างที่ รพ. ต่างจังหวัด",
  ev_gamble_d: "จะย้ายไหม? โชคดีได้ขึ้นหน้า โชคร้ายไปท้ายแถว (50/50)",
  ev_gamble_wait: "เลือกในมือถือ! เหลือ {s} วิ",
  ev_gamble_res: "ย้ายไป {movers} คน → โชคดี {lucky} คนขึ้นหน้า · โชคร้าย {unlucky} คนไปท้ายแถว",
  ev_gamble_none: "ไม่มีใครกล้าย้ายเลย…",
  gambleMove: "ย้าย! 🚌",
  gambleStay: "รอที่เดิม 🪑",
  gambleChosen: "คุณเลือก: {c} — รอผล…",
  moveUp: "⬆️ ขึ้นมาจากคิวที่ {from}!",
  moveDown: "⬇️ ถอยไปจากคิวที่ {from}",
  noEventYet: "รอเรียกคิว…",

  // --- call
  callDrum: "🥁 กำลังเรียกคิว…",
  callBig: "ขอเชิญหมายเลข {n}",
  callSay: "ขอเชิญหมายเลข {n} ที่ห้องตรวจค่ะ",
  callWinnerUrg: "บัตรผู้ป่วย: {icon} {label}",
  callSummary: "ผู้ได้พบหมอ {icon} {label} · ยังรออยู่: 🔴 ด่วนมาก {red} คน",
  callNoOne: "ไม่มีใครในคิวเลย",
  youWin: "ถึงคิวคุณแล้ว! 🎉",
  youWinSub: "คุณได้พบหมอ · รับรางวัลหน้าห้องตอนจบ",
  claimCodeLabel: "รหัสรับรางวัล",
  youLose: "ยังไม่ถึงคิวคุณ 😢",

  // --- guess
  guessQ: "ทายสิ! จิตแพทย์ 1 คน ต้องดูแลห้องแบบเรา ({n} คน) กี่ห้อง?",
  guessOpt0: "~10 ห้อง",
  guessOpt1: "~100 ห้อง",
  guessOpt2: "~500 ห้อง",
  guessOpt3: "1,000 ห้องขึ้นไป",
  guessAnswered: "ตอบแล้ว {n} คน",
  guessPicked: "เลือกแล้ว — เปลี่ยนได้จนหมดเวลา",

  // --- zoom (reveal)
  zoomGuessRight: "ทายถูก {n} คน จาก {total}",
  zoomOurRoom: "ห้องเรา {n} คน",
  zoomRooms: "{n} ห้อง",
  zoomDoc: "ต่อจิตแพทย์ 1 คน",
  zoomLine1: "ไทยมีจิตแพทย์ทั่วไปประมาณ {per100k} คน ต่อประชากร 1 แสนคน",
  zoomLine2: "จิตแพทย์ 1 คน ดูแลประชากรราว {people} คน = ห้องแบบเรา {rooms} ห้อง",
  zoomLine3: "การได้พบหมอขึ้นกับความเร็วและโชค… ไม่ใช่ว่าใครต้องการที่สุด",
  zoomScale: "1 จุด = {k} ห้อง",
  lookAtScreen: "ดูที่จอหน้าห้องเลย 👀",
  lookUp: "ดูจอใหญ่",
  lookUpCall: "กำลังเรียกคิว…",
  phoneCallSum: "ผู้ได้พบหมอ {emoji} {icon} {label}\n🔴 ด่วนมาก ยังรออยู่ {red} คน",
  phoneZoomSum: "จิตแพทย์ 1 คน : ห้องแบบเรา {rooms} ห้อง",
  paused: "⏸ หยุดชั่วคราว",

  // --- end
  endBig: "ระหว่างรอหมอ… เพื่อนดูแลกันได้ 💛",
  endAsk: "หันไปถามเพื่อนข้าง ๆ ว่า “ช่วงนี้เป็นไงบ้าง?”",
  endPhone: "รับขนมจากเพื่อนได้เลย 🍬",
  endWinner: "ผู้ได้พบหมอ",
  hotline: "สายด่วนสุขภาพจิต 1323",

  // --- presenter-only control bar (never shown to players)
  ctlStart: "เริ่มเกม ▶",
  ctlSkip: "ข้าม ⏭",
  ctlReset: "รีเซ็ต",
  ctlHide: "ซ่อน",
  ctlFullscreen: "เต็มจอ",
  ctlPause: "⏸ หยุด",
  ctlResume: "▶ เล่นต่อ",
  ctlSound: "🔊 เสียง",
  ctlMuted: "🔇 ปิดเสียง",
  ctlOnline: "ออนไลน์ {n}",
  resetConfirm: "รีเซ็ตเกมทั้งหมด?",
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

/** "0.23" style seconds from ms. */
window.secs = function secs(ms) {
  return (Math.max(0, ms) / 1000).toFixed(2);
};
