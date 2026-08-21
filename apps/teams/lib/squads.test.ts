import { test } from "node:test";
import assert from "node:assert";
import { orderedSquadMembers, sameSquadMembers } from "./squads.ts";

// §5-5 §개정 계약 표 순위 1-2-3 — `default`의 실측(`pm` `developer` `qa` `designer` `writer`)과
// 같은 모양: 화면 목록(`eligible`)은 알파벳 순인데 파일 순서는 그것과 다르다.
const saved = [
  { name: "pm", role: "" },
  { name: "developer", role: "" },
  { name: "qa", role: "" },
];
const eligible = ["archive-manager", "designer", "developer", "pm", "qa", "writer"]; // 화면 목록(정렬) 순서

test("순위 1 — 이미 있고 지금도 체크된 이름은 파일 순서 그대로다(화면 알파벳 순을 안 따른다)", () => {
  const ordered = orderedSquadMembers(["pm", "developer", "qa"], {}, saved, eligible);
  assert.deepEqual(
    ordered.map((m) => m.name),
    ["pm", "developer", "qa"],
  );
});

test("순위 2 — 새로 체크한 이름은 화면 목록 순서로 1의 뒤에 붙는다", () => {
  const ordered = orderedSquadMembers(["pm", "developer", "qa", "writer", "designer"], {}, saved, eligible);
  assert.deepEqual(
    ordered.map((m) => m.name),
    ["pm", "developer", "qa", "designer", "writer"], // 새 체크 둘은 eligible 순(designer가 writer보다 앞)
  );
});

test("순위 3 — 프로필 없는 멤버(eligible 밖)는 picked에 든 순서 그대로 꼬리에 남는다", () => {
  const ordered = orderedSquadMembers(["pm", "developer", "ghost"], {}, saved, eligible);
  assert.deepEqual(
    ordered.map((m) => m.name),
    ["pm", "developer", "ghost"],
  );
});

test("리더 체크를 끄면 다음 파일 순서 이름이 앞으로 온다", () => {
  const ordered = orderedSquadMembers(["developer", "qa"], {}, saved, eligible);
  assert.equal(ordered[0]?.name, "developer");
});

test("sameSquadMembers — 이름+역할이 같아도 순서가 다르면 다른 값이다", () => {
  const a = [
    { name: "pm", role: "" },
    { name: "developer", role: "" },
  ];
  const b = [
    { name: "developer", role: "" },
    { name: "pm", role: "" },
  ];
  assert.equal(sameSquadMembers(a, a), true);
  assert.equal(sameSquadMembers(a, b), false);
});
