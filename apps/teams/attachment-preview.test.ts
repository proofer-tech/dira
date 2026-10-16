import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ko, en } from "./lib/i18n.ts";
import { isImageAttachment } from "./lib/attachment-format.ts";

// 클라이언트 컴포넌트라 import를 못 댄다(`ticket-ui.test.ts`와 같은 관용) - 소스에서 갈래를 읽는다.
const s = readFileSync("components/attachment-preview.tsx", "utf8");
const image = s.slice(s.indexOf("function AttachmentImage"), s.indexOf("export function AttachmentPreview"));
const preview = s.slice(s.indexOf("export function AttachmentPreview"));

test("P507 - 그림은 button 트리거 + 다이얼로그, 그림에 크기 제한이 없다", () => {
  assert.ok(s.startsWith('"use client"'));
  assert.match(image, /<button type="button" className="cursor-zoom-in"/);
  assert.match(image, /<DialogContent className="[^"]*max-w-\[95vw\][^"]*"/);
  const c = image.match(/<DialogContent className="([^"]*)"/)![1];
  for (const k of ["max-h-[95vh]", "max-w-[95vw]", "overflow-auto", "p-0"]) assert.ok(c.split(" ").includes(k), k);
  assert.match(image, /<img src=\{href\} alt=\{name\} className="[^"]*max-w-none[^"]*"/);
  assert.match(image, /target="_blank"/); // 새 탭에서 열기 길이 다이얼로그 안에 남는다
});

test("P507 - 그림이 아닌 첨부와 svg는 새 탭 칩이다", () => {
  assert.match(preview, /<AttachmentImage /);
  assert.match(preview, /<a key=\{p\} href=\{href\} target="_blank" rel="noreferrer">\s*<Badge/);
  for (const n of ["a.png", "a.JPG", "a.webp"]) assert.ok(isImageAttachment(n));
  for (const n of ["a.svg", "a.pdf", "a.txt"]) assert.ok(!isImageAttachment(n));
});

test("P507 - 새 i18n 키가 ko-en에 있다", () => {
  for (const k of ["attachment.openPreview", "attachment.openInNewTab"]) {
    assert.ok(ko[k], `ko ${k}`);
    assert.ok(en[k], `en ${k}`);
  }
});
