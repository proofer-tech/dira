import { put } from "@vercel/blob";
import { receive } from "../../../lib/error-report-intake.ts";

export async function POST(req: Request) {
  return receive(req, (path, body) =>
    put(path, body, { access: "private", contentType: "application/json", addRandomSuffix: false }),
  );
}
