/** 산문 속 해시-P번호 표식의 실제 렌더 (DESIGN.md §비주얼 §31 §산문 안의 해시 - 갈래 D,
 *  §9). `<Markdown>`은 서버-클라이언트 양쪽에서 쓰이지만(그 파일 자체는 `"use client"`가
 *  아니다) 호버 카드는 상태가 있어야 해서 그 리프만 클라이언트 컴포넌트로 뗀다 - `<Markdown>`을
 *  쓰는 여섯 자리 중 서버 컴포넌트로 남는 자리(에픽 README)의 SSR 경계가 안 바뀐다. */
"use client";
import { Fragment } from "react";
import { Circle, CircleCheck, CirclePlay } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { PersonaBadge, SquadBadge } from "@/components/persona-badge";
import { StatusBadge } from "@/components/status-badge";
import { t, type Locale } from "@/lib/i18n";
import { splitRefs, type RefIndex, type EpicRefValue, type TicketRefValue } from "@/lib/markdown-refs";
import { cn } from "@/lib/utils";

/** 코드 스팬 레시피 — `components/markdown.tsx`의 `code` 핸들러와 같은 값이다(§비주얼 §31
 *  §표식의 값: 코드 스팬 안과 맨 글자가 배경-글꼴-크기에서 안 갈린다). 그 파일이 여기서
 *  가져다 쓴다 — `markdown.tsx`도 `queue-ref.tsx`를 이미 참조해서(components map) 반대
 *  방향으로 다시 참조하면 순환 import가 된다. */
export const CODE_SPAN_CLASS = "rounded-sm bg-muted px-1 font-mono text-sm text-foreground";

// §비주얼 §31 §표식의 값 - 한 벌이다. 코드 스팬 안과 맨 글자가 안 갈린다(§9 ⑨⑩).
const ANCHOR =
  "inline-flex items-center gap-1 rounded-sm underline underline-offset-2 decoration-muted-foreground hover:decoration-foreground";

const STATE_ICON = { open: Circle, wip: CirclePlay, done: CircleCheck } as const;
const STATE_INK = {
  open: "text-secondary-foreground",
  wip: "text-status-active",
  done: "text-status-done",
} as const;

function TicketCard({ value, locale }: { value: TicketRefValue; locale: Locale }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <StatusBadge status={value.status} days={value.days} locale={locale} />
        <span className="font-mono text-xs text-muted-foreground">{value.stem}</span>
      </div>
      <p className="text-sm font-medium text-foreground break-words">{value.title || "(제목 없음)"}</p>
      {value.bodyPreview && <p className="text-xs text-muted-foreground line-clamp-3">{value.bodyPreview}</p>}
      {value.assignee.name &&
        (value.assignee.squad ? (
          <SquadBadge name={value.assignee.name} />
        ) : (
          <PersonaBadge name={value.assignee.name} />
        ))}
    </>
  );
}

/** 티켓 표식(§9 ⑨⑩) - `coded`는 원문이 백틱을 둘렀는지다(코드 스팬째 표식이 된다). `layered`는
 *  §9 뒤쪽 절반의 제목 자리(칸반 카드 - 표뷰 제목 셀)에서만 참이다 - 카드-행 전체가 늘어난
 *  링크라 표식이 `relative z-10`으로 그 위에 서지 않으면 눌리는 것이 카드다(§비주얼 §31 §층).
 *  `<Markdown>` 산문·상세 `h1`은 위에 덮인 앵커가 없어 이 값을 안 준다(같은 절). */
export function TicketRef({
  value,
  coded,
  locale,
  layered = false,
}: {
  value: TicketRefValue;
  coded: boolean;
  locale: Locale;
  layered?: boolean;
}) {
  const Icon = STATE_ICON[value.state];
  return (
    <HoverCard>
      <HoverCardTrigger render={<a href={value.href} title="" className={cn(ANCHOR, layered && "relative z-10")} />}>
        <Icon aria-hidden className={cn("size-3.5 shrink-0", STATE_INK[value.state])} />
        <span className="sr-only">{t(locale, `status.label.${value.state}`)}</span>
        {coded ? <code className={CODE_SPAN_CLASS}>{value.stem}</code> : value.stem}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 flex flex-col gap-2">
        <TicketCard value={value} locale={locale} />
      </HoverCardContent>
    </HoverCard>
  );
}

const COUNT_LABEL_KEY = {
  open: "status.label.open",
  wip: "status.label.wip",
  done: "status.label.done",
} as const;

/** 에픽 표식(§9 ⑪⑫) - 상태 표식이 없다(에픽에 상태가 없다). 값은 §10 `a`와 완전히 같다 -
 *  호버 카드가 붙는 것 하나만 늘어난다. `layered`는 `TicketRef`와 같은 뜻이다. */
export function EpicRef({
  value,
  locale,
  layered = false,
}: {
  value: EpicRefValue;
  locale: Locale;
  layered?: boolean;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger render={<a href={value.href} title="" className={cn(ANCHOR, layered && "relative z-10")} />}>
        {value.epic}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 flex flex-col gap-2">
        <span className="font-mono text-xs text-muted-foreground">{value.epic}</span>
        <p className="text-sm font-medium text-foreground break-words">
          {value.title ?? t(locale, "board.epic.noTitle")}
        </p>
        {value.body && <p className="text-xs text-muted-foreground line-clamp-3">{value.body}</p>}
        <div className="flex gap-3">
          {(Object.keys(COUNT_LABEL_KEY) as (keyof typeof COUNT_LABEL_KEY)[]).map((state) => {
            const Icon = STATE_ICON[state];
            return (
              <span key={state} className="inline-flex items-center gap-1">
                <Icon aria-hidden className={cn("size-3.5", STATE_INK[state])} />
                <span className="text-xs">{t(locale, COUNT_LABEL_KEY[state])}</span>
                <span className="text-xs tabular-nums">{value.counts[state]}</span>
              </span>
            );
          })}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export type QueueRefProps = {
  kind: "ticket" | "epic";
  value: TicketRefValue | EpicRefValue;
  coded: boolean;
  locale: Locale;
};

/** `<Markdown>`의 `a` 표식 핸들러가 `queueref` 프로퍼티를 봤을 때 넘기는 진입점(위
 *  `components/markdown.tsx` 참고) — `lib/markdown-refs.ts refMarkers`가 `hProperties`로
 *  실어 보낸 `kind`·`value`·`coded`·`locale`을 그대로 받는다. */
export function QueueRef(props: QueueRefProps) {
  return props.kind === "ticket" ? (
    <TicketRef value={props.value as TicketRefValue} coded={props.coded} locale={props.locale} />
  ) : (
    <EpicRef value={props.value as EpicRefValue} locale={props.locale} />
  );
}

/** `<Markdown>`을 안 지나가는 글자 속 표식(§9 §마크다운을 안 지나가는 글자도 켠다) - 칸반 카드
 *  제목 - 표뷰 제목 셀 - 상세 `h1` - 스쿼드 티켓 줄. `splitRefs`를 그대로 재사용해 `refMarkers`와
 *  판정을 한 벌로 둔다 - `known`은 호출부가 넘긴 `refs`(그 글에 실제로 나온 것만, §9 §화면이
 *  해석해서 내려준다)의 키 집합이다. 값이 없으면(빈 `refs`) 원문 그대로를 돌려준다 - 새 DOM
 *  노드 0. `coded`가 없다 - 제목은 원문이 늘 맨 글자라 백틱 갈래가 없다(§9 §안 하는 것). */
export function TitleRefs({
  title,
  refs,
  locale,
  layered = false,
}: {
  title: string;
  refs: RefIndex;
  locale: Locale;
  /** 카드-행 전체가 늘어난 링크인 자리(칸반 카드 - 표뷰 제목 셀)에서만 참 - `TicketRef`
   *  §layered 참고. */
  layered?: boolean;
}) {
  const known = { tickets: new Set(Object.keys(refs.tickets)), epics: new Set(Object.keys(refs.epics)) };
  const segments = splitRefs(title, known);
  if (segments.length === 1 && segments[0].type === "text") return <>{title}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <Fragment key={i}>{seg.value}</Fragment>
        ) : seg.type === "ticket" ? (
          <TicketRef key={i} value={refs.tickets[seg.stem]} coded={false} locale={locale} layered={layered} />
        ) : (
          <EpicRef key={i} value={refs.epics[seg.epic]} locale={locale} layered={layered} />
        ),
      )}
    </>
  );
}
