"use client";

/** 프론트매터 행 편집기 - 평문 칸 손잡이가 여는 둘째 표면 (DESIGN.md §프론트매터 행 편집기
 *  결정 1·2·3·5, §비주얼 §50 §프론트매터 행 편집기 - 행 하나의 값 한 벌). `head` 문자열을
 *  `lib/markdown-frontmatter-rows.ts`(순수 함수, 슬라이스 행 모델)로 읽어 행마다 키/값 `Input`
 *  하나씩 그린다 - 안 고친 행은 슬라이스 그대로라 고친 행만 파일에서 갈린다(결정 2).
 *
 *  **칸의 두 모양(목록형 값의 항목 UI - 키 추천 - 값 검색 팝오버)은 이 표면이 아니다**
 *  (티켓 `7e02b1ac`) - 여기서 키 칸과 값 칸은 평범한 `Input`이고, 대괄호 목록 값도 그 칸에
 *  원문 그대로 든다.
 *
 *  `Input`이 이미 제어 컴포넌트라 `onChange`마다 값이 즉시 부모 state로 올라간다 - 위지윅 면의
 *  `contentEditable` 블록처럼 `blur`/`⌘↵` 제출 순간에 커밋을 강제로 되읽을 필요가 없다(호출부의
 *  `commitEditable`은 `data-head`가 있는 원소만 찾으므로 이 표면의 `Input`들은 애초에 그 흐름을
 *  안 탄다) - 매 키 입력이 곧 커밋이라 마지막 편집이 버려질 자리가 없다. */
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type FrontmatterDoc,
  type FrontmatterRow,
  insertRow,
  parseFrontmatterHead,
  removeRow,
  stringifyFrontmatterHead,
  updateRow,
} from "@/lib/markdown-frontmatter-rows";
import { useT } from "@/components/language-provider";

const INDENT_STEP_PX = 16;
const INDENT_MAX_LEVEL = 4; // §비주얼 §50 §층 - 여백은 4단(64px)에서 멈춘다(행 모델은 안 갈린다)

function indentStyle(level: number) {
  const px = Math.min(level, INDENT_MAX_LEVEL) * INDENT_STEP_PX;
  return { "--fm-indent": `${px}px` } as React.CSSProperties;
}

/** 새로 더할 행의 갈래 - 클릭한 행의 갈래를 물려받는다(부모 행 아래는 쌍으로 - 그 밖은 클릭한
 *  행과 같은 갈래). 층은 `insertRow`가 `rows[index - 1]`에서 스스로 물려받는다(결정 1). */
function nextRowFields(after: FrontmatterRow): { key: string | null; value: string | null; shape: FrontmatterRow["shape"] } {
  if (after.shape === "list-item") return { key: after.key === null ? null : "", value: "", shape: "list-item" };
  return { key: "", value: "", shape: "pair" };
}

export function FrontmatterRowsEditor({
  head,
  onHeadChange,
  onPaste,
  onKeyDown,
}: {
  head: string;
  onHeadChange: (head: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const t = useT();
  const doc = parseFrontmatterHead(head);

  function commit(rows: FrontmatterRow[]) {
    onHeadChange(stringifyFrontmatterHead({ ...doc, rows } satisfies FrontmatterDoc));
  }

  if (doc.rows.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">{t("frontmatterRows.empty")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => commit(insertRow(doc.rows, 0, { key: "", value: "", shape: "pair" }))}
        >
          {t("frontmatterRows.addRow")}
        </Button>
      </div>
    );
  }

  return (
    <div className="@container space-y-1">
      {doc.rows.map((row, i) => {
        const showKey = !(row.shape === "list-item" && row.key === null);
        const showValue = row.shape !== "parent";
        const stacks = showKey && showValue; // §비주얼 §50 §키 칸과 값 칸 §임계 폭 아래
        const addLabel =
          row.shape === "list-item" && row.key === null
            ? `${t("frontmatterRows.addAfterItemPrefix")}${i + 1}${t("frontmatterRows.addAfterItemSuffix")}`
            : `${t("frontmatterRows.addAfterKeyPrefix")}${row.key ?? ""}${t("frontmatterRows.addAfterKeySuffix")}`;
        const removeLabel =
          row.shape === "list-item" && row.key === null
            ? `${t("frontmatterRows.removeItemPrefix")}${i + 1}${t("frontmatterRows.removeItemSuffix")}`
            : `${t("frontmatterRows.removeKeyPrefix")}${row.key ?? ""}${t("frontmatterRows.removeKeySuffix")}`;
        return (
          <div
            key={i}
            className="group flex flex-wrap items-start gap-x-2 gap-y-1 ps-(--fm-indent)"
            style={indentStyle(row.level)}
          >
            <div className="order-1 w-4 shrink-0 text-center font-mono text-sm opacity-60" aria-hidden>
              {row.shape === "list-item" ? "-" : null}
            </div>
            {showKey && (
              <Input
                aria-label={t("frontmatterRows.keyLabel")}
                className="order-2 min-w-0 grow font-mono @xl:w-40 @xl:grow-0"
                value={row.key ?? ""}
                onChange={(e) => commit(updateRow(doc.rows, i, { key: e.target.value, value: row.value }))}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              />
            )}
            {showValue ? (
              <Input
                aria-label={t("frontmatterRows.valueLabel")}
                className={
                  stacks
                    ? "order-4 ms-4 min-w-0 grow basis-full font-mono @xl:order-3 @xl:ms-0 @xl:basis-auto"
                    : "order-3 min-w-0 grow font-mono"
                }
                value={row.value ?? ""}
                onChange={(e) => commit(updateRow(doc.rows, i, { key: row.key, value: e.target.value }))}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              />
            ) : (
              // 값 칸이 없는 부모 행도 손잡이가 행의 오른쪽 끝에 붙게 - 넓은 폭에서만 그 자리를 민다
              <div className="order-3 hidden grow @xl:block" aria-hidden />
            )}
            <div className={`${stacks ? "order-3 @xl:order-4" : "order-4"} flex shrink-0 items-center gap-1`}>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={addLabel}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => commit(insertRow(doc.rows, i + 1, nextRowFields(row)))}
              >
                <Plus aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={removeLabel}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => commit(removeRow(doc.rows, i))}
              >
                <X aria-hidden />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
