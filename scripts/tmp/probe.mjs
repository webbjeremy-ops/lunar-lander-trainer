import { chromium } from "playwright";
const b = await chromium.launch({ headless:true, executablePath:"/chromium-1194/chrome-linux/chrome"});
const p = await (await b.newContext()).newPage();
p.on("console", m => console.log("[page]", m.type(), m.text()));
p.on("pageerror", e => console.log("[err]", e.message));
await p.goto("http://127.0.0.1:8788/capture", { waitUntil:"domcontentloaded"});
for (let i=0;i<40;i++){ const r = await p.evaluate(()=>window.__agcCapture?.isReady()); if(r) break; await p.waitForTimeout(200);}
console.log("READY:", await p.evaluate(()=>window.__agcCapture?.getReady()));
await p.evaluate(async()=>{ const c=window.__agcCapture; const b=await new Promise((res,rej)=>{ /* touch requestEventBoundary via waitReady internals */ }); });
// Poll: request boundary and inspect shadow
for (let i=0;i<10;i++){
  await p.waitForTimeout(1000);
  const snap = await p.evaluate(async()=>{
    // Force snapshot pulling
    const c = window.__agcCapture;
    c.requestSnapshot();
    await new Promise(r=>setTimeout(r,50));
    return { r: c.readiness(), tick: c.getLog().latestTickIndex, chEv: c.getLog().allChannelEvents.length };
  });
  console.log("t="+i+"s", JSON.stringify(snap));
}
// Now trigger waitReady with short timeout to see final blocking
try {
  const r = await p.evaluate(()=>window.__agcCapture.waitReady(3000));
  console.log("waitReady ok:", JSON.stringify(r));
} catch(e){ console.log("waitReady err:", e.message);}
const finalDec = await p.evaluate(()=>{
  const l = window.__agcCapture.getLog();
  return { latestDecoded: l.latestDecoded, allChEvents: l.allChannelEvents.length, ch163: l.allChannelEvents.filter(e=>e.channel===0o163).length, ch10: l.allChannelEvents.filter(e=>e.channel===0o10).length, ch11: l.allChannelEvents.filter(e=>e.channel===0o11).length };
});
console.log("final:", JSON.stringify({ann:finalDec.latestDecoded?.annunciators, chC: {all:finalDec.allChEvents, ch163:finalDec.ch163, ch10:finalDec.ch10, ch11:finalDec.ch11}}));
await b.close();
