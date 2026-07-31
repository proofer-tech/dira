"use client";

/** `설정` 다이얼로그 — 두 셸(`/` · `/p/<project>`)이 헤더 **우측 끝**에 같이 갖는 앱 액션
 *  (DESIGN.md §0-4 자리 표 · §비주얼 §4). 라우트가 아니다.
 *
 *  섹션은 지금 **인증 하나**다. 그릇 이름이 `인증`이 아니라 `설정`인 이유는 자리가 두 셸 공통이
 *  됐기 때문이다 — 다음 항목이 올 때 자리를 또 옮기지 않는다(§0-4).
 *
 *  인증 층은 셋이다: ①상태 · ②`claude setup-token`을 GUI가 몬다 · ③직접 넣기.
 *  **③은 ②가 된 뒤에도 남는다** — 남의 TUI를 긁는 일이라 깨질 수 있고, 깨지면 여기가 바닥이다.
 *
 *  진입점 둘(헤더 버튼 · 프로젝트 셸 배너 CTA)은 **이 컴포넌트를 두 번 쓴다.** 전역 상태도
 *  URL 파라미터도 만들지 않는다 — 동시에 열릴 수 없고, 상태는 어느 쪽이든 서버가 준 같은
 *  props에서 온다(§0-4). 트리거를 JSX로 받지 않고 두 값 중 하나로 받는 이유는 배너가
 *  **서버 컴포넌트**라서다: 넘길 수 있는 것은 값이고, 모양은 두 가지뿐이다. */
import { useEffect, useState, useTransition } from "react";
import { Settings, TriangleAlert } from "lucide-react";
import {
  saveTokenAction,
  sendSetupCodeAction,
  startSetupAction,
  pollSetupAction,
  stopSetupAction,
} from "@/app/actions";
import type { SetupState } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 머신당 하나뿐인 Claude 장기 토큰의 자리와 저장 시각. 프로젝트마다 있지 않다(§0-4). */
export type AuthView = { path: string; savedAt: string | null };

export function SettingsDialog({
  auth,
  trigger = "icon",
}: {
  auth: AuthView;
  /** `icon` = 두 셸 헤더 우측 끝. `link` = 프로젝트 셸 인증 배너의 `인증하기`(§비주얼 §4-3). */
  trigger?: "icon" | "link";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ savedAt?: string; error?: string }>({});
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState("");
  // 저장 직후엔 서버 프롭이 아직 옛 값이다 — 방금 쓴 것이 이긴다(층 ②·③ 어느 쪽이든)
  const savedAt = setup?.savedAt ?? result.savedAt ?? auth.savedAt;

  // 진행 로그는 폴링으로 받는다 — 이 앱에 소켓은 없다(세션 스트림과 같은 방식).
  // 돌고 있을 때만 돈다: `running`이 꺼지면 effect가 정리되고 폴링이 멈춘다
  useEffect(() => {
    if (!setup?.running) return;
    const id = setInterval(async () => setSetup(await pollSetupAction()), 1000);
    return () => clearInterval(id);
  }, [setup?.running]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setToken("");
          setResult({});
          setCode("");
          setSetup(null);
          // 닫으면 죽인다 — 살아남은 `setup-token`은 pty를 물고 다음 시도를 막는다(§0-4)
          void stopSetupAction();
        }
      }}
    >
      {/* 인증이 필요하면 **이 버튼이** 말한다 — 배지를 따로 세우지 않는다(§0-4 · §비주얼 §4).
          그때만 아이콘 칸(size-9 정사각)을 풀어 글자를 들인다. 접근가능 이름은 두 경우 다 `설정`이다 */}
      <DialogTrigger
        render={
          trigger === "icon" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="설정"
              className={savedAt ? undefined : "w-auto gap-1 px-2"}
            >
              <Settings aria-hidden />
              {!savedAt && (
                <>
                  <TriangleAlert aria-hidden className="text-status-stale" />
                  <span className="text-sm">인증 필요</span>
                </>
              )}
            </Button>
          ) : (
            <button type="button" className="text-sm underline">
              인증하기
            </button>
          )
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
          <DialogDescription>
            이 컴퓨터의 dira 설정입니다. 등록된 프로젝트 전부에 적용됩니다.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">인증</h3>
          <p className="text-xs text-muted-foreground">
            워커가 Claude에 붙을 때 쓰는 장기 토큰입니다. 이 컴퓨터에 하나뿐입니다.
          </p>

          {/* ① 상태 — 한 줄. 배지를 세우지 않는다(§0-4) */}
          {savedAt ? (
            <p className="text-sm">
              인증됨 —{" "}
              <span className="font-mono text-xs break-all text-muted-foreground">{auth.path}</span>{" "}
              <span className="text-muted-foreground">· {savedAt} 저장</span>
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm">
              <TriangleAlert aria-hidden className="size-4 shrink-0 text-status-stale" />
              인증 안 됨 — 워커가 티켓을 물어가지 않습니다
            </p>
          )}
        </section>

        {/* ② 발급 — CLI에게 터미널을 대신 내어 준다 */}
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <Label>브라우저로 인증</Label>
            <Button
              variant="outline"
              size="sm"
              disabled={setup?.running}
              onClick={() => start(async () => setSetup(await startSetupAction()))}
            >
              {setup?.running ? "진행 중…" : setup ? "다시 시도" : "브라우저로 인증하기"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            claude setup-token을 대신 실행합니다. 새 탭에서 승인한 뒤 받은 코드를 여기에 붙여
            넣으면 토큰이 제자리에 저장됩니다.
          </p>

          {setup && setup.lines.length > 0 && (
            // 원문 그대로 흘리면 `Opening[12Gbrowser[20Gto`가 뜬다 — 서버가 escape를 걷어낸
            // 뒤 사람이 읽을 줄만 넘긴다(§0-4)
            <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2">
              {setup.lines.map((l, i) => (
                <p key={i} className="font-mono text-xs break-all text-muted-foreground">
                  {l}
                </p>
              ))}
            </div>
          )}

          {/* CLI가 코드를 기다린다(실측: `Paste code here if prompted`). 이 입력이 그 통로다 —
              프롬프트 문구로 감지하지 않는다: 남의 TUI 문구는 바뀌고, 안 쓰면 그만인 칸이다 */}
          {setup?.running && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  setSetup(await sendSetupCodeAction(code));
                  setCode("");
                });
              }}
            >
              <Input
                className="font-mono"
                placeholder="브라우저에서 받은 코드"
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={!code.trim()}>
                코드 보내기
              </Button>
            </form>
          )}

          {/* 조용히 실패하지 않는다 — 사유 원문 + 다음 행동(§비주얼 §6 에러 3요소).
              층 ③은 바로 아래 그대로 서 있다: 이 폴백이 제품의 바닥이다(§0-4 천장 항) */}
          {setup?.error && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>토큰을 받지 못했습니다</AlertTitle>
              <AlertDescription className="grid gap-1">
                <span>{setup.error}</span>
                {/* 원인 원문은 위 진행 로그가 이미 그대로 담고 있다 — 여기 문장을 `font-mono`로
                    쓰지 않는다(§비주얼 §3). 다음 행동은 `다시 시도`와 아래 층 ③ 둘이다 */}
                <span>&quot;직접 넣기&quot;에 이미 발급받은 토큰을 붙여 넣어도 됩니다.</span>
              </AlertDescription>
            </Alert>
          )}
          {setup?.savedAt && <p className="text-xs">토큰을 받아 저장했습니다.</p>}
        </div>

        {/* ③ 직접 넣기 */}
        <form
          className="space-y-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveTokenAction(token);
              setResult(r);
              if (r.savedAt) setToken("");
            });
          }}
        >
          <Label htmlFor="auth-token">토큰</Label>
          <div className="flex items-center gap-2">
            <Input
              id="auth-token"
              className="font-mono"
              placeholder="sk-ant-oat…"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setResult({});
              }}
            />
            <Button type="submit" disabled={pending}>
              {pending ? "저장 중…" : "저장"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            이미 발급받은 토큰이 있으면 여기에 붙여 넣습니다. 다시 저장하면 덮어씁니다.
          </p>
          {result.error && <p className="text-xs text-destructive">{result.error}</p>}
          {/* 삼키지 않는 것이 요건이지 미리 아는 것이 요건이 아니다 — 형식으로 거르지 않으므로
              "저장했다"까지만 말한다(§0-4) */}
          {result.savedAt && (
            <p className="text-xs">저장했습니다. 유효한지는 다음 디스패치에서 드러납니다.</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
