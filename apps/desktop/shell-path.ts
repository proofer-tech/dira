/** 앱이 켜질 때 `~/.config/dira/bin`을 사람의 셸 PATH에 한 번 넣는다 (P484). 엔진은 건드리지 않는다. */
import { appendFile, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const MARK = ".config/dira/bin";
const BLOCK = `# >>> dira >>>
if [ -d "$HOME/.config/dira/bin" ]; then case ":$PATH:" in *":$HOME/.config/dira/bin:"*) ;; *) export PATH="$HOME/.config/dira/bin:$PATH" ;; esac; fi
# <<< dira <<<
`;

export const shellPathBlock = BLOCK;

/** 설정 파일 끝에 블록을 덧붙이고(이미 `.config/dira/bin`이 있으면 읽기만), 이번 기동 PATH 앞에도 더한다. */
export async function installShellPath(home: string, shell: string, env: NodeJS.ProcessEnv = process.env) {
  const name = basename(shell || "");
  const file = name === "zsh" ? join(env.ZDOTDIR || home, ".zshrc") : name === "bash" ? join(home, ".bash_profile") : null;
  if (!file) console.log(`[dira] 셸 PATH: ${shell || "(빈 값)"}은 자동 설정하지 않습니다`);
  else {
    const cur = await readFile(file, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
    if (!cur.includes(MARK)) await appendFile(file, (cur && !cur.endsWith("\n") ? "\n" : "") + BLOCK, { mode: 0o644 });
  }
  const bin = join(home, MARK);
  const parts = (env.PATH ?? "").split(":");
  if (!parts.includes(bin)) env.PATH = [bin, ...parts.filter(Boolean)].join(":");
}
