/** 온톨로지 지표 계산에 필요한 텍스트를 fs에서 모아 순수 함수(`computeOntologyMetrics`)에
 *  넘긴다 (DESIGN.md §온톨로지 화면의 설정성 표면 셋이 설정 다이얼로그로 간다 결정 3 — 판정
 *  코드는 한 줄도 안 갈리고, 그것을 부르는 자리만 `ontology/page.tsx`에서 여기로 내려온다).
 *
 *  `ontology/page.tsx`(위반 카드) - `app/actions.ts`의 `loadOntologyMetricsAction`(설정 >
 *  프로젝트 노드의 지표 칸, 별도 왕복) - `ontology/actions.ts`의 `fixOntologySchemaAction`(정리
 *  티켓 본문) 셋이 이 함수 하나를 같이 부른다 — 세 곳이 각자 계산하면 숫자가 갈릴 수 있다. */
import { readTextFile, type ProtocolEntry } from "./protocols.ts";
import { computeOntologyMetrics, type OntologyMetrics } from "./ontology.ts";
import type { Locale } from "./i18n.ts";

export async function loadMetrics(base: string, tree: ProtocolEntry[], locale: Locale): Promise<OntologyMetrics> {
  const basename = (rel: string) => rel.split("/").at(-1) ?? rel;
  const text = async (rel: string) => (await readTextFile(base, rel)).text ?? "";

  const schemaEntry = tree.find((e) => !e.isDir && e.rel === "_ontology/SCHEMA.md");
  const objectEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("objects/") && e.rel.endsWith(".md"));
  const viewEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("object-views/") && e.rel.endsWith(".md"));
  const logEntries = tree.filter((e) => !e.isDir && e.rel.startsWith("action-log/") && e.rel.endsWith(".md"));
  const typeFileEntries = tree.filter(
    (e) => !e.isDir && e.rel.startsWith("_ontology/object-types/") && e.rel.endsWith(".md"),
  );

  const [schemaText, objects, views, actionLogs, typeFiles] = await Promise.all([
    schemaEntry ? text(schemaEntry.rel) : Promise.resolve(""),
    Promise.all(objectEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
    Promise.all(viewEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
    Promise.all(
      logEntries.map(async (e) => ({ date: basename(e.rel).replace(/\.md$/, ""), text: await text(e.rel) })),
    ),
    Promise.all(typeFileEntries.map(async (e) => ({ rel: e.rel, text: await text(e.rel) }))),
  ]);

  return computeOntologyMetrics({ schemaText, objects, views, actionLogs, typeFiles }, locale);
}
