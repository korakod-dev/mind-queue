// Solo run (no bots) so the phone is queue #1, to capture the real winner screen.
import { chromium } from "playwright-core";
import path from "node:path";
import { ROOT, WORK, SHOTS, BASE, hostKey, sleep, HERE } from "./paths.mjs";
const key = hostKey();
const b = await chromium.launch({ channel: "chrome" });
const host = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" })).newPage();
await host.goto(`${BASE}/host?key=${key}`); await sleep(1000);
if (await host.evaluate(() => document.getElementById("online-toggle").classList.contains("on"))) { await host.keyboard.press("o"); await sleep(600); } // classroom mode
await phone.goto(BASE + "/"); await phone.waitForSelector("#emoji-grid button");
await phone.fill("#nick", "มิ้น"); await phone.locator("#emoji-grid button").nth(5).click(); await phone.click("#join-btn"); await sleep(800);
const ph = () => host.evaluate(() => document.getElementById("ctl-info").textContent.split(" ")[0]);
await host.keyboard.press(" "); await sleep(700); await host.keyboard.press(" ");
while ((await ph()) !== "LINEUP") await sleep(200);
for (let i = 0; i < 2; i++) { await sleep(700); await host.keyboard.press(" "); }
while ((await ph()) !== "CALL") await sleep(200);
await sleep(4500);
await phone.screenshot({ path: path.join(SHOTS, "phone-win.jpg"), type: "jpeg", quality: 82 });
await b.close(); console.log("ok");
