/** op 공용 입력 조각과 프로젝트 고르기. `index.ts`와 무리 파일이 같이 쓰므로 순환 import를 피하려고 따로 둔다. */
import { realpathSync } from "node:fs";
import { DEFAULT_LOCALE, type Locale } from "../i18n.ts";
import { readLanguage, readProjects, type Project } from "../projects.ts";

/** 프로젝트를 고르는 op의 공용 입력 조각. */
export const PROJECT_PICK = {
  id: { type: "string", description: "registry id of the project" },
  root: { type: "string", description: "queue root (.dira) of the project; defaults to $TICKET_ROOT" },
} as const;

/** 프로젝트 고르기(결정 2): `id` | `root` | `TICKET_ROOT`. 등록되지 않은 큐는 오류다. */
export async function pickProject(input: Record<string, unknown>): Promise<Project> {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const root = typeof input.root === "string" ? input.root.trim() : "";
  const projects = await readProjects();
  if (id) {
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error(`no registered project with id: ${id}`);
    return p;
  }
  const want = root || process.env.TICKET_ROOT || "";
  if (!want) throw new Error("id, root or TICKET_ROOT is required");
  const norm = (s: string) => s.normalize("NFC").replace(/\/+$/, "");
  // 레지스트리는 realpath로 등록되므로 /tmp 같은 심볼릭 링크 별칭도 같은 큐로 본다(파이썬 도구와 같다).
  const real = (s: string) => {
    try {
      return norm(realpathSync(s));
    } catch {
      return norm(s);
    }
  };
  const p =
    projects.find((x) => norm(x.root) === norm(want)) ?? projects.find((x) => real(x.root) === real(want));
  if (!p) throw new Error(`queue is not registered: ${want}`);
  return p;
}

/** 언어는 `language.json`을 읽는다(`readLanguage`와 같다). */
export async function opLocale(): Promise<Locale> {
  return readLanguage().catch(() => DEFAULT_LOCALE);
}
