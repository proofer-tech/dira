"use server";

/** 테넌트 레지스트리를 바꾸는 서버 액션 전부. 큐 파일은 **하나도 건드리지 않는다**(제약 7).
 *
 *  검증은 `lib/tenants.ts`에 있고 여기서 다시 하지 않는다 — 실패 문구도 거기 있다. 이 파일이
 *  하는 일은 Error를 **직렬화 가능한 결과로 바꾸는 것**뿐이다(클라이언트로 Error는 못 넘어간다). */
import { homedir } from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import {
  TenantError,
  addTenant,
  getTenant,
  removeTenant,
  renameTenant,
  reorderTenants,
  resolveConfig,
  readTenants,
  type Tenant,
  type TenantConfig,
} from "@/lib/tenants";
import { listWorkers } from "@/lib/workers";
import { tildePath } from "@/lib/urls";

/** 해석 결과 표 한 행. 서버가 배지까지 정해서 넘긴다 — 클라이언트는 그리기만 한다. */
export type ConfigRow = {
  key: string;
  value: string;
  mono: boolean;
  /** `기본값 가정` = 워커에서 못 읽음, `루트 밖` = 틀린 게 아니라 알아야 할 사실. */
  badges: ("기본값 가정" | "루트 밖")[];
  /** 워커 간 값이 갈렸을 때만. 그 행은 워커별로 나눠 적고 경고한다. */
  byWorker?: Record<string, string>;
};

export type ResolvedView = {
  tenant: { id: string; name: string; root: string; shortRoot: string };
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
function toView(tenant: Tenant, config: TenantConfig, workers: string[]): ResolvedView {
  const home = homedir();
  const short = (p: string) => tildePath(p, home);
  const outside = (p: string) => (p === tenant.root || p.startsWith(tenant.root + path.sep) ? [] : (["루트 밖"] as const));
  const conflictOf = (key: string) => config.conflicts.find((c) => c.key === key)?.byWorker;
  const assumed = (key: string) => (config.assumed.includes(key) ? (["기본값 가정"] as const) : []);

  const rows: ConfigRow[] = [
    {
      key: "진행중 접미사",
      value: config.inProgress,
      mono: true,
      badges: [...assumed("inProgress")],
      byWorker: conflictOf("inProgress"),
    },
    {
      key: "완료 접미사",
      value: config.done,
      mono: true,
      badges: [...assumed("done")],
      byWorker: conflictOf("done"),
    },
    {
      key: "페르소나",
      value: short(config.personas),
      mono: true,
      badges: [...assumed("personas"), ...outside(config.personas)],
      byWorker: conflictOf("personas"),
    },
    {
      key: "프로토콜",
      value: short(config.protocols),
      mono: true,
      badges: [...assumed("protocols"), ...outside(config.protocols)],
      byWorker: conflictOf("protocols"),
    },
    {
      // ponytail: 워커별 나열은 edc5e1a7이 넣는다(TICKET_CWD는 갈리는 게 정상 — 경고 아님).
      key: "작업 디렉터리",
      value: short(config.cwd),
      mono: true,
      badges: [...assumed("cwd")],
      byWorker: conflictOf("cwd"),
    },
    workers.length
      ? { key: "워커", value: `${workers.join(" ")} (${workers.length}개)`, mono: true, badges: [] }
      : { key: "워커", value: "없음 — 이 큐는 돌지 않습니다", mono: false, badges: [] },
  ];

  return {
    tenant: { ...tenant, shortRoot: short(tenant.root) },
    rows,
    hasConflict: rows.some((r) => r.byWorker),
  };
}

async function viewOf(tenant: Tenant): Promise<ResolvedView> {
  const [config, workers] = await Promise.all([resolveConfig(tenant), listWorkers(tenant.root)]);
  return toView(tenant, config, workers.map((w) => w.name));
}

function fail(e: unknown): RegisterState {
  if (e instanceof TenantError) {
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

export async function registerTenant(
  _prev: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  const name = String(form.get("name") ?? "");
  const root = String(form.get("root") ?? "");
  const id = String(form.get("id") ?? "").trim();
  try {
    const tenant = await addTenant(name, root, id || undefined);
    revalidatePath("/", "layout"); // 목록 + 모든 테넌트 화면의 전환기
    return { done: await viewOf(tenant) };
  } catch (e) {
    return fail(e);
  }
}

/** 이름 변경 · 순서 변경 · 등록 해제 — 결과는 성공 여부와 사유뿐이다. */
export type ActionResult = { ok: boolean; message?: string };

export async function renameTenantAction(id: string, name: string): Promise<ActionResult> {
  try {
    await renameTenant(id, name);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 표시 순서 = 레지스트리 배열 순서. `↑`/`↓`는 이웃과 자리를 바꾼다. */
export async function moveTenantAction(id: string, dir: -1 | 1): Promise<ActionResult> {
  try {
    const ids = (await readTenants()).map((t) => t.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: false, message: "더 옮길 자리가 없습니다." };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorderTenants(ids);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 레지스트리에서만 제거한다. 큐 파일은 손대지 않는다(제약 7). */
export async function unregisterTenantAction(id: string): Promise<ActionResult> {
  try {
    await removeTenant(id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 설정 다이얼로그의 `다시 읽기` — 워커 파일이 바뀌었을 수 있다. */
export async function resolveTenantAction(id: string): Promise<ResolvedView | { message: string }> {
  const tenant = await getTenant(id);
  if (!tenant) return { message: `등록되지 않은 테넌트입니다: ${id}` };
  try {
    return await viewOf(tenant);
  } catch (e) {
    return { message: (e as Error).message };
  }
}
