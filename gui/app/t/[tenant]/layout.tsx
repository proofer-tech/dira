/** 테넌트 스코프 셸 — 헤더·내비·전환기 (DESIGN.md §0-1 · 비주얼 디렉션 §4).
 *
 *  테넌트는 URL이 담는다. 모듈 전역에 "현재 테넌트"를 두지 않는다 — 서버 컴포넌트는 동시에
 *  여러 요청을 처리하므로 전역에 담으면 엉뚱한 큐에 쓰는 사고가 난다. */
import { homedir } from "node:os";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Unplug } from "lucide-react";
import { RefreshButton, TenantNav, TenantSwitcher } from "@/components/tenant-switcher";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { readSummary, readTenants } from "@/lib/tenants";
import { tildePath } from "@/lib/urls";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: id } = await params;
  const home = homedir();
  const tenants = await readTenants();
  // 등록 안 된 테넌트는 404다. 경로를 조립해 읽어보지 않는다 — 등록된 root가 이 앱의 권한 범위다.
  if (!tenants.some((t) => t.id === id)) notFound();

  // 전환기 항목의 카운트는 팔레트를 열 때 세지 않고 여기서 한 번에 센다(테넌트는 한 자릿수).
  const items = await Promise.all(
    tenants.map(async (t) => {
      const s = await readSummary(t);
      return {
        id: t.id,
        name: t.name,
        shortRoot: tildePath(t.root, home),
        open: s.open,
        running: s.workers.filter((w) => w.status === "running").length,
        connected: s.connected,
        error: s.error,
      };
    }),
  );
  const current = items.find((t) => t.id === id)!;

  return (
    <>
      <header className="sticky top-0 z-50 flex h-12 items-center gap-6 border-b bg-background px-6">
        <Link href="/" className="shrink-0 text-sm font-medium">
          fs-tickets
        </Link>
        <TenantNav id={id} />
        <TenantSwitcher tenants={items} currentId={id} />
      </header>

      <main className="w-full space-y-6 px-6 py-6">
        {current.connected ? (
          children
        ) : (
          // 경로가 없는 건 파괴가 아니라 부재다 — destructive를 쓰지 않는다(§8).
          <Alert className="max-w-3xl">
            <Unplug aria-hidden className="text-status-stale" />
            <AlertTitle>테넌트 &quot;{current.name}&quot;의 큐를 읽을 수 없습니다</AlertTitle>
            <AlertDescription className="grid gap-3">
              <span className="font-mono text-xs break-all">{current.error}</span>
              <span className="flex items-center gap-4">
                <RefreshButton />
                <Link href="/" className="text-sm underline">
                  테넌트 관리
                </Link>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </main>
    </>
  );
}
