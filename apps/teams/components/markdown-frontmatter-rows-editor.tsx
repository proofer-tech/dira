"use client";

/** 프론트매터 행 편집기 - 평문 칸 손잡이가 여는 둘째 표면 (DESIGN.md §프론트매터 행 편집기
 *  결정 1·2·3·5·6·7, §비주얼 §50 §프론트매터 행 편집기 - 행 하나의 값 한 벌). `head` 문자열을
 *  `lib/markdown-frontmatter-rows.ts`(순수 함수, 슬라이스 행 모델)로 읽어 행마다 키/값 칸
 *  하나씩 그린다 - 안 고친 행은 슬라이스 그대로라 고친 행만 파일에서 갈린다(결정 2).
 *
 *  **칸의 두 모양**(티켓 `7e02b1ac`) - 대괄호 목록 값(`aliases: [a, b]`)은 항목마다 한 줄인
 *  `BracketListValue`로, 후보가 있는 키·값 칸은 `CandidateCombobox`(`InputGroup` +
 *  `ChevronDown` 트리거 + `Command` 팝오버)로 갈아 낀다 - 후보가 없으면 종전 그대로 평범한
 *  `Input`이다. **콤보박스는 문지기가 아니다** - 골라도 그 자리는 여전히 `Input`이라 사람이
 *  그대로 고칠 수 있고, 후보에 없는 값을 쳐도 막지 않는다(결정 7).
 *
 *  `Input`이 이미 제어 컴포넌트라 `onChange`마다 값이 즉시 부모 state로 올라간다 - 위지윅 면의
 *  `contentEditable` 블록처럼 `blur`/`⌘↵` 제출 순간에 커밋을 강제로 되읽을 필요가 없다(호출부의
 *  `commitEditable`은 `data-head`가 있는 원소만 찾으므로 이 표면의 `Input`들은 애초에 그 흐름을
 *  안 탄다) - 매 키 입력이 곧 커밋이라 마지막 편집이 버려질 자리가 없다. */
import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type FrontmatterCandidates,
  type FrontmatterDoc,
  type FrontmatterRow,
  insertRow,
  isBracketList,
  joinListValue,
  keyCandidates,
  parseFrontmatterHead,
  removeRow,
  splitListValue,
  stringifyFrontmatterHead,
  updateRow,
  valueCandidates,
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

/** 키 추천·값 검색이 한 벌인 콤보박스(티켓 `7e02b1ac`) - `InputGroup`으로 값 칸을 감싸고
 *  `ChevronDown` 트리거가 `Command` 팝오버(w-64/max-h-72)를 연다. 칸 자체는 여전히 평범한
 *  텍스트 입력이라 골라도, 그대로 고쳐도, 후보 밖 값을 쳐도 다 된다(결정 7). */
function CandidateCombobox({
  className,
  ariaLabel,
  pickAriaLabel,
  value,
  onValueChange,
  options,
  onPaste,
  onKeyDown,
}: {
  className?: string;
  ariaLabel: string;
  pickAriaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <InputGroup className={className}>
      <InputGroupInput
        aria-label={ariaLabel}
        className="font-mono"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <InputGroupButton size="icon-xs" aria-label={pickAriaLabel}>
                <ChevronDown aria-hidden />
              </InputGroupButton>
            }
          />
          <PopoverContent align="end" className="w-64 p-0">
            <Command>
              <CommandInput placeholder={t("frontmatterRows.searchPlaceholder")} />
              <CommandList className="max-h-72">
                <CommandEmpty>{t("frontmatterRows.searchEmpty")}</CommandEmpty>
                {options.map((o) => (
                  <CommandItem
                    key={o}
                    value={o}
                    onSelect={() => {
                      onValueChange(o);
                      setOpen(false);
                    }}
                  >
                    {o}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** 목록형 값의 콤마 항목 UI(결정 5) - `aliases: [a, b]`를 항목마다 한 줄로 그린다. 항목 0개는
 *  `항목 추가` 버튼 하나뿐이고(키 줄은 `[]`인 채로 남는다), 다 지워도 이 함수가 부르는
 *  `updateRow`가 `removeRow`가 아니라서 키 줄 자체는 안 사라진다. */
function BracketListValue({
  className,
  rowKey,
  value,
  onChange,
  onPaste,
  onKeyDown,
  candidateOptions,
}: {
  className?: string;
  rowKey: string | null;
  value: string;
  onChange: (value: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** 값 검색 후보(결정 7·9, 티켓 `dc6364a4`) - 있으면 항목마다 `CandidateCombobox`, 없으면
   *  종전 그대로 평범한 `Input`(`aliases: [...]`처럼 후보가 없는 목록형 값이 이 갈래다). */
  candidateOptions?: string[] | null;
}) {
  const t = useT();
  const items = splitListValue(value);
  const setItems = (next: string[]) => onChange(joinListValue(next));
  const label = rowKey ?? t("frontmatterRows.valueLabel");

  if (items.length === 0) {
    return (
      <div className={className}>
        <Button type="button" variant="outline" size="sm" onClick={() => setItems([""])}>
          {t("frontmatterRows.addListItem")}
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1">
            {candidateOptions ? (
              <CandidateCombobox
                className="min-w-0 grow"
                ariaLabel={`${label} ${idx + 1}`}
                pickAriaLabel={t("frontmatterRows.pickValueLabel")}
                value={item}
                onValueChange={(v) => setItems(items.map((val, j) => (j === idx ? v : val)))}
                options={candidateOptions}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              />
            ) : (
              <Input
                aria-label={`${label} ${idx + 1}`}
                className="min-w-0 grow font-mono"
                value={item}
                onChange={(e) => setItems(items.map((v, j) => (j === idx ? e.target.value : v)))}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`${t("frontmatterRows.removeListItemPrefix")}${label} ${idx + 1}${t("frontmatterRows.removeListItemSuffix")}`}
              className="shrink-0 opacity-60 hover:opacity-100"
              onClick={() => setItems(items.filter((_, j) => j !== idx))}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setItems([...items, ""])}
        >
          {t("frontmatterRows.addListItem")}
        </Button>
      </div>
    </div>
  );
}

export function FrontmatterRowsEditor({
  head,
  onHeadChange,
  onPaste,
  onKeyDown,
  candidates,
}: {
  head: string;
  onHeadChange: (head: string) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** 후보 원천 여섯(결정 8) - 없으면 모든 칸이 종전대로 평범한 입력 칸이다(§10 §키 추천/값
   *  검색이 없는 호출부, 예: `?` 미만 옵션). */
  candidates?: FrontmatterCandidates | null;
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
        const keyOptions = candidates ? keyCandidates(doc.rows, i, candidates) : [];
        const valueOptions = candidates ? valueCandidates(doc.rows, i, candidates) : null;
        const valueClassName = stacks
          ? "order-4 ms-4 min-w-0 grow basis-full @xl:order-3 @xl:ms-0 @xl:basis-auto"
          : "order-3 min-w-0 grow";
        return (
          <div
            key={i}
            className="group flex flex-wrap items-start gap-x-2 gap-y-1 ps-(--fm-indent)"
            style={indentStyle(row.level)}
          >
            <div className="order-1 w-4 shrink-0 text-center font-mono text-sm opacity-60" aria-hidden>
              {row.shape === "list-item" ? "-" : null}
            </div>
            {showKey &&
              (keyOptions.length > 0 ? (
                <CandidateCombobox
                  className="order-2 min-w-0 grow @xl:w-40 @xl:grow-0"
                  ariaLabel={t("frontmatterRows.keyLabel")}
                  pickAriaLabel={t("frontmatterRows.pickKeyLabel")}
                  value={row.key ?? ""}
                  onValueChange={(v) => commit(updateRow(doc.rows, i, { key: v, value: row.value }))}
                  options={keyOptions}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              ) : (
                <Input
                  aria-label={t("frontmatterRows.keyLabel")}
                  className="order-2 min-w-0 grow font-mono @xl:w-40 @xl:grow-0"
                  value={row.key ?? ""}
                  onChange={(e) => commit(updateRow(doc.rows, i, { key: e.target.value, value: row.value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              ))}
            {showValue ? (
              isBracketList(row.value ?? "") ? (
                <BracketListValue
                  className={valueClassName}
                  rowKey={row.key}
                  value={row.value ?? "[]"}
                  onChange={(value) => commit(updateRow(doc.rows, i, { key: row.key, value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                  candidateOptions={valueOptions}
                />
              ) : valueOptions ? (
                <CandidateCombobox
                  className={valueClassName}
                  ariaLabel={t("frontmatterRows.valueLabel")}
                  pickAriaLabel={t("frontmatterRows.pickValueLabel")}
                  value={row.value ?? ""}
                  onValueChange={(v) => commit(updateRow(doc.rows, i, { key: row.key, value: v }))}
                  options={valueOptions}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              ) : (
                <Input
                  aria-label={t("frontmatterRows.valueLabel")}
                  className={`${valueClassName} font-mono`}
                  value={row.value ?? ""}
                  onChange={(e) => commit(updateRow(doc.rows, i, { key: row.key, value: e.target.value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              )
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
