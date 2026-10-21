import { del, list } from "@vercel/blob";
import { purge } from "../../../../lib/error-report-purge.ts";

export async function GET(req: Request) {
  return purge(req, {
    list: async (cursor) => {
      const r = await list({ prefix: "error-reports/", cursor });
      return { paths: r.blobs.map((b) => b.pathname), cursor: r.hasMore ? r.cursor : undefined };
    },
    del: (paths) => del(paths),
  });
}
