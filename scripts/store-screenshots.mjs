// App Store screenshots: the demo boards on an iPhone and an iPad screen, each with a short
// headline on the brand gradient above it. Never real data.
//
//   1. Here:  VITE_DEMO=1 npx vite --port 1420
//   2. Here:  node scripts/store-screenshots.mjs [output folder]
//
// Needs Chromium (or set CHROME=/path/to/chrome). Writes iphone/*.png at 1320 × 2868 (6.9" iPhone),
// ipad/*.png at 2064 × 2752 (13" iPad), duo/*.png at 2034 × 1398 (iPhone Duo, open) and mac/*.png at
// 2880 × 1800: sizes App Store Connect takes.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const APP = process.env.APP_URL ?? "http://localhost:1420";
const OUT = process.argv[2] ?? join(homedir(), "zomello-builds/store/app-store-0.6");
const profile = mkdtempSync(join(tmpdir(), "zomello-store-"));
const chrome = spawn(process.env.CHROME ?? "chromium", ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

const target = (await (await fetch("http://127.0.0.1:9335/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let n = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) (waiting.get(d.id)(d), waiting.delete(d.id));
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++n; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const size = (w, h, scale, mobile = true) =>
  Promise.all([
    cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: scale, mobile }),
    cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }),
  ]);
const capture = async () => (await cdp("Page.captureScreenshot", { format: "png" })).result.data;

// First visit: the demo makes its boards. Keep that data (welcome guide and What's new seen).
await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await size(440, 956, 1);
await cdp("Page.navigate", { url: `${APP}/#/home` });
await sleep(2500);
await ev(`localStorage.clear(); location.reload();`).catch(() => {});
await sleep(2500);
const data = await ev(`const d = JSON.parse(localStorage.getItem("zomello-data")); d.settings.onboarded = true; d.settings.seenWhatsNew = "0.6"; return d;`);
const boardId = (title) => Object.values(data.boards).find((b) => b.title === title).id;
const cardId = (title) => Object.values(data.cards).find((c) => c.title === title).id;
const WEB = boardId("Website Launch");
const HOME = boardId("Home Projects");
const store = `const { useStore } = await import("/src/store.ts"); const st = useStore.getState();`;
const click = (sel, text) =>
  `[...document.querySelectorAll(${JSON.stringify(sel)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})?.click();`;
const pause = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;

async function screen(hash, prep = "") {
  await cdp("Page.navigate", { url: `${APP}/${hash}` });
  await sleep(600);
  await ev(`localStorage.setItem("zomello-data", ${JSON.stringify(JSON.stringify(data))}); location.reload();`).catch(() => {});
  await sleep(2200);
  // The demo's "Live demo" bar and toasts don't belong in a store picture.
  await ev(`const s = document.createElement("style"); s.textContent = ".demo-banner,.toast-stack,.toasts,.sidebar-fade{display:none!important}"; document.head.append(s);`);
  if (prep) {
    await ev(prep);
    await sleep(900);
  }
  return capture();
}

// The finished picture: headline and line of text on the gradient, the screen below in a rounded frame.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function framePage({ w, h, title, text, png, device }) {
  const phone = device === "iphone";
  const mac = device === "mac";
  const wide = mac || device === "duo"; // landscape pictures: less room above the screen
  const pad = phone ? 110 : 150;
  const frameW = wide ? w * 0.72 : w * 0.8;
  const radius = phone ? 96 : mac ? 30 : 56;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(120% 70% at 50% 0%,#24489c 0%,#152a63 45%,#0b1020 100%);font-family:Inter,"Noto Sans",sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center}
  .text{padding:${phone ? 150 : wide ? 80 : 130}px ${pad}px 0;text-align:center}
  h1{font-family:"Open Sans",Inter,sans-serif;font-weight:700;font-size:${phone ? 104 : device === "duo" ? 84 : 112}px;line-height:1.08;letter-spacing:-.02em;margin:0}
  h1 em{font-style:normal;color:#4fb0ec}
  p{font-size:${phone ? 50 : device === "duo" ? 40 : 52}px;line-height:1.35;color:#c9d3ea;margin:${phone ? 40 : wide ? 20 : 34}px auto 0;max-width:${phone ? 1080 : 1500}px}
  .frame{margin-top:${phone ? 96 : wide ? 56 : 90}px;width:${frameW}px;border-radius:${radius}px;padding:${phone ? 18 : mac ? 0 : 16}px;background:#05070c;
    box-shadow:0 0 0 3px #2a3550,0 60px 140px #00000080}
  .frame img{display:block;width:100%;border-radius:${radius - (phone ? 18 : mac ? 0 : 16)}px}
  </style></head><body><div class="text"><h1>${title}</h1><p>${esc(text)}</p></div>
  <div class="frame"><img src="data:image/png;base64,${png}"></div></body></html>`;
}

async function compose(file, opts) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: opts.w, height: opts.h, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await ev(`document.open(); document.write(${JSON.stringify(framePage(opts))}); document.close(); await document.fonts.ready; ${pause(300)}`);
  writeFileSync(file, Buffer.from(await capture(), "base64"));
  console.log("saved", file);
}

// Website Launch's "In progress" bucket gets a few rules first, so the dialog shows them in use.
const inProgress = Object.values(data.lists).find((l) => l.boardId === WEB && l.name === "In progress")?.id;
const openBucketRules = `${store} st.updateList(${JSON.stringify(inProgress)}, { autoProgress: "inProgress", arriveDueDays: 7, arriveMyDay: true, latePriority: "urgent" }); ${pause(300)}
  const buttons = [...document.querySelectorAll("[aria-label='Bucket menu']")];
  buttons[1]?.click(); ${pause(300)}
  [...document.querySelectorAll(".menu-item")].find((b) => b.textContent.startsWith("Bucket rules"))?.click();`;

// ---- iPhone 6.9": 440 × 956 points at 3x ----
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const iphone = [
  ["1-board", `#/board/${WEB}`, "", "Plan <em>anything</em>", "Boards, buckets and cards for work, home and everything in between."],
  ["2-my-day", "#/myday", "", "Your day, <em>at a glance</em>", "My Day shows what's late, due and planned for today."],
  ["3-card", `#/board/${WEB}`, `${store} st.openCard(${JSON.stringify(cardId("Homepage redesign"))});`, "Every detail, <em>one card</em>", "Dates, checklists, notes, files and reminders."],
  ["4-calendar", `#/board/${WEB}`, `${click(".view-tabs button", "Calendar")} ${pause(400)} ${click(".cal-views button", "Week")}`, "See your <em>week</em>", "Day, week and month views, with times."],
  ["5-home", "#/home", "", "Nothing <em>slips</em>", "Home gathers what's late, due today and coming up, from every board."],
  ["6-features", "#/settings", `${pause(300)} const f = document.querySelector("#set-features"); let el = f.parentElement; while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement; const box = el ?? document.scrollingElement; const top = box === document.scrollingElement ? 0 : box.getBoundingClientRect().top; const tabs = document.querySelector(".settings-nav")?.getBoundingClientRect().height ?? 90; box.scrollTop += f.getBoundingClientRect().top - top - tabs - 12;`, "As simple <em>as you like</em>", "Turn whole groups of features on or off. No account, no ads, and your boards stay on your device."],
];

// ---- iPad 13": 1032 × 1376 points at 2x ----
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const ipad = [
  ["1-board", `#/board/${WEB}`, "", "Plan <em>anything</em>", "Boards, buckets and cards for work, home and everything in between."],
  ["2-card", `#/board/${WEB}`, `${store} st.openCard(${JSON.stringify(cardId("Homepage redesign"))});`, "Every detail, <em>one card</em>", "Dates, checklists, notes, files and reminders."],
  ["3-calendar", `#/board/${WEB}`, `${click(".view-tabs button", "Calendar")} ${pause(400)} ${click(".cal-views button", "Week")}`, "See your <em>week</em>", "Day, week and month views, with times."],
  ["4-rules", `#/board/${WEB}`, openBucketRules, "Let buckets <em>do the busywork</em>", "Cards dropped in a bucket can get a date, label or checklist on their own."],
  ["5-home", "#/home", "", "Nothing <em>slips</em>", "Home gathers what's late, due today and coming up, from every board."],
];

// ---- Mac: a 1280 × 800 window at 2x ----
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const mac = [
  ["1-board", `#/board/${WEB}`, "", "Plan <em>anything</em>", "Boards, buckets and cards for work, home and everything in between."],
  ["2-card", `#/board/${WEB}`, `${store} st.openCard(${JSON.stringify(cardId("Homepage redesign"))});`, "Every detail, <em>one card</em>", "Dates, checklists, notes, files and reminders."],
  ["3-calendar", `#/board/${WEB}`, `${click(".view-tabs button", "Calendar")} ${pause(400)} ${click(".cal-views button", "Week")}`, "See your <em>week</em>", "Day, week and month views, with times."],
  ["4-rules", `#/board/${WEB}`, openBucketRules, "Let buckets <em>do the busywork</em>", "Cards dropped in a bucket can get a date, label or checklist on their own."],
  ["5-home", "#/home", "", "Nothing <em>slips</em>", "Home gathers what's late, due today and coming up, from every board."],
];

const only = process.env.ONLY; // e.g. ONLY=mac, or ONLY=ipad/4-rules to redo one picture
for (const [device, ua, list, sw, sh, scale, w, h] of [
  ["iphone", IPHONE_UA, iphone, 440, 956, 3, 1320, 2868],
  ["ipad", IPAD_UA, ipad, 1032, 1376, 2, 2064, 2752],
  ["mac", MAC_UA, mac, 1280, 800, 2, 2880, 1800],
  // iPhone Duo, open: 1017 × 699 points at 2x (the iPad layout fits it).
  ["duo", IPHONE_UA, ipad, 1017, 699, 2, 2034, 1398],
]) {
  if (only && !only.startsWith(`${device}/`) && only !== device) continue;
  mkdirSync(join(OUT, device), { recursive: true });
  for (const [name, hash, prep, title, text] of list) {
    if (only && only !== device && only !== `${device}/${name}`) continue;
    await cdp("Emulation.setUserAgentOverride", { userAgent: ua });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: device !== "mac", maxTouchPoints: 5 });
    await size(sw, sh, scale, device !== "mac");
    const png = await screen(hash, prep);
    await compose(join(OUT, device, `${name}.png`), { w, h, title, text, png, device });
  }
}

// ---- Product page header (3840 × 1646): the Mac and an iPhone on the gradient, no text (the App
// Store puts the name and icon over it, and crops the edges on smaller screens). ----
if (!only || only === "header") {
  await cdp("Emulation.setUserAgentOverride", { userAgent: MAC_UA });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await size(1440, 900, 2, false);
  const macPng = await screen(`#/board/${WEB}`);
  await cdp("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await size(440, 956, 3);
  const phonePng = await screen("#/myday");
  const [w, h] = [3840, 1646];
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(90% 120% at 50% 0%,#24489c 0%,#152a63 50%,#0b1020 100%);position:relative}
  .mac{position:absolute;left:50%;top:230px;width:2240px;transform:translateX(-58%);border-radius:28px;overflow:hidden;box-shadow:0 0 0 3px #2a3550,0 70px 160px #000000a0}
  .mac img,.phone img{display:block;width:100%}
  .phone{position:absolute;left:50%;top:420px;width:620px;transform:translateX(118%);border-radius:84px;padding:16px;background:#05070c;box-shadow:0 0 0 3px #2a3550,0 70px 160px #000000b0}
  .phone img{border-radius:68px}
  </style></head><body>
  <div class="mac"><img src="data:image/png;base64,${macPng}"></div>
  <div class="phone"><img src="data:image/png;base64,${phonePng}"></div></body></html>`;
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await ev(`document.open(); document.write(${JSON.stringify(html)}); document.close(); ${pause(400)}`);
  const file = join(OUT, "header-3840x1646.png");
  writeFileSync(file, Buffer.from(await capture(), "base64"));
  console.log("saved", file);
}

// ---- Search results picture (3840 × 2560): a headline and two iPhone screens. ----
if (!only || only === "search") {
  await cdp("Emulation.setUserAgentOverride", { userAgent: IPHONE_UA });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await size(440, 956, 3);
  const boardPng = await screen(`#/board/${WEB}`);
  const dayPng = await screen("#/myday");
  const [w, h] = [3840, 2560];
  const phone = (png, cls) => `<div class="phone ${cls}"><img src="data:image/png;base64,${png}"></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(100% 110% at 20% 0%,#24489c 0%,#152a63 50%,#0b1020 100%);position:relative;font-family:Inter,"Noto Sans",sans-serif;color:#fff}
  .text{position:absolute;left:260px;top:50%;transform:translateY(-50%);width:1500px}
  h1{font-family:"Open Sans",Inter,sans-serif;font-weight:700;font-size:200px;line-height:1.05;letter-spacing:-.025em;margin:0}
  h1 em{font-style:normal;color:#4fb0ec}
  p{font-size:84px;line-height:1.35;color:#c9d3ea;margin:70px 0 0}
  .phone{position:absolute;width:900px;border-radius:120px;padding:22px;background:#05070c;box-shadow:0 0 0 4px #2a3550,0 90px 200px #000000b0}
  .phone img{display:block;width:100%;border-radius:98px}
  .back{left:1980px;top:260px}
  .front{left:2700px;top:520px}
  </style></head><body>
  <div class="text"><h1>Plan anything.<br><em>Keep it yours.</em></h1><p>Boards, tasks and checklists on your own devices. No account, no ads.</p></div>
  ${phone(boardPng, "back")}${phone(dayPng, "front")}</body></html>`;
  await cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await ev(`document.open(); document.write(${JSON.stringify(html)}); document.close(); await document.fonts.ready; ${pause(400)}`);
  const file = join(OUT, "search-3840x2560.png");
  writeFileSync(file, Buffer.from(await capture(), "base64"));
  console.log("saved", file);
}

ws.close();
chrome.kill();
await sleep(800);
rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
