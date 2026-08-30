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
import { cn } from "@/lib/utils";
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
// §비주얼 §개정 2(결정 13) - 행 열의 왼쪽 눈금 5px. 12(읽기 전용 표의 px-3)에서 칸의 안쪽
// 오프셋 7(테두리 1 + px-1.5 6)을 뺀 나머지라 층 0 쌍 행의 키 글자가 표와 같은 12px에서 시작한다.
const INDENT_BASE_PX = 5;

// §비주얼 §프론트매터 행 편집기 §개정(결정 11) - 프론트매터 전용 칸 한 벌. `Input`/`InputGroup`
// 기본 벌(h-8 - 정지 border-input - px-2.5 py-1 - rounded-lg - text-base md:text-sm)을 뜯어
// h-6 - 정지 투명 테두리(행 호버에서 border-input) - 두 면 다 bg-transparent - px-1.5 py-0 -
// rounded-md - text-sm 고정으로 간다. `FM_CELL`은 평범한 `Input`에, `FM_CELL_GROUP`은 콤보박스의
// `InputGroup` 그릇에, `FM_CELL_GROUP_INPUT`은 그 안의 `InputGroupInput`에 쓴다(테두리·배경은
// 그릇 쪽이 이미 들고 있어 안쪽 입력에는 안 준다).
const FM_CELL =
  "h-6 rounded-md border-transparent bg-transparent px-1.5 py-0 text-sm font-mono group-hover:border-input dark:bg-transparent";
const FM_CELL_GROUP =
  "h-6 rounded-md border-transparent bg-transparent group-hover:border-input dark:bg-transparent";
const FM_CELL_GROUP_INPUT = "h-6 px-1.5 py-0 text-sm font-mono";
// §키 칸과 값 칸 - 144 고정 + 남는 것 전부, 임계 폭은 0개다(결정 10). 좁아지면 값 칸이 먼저 주고
// (`basis-0 grow`) 다음에 키 칸이 준다(`shrink`) - `@xl:` 조건은 이 표면에서 0줄이다.
const FM_KEY_LAYOUT = "w-36 min-w-14 shrink";
const FM_VALUE_LAYOUT = "basis-0 grow min-w-16";

function indentStyle(level: number) {
  const px = INDENT_BASE_PX + Math.min(level, INDENT_MAX_LEVEL) * INDENT_STEP_PX;
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
    <InputGroup className={cn(FM_CELL_GROUP, className)}>
      <InputGroupInput
        aria-label={ariaLabel}
        className={FM_CELL_GROUP_INPUT}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
      />
      <InputGroupAddon align="inline-end" className="py-0 pr-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                aria-label={pickAriaLabel}
                className="size-5 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
              >
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
 *  `updateRow`가 `removeRow`가 아니라서 키 줄 자체는 안 사라진다.
 *
 *  항목 0개에서 누른 `항목 추가`는 `joinListValue([""])`도 `"[]"`라 값이 안 갈리므로(결정 5의
 *  0개 표현과 겹친다, 티켓 `4ae1fde0`), 커밋 전 빈 칸 한 줄을 `pendingEmpty`라는 이 컴포넌트만의
 *  UI 상태로 띄운다 - 실제 글자를 치는 순간 그 값으로 `onChange`가 나가 정상 라운드트립을 탄다. */
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
  const [pendingEmpty, setPendingEmpty] = useState(false);
  const setItems = (next: string[]) => onChange(joinListValue(next));
  const label = rowKey ?? t("frontmatterRows.valueLabel");

  if (items.length === 0 && !pendingEmpty) {
    return (
      <div className={className}>
        <Button type="button" variant="outline" size="sm" onClick={() => setPendingEmpty(true)}>
          {t("frontmatterRows.addListItem")}
        </Button>
      </div>
    );
  }

  const displayItems = items.length === 0 ? [""] : items;

  return (
    <div className={className}>
      <div className="flex flex-col gap-1">
        {displayItems.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1">
            {candidateOptions ? (
              <CandidateCombobox
                className="min-w-0 grow"
                ariaLabel={`${label} ${idx + 1}`}
                pickAriaLabel={t("frontmatterRows.pickValueLabel")}
                value={item}
                onValueChange={(v) => {
                  setPendingEmpty(false);
                  setItems(displayItems.map((val, j) => (j === idx ? v : val)));
                }}
                options={candidateOptions}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
              />
            ) : (
              <Input
                aria-label={`${label} ${idx + 1}`}
                className="min-w-0 grow font-mono"
                value={item}
                onChange={(e) => {
                  setPendingEmpty(false);
                  setItems(displayItems.map((v, j) => (j === idx ? e.target.value : v)));
                }}
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
              onClick={() => {
                setPendingEmpty(false);
                setItems(items.filter((_, j) => j !== idx));
              }}
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
          onClick={() => setItems([...displayItems, ""])}
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
      <div className="flex items-center gap-2 ps-3">
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

  // §비주얼 §개정 2(결정 14) - 표식 칸은 행 열에 목록 항목 행이 하나도 없으면 안 잡는다. 판정은
  // 파일 하나 단위다 - 행마다 갈리면 열 정렬이 깨진다(결정 13의 문 1).
  const hasListItemRow = doc.rows.some((row) => row.shape === "list-item");

  return (
    <div>
      {doc.rows.map((row, i) => {
        const showKey = !(row.shape === "list-item" && row.key === null);
        const showValue = row.shape !== "parent";
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
        return (
          <div
            key={i}
            className="group flex items-start gap-x-2 ps-(--fm-indent)"
            style={indentStyle(row.level)}
          >
            {hasListItemRow && (
              <div className="w-4 shrink-0 text-center font-mono text-sm opacity-60" aria-hidden>
                {row.shape === "list-item" ? "-" : null}
              </div>
            )}
            {showKey &&
              (keyOptions.length > 0 ? (
                <CandidateCombobox
                  className={FM_KEY_LAYOUT}
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
                  className={cn(FM_CELL, FM_KEY_LAYOUT)}
                  value={row.key ?? ""}
                  onChange={(e) => commit(updateRow(doc.rows, i, { key: e.target.value, value: row.value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              ))}
            {showValue ? (
              isBracketList(row.value ?? "") ? (
                <BracketListValue
                  className={FM_VALUE_LAYOUT}
                  rowKey={row.key}
                  value={row.value ?? "[]"}
                  onChange={(value) => commit(updateRow(doc.rows, i, { key: row.key, value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                  candidateOptions={valueOptions}
                />
              ) : valueOptions ? (
                <CandidateCombobox
                  className={FM_VALUE_LAYOUT}
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
                  className={cn(FM_CELL, FM_VALUE_LAYOUT)}
                  value={row.value ?? ""}
                  onChange={(e) => commit(updateRow(doc.rows, i, { key: row.key, value: e.target.value }))}
                  onPaste={onPaste}
                  onKeyDown={onKeyDown}
                />
              )
            ) : (
              // 값이 빈 부모 행 - 값 칸을 안 그린다. 이 자리를 비워 둬야 키 칸 144px과 손잡이
              // 둘의 자리가 안 갈리고 열 정렬이 유지된다(§부모 행과 목록 항목 행)
              <div className={FM_VALUE_LAYOUT} aria-hidden />
            )}
            <div className="flex shrink-0 items-center gap-1">
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
