/** 오류 제보 90일 파기 — DESIGN.md §P513 결정 7. 날짜 폴더 이름이 UTC 오늘로부터 90일보다 오래되면 지운다.
 *  Blob 접근은 주입한다(`error-report-purge.test.ts`). */
export const RETENTION_DAYS = 90;

export type Store = {
  list: (cursor?: string) => Promise<{ paths: string[]; cursor?: string }>;
  del: (paths: string[]) => Promise<void>;
};

export function isExpired(path: string, now: Date): boolean {
  const m = /^error-reports\/(\d{4}-\d{2}-\d{2})\//.exec(path);
  if (!m) return false;
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - RETENTION_DAYS));
  return m[1] < cutoff.toISOString().slice(0, 10);
}

export async function purge(req: Request, store: Store, now = new Date()): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await store.list(cursor);
    const old = page.paths.filter((p) => isExpired(p, now));
    if (old.length) {
      await store.del(old);
      deleted += old.length;
    }
    cursor = page.cursor;
  } while (cursor);
  return Response.json({ deleted });
}
