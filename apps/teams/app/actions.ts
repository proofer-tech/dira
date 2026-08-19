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
  addToken,
  deleteToken,
  pollSetup,
  readAuth,
  readTokenRows,
  sendSetupCode,
  setActiveToken,
  setTokenEnabled,
  setTokenLabel,
  startSetup,
  stopSetup,
  type SetupState,
  type TokenRow,
} from "@/lib/auth";
import {
  readAnalytics,
  sessionIdentity,
  setAnalyticsEnabled,
  shellParams,
  track,
  type EventName,
  type Events,
} from "@/lib/analytics";
import type { FeedbackMeta } from "@/lib/feedback";
import { DEFAULT_KEYMAP, comboOf, validateBinding, type KeyLike } from "@/lib/keymap";
import { markResumeRead } from "@/lib/machine-state";
import {
  ProjectError,
  addProject,
  getProject,
  removeProject,
  renameProject,
  reorderProjects,
  resolveConfig,
  readKeymap,
  readProjects,
  writeKeymap,
  readLanguage,
  setLanguage,
  readMultiplay,
  setMultiplayEnabled,
  isMultiTokenAllowed,
  setMultitoken,
  type Project,
  type ProjectConfig,
} from "@/lib/projects";
import { t, type Locale } from "@/lib/i18n";
import { statusLabel } from "@/components/status-badge";
import {
  importFolderOf,
  listTickets,
  openFixTicket,
  openImportTickets,
  ONTOLOGY_MIGRATION_MARKER,
  statusOf,
  type Ticket,
} from "@/lib/queue";
import { preflight, scaffold } from "@/lib/scaffold";
import { cronRegisterCmd, listWorkers, markAlertsRead, registerCron } from "@/lib/workers";
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

/** 티켓으로 가는 줄 하나가 클라이언트 컴포넌트로 내려가는 모양(§비주얼 §56 ⑤ §티켓으로 가는
 *  줄). `Ticket` 전체가 아니라 이미 판정된 문자열만 준다 — `statusOf`·`fixesOf`는 `lib/queue.ts`
 *  runtime이라(`node:fs/promises` 의존) 클라이언트 번들에 못 들어간다(`ticket-ui.tsx` 등의
 *  선례는 전부 `import type`뿐이다). */
type MarkerTicketLine = { stem: string; hash: string; status: string };

export type ResolvedView = {
  project: { id: string; name: string; root: string; shortRoot: string };
  rows: ConfigRow[];
  /** 하나라도 워커 간 값이 갈렸는가 — 표 아래 Alert 한 줄의 근거. */
  hasConflict: boolean;
  /** 설정 다이얼로그의 `OntologyMigration` — 열려 있으면 버튼 대신 그 줄이 선다(§비주얼 §56
   *  ⑤). 다이얼로그가 첫 그림부터 판정된 값으로 그리게 이 해석 결과와 같이 나른다. */
  ontologyMigrationTicket: MarkerTicketLine | null;
  /** 설정 다이얼로그의 `OntologyImport` — 폴더당 한 장이라 목록이다(§비주얼 §56 ⑤). */
  ontologyImportTickets: (MarkerTicketLine & { folder: string })[];
};

export type RegisterState = {
  error?: { code: string; message: string; dup?: { id: string; name: string } };
  /** `URL 조각` 입력을 노출해야 하는가(슬러그가 비었거나 id가 겹쳤다). */
  needId?: boolean;
  done?: ResolvedView;
};

/** 해석 결과를 표로 옮긴다 (DESIGN.md §7 등록 직후 — 해석 결과 표). */
function toView(
  project: Project,
  config: ProjectConfig,
  workers: string[],
  ontologyMigrationTicket: Ticket | null,
  ontologyImportTickets: Ticket[],
): ResolvedView {
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
      : { key: "워커", value: "없음 — 이 프로젝트는 돌지 않습니다", mono: false, badges: [] },
  ];

  return {
    project: { ...project, shortRoot: short(project.root) },
    rows,
    hasConflict: rows.some((r) => r.byWorker),
    ontologyMigrationTicket: ontologyMigrationTicket
      ? {
          stem: ontologyMigrationTicket.stem,
          hash: ontologyMigrationTicket.hash,
          status: statusLabel(statusOf(ontologyMigrationTicket)),
        }
      : null,
    ontologyImportTickets: ontologyImportTickets.map((t) => ({
      stem: t.stem,
      hash: t.hash,
      status: statusLabel(statusOf(t)),
      folder: importFolderOf(t),
    })),
  };
}

async function viewOf(project: Project): Promise<ResolvedView> {
  const [config, workers] = await Promise.all([resolveConfig(project), listWorkers(project.root)]);
  const tickets = await listTickets(project.root, config);
  return toView(
    project,
    config,
    workers.map((w) => w.name),
    openFixTicket(tickets, ONTOLOGY_MIGRATION_MARKER),
    openImportTickets(tickets),
  );
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
    void track("project_add", { method: "register" }); // §0-11 — 성공 경로에서만 (이름·경로는 안 간다)
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
 *  스캐폴딩에서 멈추지 않고 crontab 등록까지 가는 것이 이 기능이다 — 등록 단위는 `cronLine`의
 *  **두 줄**(`* * * * *` + `* * * * * sleep 30;`)이라 만든 직후 30초 뒤에 디스패치가
 *  시작된다(§0-3 답변 1(c)).
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
    // 스캐폴딩만 되고 등록이 실패하면 여기 안 온다 — 프로젝트가 하나 는 것이 이 이벤트다(§0-11).
    void track("project_add", { method: "create" });
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

/** 인증 다이얼로그 층 ③ — 붙여 넣은 토큰을 제자리에 놓는다(DESIGN.md §0-4 · §0-13).
 *
 *  **유효성은 판정하지 않는다** — 접두사로 거르면 형식이 바뀔 때 멀쩡한 토큰을 GUI가 거부한다.
 *  실제 유효성은 워커가 돌아야 드러나고, 다이얼로그가 그렇게 말한다.
 *
 *  **덮어쓰기가 아니라 목록 append다 — 활성은 안 움직인다**(§0-13 §화면, P179). eligible한 활성이
 *  이미 있으면 그 자리에 머물고 이 토큰은 `대기`로 들어간다; eligible이 하나도 없을 때만(첫 토큰 등)
 *  이 토큰이 활성이 된다 — `addToken`이 `reconcileActive`로 그 계약을 지킨다. 지금 쓸 토큰을
 *  직접 고르는 손은 `setActiveTokenAction`(대기 행의 `사용` 버튼)이다.
 *  `label`은 선택이다(P180-1, §0-13 §라벨) — 형식은 검증하지 않는다. */
export async function saveTokenAction(
  raw: string,
  label?: string,
): Promise<{ savedAt?: string; error?: string }> {
  try {
    await addToken(raw, label);
  } catch (e) {
    return { error: (e as Error).message };
  }
  // 셸 배너(`p/[project]/layout.tsx`)가 이 판정으로 뜬다 — 레이아웃까지 무효화한다
  revalidatePath("/", "layout");
  return { savedAt: (await readAuth()).savedAt ?? undefined };
}

/** 인증 섹션 §0-13 §화면 — 목록 층. `AnalyticsSection`과 같은 이유로 프롭이 아니라 다이얼로그가
 *  열릴 때 읽는다(`readAnalyticsAction`의 그 주석과 같다 — 다이얼로그를 그리는 자리가 셋이라
 *  값 하나 때문에 레이아웃 둘·컴포넌트 둘의 프롭이 같이 늘어난다). */
export async function readTokenRowsAction(): Promise<TokenRow[]> {
  return readTokenRows(await readLanguage());
}

/** 행의 `활성화`/`비활성화` 버튼. `oauth-token` 쓰기는 이 액션이 하지 않는다 —
 *  `setTokenEnabled`(→`writeTokens`) 안에서만 일어난다(§0-13 §화면). */
export async function setTokenEnabledAction(id: string, enabled: boolean): Promise<TokenRow[]> {
  await setTokenEnabled(id, enabled);
  revalidatePath("/", "layout"); // 활성 토큰이 이 자리에서 바뀔 수 있다 — 배너·트리거 배지도 같이 본다
  return readTokenRows(await readLanguage());
}

/** `대기` 행의 `사용` 버튼 — 지금 쓸 토큰을 사람이 직접 고른다(§0-13 §화면 · P179). `oauth-token`
 *  쓰기는 `setActiveToken`(→`writeTokens`) 안에서만 일어난다.
 *  이름은 `use`로 시작하지 않는다 — React 훅으로 오인돼 `rules-of-hooks`가 걸린다(`f8327b9` 이후). */
export async function setActiveTokenAction(id: string): Promise<TokenRow[]> {
  await setActiveToken(id);
  revalidatePath("/", "layout"); // 활성 토큰이 이 자리에서 바뀐다 — 배너·트리거 배지도 같이 본다
  return readTokenRows(await readLanguage());
}

/** 행의 라벨 편집(P180-1, §0-13 §라벨). `oauth-token`은 안 건드린다 — `setTokenLabel`이
 *  `label`만 간다. */
export async function setTokenLabelAction(id: string, label: string): Promise<TokenRow[]> {
  await setTokenLabel(id, label);
  return readTokenRows(await readLanguage());
}

/** 행의 `삭제` 버튼. 마지막 하나를 지워도 막지 않는다(§0-13 §상태) — 화면은 그 결과(§0-10 ①)를
 *  그대로 보여줄 뿐이다. */
export async function deleteTokenAction(id: string): Promise<TokenRow[]> {
  await deleteToken(id);
  revalidatePath("/", "layout");
  return readTokenRows(await readLanguage());
}

/** 인증 다이얼로그 층 ② — `claude setup-token`을 GUI가 pty로 몬다(DESIGN.md §0-4).
 *
 *  **OAuth를 직접 구현하지 않는다.** 공식 CLI가 이미 그 일을 하고, 다시 짜면 문서화되지 않은
 *  엔드포인트에 제품이 묶인다. 여기 넷은 `lib/auth.ts`의 드라이버를 그대로 노출할 뿐이고,
 *  **저장은 층 ③과 같은 `addToken()`이 한다** — 저장 경로가 두 벌이 되지 않는다(§0-13 §화면).
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

/** 키설정 층 ② — 캡처 상자가 누른 키를 그대로 값으로 만든다(DESIGN.md §0-6).
 *
 *  **조합 문자열은 서버가 만든다.** 클라이언트가 조립해 보내면 이 액션이 받는 것이 임의
 *  문자열이 되고 그대로 `keymap.json`에 들어간다 — 받는 것은 `KeyboardEvent`의 필드 다섯이고
 *  값으로 바꾸는 것은 `comboOf` 하나다(신뢰 경계). `id`도 여기서 액션 표와 대조한다.
 *
 *  검증은 `validateBinding` 하나고 여기서 다시 쓰지 않는다 — 거절 문구도 거기 있다.
 *  `revalidatePath`가 아닌 이유는 §0-6에 있다: 바뀐 것은 큐가 아니라 머신 설정이라
 *  **부르는 쪽이 `router.refresh()`** 한다. */
export async function setBindingAction(
  id: string,
  e: KeyLike,
): Promise<{ combo?: string; error?: string }> {
  // 거절 문구는 사람이 읽는다 — 고른 언어로 나간다(§0-16 §장치). 파일은 여기서 읽고
  // `validateBinding`은 값만 받는다(그 파일은 클라이언트 번들로 가서 `node:*`를 못 쓴다).
  const locale = await readLanguage();
  const action = DEFAULT_KEYMAP.find((a) => a.id === id);
  if (!action) return { error: `${t(locale, "settings.keymap.reject.unknownAction")} ${id}` };
  const combo = comboOf(e);
  const { bindings } = await readKeymap();
  const bad = validateBinding(bindings, action.id, combo, locale);
  if (bad) return { error: bad.reason };
  await writeKeymap({ [action.id]: combo });
  return { combo };
}

/** 키설정 층 ③ — `되돌리기`(줄 하나) · `전부 기본값으로`(`id` 없음).
 *  기본값으로 쓰면 `writeKeymap`이 그 키를 파일에서 뺀다 — 전부 되돌리면 `{}`가 남는다(§0-6). */
export async function resetKeymapAction(id?: string): Promise<{ error?: string }> {
  const targets = id ? DEFAULT_KEYMAP.filter((a) => a.id === id) : DEFAULT_KEYMAP;
  if (targets.length === 0) {
    return { error: `${t(await readLanguage(), "settings.keymap.reject.unknownAction")} ${id}` };
  }
  await writeKeymap(Object.fromEntries(targets.map((a) => [a.id, a.combo])));
  return {};
}

/** 알림 ②의 `읽음으로 표시`(§0-10 §보관 = 읽음이다). 그 순간 나열된 실패 **전부**를
 *  보관한다 — 단위가 워커도 항목도 아니라 실패 하나고 키가 그 로그 파일명이다.
 *
 *  **루트는 클라이언트가 안 보낸다.** 등록된 `id`로 레지스트리에서 찾고, 없으면 아무것도 안
 *  쓴다(셸 레이아웃의 `notFound()`와 같은 규칙 — 등록된 root가 이 앱의 권한 범위다).
 *  `log`는 파일 경로가 아니라 `alerts.json`의 키로만 쓰인다(`lib/workers.ts`). `at`은 여기서
 *  안 쓴다 — 보관은 지금 살아 있는 값을 시각으로 덮어쓰는 것뿐이다.
 *
 *  **큐 파일은 한 바이트도 안 바뀐다** — 적히는 사실은 *큐가 나았다*가 아니라 *이 머신이 이
 *  실패를 봤다*이다(§0-5). 판정이 하나라 종 항목과 워커 화면(§4)의 사유 블록이 같이 걷힌다:
 *  그래서 무효화도 레이아웃까지다(`saveTokenAction`이 배너를 끄는 그 한 줄과 같다). */
export async function markFailuresReadAction(
  id: string,
  failures: { log: string; at: string }[],
): Promise<void> {
  const root = (await readProjects()).find((t) => t.id === id)?.root;
  if (!root) return;
  await markAlertsRead(root, failures);
  revalidatePath("/", "layout");
}

/** 알림 ⑥의 `읽음으로 표시`(§0-10 §보관 = 읽음이다). 화면이 그 순간 보인 이벤트의 `to`를
 *  보관한다 — 단위는 이벤트 하나(②처럼 프로젝트 루트를 넘기지 않는다. ⑥은 머신 하나의 상태라
 *  프로젝트 스코프가 아니다). `alerts.json`에 적힌다 — §0-14의 옛 `파일 0개`는 §0-10 §저장이
 *  뒤집었다(편지함은 판정의 창이 아니라 사건의 기록이다). */
export async function markResumeReadAction(toMs: number): Promise<void> {
  await markResumeRead(toMs);
  revalidatePath("/", "layout");
}

/** 설정 트리 다섯째 노드 `언어` (DESIGN.md §0-16 §설정 노드) — 고르는 즉시 반영된다.
 *  파일 하나에 머신 스코프로 쓴다(`setLanguage`, `readAnalytics`/`setAnalyticsEnabled`와 같은
 *  벌). 화면은 루트 레이아웃이 `readLanguage()`를 다시 읽도록 `router.refresh()`로 받는다 —
 *  재시작·새로고침을 요구하지 않는다. */
export async function setLanguageAction(locale: Locale): Promise<void> {
  await setLanguage(locale);
}

/** 설정 다이얼로그의 숨은 여섯째 노드 `멀티플레잉` (DESIGN.md §0-18 §스위치) — 다이얼로그가
 *  열릴 때 한 줄이 읽는다. `readAnalyticsAction`과 같은 이유로 프롭이 아니라 여기서 읽는다. */
export async function readMultiplayAction(): Promise<boolean> {
  return readMultiplay();
}

/** 스위치 버튼 하나 — 켜면 파일이 생기고 끄면 지워진다. 내용은 안 쓴다. */
export async function setMultiplayAction(enabled: boolean): Promise<boolean> {
  await setMultiplayEnabled(enabled);
  return readMultiplay();
}

/** 설정 다이얼로그의 숨은 여섯째 노드 `다중계정 허용` (DESIGN.md §0-18 §기본값이 된다) —
 *  다이얼로그가 열릴 때 한 줄이 읽는다. 파일 없음까지 `isMultiToken()`으로 흡수한 값이라
 *  화면은 항상 지금 배포물이 실제로 허용하는지만 본다. */
export async function readMultitokenAction(): Promise<boolean> {
  return isMultiTokenAllowed();
}

/** 스위치 버튼 하나 — 켜면 `1`, 끄면 `0`을 쓴다(§0-18 §판정 한 자리). */
export async function setMultitokenAction(enabled: boolean): Promise<boolean> {
  await setMultitoken(enabled);
  return isMultiTokenAllowed();
}

/** 사용 통계 섹션 층 ① (DESIGN.md §0-11 §끄는 자리) — 다이얼로그가 열릴 때 한 줄이 읽는다.
 *
 *  **프롭으로 안 내린다.** 이 다이얼로그를 그리는 자리가 셋이라(두 셸 헤더 · 인증 배너 CTA)
 *  값 하나 때문에 레이아웃 둘과 컴포넌트 둘의 프롭이 같이 는다. 열리는 순간의 파일 한 줄 읽기다. */
export async function readAnalyticsAction(): Promise<{ configured: boolean; enabled: boolean }> {
  return readAnalytics();
}

/** 사용 통계 섹션 층 ② — 끄기/켜기 버튼 하나.
 *
 *  **`analytics_off`는 끄기 직전에 나간다**(§0-11 이벤트 표). 순서가 뒤집히면 `track()`이
 *  방금 쓴 `enabled: false`를 읽고 그 마지막 한 건을 자기가 버린다 — 그래서 **여기서만**
 *  `await`한다(다른 트리거는 안 기다린다). 자격값이 없는 빌드에서는 즉시 돌아온다. */
export async function setAnalyticsAction(
  enabled: boolean,
): Promise<{ configured: boolean; enabled: boolean }> {
  if (!enabled) await track("analytics_off", {});
  await setAnalyticsEnabled(enabled);
  return readAnalytics();
}

/** 사용 통계 — **화면에서 GA로 나가는 유일한 길**(DESIGN.md §0-11 §어떻게 보내나).
 *  새 API 라우트를 만들지 않는다: `app/api/`는 Electron main이 쓰는 창구 하나뿐이다.
 *
 *  **`track()`을 await하지 않는다.** 전송이 늦어도(오프라인이면 5초 타임아웃까지 간다) 이 액션은
 *  즉시 끝나야 한다 — 클라이언트 라우터가 서버 액션 요청을 줄 세우므로 여기서 기다리면 뒤에 선
 *  진짜 동작이 그만큼 늦는다. `track()`은 던지지 않으므로 떠 있는 promise가 서버를 깨우지 않는다.
 *  **`analytics_off`만 예외로 바로 위 `setAnalyticsAction`이 직접 `await`한다** — 끄기 직전에
 *  나가야 하는 한 건이라 순서가 계약이다.
 *
 *  **서버 쪽 트리거는 이 액션을 안 거친다** — 그 자리들은 이미 서버라 `track()`을 직접 부른다
 *  (`registerProject`·`createProject`·`createWorkerAction`·`createTicket`·`answerRequirement`).
 *  여기를 지나는 것은 화면에서만 나는 둘이다: `screen_view` · `feedback_submit`(`b808993d`).
 *
 *  이름·파라미터는 `Events` 타입이 닫는다 — 표 밖의 이름은 컴파일이 거부한다(§0-11 표가 단일 출처). */
export async function trackEvent<N extends EventName>(name: N, params: Events[N]): Promise<void> {
  void track(name, params);
}

/** 의견 폼이 열릴 때 한 번 — 이슈에 같이 실릴 두 줄이다(DESIGN.md §0-12).
 *
 *  **통계를 껐어도 준다.** 여기는 GA로 나가는 전송이 아니라 사람이 자기 손으로 여는 공개
 *  이슈고, 폼이 이 값을 그대로 보여 준 뒤다(§0-12). `install_id`가 아직 없으면 이 조회가
 *  만든다 — `sessionIdentity()`의 계약 그대로다.
 *
 *  폼을 그릴 때 서버 컴포넌트에서 미리 내려보내지 않는 이유: 진입점이 메뉴 하나라
 *  (`252fd905`) 미리 내리면 **모든 화면**이 열지도 않을 다이얼로그를 위해 파일을 읽는다. */
export async function feedbackMetaAction(): Promise<FeedbackMeta> {
  const { app_version, shell } = shellParams();
  const { installId, sessionId } = await sessionIdentity();
  return { version: `${app_version} (${shell})`, session: `${installId}/${sessionId}` };
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
