/** Claude 장기 토큰 — 상태 읽기 · 저장 (DESIGN.md §0-4).
 *
 *  **엔진은 한 줄도 안 고친다**(제약 1). 여기가 하는 일은 `tick.sh:52-54`가 이미 정한 계약을
 *  따라 쓰는 것뿐이다 — 경로 `$TICKET_LOCAL/oauth-token`, 내용은 **개행 없는 한 줄**, 권한 `0600`.
 *  `.authwarn`은 건드리지 않는다: 엔진이 "이미 한 번 경고했다"를 적어 두는 자기 파일이고,
 *  토큰이 생기면 61행 조건이 먼저 꺼져 다시 보지 않는다(§0-4). */
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { registryPath } from "./projects.ts";

/** 레지스트리와 **같은 디렉터리**다(엔진의 `$LOCAL`). 규칙을 두 벌로 적지 않으려고
 *  `registryPath()`에서 파생시킨다 — `TICKET_LOCAL` 존중도 거기 한 곳에만 있다. */
export function tokenPath(): string {
  return path.join(path.dirname(registryPath()), "oauth-token");
}

export type AuthStatus = {
  path: string;
  /** 파일이 없으면 `null`. 있으면 mtime을 CLI `list`와 같은 표기로.
   *  **유효한지는 판정하지 않는다** — 다음 디스패치에서 드러난다(§0-4). */
  savedAt: string | null;
};

export async function readAuth(): Promise<AuthStatus> {
  const p = tokenPath();
  const s = await stat(p).catch(() => null);
  return { path: p, savedAt: s?.isFile() ? when(s.mtime) : null };
}

/** 붙여 넣은 값을 저장할 형태로 만든다. 못 쓰면 사유를 던진다.
 *
 *  **검증은 "비어 있지 않다 · 공백과 개행이 없다"까지다.** 접두사(`sk-ant-oat…`)로 거르지
 *  않는다 — 그 형식은 우리 것이 아니고 바뀌면 멀쩡한 토큰을 GUI가 거부한다(§0-4).
 *  바깥 공백은 떨어낸다: 복사하면 줄바꿈이 딸려 오고 엔진도 `tr -d '\r\n'`으로 지운다. */
export function normalizeToken(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("토큰이 비어 있습니다.");
  if (/\s/.test(t)) throw new Error("토큰 안에 공백·줄바꿈이 있습니다. 한 줄만 붙여 넣어 주세요.");
  return t;
}

/** 덮어쓴다 — 토큰은 하나뿐이라 이력을 남길 자리가 없다(§0-4 재발급 항).
 *  `writeFile`의 `mode`는 **새로 만들 때만** 먹는다. 재발급이 기존 파일에 쓰면 그때 권한이
 *  안 바뀌므로 `chmod`를 따로 부른다 — 0600은 이 파일의 요건이다. */
export async function saveToken(token: string): Promise<void> {
  const p = tokenPath();
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, token, { mode: 0o600 });
  await chmod(p, 0o600);
}

/** CLI `list`와 같은 표기(`%Y-%m-%d %H:%M`). 서버에서 만든다 — 로컬 도구라 서버와 브라우저가
 *  같은 타임존이고, 클라이언트에서 포맷하면 하이드레이션만 시끄러워진다. */
function when(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
