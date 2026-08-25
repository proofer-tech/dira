// 간이 CDP 클라이언트 — Runtime.evaluate/Page.navigate 두 개만 필요해서 새 의존성 없이 node WebSocket으로 짠다.
// ponytail: 일회용 QA 스크립트. apps/teams 밖(Next dev 워처가 안 보는 자리)에 둔다 — 안에 두면
// 편집마다 HMR 재컴파일이 걸려 요청이 느려진다(실측: 3.8분까지 벌어졌다). 티켓 검증 끝나면 지운다.
const [, , wsUrl, exprB64, navUrl] = process.argv;
const expr = exprB64 ? Buffer.from(exprB64, "base64").toString("utf8") : null;

const ws = new WebSocket(wsUrl);
let id = 1;
const pending = new Map();

function send(method, params) {
  const myId = id++;
  return new Promise((resolve) => {
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

ws.addEventListener("open", async () => {
  await send("Page.enable", {});
  await send("Runtime.enable", {});
  if (navUrl) {
    await send("Page.navigate", { url: navUrl });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const rs = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
      if (rs.result?.result?.value === "complete") break;
    }
  }
  const result = expr
    ? await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
    : { navigated: navUrl };
  console.log(JSON.stringify(result));
  ws.close();
  process.exit(0);
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

ws.addEventListener("error", (e) => {
  console.error("ws error", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 150000);
