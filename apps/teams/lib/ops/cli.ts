/** 실행기(P559 결정 3). `node lib/ops/cli.ts list` | `call <name>`(stdin의 JSON이 인자).
 *  표준 출력은 항상 한 줄 JSON이고 종료 코드는 0이다 - 0이 아니면 실행기 자체가 죽은 것이다. */
import { OPS } from "./index.ts";

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

export async function execute(argv: string[], stdin: () => Promise<string>): Promise<Reply> {
  const [cmd, name] = argv;
  try {
    if (cmd === "list") {
      return {
        ok: true,
        result: Object.entries(OPS).map(([n, o]) => ({ name: n, description: o.description, inputSchema: o.inputSchema })),
      };
    }
    if (cmd === "call") {
      const op = name && Object.hasOwn(OPS, name) ? OPS[name] : undefined;
      if (!op) return { ok: false, error: `unknown op: ${name ?? ""}` };
      const raw = (await stdin()).trim();
      const input: unknown = raw ? JSON.parse(raw) : {};
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { ok: false, error: "input must be a JSON object" };
      }
      return { ok: true, result: await op.run(input as Record<string, unknown>) };
    }
    return { ok: false, error: "usage: cli.ts list | call <name>" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readStdin(): Promise<string> {
  let s = "";
  for await (const c of process.stdin) s += c;
  return s;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const reply = await execute(process.argv.slice(2), readStdin);
  process.stdout.write(JSON.stringify(reply) + "\n");
  process.exit(0); // 열린 핸들(분석 POST 등)이 있어도 끝낸다
}
