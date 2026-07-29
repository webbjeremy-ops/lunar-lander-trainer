import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, executablePath:"/chromium-1194/chrome-linux/chrome"});
const p = await (await b.newContext()).newPage();
p.on("console", m => { if (m.type()==="error") console.log("[perr]", m.text()); });
p.on("pageerror", e => console.log("[err]", e.message));
await p.goto("http://127.0.0.1:8788/capture", { waitUntil:"domcontentloaded"});
for (let i=0;i<40;i++){ const r = await p.evaluate(()=>window.__agcCapture?.isReady()); if(r) break; await p.waitForTimeout(200);}
console.log("harness ready:", await p.evaluate(()=>window.__agcCapture?.isReady()));

for (let i=0;i<12;i++){
  await p.waitForTimeout(1000);
  const snap = await p.evaluate(async()=>{
    const c = window.__agcCapture;
    c.requestSnapshot();
    await new Promise(r=>setTimeout(r,80));
    const l = c.getLog();
    return {
      tick: l.latestTickIndex,
      steps: l.latestSnapshot?.totalAgcSteps,
      chAll: l.allChannelEvents.length,
      ch163: l.allChannelEvents.filter(e=>e.channel===0o163).length,
      ch10: l.allChannelEvents.filter(e=>e.channel===0o10).length,
      ch11: l.allChannelEvents.filter(e=>e.channel===0o11).length,
      ann: l.latestDecoded?.annunciators,
    };
  });
  console.log("t="+i+"s", JSON.stringify(snap));
}
try {
  const r = await p.evaluate(()=>window.__agcCapture.waitReady(5000));
  console.log("waitReady ok:", JSON.stringify(r));
} catch(e){ console.log("waitReady err:", e.message.slice(0,300));}
const readi = await p.evaluate(()=>window.__agcCapture.readiness());
console.log("readi snap:", JSON.stringify(readi));
await b.close();
