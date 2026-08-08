/** 온톨로지 생성 설문 4문항 + 시드 산출 (DESIGN.md §5-3 §온톨로지 빌더 §생성).
 *
 *  **순수 함수다** — fs를 안 탄다(`node --test`로 잰다). 파일에 쓰는 것은 부르는 쪽
 *  (`ontology/actions.ts`)의 몫이다.
 *
 *  **문항 4개에 «객체»·«타입»·«관계»·«온톨로지»가 없다** — 이 상수(`Q1_OPTIONS` 등)가 화면에
 *  그대로 뜨는 문구다. 산출물(`buildOntologySeed`의 결과)은 `SCHEMA.md` 자체 용어(«객체 타입»·
 *  «관계 타입»)를 그대로 쓴다 — 금지는 사용자가 보는 질문에만 건다.
 *
 *  **LLM을 쓰지 않는다.** Q2·Q3가 이미 선택지 기반이라(Q2는 직접 입력도 받지만) 자유 서술을
 *  파싱해 타입·관계를 뽑아낼 필요가 없다 — 답 자체가 후보다. 나중에 코퍼스 스캔으로 보강하는
 *  갈래(§5-3 §생성)가 붙어도 이 빌더의 계약(입력 → 문자열)은 안 갈린다. */

/** 문항 4개의 질문 문구 — 화면이 그대로 쓴다. 여기 상수로 두는 이유는 테스트가 "문항에 금지어가
 *  없다"를 이 파일 하나로 확인하기 위해서다(화면 문자열을 따로 베끼면 둘이 갈릴 수 있다). */
export const QUESTIONS = {
  q1: "이 프로젝트는 주로 무엇을 다루나요?",
  q2: "일하다 보면 자주 이름을 불러 부르게 될 대상은 무엇인가요?",
  q3: "나중에 이런 걸 물어보게 될 것 같나요?",
  q4: "다음 중 프로젝트 자체가 아니라 작업 흔적이라 정리 대상이 아닌 것을 골라주세요",
} as const;

/** Q1 — 유도 프롬프트의 관점. 아키타입 팩이 아니다(타입은 Q2~Q4로 만든다) — 시드 머리말에
 *  한 줄로만 남는다. */
export const Q1_OPTIONS = [
  "제품이나 코드를 만듭니다",
  "글이나 콘텐츠를 만듭니다",
  "사람을 상대합니다 (고객·파트너·팀)",
  "자료를 모으고 정리합니다",
] as const;

/** Q2 — 객체 타입 1차 후보. 직접 입력은 화면이 `custom` 배열로 따로 받아 앞에 붙인다
 *  (설계: "직접 적은 것은 확신도가 높아 우선 채택"). */
export const Q2_CHIPS = ["고객", "프로젝트", "문서", "작업", "제품"] as const;

/** Q3 — 관계 타입 후보. 문항은 질문 문장이고 값은 그 질문이 묻는 관계 이름 하나다(질문의
 *  명사·동사를 미리 관계 이름으로 굳혀 자유 서술 파싱을 피한다). */
export const Q3_OPTIONS = [
  { label: "이게 무엇과 연결되나요?", relation: "연결한다" },
  { label: "누가 관여했나요?", relation: "담당한다" },
  { label: "무엇 때문에 이렇게 됐나요?", relation: "원인이다" },
  { label: "다음에 무엇으로 이어지나요?", relation: "이어진다" },
] as const;

/** Q4 — 경계(정리 대상이 아닌 것). 화면이 첫 항목을 기본 체크로 보여준다(설계: "dira 큐 자신은
 *  기본 제외로 제시한다"). 값은 시드 하단 주석에만 남는다 — 이 티켓 범위는 코퍼스 스캔 자체를
 *  안 건드린다(§5-3 §생성 "깊이 파지 않는다"). */
export const Q4_OPTIONS = [
  "이 프로젝트를 굴리는 관리 도구 자체(예: 지금 쓰는 이 화면)",
  "임시 메모나 낙서",
  "지나간 대화 로그",
  "테스트로 남긴 파일",
] as const;

export type OntologySurveyAnswers = {
  q1: string;
  /** 체크한 것 + 직접 입력을 화면이 이미 합친 배열. 우선순위(직접 입력 먼저)도 화면이 정해 온다 */
  q2: string[];
  /** `Q3_OPTIONS`의 `relation` 값들(체크한 것) */
  q3: string[];
  q4: string[];
};

/** 시드 하나가 갖는 것 — 표에 실제로 들어가는 값. `## 결과`에 그대로 붙이기 좋은 모양이라
 *  마크다운과 별개로 돌려준다. */
export type OntologySeed = {
  objectTypes: string[];
  relationTypes: { name: string; domain: string; range: string }[];
};

/** 최소 3 최대 5 후보를 정한다 — 부족하면 채우고 남으면 앞에서 자른다(=우선순위 그대로).
 *  `fallback`은 사용자가 아무것도 안 골라도 표가 비지 않게 하는 자리다(§5-3 "시드는 작다"). */
function pick(entries: readonly string[], min: number, max: number, fallback: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const v = e.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length === max) return out;
  }
  for (const f of fallback) {
    if (out.length === min) break;
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

const OBJECT_FALLBACK = ["자료", "기록", "메모", "항목", "노트"] as const;
const RELATION_FALLBACK = ["관련된다", "속한다"] as const;

export function buildSeed(answers: OntologySurveyAnswers): OntologySeed {
  const objectTypes = pick(answers.q2, 3, 5, OBJECT_FALLBACK);
  const relationNames = pick(answers.q3, 2, 4, RELATION_FALLBACK);
  // 정의역/치역은 답이 주지 않는 값이다 — 고른 객체 타입을 순서대로 돌려 끼운다(타입이 하나뿐이면
  // 정의역=치역). 사용자가 표를 보고 직접 고쳐 쓰는 것을 전제한다(시드는 시작점이다).
  const relationTypes = relationNames.map((name, i) => ({
    name,
    domain: objectTypes[i % objectTypes.length],
    range: objectTypes[(i + 1) % objectTypes.length],
  }));
  return { objectTypes, relationTypes };
}

/** `SCHEMA.md` 전문. 형식은 `protocols/ontology.md` §형식(§작성 4단계)의 표와 같다 — 액션 타입
 *  절은 없다(시드에는 아직 반영할 액션이 없다. 성장 루프가 첫 반영 때 연다). */
export function buildOntologySeed(answers: OntologySurveyAnswers): string {
  const seed = buildSeed(answers);

  const objectRows = seed.objectTypes.map((t) => `| ${t} | 이름 · 상태 | (직접 채워 넣으세요) |`);
  const relationRows = seed.relationTypes.map((r) => `| ${r.name} | ${r.domain} → ${r.range} |`);

  return [
    "이 스키마는 온보딩 설문으로 만든 시작점입니다 — 표를 다듬고 채워 나가세요. 나머지는",
    "프로젝트가 굴러가며 성장 루프가 채웁니다. 형식·판정 절차의 정본은 `protocols/ontology.md`.",
    "",
    `관점: ${answers.q1 || "(응답 없음)"}`,
    "",
    "## 객체 타입",
    "",
    "| 이름 | 필수 속성 | 뜻 |",
    "|---|---|---|",
    ...objectRows,
    "",
    "## 관계 타입",
    "",
    "| 이름 | 정의역 → 치역 |",
    "|---|---|",
    ...relationRows,
    "",
    "<!-- 설문 응답 원문",
    `Q1. 이 프로젝트는 주로 무엇을 다루나요: ${answers.q1 || "(응답 없음)"}`,
    `Q2. 자주 이름을 부르게 될 것: ${answers.q2.join(", ") || "(응답 없음)"}`,
    `Q3. 나중에 물어보실 것 같은 것: ${answers.q3.join(", ") || "(응답 없음)"}`,
    `Q4. 정리 대상이 아닌 것: ${answers.q4.join(", ") || "(응답 없음)"}`,
    "-->",
    "",
  ].join("\n");
}
