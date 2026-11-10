/** 대조 테스트(P559 결정 9): `app/**` 서버 액션 이름 하나하나가 `COVERED` - `EXCLUDED` - `PENDING` 셋 중 정확히
 *  하나에 있어야 한다. 셋 다 없는 새 액션이 생기면 실패한다 - 화면에서만 되는 일이 조용히 늘지 못하게 막는 자리다.
 *  P559-4~8이 자기 행을 옮기며 `PENDING`에서 `COVERED`로 옮기고, 끝나면 `PENDING`은 비어 있다. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { OPS } from "./index.ts";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app");
const ENGINE_MCP = path.join(APP, "..", "..", "..", "mcp_tools.py");

/** 액션 -> op 이름, 또는 `mcp:<파이썬 도구>`. */
const COVERED: Record<string, string> = {
  createProject: "project_create",
  saveIntegrationBranchAction: "project_settings_set",
  saveOntologyAction: "project_ontology_set",
  saveContextAction: "project_context_set",
  saveCommonContextAction: "project_context_set",
  copyContextAction: "project_context_copy",
  // 이미 파이썬 MCP 도구가 있다
  registerProject: "mcp:project_register",
  renameProjectAction: "mcp:project_rename",
  moveProjectAction: "mcp:project_reorder",
  unregisterProjectAction: "mcp:project_unregister",
  resolveProjectAction: "mcp:projects",
  setLanguageAction: "mcp:settings_set",
  readAutonomyAction: "mcp:settings_get",
  setAutonomyAction: "mcp:settings_set",
  setAutopilotAction: "mcp:settings_set",
  readMultiplayAction: "mcp:settings_get",
  setMultiplayAction: "mcp:settings_set",
  readMultitokenAction: "mcp:settings_get",
  setMultitokenAction: "mcp:settings_set",
  sessionCapOf: "mcp:settings_get",
  saveSessionLimitAction: "mcp:settings_set",
  readSlimAction: "mcp:project_settings_get",
  setSlimAction: "mcp:project_slim",
  readIntegrationBranchAction: "mcp:project_settings_get",
  listEnvAction: "mcp:env_list",
  changeEnvAction: "mcp:env_create",
  reapWorkerAction: "mcp:reap",
  createTicket: "mcp:ticket_create",
  answerRequirement: "mcp:ticket_answer",
  sendInterject: "mcp:interject",
  unassignTicket: "mcp:unassign",
};

/** 안 채우는 것(스펙 §안 하는 것). 값은 사유다. */
const NO_SAFETY = "사람이 직접 하는 안전장치다(P559 판단).";
const NO_SECRET = "자격 증명 - 비밀값은 사람이 화면에서 넣는다(P559 판단).";
const NO_CONSENT = "사용 통계 동의는 사람이 정한다(P559 판단).";
const NO_SCREEN = "화면 상호작용 - MCP로 열어도 에이전트가 할 수 있는 일이 늘지 않는다(P559 판단).";
const EXCLUDED: Record<string, string> = {
  enableEmergencyStopAction: NO_SAFETY,
  disableEmergencyStopAction: NO_SAFETY,
  saveTokenAction: NO_SECRET, readTokenRowsAction: NO_SECRET, setTokenEnabledAction: NO_SECRET,
  setActiveTokenAction: NO_SECRET, setTokenLabelAction: NO_SECRET, deleteTokenAction: NO_SECRET,
  readEngineProfileRowsAction: NO_SECRET, captureEngineProfileAction: NO_SECRET, setEngineProfileEnabledAction: NO_SECRET,
  setActiveEngineProfileAction: NO_SECRET, setEngineProfileLabelAction: NO_SECRET, deleteEngineProfileAction: NO_SECRET,
  startSetupAction: NO_SECRET, pollSetupAction: NO_SECRET, sendSetupCodeAction: NO_SECRET, stopSetupAction: NO_SECRET,
  vercelStatusAction: NO_SECRET, vercelConnectAction: NO_SECRET, vercelDisconnectAction: NO_SECRET,
  vercelSyncAction: NO_SECRET, vercelRedeployAction: NO_SECRET, vercelTokenAction: NO_SECRET,
  readWebhookAction: NO_SECRET, setWebhookAction: NO_SECRET, testWebhookAction: NO_SECRET,
  readAnalyticsAction: NO_CONSENT, setAnalyticsAction: NO_CONSENT, trackEvent: NO_CONSENT,
  // 홈 대화 - 터미널 - 소스 컨트롤 - 탐색기 - 브라우저 탭 - 링크(home/actions.ts 전부, createSchedule/deleteSchedule 제외)
  askHome: NO_SCREEN, interjectHome: NO_SCREEN, pollHomeAnswer: NO_SCREEN, pollTabs: NO_SCREEN, refreshRefs: NO_SCREEN,
  stopHome: NO_SCREEN, clearHome: NO_SCREEN, switchHome: NO_SCREEN, closeTab: NO_SCREEN, openTerminal: NO_SCREEN,
  runCommandInTerminal: NO_SCREEN, restartTerminal: NO_SCREEN, closeTerminalTab: NO_SCREEN, terminalStatuses: NO_SCREEN,
  scmCheckouts: NO_SCREEN, scmStatus: NO_SCREEN, openBrowserTabAction: NO_SCREEN, browserPoolTickets: NO_SCREEN,
  openLinkAction: NO_SCREEN, releaseLinkAction: NO_SCREEN, scmStage: NO_SCREEN, scmUnstage: NO_SCREEN, scmStageAll: NO_SCREEN,
  scmRemoteBranches: NO_SCREEN, scmSetUpstream: NO_SCREEN, scmCommit: NO_SCREEN, scmPush: NO_SCREEN, scmPull: NO_SCREEN,
  listExplorerDirAction: NO_SCREEN, openExplorerFileAction: NO_SCREEN, openExplorerFileTab: NO_SCREEN,
  setExplorerTabUnsaved: NO_SCREEN, saveExplorerFileAction: NO_SCREEN, findByNameAction: NO_SCREEN,
  findByContentAction: NO_SCREEN, openExplorerFileExternallyAction: NO_SCREEN,
  draftCommandAction: NO_SCREEN, openEpicReadmeAction: NO_SCREEN, openOntologyFileAction: NO_SCREEN,
  openPersonaProfileAction: NO_SCREEN, openProtocolFileAction: NO_SCREEN, openTicketFileAction: NO_SCREEN,
  uploadAttachment: NO_SCREEN, tailSession: NO_SCREEN, dropTicketToWip: NO_SCREEN,
  setBindingAction: NO_SCREEN, resetKeymapAction: NO_SCREEN, markFailuresReadAction: NO_SCREEN, markResumeReadAction: NO_SCREEN,
  toggleFavoriteAction: NO_SCREEN,
  readSelfishAction: NO_SCREEN, startSelfishAction: NO_SCREEN, stopSelfishAction: NO_SCREEN, checkSelfishPermissionAction: NO_SCREEN,
  readSelfishPanelAction: NO_SCREEN, previewSelfishAction: NO_SCREEN, saveSelfishSettingsAction: NO_SCREEN,
  reportRendererErrorAction: NO_SCREEN, feedbackMetaAction: NO_SCREEN, readMcpAction: NO_SCREEN,
};

/** 아직 안 옮긴 채움 행 -> 담당 행. P559-4~8이 옮기며 `COVERED`로 보내고 여기서 뺀다. */
const PENDING: Record<string, string> = {
  // P559-5
  createWorkerAction: "P559-5", deleteWorkerAction: "P559-5", stopWorkerAction: "P559-5", retryWorktreeAction: "P559-5",
  registerWorkerAction: "P559-5", readWorkersPanelAction: "P559-5", applySelfHealAction: "P559-5",
  applyDispatchGateAction: "P559-5", applyExecBitAction: "P559-5", applyCommonSourceAction: "P559-5",
  runSelfHeal: "P559-5", discardGateDirtyAction: "P559-5", fixTicketFilesAction: "P559-5",
  // P559-6
  createPersonaAction: "P559-6", savePersonaAction: "P559-6", deletePersonaAction: "P559-6", hidePersonaAction: "P559-6",
  unhidePersonaAction: "P559-6", copySharedToLocalAction: "P559-6", setPersonaColorAction: "P559-6",
  savePersonaSkillsAction: "P559-6", savePersonaLimitAction: "P559-6", savePersonaEngineAction: "P559-6",
  deletePersonaMemoryAction: "P559-6", createSquadAction: "P559-6", saveSquadMembersAction: "P559-6",
  saveSquadRulesAction: "P559-6", deleteSquadAction: "P559-6", createSquadDesignTicketAction: "P559-6",
  issueSquadReviewTicketAction: "P559-6", listTrashAction: "P559-6", restoreTrashAction: "P559-6",
  purgeTrashAction: "P559-6", installSkillAction: "P559-6", loadMarketPaneData: "P559-6",
  getMarketItemDetailAction: "P559-6", importPersonaAction: "P559-6", importSquadAction: "P559-6",
  previewMarketUpdateAction: "P559-6", deployPersonaAction: "P559-6", missingSquadMembersAction: "P559-6",
  deploySquadAction: "P559-6",
  // P559-7
  saveProtocolAction: "P559-7", createProtocolAction: "P559-7", deleteProtocolAction: "P559-7",
  renameProtocolAction: "P559-7", createEpic: "P559-7", saveEpicReadmeAction: "P559-7", deleteEpicMemoryAction: "P559-7",
  listCommandsAction: "P559-7", createCommandAction: "P559-7", updateCommandAction: "P559-7",
  deleteCommandAction: "P559-7", lastCommandRunAction: "P559-7", createSchedule: "P559-7", deleteSchedule: "P559-7",
  // P559-8
  saveTicket: "P559-8", saveTicketFrontmatter: "P559-8", setTicketEpic: "P559-8", deleteTicket: "P559-8",
  sendFollowup: "P559-8", dispatchPollingNowAction: "P559-8", extendPollingUntilAction: "P559-8",
  retryBackoffNowAction: "P559-8", createOntologyAction: "P559-8", deleteOntologyAction: "P559-8",
  renameOntologyAction: "P559-8", fixOntologySchemaAction: "P559-8", publishOntologyMigrationAction: "P559-8",
  publishOntologyImportAction: "P559-8", submitOntologySurveyAction: "P559-8", loadOntologyMetricsAction: "P559-8",
  readEmergencyStopAction: "P559-8",
};

function actionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return actionFiles(p);
    return e.name === "actions.ts" || e.name.endsWith("-actions.ts") ? [p] : [];
  });
}

export function actionNames(): Set<string> {
  const names = new Set<string>();
  for (const f of actionFiles(APP)) {
    for (const m of readFileSync(f, "utf8").matchAll(/^export async function (\w+)/gm)) names.add(m[1]);
  }
  return names;
}

test("서버 액션 전부가 COVERED - EXCLUDED - PENDING 중 정확히 하나에 있다", () => {
  const names = actionNames();
  assert.ok(names.size > 100, `액션을 못 찾았다(${names.size})`);
  const problems: string[] = [];
  for (const n of [...names].sort()) {
    const where = [n in COVERED && "COVERED", n in EXCLUDED && "EXCLUDED", n in PENDING && "PENDING"].filter(Boolean);
    if (where.length !== 1) problems.push(`${n}: ${where.length ? where.join("+") : "대조표에 없다"}`);
  }
  assert.deepEqual(problems, [], "대조표에 행을 더하세요(lib/ops/parity.test.ts)");
});

test("대조표에 있는 이름은 실제 액션이다(없앤 액션이 남지 않는다)", () => {
  const names = actionNames();
  const stale = [...Object.keys(COVERED), ...Object.keys(EXCLUDED), ...Object.keys(PENDING)].filter((n) => !names.has(n));
  assert.deepEqual(stale, []);
});

test("COVERED의 op는 OPS에, mcp:는 mcp_tools.py에 실제로 있다", () => {
  const py = readFileSync(ENGINE_MCP, "utf8");
  for (const [action, target] of Object.entries(COVERED)) {
    if (target.startsWith("mcp:")) {
      assert.ok(py.includes(`"${target.slice(4)}"`), `${action}: 파이썬 도구 ${target}이 없다`);
    } else {
      assert.ok(Object.hasOwn(OPS, target), `${action}: OPS에 ${target}이 없다`);
    }
  }
});
