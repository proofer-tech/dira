"use client";

/** 홈 `browser` 탭 하나가 그리는 실제 화면 (DESIGN.md §11-11 결정 2 · 6). `cdp/[hash]` GET을
 *  읽어 프레임을 `<img>`에 그리고(선례는 `terminal-panel.tsx`의 pty 스트림 배선), 그 위에
 *  **랩 레이어 세 상태**(막힘 - 경고 - 걷힘)를 얹는다 — 사람이 그린 그림 그대로다(결정 6).
 *
 *  **마운트할 때마다 막힘이다** — 걷힌 상태를 어디에도 안 남긴다(결정 6 §저장하지 않는다).
 *  탭을 닫으면(부모가 이 컴포넌트를 언마운트한다) 다음에 열 때 새 인스턴스가 다시 막힘으로
 *  시작한다. `TerminalSurface`처럼 탭을 오가는 동안(표면 전환)은 `hidden`으로만 접히므로
 *  그 사이에는 걷힌 상태가 유지된다 — 결정 6이 요구하는 것은 새로고침·탭 닫기 재시작 둘뿐이다. */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocale, useT } from "@/components/language-provider";
import { LINK_SLOT_HASH, LINK_TAB_EVENT, normalizeAddressInput, readCdpFrameStream } from "@/lib/cdp-relay";
import { keyBody, mouseButtonBody, scaleToFrame, wheelBody, type KeyCdpBody, type MouseCdpBody } from "@/lib/browser-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrackedRouter } from "@/lib/route-pending";
import { writeStoredActiveTab } from "@/lib/tabs";
import {
  openBrowserTabAction,
  openLinkAction,
  releaseLinkAction,
  type BrowserPoolRow,
} from "@/app/(app)/p/[project]/home/actions";
import { linkCapToastMessage, linkErrorToastMessage, wrap, type Locale } from "@/lib/i18n";
import type { HomeChunk } from "@/lib/home-session";

function postInput(url: string, body: MouseCdpBody | KeyCdpBody): void {
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}

function postNavigate(url: string, addr: string): void {
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "navigate", url: addr }),
  }).catch(() => {});
}

/** 슬롯 하나의 주인 이름(§11-13 결정 3 §주인 이름을 만드는 표) — `worker:` 값은 서버
 *  (`browserPoolTickets`)가 이미 `<페르소나> - <제목>`으로 조립해 내려서 그대로 쓰고,
 *  `home` - `external`은 여기서 i18n으로 옮긴다. `owner`가 없는 옛 슬롯은 `null`이다 —
 *  추정으로 메우지 않는다(결정 1 마지막 줄과 같은 경계). */
export function browserOwnerLabel(row: BrowserPoolRow, t: (key: string) => string): string | null {
  // 해시가 `c0ffee00`인 줄만 이름을 `링크`로 옮긴다(§11-15 결정 1 §좌측 브라우저 패널은
  // 이 줄을 해시로 가른다) — `owner` 토큰(`home`)은 안 바뀌고 표시 이름만 특례다.
  if (row.hash === LINK_SLOT_HASH) return t("home.surface.browser.owner.link");
  if (row.ownerKind === "worker") return row.ownerName;
  if (row.ownerKind === "home") return t("home.surface.browser.owner.home");
  if (row.ownerKind === "external") return t("home.surface.browser.owner.external");
  return null;
}

/** 링크 클릭 하나가 `openLink` 안에서 쏘는 창 알림의 짐(§P449 결정 1) - `HomeUI`가 이 모양으로
 *  받아 `projectId`가 자기 것일 때만 `chunk`를 반영한다. */
export type LinkTabEventDetail = { projectId: string; chunk: HomeChunk };

/** 앱 안 링크를 링크 슬롯(`c0ffee00`)에서 연다(§11-15 결정 1 · 4, §P438 결정 2, §P449 결정 1) —
 *  P430-3의 클릭 리스너·터미널 링크 제공자·피드백 링크가 부를 이름 하나다. 서버 액션
 *  (`openLinkAction`)이 상한을 재고, 막혔으면 토스트 한 줄로 알린다(결정 4 §알리는 자리는 토스트
 *  한 줄이다). 셸이 그 밖의 이유로 실패했을 때도 말없이 끝내지 않고 같은 자리에 원인 문구가
 *  실린 토스트를 띄운다(§P438 결정 2). 셸이 실제로 열렸을 때만(`ok: true`) 이어간다 — 막혔거나
 *  실패했으면 지금 화면에 그대로 머문다(보여 줄 것이 없는 탭으로 옮길 이유가 없다).
 *
 *  **탭을 먼저 등록한다**(§P449 결정 1) — `TicketBrowserSection`의 `openInHomeTab`과 같은
 *  순서(등록 - 저장 - 이동)로 `openBrowserTabAction`을 불러 `home-sessions.json`에 `c0ffee00`이
 *  없어도 생기게 한다(이미 있으면 그대로 둔다). **홈이 이미 떠 있으면 같은 경로로 `navigate`해도
 *  다시 마운트되지 않아 저장소를 안 읽는다** — 그래서 등록 결과(`HomeChunk`)를 실어 창
 *  `CustomEvent`(`LINK_TAB_EVENT`)를 하나 쏜다. 마운트된 `HomeUI`만 듣고, 다른 화면에서 누른
 *  경우는 아무도 안 들어 `navigate`가 종전대로 홈을 새로 마운트해 저장된 값을 읽게 한다. */
export async function openLink(
  projectId: string,
  url: string,
  locale: Locale,
  navigate: (path: string) => void,
): Promise<void> {
  const result = await openLinkAction(projectId, url);
  if (!result.ok) {
    if (result.reason === "cap") toast(linkCapToastMessage(locale, result.used, result.limit));
    else toast(linkErrorToastMessage(locale, result.output));
    return;
  }
  const chunk = await openBrowserTabAction(projectId, LINK_SLOT_HASH);
  writeStoredActiveTab(projectId, LINK_SLOT_HASH);
  window.dispatchEvent(new CustomEvent<LinkTabEventDetail>(LINK_TAB_EVENT, { detail: { projectId, chunk } }));
  navigate(`/p/${projectId}`);
}

/** 이름 끝 글자의 받침 여부로 주격 조사(이/가)를 고른다. 로마자·숫자·빈 문자열은 받침이 없는
 *  값으로 보고 "가"를 쓴다 — 과도한 예외표는 안 만든다(ponytail). `browser.mirror.inUse.suffix`
 *  한 자리에서만 쓴다(한국어 로케일 전용, `wrap`이 자리표시자 없이 조립한다). */
function subjectParticle(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.codePointAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return "가";
  return (code - 0xac00) % 28 === 0 ? "가" : "이";
}

/** "<이름>이 쓰는 중"(§11-13 결정 3) — 한국어만 조사가 붙는다. 영어는 `wrap`이 이름과 접미
 *  사이에 공백 하나를 넣는다("<name> in use"). `t`는 `useT()`가 이미 지금 로케일에 묶어
 *  준 값이라 여기서 로케일을 다시 안 받는다 — `locale`은 조사를 고를 때만 쓴다. */
function inUseLabel(locale: "ko" | "en", name: string, t: (key: string) => string): string {
  const subject = locale === "ko" ? `${name}${subjectParticle(name)}` : name;
  return wrap("", subject, t("browser.mirror.inUse.suffix"));
}

export function BrowserMirror({
  projectId,
  hash,
  ownerName,
  busy,
  onRelease,
  focusAddressToken,
}: {
  projectId: string;
  hash: string;
  /** 슬롯의 주인 이름(§11-13 결정 3) — 이미 `browserOwnerLabel`로 옮긴 값. `null`이면 그
   *  슬롯에 `owner` 파일이 없다(옛 슬롯) — 이름 없이 종전 상태만 그린다. */
  ownerName: string | null;
  /** 명령이 도는 동안만 참(§11-13 결정 2) — 이름 옆 점의 출처. */
  busy: boolean;
  /** `반납` 단추를 누르고 셸이 실제로 끝난 뒤 불린다(§11-15 결정 5) — 이 탭 자체를 닫는 것은
   *  부모(`home-ui.tsx`의 `closeTab`) 몫이다, 여기서는 셸 하나(`releaseLinkAction`)만 안다. */
  onRelease?: () => void;
  /** `새 브라우저`가 연 뒤 주소표시줄에 포커스를 보내라는 신호(§11-17 결정 1) — `home-ui.tsx`의
   *  `HomeUI`가 든 값을 그대로 받는다. 링크 슬롯이 아니면 무시한다(주소표시줄이 입력칸이
   *  아니라서 포커스를 줄 곳이 없다). 미전달이면(§11-11의 다른 호출자) 이펙트가 안 돈다. */
  focusAddressToken?: number;
}) {
  const t = useT();
  const locale = useLocale();
  const url = `/p/${projectId}/cdp/${hash}`;
  const isLinkSlot = hash === LINK_SLOT_HASH;
  const [frame, setFrame] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);

  // §11-17 결정 1 — `새 브라우저`를 누른 뒤 주소표시줄로 포커스를 옮긴다. 토큰이 없는(구버전
  // 호출자) 마운트에서는 안 돈다 — `undefined`에서 시작해 한 번도 안 바뀐다.
  useEffect(() => {
    if (isLinkSlot && focusAddressToken !== undefined) addressInputRef.current?.focus();
  }, [isLinkSlot, focusAddressToken]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal: ac.signal });
      } catch {
        return; // abort(언마운트) — 조용히 물러난다
      }
      const outcome = await readCdpFrameStream(
        res,
        (b64) => setFrame(b64),
        ac.signal,
        (u) => {
          setAddress(u);
          setAddressInput(u);
        },
      );
      if (outcome === "disconnected") setLost(true);
    })();
    return () => ac.abort();
  }, [url]);

  // 걷힌 동안 포커스를 미러로 옮긴다 — 곧바로 키가 들어간다(§11-11 결정 6 §승인하면 걷힌다).
  useEffect(() => {
    if (unlocked) containerRef.current?.focus();
  }, [unlocked]);

  const point = (clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    return scaleToFrame(
      clientX,
      clientY,
      img.getBoundingClientRect(),
      { width: img.naturalWidth || 1, height: img.naturalHeight || 1 },
    );
  };

  if (lost) {
    return <div className="flex h-full flex-1 items-center justify-center text-sm text-muted-foreground">{t("browser.disconnected")}</div>;
  }

  // §11-13 결정 3 — 주인 이름은 상시고, 걷힌 동안만 `입력 열림` + `다시 잠그기`가 같은
  // 줄에 더 붙는다(§11-11 결정 6의 세 상태는 무수정). 이름도 없고 안 걷혔으면 줄 자체가
  // 없다 — 빈 줄을 안 남긴다.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {(ownerName || unlocked) && (
        <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {busy && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
            {ownerName && <span>{inUseLabel(locale, ownerName, t)}</span>}
            {unlocked && <span>{t("browser.wrap.unlocked")}</span>}
          </span>
          {unlocked && (
            <Button size="xs" variant="outline" onClick={() => setUnlocked(false)}>
              {t("browser.wrap.lock")}
            </Button>
          )}
        </div>
      )}
      {/* 주소 한 줄 - 주인 이름 줄 아래, 상시(§11-15 결정 4·5). `c0ffee00`만 입력칸이고
          그 밖은 읽기 전용 텍스트다 - 링크 슬롯 밖은 세션이 쥔 자리라 사람이 못 돌린다. */}
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-1 text-xs">
        {isLinkSlot ? (
          <Input
            ref={addressInputRef}
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const target = normalizeAddressInput(addressInput);
              setAddressInput(target);
              postNavigate(url, target);
            }}
            className="h-6 flex-1 text-xs"
          />
        ) : (
          <span className="flex-1 truncate text-muted-foreground">{address}</span>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={!address}
          onClick={() => {
            if (address) window.open(address, "_blank", "noopener");
          }}
        >
          {t("browser.addressBar.openExternal")}
        </Button>
        {isLinkSlot && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void releaseLinkAction(projectId).then(() => onRelease?.());
            }}
          >
            {t("browser.addressBar.release")}
          </Button>
        )}
      </div>
      <div
        ref={containerRef}
        tabIndex={unlocked ? 0 : -1}
        className="relative min-h-0 flex-1 bg-black outline-none"
        onKeyDown={(e) => {
          if (!unlocked) return;
          e.preventDefault();
          postInput(url, keyBody("keydown", e.key, e.code));
        }}
        onKeyUp={(e) => {
          if (!unlocked) return;
          e.preventDefault();
          postInput(url, keyBody("keyup", e.key, e.code));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 데이터 URL, `next/image`의 최적화 대상이 아니다 */}
        <img
          ref={imgRef}
          alt=""
          src={frame ? `data:image/jpeg;base64,${frame}` : undefined}
          className="h-full w-full object-contain"
        />
        {/* 랩 레이어(§11-11 결정 6) — 막힌 동안은 투명한 이 층이 전부를 받는다. 걷힌 동안에는
            이 층이 곧 입력 캡처 표면이다(이미지 자신은 상호작용 요소가 아니다 — 마우스·휠을
            여기서 잡아 POST로 옮긴다). */}
        <div
          className="absolute inset-0"
          onClick={() => {
            if (unlocked) return;
            if (window.confirm(t("browser.wrap.confirm"))) setUnlocked(true);
          }}
          onMouseDown={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mousedown", e.button, x, y));
          }}
          onMouseUp={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mouseup", e.button, x, y));
          }}
          onMouseMove={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, mouseButtonBody("mousemove", e.button, x, y));
          }}
          onWheel={(e) => {
            if (!unlocked) return;
            const { x, y } = point(e.clientX, e.clientY);
            postInput(url, wheelBody(x, y, e.deltaX, e.deltaY));
          }}
        />
      </div>
    </div>
  );
}

/** 티켓 상세 우측 절의 읽기 전용 미리보기(§11-14 결정 2) — GET SSE(`cdp/[hash]`)의 프레임을
 *  `<img>`에 그대로 흘린다. **포인터 이벤트를 안 받는다**(결정 3 무수정 — 미러는 보는 자리다,
 *  이 컴포넌트에 POST를 부르는 줄이 없다). 랩 레이어 세 상태(위 `BrowserMirror`)는 홈 탭
 *  전용이고 이 자리에 안 온다(결정 4 §안 하는 것). */
export function BrowserPreview({ projectId, hash }: { projectId: string; hash: string }) {
  const t = useT();
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    const url = `/p/${projectId}/cdp/${hash}`;
    const ac = new AbortController();
    (async () => {
      let res: Response;
      try {
        res = await fetch(url, { signal: ac.signal });
      } catch {
        return; // abort(언마운트) — 조용히 물러난다
      }
      await readCdpFrameStream(res, (base64Jpeg) => setFrame(base64Jpeg), ac.signal);
    })();
    return () => ac.abort();
  }, [projectId, hash]);

  return frame ? (
    <img
      src={`data:image/jpeg;base64,${frame}`}
      alt={t("sessionStream.browserActive")}
      className="pointer-events-none w-full rounded-md border"
    />
  ) : null;
}

/** 티켓 상세 우측 칼럼의 브라우저 절(§11-14 결정 1) — frontmatter 표 아래, 폴링 대기 절 위에
 *  선다. 부르는 쪽(`page.tsx`)이 `DevToolsActivePort` 존재로 이미 걸러 넘기므로 이 컴포넌트는
 *  브라우저를 쥔 티켓에서만 마운트된다(결정 3 §브라우저가 없으면 h2도 없다). */
export function TicketBrowserSection({ project, hash }: { project: string; hash: string }) {
  const t = useT();
  const router = useTrackedRouter();
  // 홈의 `browser` 표면에서 같은 탭을 연다 — 탭을 먼저 만들고(`home-sessions.json`에 없으면
  // `HomeUI`가 못 찾는다), 이 창의 활성 탭 자리(`lib/tabs.ts` §`writeStoredActiveTab`)에 적은
  // 뒤 홈으로 옮긴다. `HomeUI` 마운트가 그 값을 읽어 `browser` 표면을 바로 연다.
  const openInHomeTab = async () => {
    await openBrowserTabAction(project, hash);
    writeStoredActiveTab(project, hash);
    router.push(`/p/${project}`);
  };
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("sessionStream.browserActive")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void openInHomeTab()}
        >
          {t("sessionStream.openInHomeTab")}
        </Button>
      </div>
      <BrowserPreview projectId={project} hash={hash} />
    </section>
  );
}
