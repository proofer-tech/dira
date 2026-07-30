/** 빈/0건 화면 (DESIGN.md §6 빈 상태 · §5 커스텀 5개).
 *
 *  한 줄 설명 + 1차 액션 버튼 1개. 일러스트도 아이콘도 없다. 컴포넌트로 두는 이유는 규칙을
 *  강제하기 위해서다 — 화면마다 다시 쓰면 어디는 아이콘이 붙고 어디는 버튼이 두 개가 된다. */
export function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}
