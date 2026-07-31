"use server";

/** `/` 화면의 서버 액션 전부 — 프로젝트 레지스트리 + 인증 토큰(§0-4). 둘 다 머신 로컬
 *  디렉터리(`$TICKET_LOCAL`)에 살고 프로젝트 스코프가 아니라 여기 같이 있다.
 *  큐 파일은 **하나도 건드리지 않는다**(제약 7).
 *
 *  검증은 `lib/projects.ts`에 있고 여기서 다시 하지 않는다 — 실패 문구도 거기 있다. 이 파일이
 *  하는 일은 Error를 **직렬화 가능한 결과로 바꾸는 것**뿐이다(클라이언트로 Error는 못 넘어간다). */
import { homedir } from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import {
  normalizeToken,
  pollSetup,
  readAuth,
  saveToken,
  sendSetupCode,
  startSetup,
  stopSetup,
  type SetupState,
} from "@/lib/auth";
import {
  ProjectError,
  addProject,
  getProject,
  removeProject,
  renameProject,
  reorderProjects,
  resolveConfig,
  readProjects,
  type Project,
  type ProjectConfig,
} from "@/lib/projects";
import { preflight, scaffold } from "@/lib/scaffold";
import { cronRegisterCmd, listWorkers, registerCron } from "@/lib/workers";
import { tildePath } from "@/lib/urls";

/** 해석 결과 표 한 행. 서버가 배지까지 정해서 넘긴다 — 클라이언트는 그리기만 한다. */
export type ConfigRow = {
  key: string;
  value: string;
  mono: boolean;
  /** `기본값 가정` = 워커에 값이 없음, `해석 실패` = 값은 있는데 못 읽음(색+아이콘 있는 경고),
   *  `루트 밖` = 틀린 게 아니라 알아야 할 사실. */
  badges: ("기본값 가정" | "해석 실패" | "루트 밖")[];
  /** 워커 간 값이 갈렸을 때만. 그 행은 워커별로 나눠 적고 경고한다. */
  byWorker?: Record<string, string>;
  /** `작업 디렉터리` 행만. 워커별 나열이고 **경고가 아니다**(DESIGN.md §0-0 그 행 표기). */
  perWorker?: { worker: string; value: string }[];
  /** 해석 못 한 할당문 원문. 값 아래 한 줄씩 그린다 — 무엇을 못 읽었는지 그것만이 말해준다. */
  unresolved?: { worker: string; raw: string }[];
};

export type ResolvedView = {
  project: { id: string; name: string; root: string; shortRoot: string };
  rows: ConfigRow[];
  /** 하나라도 워커 간 값이 갈렸는가 — 표 아래 Alert 한 줄의 근거. */
  hasConflict: boolean;
};

export type RegisterState = {
  error?: { code: string; message: string; dup?: { id: string; name: string } };
  /** `URL 조각` 입력을 노출해야 하는가(슬러그가 비었거나 id가 겹쳤다). */
  needId?: boolean;
  done?: ResolvedView;
};

/** 해석 결과를 표로 옮긴다 (DESIGN.md §7 등록 직후 — 해석 결과 표). */
function toView(project: Project, config: ProjectConfig, workers: string[]): ResolvedView {
  const home = homedir();
  const short = (p: string) => tildePath(p, home);
  const outside = (p: string) => (p === project.root || p.startsWith(project.root + path.sep) ? [] : (["루트 밖"] as const));
  const conflictOf = (key: string) => config.conflicts.find((c) => c.key === key)?.byWorker;
  const assumed = (key: string) => (config.assumed.includes(key) ? (["기본값 가정"] as const) : []);
  // 해석 실패는 `기본값 가정`과 배타적이다(resolveConfig가 갈라 담는다) — 배지도 하나만 뜬다.
  const rawOf = (key: string) => {
    const bad = config.unresolved.filter((u) => u.key === key);
    return bad.length ? bad.map(({ worker, raw }) => ({ worker, raw })) : undefined;
  };
  const failed = (key: string) => (rawOf(key) ? (["해석 실패"] as const) : []);

  const rows: ConfigRow[] = [
    {
      key: "진행중 접미사",
      value: config.inProgress,
      mono: true,
      badges: [...assumed("inProgress"), ...failed("inProgress")],
      byWorker: conflictOf("inProgress"),
      unresolved: rawOf("inProgress"),
    },
    {
      key: "완료 접미사",
      value: config.done,
      mono: true,
      badges: [...assumed("done"), ...failed("done")],
      byWorker: conflictOf("done"),
      unresolved: rawOf("done"),
    },
    {
      key: "페르소나",
      value: short(config.personas),
      mono: true,
      badges: [...assumed("personas"), ...failed("personas"), ...outside(config.personas)],
      byWorker: conflictOf("personas"),
      unresolved: rawOf("personas"),
    },
    {
      key: "프로토콜",
      value: short(config.protocols),
      mono: true,
      badges: [...assumed("protocols"), ...failed("protocols"), ...outside(config.protocols)],
      byWorker: conflictOf("protocols"),
      unresolved: rawOf("protocols"),
    },
    {
      key: "작업 디렉터리",
      value: short(config.cwd),
      mono: true,
      badges: [...assumed("cwd"), ...failed("cwd")],
      unresolved: rawOf("cwd"),
      // 값이 갈려도 경고하지 않는다 — 워커마다 자기 워크트리를 쓰는 게 권장 구성이다.
      // 서로 다른 값이 하나면 경로 한 줄(워커명 없음), 둘 이상이면 워커별로 나열한다.
      perWorker:
        new Set(Object.values(config.cwdByWorker)).size > 1
          ? workers
              .filter((w) => w in config.cwdByWorker) // 순서는 `워커` 행과 같다
              .map((w) => ({ worker: w, value: short(config.cwdByWorker[w]) }))
          : undefined,
    },
    workers.length
      ? { key: "워커", value: `${workers.join(" ")} (${workers.length}개)`, mono: true, badges: [] }
      : { key: "워커", value: "없음 — 이 큐는 돌지 않습니다", mono: false, badges: [] },
  ];

  return {
    project: { ...project, shortRoot: short(project.root) },
    rows,
    hasConflict: rows.some((r) => r.byWorker),
  };
}

async function viewOf(project: Project): Promise<ResolvedView> {
  const [config, workers] = await Promise.all([resolveConfig(project), listWorkers(project.root)]);
  return toView(project, config, workers.map((w) => w.name));
}

function fail(e: unknown): RegisterState {
  if (e instanceof ProjectError) {
    return {
      error: {
        code: e.code,
        message: e.message,
        dup: e.dup ? { id: e.dup.id, name: e.dup.name } : undefined,
      },
      needId: e.code === "needId" || e.code === "dupId" || e.code === "badId",
    };
  }
  // 예상 못 한 실패는 원문을 그대로 보여준다. 삼키지 않는다(DESIGN.md §6 에러 3요소).
  return { error: { code: "unknown", message: (e as Error).message } };
}

export async function registerProject(
  _prev: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  const name = String(form.get("name") ?? "");
  const root = String(form.get("root") ?? "");
  const id = String(form.get("id") ?? "").trim();
  try {
    const project = await addProject(name, root, id || undefined);
    revalidatePath("/", "layout"); // 목록 + 모든 프로젝트 화면의 전환기
    return { done: await viewOf(project) };
  } catch (e) {
    return fail(e);
  }
}

// ── 새 프로젝트 생성 (DESIGN.md §0-3) ──────────────────────────────────────

export type CreateState = RegisterState & {
  /** `.dira`가 이미 있어서 **아무것도 만들지 않았다**(답변 4(b)). `queue`면 등록으로 보낸다. */
  exists?: { queue: boolean; root: string; message: string };
  /** 만든 것 — 해석 결과 표 위에 얹는 세 줄. `cron: false`면 파일은 다 있고 등록만 실패한 것이다. */
  created?: {
    root: string;
    repo: string;
    written: number;
    skipped: string[];
    cron: boolean;
    cronError?: string;
    registerCmd: string;
  };
};

/** 없는 큐를 만든다: `preflight` → `scaffold` → `registerCron(w1.sh)` → `addProject`.
 *  스캐폴딩에서 멈추지 않고 crontab 한 줄까지 가는 것이 이 기능이다 — 만든 직후 1분 뒤에
 *  디스패치가 시작된다(§0-3 답변 1(c)).
 *
 *  **어느 단계에서 실패해도 만든 파일을 되돌리지 않는다**(§0-3). 그 경로에 사람의 파일이 있을 수
 *  있고, `wx`로 덮지 않는 것이 이 기능의 유일한 방어다. crontab 등록 실패는 성공 보고를 막지
 *  않는다(§4 워커 생성과 같은 규약) — 사유와 등록 명령을 결과에 담고 사람이 셸에서 마무리한다. */
export async function createProject(
  name: string,
  projectDir: string,
  branch: string,
  specDoc: string,
  id?: string,
): Promise<CreateState> {
  let created: CreateState["created"] | undefined;
  try {
    if (!branch.trim()) {
      // 비면 push 절차가 자리표시자로 남아 세션이 추측한다(§0-3 자리표시자 표).
      return { error: { code: "branch", message: "통합 브랜치를 입력하세요." } };
    }
    const pre = await preflight(projectDir);
    if (!pre.ok) return { exists: { queue: pre.queue, root: pre.root, message: pre.message } };

    const made = await scaffold(projectDir, {
      branch: branch.trim(),
      specDoc: specDoc.trim() || undefined,
    });
    const workerPath = path.join(made.root, "workers", "w1.sh");
    const cronError = await registerCron(workerPath).then(
      () => undefined,
      (e: Error) => e.message,
    );
    created = {
      root: made.root,
      repo: made.repo,
      written: made.written.length,
      skipped: made.skipped,
      cron: !cronError,
      cronError,
      registerCmd: cronRegisterCmd({ path: workerPath }),
    };

    const project = await addProject(name, made.root, id?.trim() || undefined);
    revalidatePath("/", "layout");
    return { created, done: await viewOf(project) };
  } catch (e) {
    const state: CreateState = { ...fail(e), created };
    // 파일은 이미 놓였는데 레지스트리 등록만 실패한 경우(이름 없음·id 중복 …). 만든 것을 지우지
    // 않으므로 다음 행동은 "다시 만들기"가 아니라 "그 경로를 등록하기"다.
    if (created && state.error) {
      state.error.message += ` — .dira는 ${created.root}에 만들어졌습니다. 등록 카드에서 그 경로를 등록하세요.`;
    }
    return state;
  }
}

/** 이름 변경 · 순서 변경 · 등록 해제 — 결과는 성공 여부와 사유뿐이다. */
export type ActionResult = { ok: boolean; message?: string };

export async function renameProjectAction(id: string, name: string): Promise<ActionResult> {
  try {
    await renameProject(id, name);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 표시 순서 = 레지스트리 배열 순서. `↑`/`↓`는 이웃과 자리를 바꾼다. */
export async function moveProjectAction(id: string, dir: -1 | 1): Promise<ActionResult> {
  try {
    const ids = (await readProjects()).map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: false, message: "더 옮길 자리가 없습니다." };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderProjects(ids);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 레지스트리에서만 제거한다. 큐 파일은 손대지 않는다(제약 7). */
export async function unregisterProjectAction(id: string): Promise<ActionResult> {
  try {
    await removeProject(id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 인증 다이얼로그 층 ③ — 붙여 넣은 토큰을 제자리에 놓는다(DESIGN.md §0-4).
 *
 *  **유효성은 판정하지 않는다** — 접두사로 거르면 형식이 바뀔 때 멀쩡한 토큰을 GUI가 거부한다.
 *  실제 유효성은 워커가 돌아야 드러나고, 다이얼로그가 그렇게 말한다. */
export async function saveTokenAction(raw: string): Promise<{ savedAt?: string; error?: string }> {
  try {
    await saveToken(normalizeToken(raw));
  } catch (e) {
    return { error: (e as Error).message };
  }
  // 셸 배너(`p/[project]/layout.tsx`)가 이 판정으로 뜬다 — 레이아웃까지 무효화한다
  revalidatePath("/", "layout");
  return { savedAt: (await readAuth()).savedAt ?? undefined };
}

/** 인증 다이얼로그 층 ② — `claude setup-token`을 GUI가 pty로 몬다(DESIGN.md §0-4).
 *
 *  **OAuth를 직접 구현하지 않는다.** 공식 CLI가 이미 그 일을 하고, 다시 짜면 문서화되지 않은
 *  엔드포인트에 제품이 묶인다. 여기 넷은 `lib/auth.ts`의 드라이버를 그대로 노출할 뿐이고,
 *  **저장은 층 ③과 같은 `saveToken()`이 한다** — 저장 경로가 두 벌이 되지 않는다.
 *
 *  진행 상황은 폴링이다(§아키텍처 상태 갱신 — 이 앱에 소켓은 없다. 세션 스트림과 같은 방식). */
export async function startSetupAction(): Promise<SetupState> {
  return startSetup();
}

export async function pollSetupAction(): Promise<SetupState> {
  const s = pollSetup();
  // 토큰이 놓이면 `/`의 버튼 라벨과 프로젝트 셸의 배너가 같이 꺼진다. 클라이언트가 done을 보면
  // 폴링을 멈추므로 이 무효화는 사실상 한 번이다
  if (s.savedAt) revalidatePath("/", "layout");
  return s;
}

/** 승인 뒤 브라우저가 주는 코드를 CLI에 넣는다. **실측(2.1.220)에서 이 단계가 있다** —
 *  마지막 화면이 `Paste code here if prompted >`이고, 넣지 않으면 CLI가 거기서 멈춘다. */
export async function sendSetupCodeAction(code: string): Promise<SetupState> {
  return sendSetupCode(code);
}

/** 다이얼로그를 닫으면 부른다. **자식을 남기지 않는다** — 살아남은 `setup-token`은 pty를 물고
 *  사람의 다음 시도를 막는다(§0-4). */
export async function stopSetupAction(): Promise<void> {
  stopSetup();
}

/** 설정 다이얼로그의 `다시 읽기` — 워커 파일이 바뀌었을 수 있다. */
export async function resolveProjectAction(id: string): Promise<ResolvedView | { message: string }> {
  const project = await getProject(id);
  if (!project) return { message: `등록되지 않은 프로젝트입니다: ${id}` };
  try {
    return await viewOf(project);
  } catch (e) {
    return { message: (e as Error).message };
  }
}
