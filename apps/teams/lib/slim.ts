/** 슬림 체크아웃 (DESIGN.md P519 결정 5, 6, 9). 판정은 엔진 `slim.py`가 하고 여기는 부르고 그리기만 한다.
 *  값은 큐 파일 `.dira/slim-checkout`(`on` 한 줄이면 켜짐)이다. */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { engineFile } from "./apm.ts";
import { childEnv } from "./child-env.ts";

export type SlimStatus = {
  enabled: boolean;
  eligible: boolean;
  state: "empty" | "full";
  last_active: string | null;
  reason: string | null;
};
export type SlimView = SlimStatus & { message?: string };
export type SlimRun = (cmd: "status" | "empty" | "fill", queueRoot: string) => Promise<{ rc: number; out: string }>;

export const slimFile = (queueRoot: string) => path.join(queueRoot, "slim-checkout");

export const runSlim: SlimRun = (cmd, queueRoot) =>
  new Promise((resolve) => {
    const py = engineFile("slim.py");
    if (!py) return resolve({ rc: 127, out: "slim.py not found" });
    execFile("python3", [py, cmd, queueRoot], { env: childEnv(), timeout: 120_000 }, (err, stdout) => {
      resolve({ rc: err ? (typeof err.code === "number" ? err.code : 2) : 0, out: stdout.toString().trim() });
    });
  });

const DEAD: SlimStatus = { enabled: false, eligible: false, state: "full", last_active: null, reason: null };

export async function readSlim(queueRoot: string, run: SlimRun = runSlim): Promise<SlimView> {
  const { rc, out } = await run("status", queueRoot);
  try {
    if (rc === 0) return { ...DEAD, ...(JSON.parse(out) as Partial<SlimStatus>) };
  } catch {}
  return { ...DEAD, message: out };
}

/** 켜면 파일에 `on`을 쓰고 `empty`, 끄면 `off`를 쓰고 `fill`. `empty`가 거절돼도(rc 2) 켜짐은 저장되고
 *  사유는 `message`로 돌려준다(결정 6). */
export async function setSlim(queueRoot: string, on: boolean, run: SlimRun = runSlim): Promise<SlimView> {
  await mkdir(queueRoot, { recursive: true });
  await writeFile(slimFile(queueRoot), on ? "on\n" : "off\n");
  const r = await run(on ? "empty" : "fill", queueRoot);
  const view = await readSlim(queueRoot, run);
  if (r.rc === 0) return view;
  let message = r.out;
  try {
    const j = JSON.parse(r.out) as { reason?: string };
    if (j.reason) message = j.reason;
  } catch {}
  return { ...view, message: message || `slim ${on ? "empty" : "fill"} rc ${r.rc}` };
}

export const slimOn = async (queueRoot: string) =>
  (await readFile(slimFile(queueRoot), "utf8").catch(() => "")).split("\n")[0].trim() === "on";

/** 사람이 이 큐에 말을 걸었다(홈 대화) - 슬림이 켜져 있으면 비운 체크아웃을 다시 채운다. 세션이 repo를
 *  cwd로 읽기 때문이다(tick.sh가 claim 뒤 `slim.py fill`을 부르는 것과 같은 판정). 채운 시각을
 *  `slim-checkout.active`에 남겨 `slim.py auto`가 대화 도중 다시 비우지 않게 한다. 실패는 대화를 막지 않는다. */
export async function wakeSlim(queueRoot: string, run: SlimRun = runSlim): Promise<void> {
  if (!(await slimOn(queueRoot))) return;
  await run("fill", queueRoot);
  await writeFile(path.join(queueRoot, "slim-checkout.active"), "").catch(() => {});
}
