/** 온톨로지 생성 설문 4문항 + 시드 산출 (DESIGN.md §5-3 §온톨로지 빌더 §생성).
 *
 *  **순수 함수다** — fs를 안 탄다(`node --test`로 잰다). 파일에 쓰는 것은 부르는 쪽
 *  (`ontology/actions.ts`)의 몫이다.
 *
 *  **문항 4개에 «객체»·«타입»·«관계»·«온톨로지»가 없다** — 이 상수(`Q1_OPTIONS` 등)가 화면에
 *  그대로 뜨는 문구다. 산출물(`buildOntologySeedFiles`의 결과)은 `SCHEMA.md` 자체 용어
 *  («객체 타입»·«관계 타입»)를 그대로 쓴다 — 금지는 사용자가 보는 질문에만 건다.
 *
 *  **LLM을 쓰지 않는다.** Q2·Q3가 이미 선택지 기반이라(Q2는 직접 입력도 받지만) 자유 서술을
 *  파싱해 타입·관계를 뽑아낼 필요가 없다 — 답 자체가 후보다. 나중에 코퍼스 스캔으로 보강하는
 *  갈래(§5-3 §생성)가 붙어도 이 빌더의 계약(입력 → 파일 목록)은 안 갈린다. */

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

/** 필수 속성 — 설문이 속성을 묻지 않으므로(Q1~Q4 어디에도 없다) 타입마다 같은 고정 기본값을
 *  쓴다. 2~4 범위 안(§5-3 §생성 "시드는 작다")이고 사용자가 표를 보고 고쳐 쓰는 시작점이다. */
export const REQUIRED_PROPS = ["이름", "상태"] as const;

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

/** 시드가 실제로 쓰는 파일 하나 — 기준 디렉터리(해석된 `TICKET_ONTOLOGY`) 상대경로 + 전문. */
export type OntologySeedFile = { rel: string; text: string };

/** `_ontology/SCHEMA.md` — 지도 한 장. 형식은 `protocols/ontology.md` §형식(§작성 4단계) ·
 *  §형식이 vault 레퍼런스로 간다 §①과 같다: 타입 이름 · 한 줄 뜻 · 정의 파일 링크만 들고 세부
 *  (속성 표 · 허용 관계)는 타입 파일로 내려간다. 설문 응답 원문 주석은 여기 하단에 남는다 —
 *  이 파일이 온보딩 뒤 사용자가 맨 처음 여는 자리라서다. */
function buildSchemaMap(seed: OntologySeed, answers: OntologySurveyAnswers): string {
  const objectRows = seed.objectTypes.map((t) => `| ${t} | (직접 채워 넣으세요) | [[${t}]] |`);
  const relationRows = seed.relationTypes.map((r) => `| ${r.name} | ${r.domain} → ${r.range} | [[${r.name}]] |`);

  return [
    "이 스키마는 온보딩 설문으로 만든 시작점입니다 — 표를 다듬고 채워 나가세요. 세부(속성 표 ·",
    "허용 관계 · 예시)는 타입 파일에 있습니다. 나머지는 프로젝트가 굴러가며 성장 루프가 채웁니다.",
    "형식·판정 절차의 정본은 `protocols/ontology.md`.",
    "",
    `관점: ${answers.q1 || "(응답 없음)"}`,
    "",
    "## 객체 타입",
    "",
    "세부(속성 표 · 허용 관계 · 예시)는 타입 파일에 있다 — 이 표는 지도다.",
    "",
    "| 이름 | 한 줄 뜻 | 정의 |",
    "|---|---|---|",
    ...objectRows,
    "",
    "## 관계 타입",
    "",
    "세부(링크 속성 · 표현 예)는 타입 파일에 있다 — 이 표는 지도다.",
    "",
    "| 이름 | 정의역 → 치역 | 정의 |",
    "|---|---|---|",
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

/** `_ontology/object-types/<타입>.md` — 타입 정의 한 장(§형식이 vault 레퍼런스로 간다 §①).
 *  필수 속성은 `REQUIRED_PROPS` 고정값, 허용 관계는 이 타입이 정의역인 관계만 싣는다
 *  (out-going — `ontology/templates/<타입>.md`가 쓰는 것과 같은 부분집합). */
function buildObjectTypeDoc(type: string, seed: OntologySeed): string {
  const outgoing = seed.relationTypes.filter((r) => r.domain === type);
  const relLines = outgoing.length
    ? outgoing.map((r) => `- [[${r.name}]] → ${r.range}`)
    : ["- (아직 없음)"];
  const propRows = REQUIRED_PROPS.map((p) => `| \`${p}\` | string | ✅ | (직접 채워 넣으세요) |`);

  return [
    "---",
    "type: ObjectType",
    `name: ${type}`,
    `storage: objects/${type}/`,
    "---",
    "",
    `# Object Type: ${type}`,
    "",
    "온보딩 설문으로 만든 시작점입니다 — 뜻·속성·관계를 다듬어 채워 나가세요.",
    "",
    "## Properties",
    "",
    "| 이름 | 타입 | 필수 | 설명 |",
    "|---|---|---|---|",
    ...propRows,
    "",
    "## 허용된 관계 (out-going)",
    "",
    ...relLines,
    "",
    "## 예시",
    "",
    "(아직 없습니다 — 첫 객체를 만들 때 채우세요)",
    "",
  ].join("\n");
}

/** `_ontology/link-types/<이름>.md` — 관계 정의 한 장. 카디널리티는 설문이 안 주는 값이라
 *  `many-to-many`로 시작한다(가장 덜 틀리는 기본값 — 사용자가 실제 관계를 보고 좁힌다). */
function buildLinkTypeDoc(rel: OntologySeed["relationTypes"][number]): string {
  return [
    "---",
    "type: LinkType",
    `name: ${rel.name}`,
    `from: ${rel.domain}`,
    `to: ${rel.range}`,
    "cardinality: many-to-many",
    "directional: true",
    "---",
    "",
    `# Link Type: ${rel.name}`,
    "",
    "온보딩 설문으로 만든 시작점입니다 — 뜻과 카디널리티를 다듬어 채워 나가세요.",
    "",
    "## 링크 속성",
    "",
    "(아직 없음)",
    "",
    "## 표현 예",
    "",
    "```markdown",
    "links:",
    `  ${rel.name}:`,
    `    - <대상키>: "[[대상 이름]]"`,
    "```",
    "",
  ].join("\n");
}

/** `ontology/templates/<타입>.md` — 새 객체가 시작하는 빈 frontmatter(§5-3 §생성 "템플릿도
 *  시드가 같이 낸다"). 키만 서 있고 값은 비어 있다 — 채우는 것은 성장 루프의 몫이다. */
function buildObjectTemplate(type: string, seed: OntologySeed): string {
  const outgoing = seed.relationTypes.filter((r) => r.domain === type);
  const linksBlock = outgoing.length
    ? ["links:", ...outgoing.map((r) => `  ${r.name}: []`)]
    : ["links:"];

  return [
    "---",
    `type: ${type}`,
    "name: ",
    "aliases: []",
    "tags: []",
    "description: ",
    ...REQUIRED_PROPS.map((p) => `${p}: `),
    ...linksBlock,
    "---",
    "",
    "# ",
    "",
  ].join("\n");
}

/** 설문 완료가 실제로 쓰는 파일 전부 — `_ontology/SCHEMA.md`(지도) + 타입마다
 *  `_ontology/object-types/<타입>.md` + 관계마다 `_ontology/link-types/<이름>.md` +
 *  `ontology/templates/<타입>.md`(§5-3 §생성·§형식이 vault 레퍼런스로 간다). 부르는 쪽
 *  (`ontology/actions.ts`)이 순서대로 `createFile` + `saveFile`한다. */
export function buildOntologySeedFiles(answers: OntologySurveyAnswers): OntologySeedFile[] {
  const seed = buildSeed(answers);
  const files: OntologySeedFile[] = [{ rel: "_ontology/SCHEMA.md", text: buildSchemaMap(seed, answers) }];

  for (const type of seed.objectTypes) {
    files.push({ rel: `_ontology/object-types/${type}.md`, text: buildObjectTypeDoc(type, seed) });
    files.push({ rel: `templates/${type}.md`, text: buildObjectTemplate(type, seed) });
  }
  for (const rel of seed.relationTypes) {
    files.push({ rel: `_ontology/link-types/${rel.name}.md`, text: buildLinkTypeDoc(rel) });
  }
  return files;
}
