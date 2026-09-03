// 간단 CDP 러너: node cdp.mjs <port> <url> <js-expr-file>
const port = process.argv[2];
const url = process.argv[3];
const exprFile = process.argv[4];

const versionRes = await fetch(`http://127.0.0.1:${port}/json/new`, { method: "PUT" });
const target = await versionRes.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);

let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
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
await send("Runtime.enable");
await send("Page.navigate", { url });

async function waitLoaded(maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await send("Runtime.evaluate", { expression: "document.readyState" });
    if (r?.result?.value === "complete") return true;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return false;
}
await waitLoaded(15000);
await new Promise((r) => setTimeout(r, 1000));

const fs = await import("node:fs");
const expr = fs.readFileSync(exprFile, "utf8");
const result = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(JSON.stringify(result?.result?.value ?? result, null, 2));

await send("Target.closeTarget", { targetId: target.id });
process.exit(0);
