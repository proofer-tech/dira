/** 환경변수 로컬 관리 브리지 (DESIGN.md §프로젝트 환경변수 저장과 실행 계약 2). 127.0.0.1 HTTP이고
 *  메인 프로세스에서 돈다. 계약은 `list` `create` `replace` `delete` 넷이며 값 조회 경로가 없다.
 *  `run`의 복호화는 `EnvStore.resolveForRun`을 메인 프로세스 안에서 직접 부른다(이 HTTP에 안 연다).
 *
 *  인증: 토큰 = HMAC-SHA256(secret, projectKey). 서버(`apps/teams`)와 세션은 secret을 받은
 *  쪽이 프로젝트마다 이 토큰을 파생한다(`deriveToken`). 요청이 지목한 프로젝트의 키로 다시 계산해
 *  맞아야 통과하므로 토큰은 그 프로젝트 하나에 묶인다. 브라우저 요청(`Origin` 헤더)은 거부해서
 *  웹 렌더러가 이 채널을 못 쓴다. 토큰과 값은 로그에 적지 않는다. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EnvError, resolveProject, type EnvStore } from "./env-store.ts";

export function deriveToken(secret: string, projectKey: string): string {
  return createHmac("sha256", secret).update(projectKey).digest("hex");
}

const STATUS: Record<string, number> = {
  invalid_name: 400,
  reserved_name: 400,
  invalid_value: 400,
  too_large: 413,
  bad_project: 400,
  duplicate: 409,
  conflict: 409,
  not_found: 404,
  locked: 503,
  corrupt: 500,
  io: 500,
};
const MAX_BODY = 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new EnvError("too_large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new EnvError("invalid_value"));
      }
    });
    req.on("error", reject);
  });
}

const sha = (s: string) => createHash("sha256").update(s).digest();

export function createEnvBridge(opts: {
  store: EnvStore;
  secret: string;
  /** 경로와 상태 코드만 받는다. 본문과 토큰은 넘기지 않는다. */
  log?: (line: string) => void;
}) {
  async function handle(req: IncomingMessage, res: ServerResponse, port: number) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const reply = (status: number, body: unknown) => {
      opts.log?.(`${req.method} ${url.pathname} ${status}`);
      send(res, status, body);
    };
    if (req.headers.origin || req.headers.host !== `127.0.0.1:${port}`) return reply(403, { error: "forbidden" });
    const m = /^\/env\/v1\/(list|create|replace|delete)$/.exec(url.pathname);
    if (!m) return reply(404, { error: "not_found" });
    const op = m[1];
    if ((op === "list") !== (req.method === "GET") || (op !== "list" && req.method !== "POST")) {
      return reply(405, { error: "method" });
    }
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1];
    if (!bearer) return reply(401, { error: "unauthorized" });
    try {
      const body = (op === "list" ? {} : await readBody(req)) as Record<string, unknown>;
      const projectIn = op === "list" ? url.searchParams.get("project") : body.project;
      const { root, key } = await resolveProject(projectIn);
      const want = sha(deriveToken(opts.secret, key));
      if (!timingSafeEqual(want, sha(bearer))) {
        // 존재하는 다른 프로젝트의 토큰이거나 틀린 토큰 - 어느 쪽인지 알려주지 않는다.
        return reply(403, { error: "forbidden" });
      }
      const s = opts.store;
      if (op === "list") return reply(200, { items: await s.list(root) });
      if (op === "create") return reply(200, await s.create(root, body.name, body.value));
      if (op === "replace") {
        return reply(200, await s.replace(root, body.name, body.value, body.expectedRevision));
      }
      return reply(200, await s.delete(root, body.name, body.expectedRevision));
    } catch (e) {
      const code = e instanceof EnvError ? e.code : "io";
      // 인증 전 단계의 bad_project는 토큰 없이 경로 존재를 캐는 데 쓰이지 않게 위 bearer 검사 뒤에만 도달한다.
      reply(STATUS[code] ?? 500, { error: code });
    }
  }

  return {
    /** 127.0.0.1의 빈 포트에 연다. */
    listen(): Promise<{ server: Server; port: number }> {
      return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
          void handle(req, res, (server.address() as { port: number }).port);
        });
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as { port: number }).port }));
      });
    },
  };
}
