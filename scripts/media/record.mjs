// Record a live game (big screen + one phone) with CDP screencast; log phase + event marks.
import { chromium } from "playwright-core";
import path from "node:path";
import { ROOT, WORK, SHOTS, BASE, hostKey, sleep, HERE, ONLINE } from "./paths.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
const key = hostKey();
for (const d of ["host", "phone"]) { rmSync(`${WORK}/${d}`, { recursive: true, force: true }); mkdirSync(`${WORK}/${d}`, { recursive: true }); }
const b = await chromium.launch({ channel: "chrome" });
const host = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" })).newPage();
async function cast(page, name, maxW, maxH) {
  const cdp = await page.context().newCDPSession(page);
  if (name === "host") await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const i = frames.length;
    writeFileSync(`${WORK}/${name}/${String(i).padStart(6, "0")}.jpg`, Buffer.from(f.data, "base64"));
    frames.push(f.metadata.timestamp);
    if (i === 0) console.log(name, "frame", f.metadata.deviceWidth, f.metadata.deviceHeight);
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: maxW, maxHeight: maxH, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast") };
}
await host.goto(`${BASE}/host?key=${key}`); await sleep(1200); await host.keyboard.press("h");
if (ONLINE !== (await host.evaluate(() => document.getElementById("online-toggle").classList.contains("on")))) { await host.keyboard.press("o"); await sleep(600); }
console.log("mode:", await host.textContent("#online-toggle"));
await phone.goto(BASE + "/"); await phone.waitForSelector("#emoji-grid button");
for (const p of [host, phone]) await p.addStyleTag({ content: "body::after{content:'';position:fixed;width:1px;height:1px;left:0;top:0;animation:kp 0.1s infinite alternate;}@keyframes kp{to{opacity:.99}}" });
const hc = await cast(host, "host", 1600, 900);
const pc = await cast(phone, "phone", 780, 1688);
const log = []; const mark = (n) => { log.push({ n, t: Date.now() / 1000 }); console.log(n); };
mark("REC"); await sleep(1500);
const bots = spawn("node", [path.join(HERE, "bots.mjs"), "52"], { stdio: "ignore" });
await sleep(1500);
await phone.fill("#nick", "มิ้น"); await sleep(400); await phone.locator("#emoji-grid button").nth(5).click(); await sleep(400); await phone.click("#join-btn");
await sleep(7000);
const ph = () => host.evaluate(() => document.getElementById("ctl-info").textContent.split(" ")[0]);
await host.keyboard.press(" "); mark("LOBBY_END");
let last = "LOBBY", tapper = null, evs = 0, gambled = false, guessed = false;
while (true) {
  const p = await ph();
  if (p !== last) { mark(p); last = p; }
  const green = await phone.evaluate(() => document.getElementById("tap-btn").classList.contains("green") && !document.getElementById("s-tap").hidden);
  if (green && !tapper) { mark("GREEN"); tapper = setInterval(() => phone.locator("#tap-btn").dispatchEvent("pointerdown").catch(() => {}), 140); }
  if (!green && tapper && p !== "RACE") { clearInterval(tapper); tapper = null; }
  if (p === "EVENTS") {
    const n = await host.evaluate(() => document.querySelector("#q-head .ev-card") ? document.querySelector("#q-head .ev-card").className : "");
    const k = n.replace(" settled", "");
    if (k && k !== evs) { evs = k; mark("EV:" + k.replace("ev-card ev-", "")); }
    if (!gambled && await phone.evaluate(() => !document.getElementById("gamble-box").hidden)) { gambled = true; await sleep(5000); await phone.click("#g-move").catch(() => {}); mark("GAMBLED"); }
  }
  if (p === "GUESS" && !guessed && await phone.evaluate(() => document.querySelectorAll(".g-opt").length > 0)) { guessed = true; await sleep(2500); await phone.locator(".g-opt").nth(3).click(); mark("GUESSED"); }
  if (p === "END") break;
  await sleep(80);
}
await sleep(30000); mark("STOP");
await hc.stop(); await pc.stop(); bots.kill();
writeFileSync(`${WORK}/log.json`, JSON.stringify({ log, host: hc.frames, phone: pc.frames }));
await b.close(); console.log("frames", hc.frames.length, pc.frames.length);
