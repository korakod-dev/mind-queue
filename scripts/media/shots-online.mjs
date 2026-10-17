// Online-mode screenshots: phone sound button, quick shouts (phone + big screen), winner tip, heart card.
import { chromium } from "playwright-core";
import path from "node:path";
import { SHOTS, BASE, hostKey, sleep } from "./paths.mjs";
const key = hostKey();
const b = await chromium.launch({ channel: "chrome" });
const host = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light" })).newPage();
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + ".jpg"), type: "jpeg", quality: 82 });
const until = async (p, fn, t = 90000) => { const e = Date.now() + t; while (Date.now() < e) { if (await p.evaluate(fn)) return; await sleep(100); } throw new Error("timeout " + fn); };
await host.goto(`${BASE}/host?key=${key}`); await sleep(1500); await host.keyboard.press("h");
if (!(await host.evaluate(() => document.getElementById("online-toggle").classList.contains("on")))) { await host.keyboard.press("o"); await sleep(600); }
await phone.goto(BASE + "/"); await phone.waitForSelector("#emoji-grid button");
await phone.fill("#nick", "มิ้น"); await phone.locator("#emoji-grid button").nth(5).click(); await phone.click("#join-btn");
await sleep(4000); await shot(host, "host-lobby-online"); await shot(phone, "phone-online-sound");
await phone.click("#sound-btn");
await host.keyboard.press(" ");
await until(host, () => !!document.querySelector("#q-head .ev-card")); await sleep(2500);
await phone.locator("#s-queue .shouts button").nth(1).dispatchEvent("pointerdown"); await sleep(900);
await shot(host, "host-online-shouts"); await shot(phone, "phone-online-shouts");
await until(host, () => !document.getElementById("h-end").hidden, 150000); await sleep(3000);
await shot(phone, "phone-online-end");
await b.close(); console.log("online shots done");
