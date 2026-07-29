import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, executablePath:"/chromium-1194/chrome-linux/chrome"});
const p = await (await b.newContext()).newPage();
p.on("pageerror", e => console.log("[err]", e.message));
await p.goto("http://127.0.0.1:8788/capture", { waitUntil:"domcontentloaded"});
for (let i=0;i<40;i++){ const r = await p.evaluate(()=>window.__agcCapture?.isReady()); if(r) break; await p.waitForTimeout(200);}
await p.waitForTimeout(5000);
const dump = await p.evaluate(()=>{
  const l = window.__agcCapture.getLog();
  const c163 = l.allChannelEvents.filter(e=>e.channel===0o163).map(e=>({t:e.tickIndex, v:e.value.toString(8)}));
  const c10 = l.allChannelEvents.filter(e=>e.channel===0o10).slice(0,10).map(e=>({t:e.tickIndex, v:e.value.toString(8)}));
  const c11 = l.allChannelEvents.filter(e=>e.channel===0o11).map(e=>({t:e.tickIndex, v:e.value.toString(8)}));
  return { c163, c10, c11, ann: l.latestDecoded?.annunciators };
});
console.log(JSON.stringify(dump, null, 2));
await b.close();
