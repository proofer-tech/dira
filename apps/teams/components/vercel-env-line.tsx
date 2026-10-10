"use client";

/** 설정 환경변수 영역 머리의 Vercel 줄 (요구 6f610c77, DESIGN.md §Vercel 환경변수 연동 §화면).
 *  다섯 상태: 연결 안 됨 / 연결 중 / 연결됨 / 로그인 필요 / 오류 (+ 후보가 여럿일 때의 선택 목록).
 *  값을 그리는 곳이 없다. 토큰 입력란은 성공하거나 닫히거나 프로젝트가 바뀌면 비운다. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  vercelConnectAction,
  vercelDisconnectAction,
  vercelRedeployAction,
  vercelStatusAction,
  vercelSyncAction,
  vercelTokenAction,
} from "@/app/actions";
import { useT } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { vercelLineKey, type VercelMeta, type VercelView } from "@/lib/project-env";

export function VercelEnvLine({
  projectId,
  open,
  meta,
  onChanged,
}: {
  projectId: string;
  open: boolean;
  /** 목록 응답의 `vercel` 필드 - 마지막 동기화 시각과 배포 대기. */
  meta: VercelMeta | null;
  /** 연결-동기화-해제 뒤 목록을 새로 읽게 한다. */
  onChanged: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<VercelView | null>(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(projectId);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      const mine = projectId;
      setBusy(true);
      setNote(null);
      try {
        await fn();
      } finally {
        if (live.current === mine) setBusy(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    live.current = projectId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 프로젝트 전환과 닫힘에서 이전 상태와 토큰 입력을 버린다
    setView(null);
    setToken("");
    setNote(null);
    if (!open) return;
    const mine = projectId;
    void (async () => {
      const v = await vercelStatusAction(mine);
      if (live.current !== mine) return;
      setView(v);
      // 설정을 열 때 한 번 동기화한다 (DESIGN.md 동기화 규칙 3항). 연결 안 됨-로그인 필요면 부르지 않는다
      if (v.state !== "connected") return;
      setBusy(true);
      try {
        await syncNow(mine);
      } finally {
        if (live.current === mine) setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncNow는 projectId와 open이 바뀔 때만 다시 불러도 된다
  }, [projectId, open]);

  const syncNow = async (mine: string) => {
    const r = await vercelSyncAction(mine);
    if (live.current !== mine) return;
    if (!r.ok) {
      if (r.code === "login_required") setView({ state: "login_required" });
      else setNote(t("vercel.syncFailed"));
    }
    onChanged();
  };

  const connect = (pick?: string) =>
    run(async () => {
      const mine = projectId;
      const v = await vercelConnectAction(mine, pick);
      if (live.current !== mine) return;
      setView(v);
      if (v.state === "connected") {
        setToken("");
        await syncNow(mine); // 연결 직후 한 번 동기화한 뒤 목록을 다시 읽는다
      }
    });

  const sync = () => run(() => syncNow(projectId));

  const saveToken = () =>
    run(async () => {
      const r = await vercelTokenAction(projectId, token);
      if (!r.ok) {
        setToken("");
        setNote(t(`vercel.token.${r.code}`));
        return;
      }
      setToken("");
      await connect();
    });

  const key = vercelLineKey(view, busy);
  const connected = view?.state === "connected" ? view : null;

  return (
    <div data-setting="project.vercel" data-state={key} className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t("vercel.title")}</span>
        {key === "connecting" && <span className="text-muted-foreground">{t("vercel.connecting")}</span>}
        {key === "unlinked" && (
          <>
            <span className="text-muted-foreground">{t("vercel.unlinked")}</span>
            <Button size="sm" className="ml-auto" onClick={() => void connect()}>
              {t("vercel.connect")}
            </Button>
          </>
        )}
        {key === "connected" && connected && (
          <>
            <span className="font-mono">{connected.teamId ? `${connected.teamId}/` : ""}{connected.name}</span>
            <span className="text-xs text-muted-foreground">
              {meta?.lastSyncAt ? `${t("vercel.lastSync")} ${meta.lastSyncAt}` : t("vercel.neverSynced")}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void sync()}>
              {t("vercel.sync")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await vercelDisconnectAction(projectId);
                  setView({ state: "unlinked" });
                  onChanged();
                })
              }
            >
              {t("vercel.disconnect")}
            </Button>
          </>
        )}
        {key === "login" && <span className="text-muted-foreground">{t("vercel.loginRequired")}</span>}
        {key === "error" && view?.state === "error" && (
          <>
            <span role="alert" className="text-status-stale">
              {t(`vercel.err.${view.code}`)}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void connect()}>
              {t("vercel.retry")}
            </Button>
          </>
        )}
      </div>

      {key === "login" && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="new-password"
              aria-label={t("vercel.token.label")}
              placeholder={t("vercel.token.label")}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button size="sm" disabled={busy || !token} onClick={() => void saveToken()}>
              {t("vercel.token.save")}
            </Button>
          </div>
          <a
            className="text-xs text-muted-foreground underline"
            href="https://vercel.com/account/settings/tokens"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("vercel.token.link")}
          </a>
        </div>
      )}

      {key === "choose" && view?.state === "choose" && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {view.candidates.length ? t("vercel.choose") : t("vercel.noneLinked")}
          </p>
          <ul className="space-y-1">
            {view.candidates.map((c) => (
              <li key={c.projectId} className="flex items-center gap-2 text-sm">
                <span className="font-mono">{c.teamId ? `${c.teamId}/` : ""}{c.name}</span>
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void connect(c.projectId)}>
                  {t("vercel.pick")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {key === "connected" && meta?.deployPending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("vercel.nextDeploy")}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await vercelRedeployAction(projectId);
                if (!r.ok) setNote(t("vercel.redeployFailed"));
                onChanged();
              })
            }
          >
            {t("vercel.redeploy")}
          </Button>
        </div>
      )}
      {note && (
        <p role="alert" className="text-xs text-status-stale">
          {note}
        </p>
      )}
    </div>
  );
}
