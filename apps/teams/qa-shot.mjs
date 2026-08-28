// 일회성 QA 스크린샷 스크립트(ab91d4a5 검증용) — 새 의존성 없이 Node 내장 WebSocket으로 CDP를 몬다.
import fs from "node:fs";

const [, , targetUrl, outFile] = process.argv;
const wsUrl = await fetch("http://localhost:9331/json/new?" + encodeURIComponent(targetUrl), { method: "PUT" }).then((r) =>
  r.json(),
);

const ws = new WebSocket(wsUrl.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve) => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((resolve) => ws.addEventListener("open", resolve));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: targetUrl });
await new Promise((r) => setTimeout(r, 3000));

const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  const { result } = await send("Runtime.evaluate", { expression: "document.body.innerText.length" });
  if (result.value > 500) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 3000));

if (process.argv[5] === "--expand") {
  const dbg = await send("Runtime.evaluate", {
    expression: `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      const hits = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.children.length === 0 && n.textContent.includes("자세히 보기")) {
          hits.push(n.outerHTML.slice(0, 200));
        }
      }
      return JSON.stringify(hits);
    })()`,
  });
  console.log("candidates:", dbg.result.value);
  await send("Runtime.evaluate", {
    expression: `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.children.length === 0 && n.textContent.includes("자세히 보기")) {
          n.click();
          n.closest("button,a,[role='button']")?.click();
          return true;
        }
      }
      return false;
    })()`,
  });
  await new Promise((r) => setTimeout(r, 3000));
}

const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(outFile, Buffer.from(shot.data, "base64"));
const textRes = await send("Runtime.evaluate", { expression: "document.body.innerText" });
fs.writeFileSync(outFile + ".txt", textRes.result.value);
console.log("saved", outFile);
ws.close();
process.exit(0);
