"use client";

/** 테넌트 목록·등록 화면(`/`)의 클라이언트 조각 — 등록 폼 · 해석 결과 표 · 행 액션(설정 다이얼로그).
 *
 *  세 개가 한 파일에 있는 이유: 해석 결과 표를 등록 직후와 설정 다이얼로그가 **같은 표**로 쓴다
 *  (DESIGN.md §7). 파일을 쪼개면 두 자리가 갈린다. fs 접근은 전부 서버 액션 뒤에 있다. */
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Settings2, TriangleAlert, Unlink } from "lucide-react";
import {
  moveTenantAction,
  registerTenant,
  renameTenantAction,
  resolveTenantAction,
  unregisterTenantAction,
  type RegisterState,
  type ResolvedView,
} from "@/app/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { slugify } from "@/lib/urls";

/** 잘린 값·배지 설명을 붙인다. 트리거는 넘긴 요소 그대로 쓴다(base-ui `render`). */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

const BADGE_HINT: Record<string, string> = {
  "기본값 가정": "워커 파일에서 이 값을 찾지 못해 기본값을 씁니다",
  "루트 밖": "테넌트 루트 밖을 가리킵니다",
};

// ── 해석 결과 표 ────────────────────────────────────────────────────────────

export function ConfigTable({ view }: { view: ResolvedView }) {
  return (
    <div className="space-y-2">
      <Table>
        <TableBody>
          {view.rows.map((row) => (
            <TableRow key={row.key} className="h-9">
              <TableCell className="w-40 px-3 py-0 text-sm text-muted-foreground">
                {row.key}
              </TableCell>
              <TableCell className="px-3 py-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.perWorker ? (
                    // 워커별 나열. 경고가 아니라 사실이므로 색도 아이콘도 쓰지 않는다 —
                    // 한 워커만 엉뚱한 경로면 이 목록에서 그 줄이 튄다(DESIGN.md §0-0).
                    <div className="min-w-0 space-y-0.5">
                      {row.perWorker.map(({ worker, value }) => (
                        <div key={worker} className="flex gap-2 font-mono text-xs">
                          <span className="w-10 shrink-0 text-muted-foreground">{worker}</span>
                          {/* min-w-0 래퍼가 있어야 flex 항목이 줄어들고 truncate가 먹는다 */}
                          <div className="min-w-0">
                            <Hint text={value}>
                              <span className="block truncate">{value}</span>
                            </Hint>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : row.byWorker ? (
                    // 워커마다 다르면 값을 하나로 적을 수 없다 — 양쪽을 다 적고 경고한다.
                    <>
                      {Object.entries(row.byWorker).map(([w, v]) => (
                        <span key={w} className="font-mono text-xs">
                          {w}: {v}
                        </span>
                      ))}
                      <Badge
                        variant="outline"
                        className="text-status-stale bg-status-stale/10 border-status-stale/30"
                      >
                        <TriangleAlert aria-hidden className="size-3.5" />
                        워커마다 다름
                      </Badge>
                    </>
                  ) : (
                    <span className={row.mono ? "font-mono text-xs break-all" : "text-sm"}>
                      {row.value}
                    </span>
                  )}
                  {row.badges.map((b) => (
                    <Hint key={b} text={BADGE_HINT[b]}>
                      <Badge variant="outline">{b}</Badge>
                    </Hint>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {view.hasConflict && (
        <Alert>
          <TriangleAlert aria-hidden className="text-status-stale" />
          <AlertTitle>워커 간 설정이 다릅니다</AlertTitle>
          <AlertDescription>
            티켓이 어느 워커에 물리느냐에 따라 결과가 달라집니다.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── 등록 카드 ───────────────────────────────────────────────────────────────

export function RegisterCard() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerTenant, {});
  const [name, setName] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const slug = slugify(name);
  // 슬러그가 비면(한글 이름) 그때만 `URL 조각`을 받는다. 서버가 중복·형식으로 거부한 경우도 같다.
  const showId = (name.trim() !== "" && slug === "") || !!state.needId;
  const err = state.error;

  if (state.done && !dismissed) {
    const view = state.done;
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">
            등록됨 — {view.tenant.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">{view.tenant.shortRoot}</span>
          </h2>
          <div className="flex items-center gap-2">
            <Button size="sm" nativeButton={false} render={<Link href={`/t/${view.tenant.id}`} />}>
              보드 열기
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              닫기
            </Button>
          </div>
        </div>
        <ConfigTable view={view} />
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tenant-name">이름</Label>
          <Input
            id="tenant-name"
            name="name"
            placeholder="fs-tickets 자체"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {slug && (
            <p className="font-mono text-xs text-muted-foreground">URL: /t/{slug}</p>
          )}
          {err?.code === "name" && <p className="text-xs text-destructive">{err.message}</p>}
        </div>

        {showId && (
          <div className="space-y-2">
            <Label htmlFor="tenant-id">URL 조각</Label>
            <Input id="tenant-id" name="id" className="font-mono" placeholder="fs-tickets" />
            <p className="text-xs text-muted-foreground">
              {err && (err.code === "needId" || err.code === "badId" || err.code === "dupId")
                ? err.message
                : "이름에서 URL 조각을 만들 수 없습니다. 직접 정해 주세요 (영문 소문자·숫자·하이픈)."}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="tenant-root">경로</Label>
          <Input
            id="tenant-root"
            name="root"
            className="font-mono"
            placeholder="~/Projects/myproject/.fs-tickets"
          />
          <p className="text-xs text-muted-foreground">절대경로. ~는 확장됩니다</p>
        </div>

        {err && (err.code === "root" || err.code === "dupRoot" || err.code === "unknown") && (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertTitle>등록하지 못했습니다</AlertTitle>
            <AlertDescription>
              <span className="break-all">{err.message}</span>
              {err.dup && <Link href={`/t/${err.dup.id}`}>{err.dup.name} 열기</Link>}
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "등록 확인 중…" : "테넌트 등록"}
        </Button>
      </form>
    </Card>
  );
}

// ── 행 액션: 순서 변경 · 설정 다이얼로그 ────────────────────────────────────

export function TenantRowActions({
  id,
  name,
  shortRoot,
  first,
  last,
}: {
  id: string;
  name: string;
  shortRoot: string;
  first: boolean;
  last: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ResolvedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState(name);

  const load = () =>
    start(async () => {
      setError(null);
      const r = await resolveTenantAction(id);
      if ("rows" in r) setView(r);
      else setError(r.message);
    });

  const move = (dir: -1 | 1) =>
    start(async () => {
      const r = await moveTenantAction(id, dir);
      if (!r.ok) setError(r.message ?? "순서를 바꾸지 못했습니다.");
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <Hint text="위로">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 위로`}
          disabled={first || pending}
          onClick={() => move(-1)}
        >
          <ChevronUp aria-hidden />
        </Button>
      </Hint>
      <Hint text="아래로">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 아래로`}
          disabled={last || pending}
          onClick={() => move(1)}
        >
          <ChevronDown aria-hidden />
        </Button>
      </Hint>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setConfirming(false);
          if (o) load();
        }}
      >
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`${name} 설정`}>
              <Settings2 aria-hidden />
            </Button>
          }
        />
        <DialogContent className="sm:max-w-2xl">
          {confirming ? (
            <>
              <DialogHeader>
                <DialogTitle>테넌트 등록 해제</DialogTitle>
                <DialogDescription>
                  &quot;{name}&quot;을 목록에서 제거합니다. 이 프로젝트의 티켓은 삭제되지 않습니다 —
                  레지스트리에서만 빠집니다.
                </DialogDescription>
              </DialogHeader>
              <p className="font-mono text-xs break-all">{shortRoot}</p>
              <p className="text-sm text-muted-foreground">
                같은 경로로 다시 등록하면 그대로 돌아옵니다.
              </p>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" autoFocus />}>취소</DialogClose>
                <Button
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await unregisterTenantAction(id);
                      if (r.ok) setOpen(false);
                      else setError(r.message ?? "등록 해제에 실패했습니다.");
                    })
                  }
                >
                  등록 해제
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{name}</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">
                  {shortRoot}
                </DialogDescription>
              </DialogHeader>

              {error && (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>설정을 읽지 못했습니다</AlertTitle>
                  <AlertDescription>
                    <span className="font-mono text-xs break-all">{error}</span>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-medium">해석 결과</h3>
                <Button variant="outline" size="sm" disabled={pending} onClick={load}>
                  {pending ? "읽는 중…" : "다시 읽기"}
                </Button>
              </div>
              {view ? (
                <ConfigTable view={view} />
              ) : (
                <p className="text-sm text-muted-foreground">읽는 중…</p>
              )}

              <div className="space-y-2 border-t pt-4">
                <Label htmlFor={`rename-${id}`}>이름</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`rename-${id}`}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await renameTenantAction(id, newName);
                        if (r.ok) setOpen(false);
                        else setError(r.message ?? "이름을 바꾸지 못했습니다.");
                      })
                    }
                  >
                    저장
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  URL 조각 <span className="font-mono">{id}</span>는 바뀌지 않습니다 — 열어 둔 링크와
                  북마크가 깨집니다.
                </p>
              </div>

              <div className="border-t pt-4">
                {/* 빨강을 쓰지 않는다: 파일을 지우지 않고 다시 등록하면 돌아온다(§8). */}
                <Button variant="outline" onClick={() => setConfirming(true)}>
                  <Unlink aria-hidden />
                  등록 해제
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
