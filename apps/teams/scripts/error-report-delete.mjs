#!/usr/bin/env node
// 사용: BLOB_READ_WRITE_TOKEN=... node scripts/error-report-delete.mjs <install_id> [--dry-run]
// error-reports/ 전체에서 파일 이름이 `<install_id>-`로 시작하는 Blob을 지우고 경로를 출력한다.
import { del, list } from "@vercel/blob";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const id = args.find((a) => !a.startsWith("--"));
if (!id || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("사용: BLOB_READ_WRITE_TOKEN=... node scripts/error-report-delete.mjs <install_id> [--dry-run]");
  process.exit(2);
}
// 경로 조각 정리(error-report-intake.ts의 safe)와 같은 규칙으로 맞춘다.
const safe = id.replace(/[^A-Za-z0-9_.:-]/g, "_").replace(/\.{2,}/g, "_").slice(0, 64);
const hits = [];
let cursor;
do {
  const r = await list({ prefix: "error-reports/", cursor });
  for (const b of r.blobs) if (b.pathname.split("/").pop().startsWith(`${safe}-`)) hits.push(b.pathname);
  cursor = r.hasMore ? r.cursor : undefined;
} while (cursor);
if (!dry && hits.length) await del(hits);
for (const p of hits) console.log(p);
console.error(`${dry ? "대상" : "삭제"} ${hits.length}건`);
