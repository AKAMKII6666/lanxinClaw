/** phone 状态合同生成/校验；唯一输入为 protocol 导出，运行产品不依赖兄弟仓库。 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AFFAIR_STATUSES, AFFAIR_TRANSITIONS, JOB_STATUSES, JOB_TRANSITIONS, PROTOCOL_VERSION, PERMISSION_INTENT_TEXT_RULES } from "@lanxin-claw/protocol";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const phoneRoot = path.resolve(process.env.LANXIN_PHONE_REPO || path.join(repoRoot, "../doubaoSister"));
// 必须找到真实仓库；不存在时报错，不生成一个冒充 phone 仓库的目录。
await readFile(path.join(phoneRoot, "phone/systems/lanxinClaw/lanxinClawStore.js"));
const contracts = {
  "stateTransitions.json": {
  generatedFrom: "@lanxin-claw/protocol/states", protocolVersion: PROTOCOL_VERSION,
  affairStatuses: AFFAIR_STATUSES, affairTransitions: AFFAIR_TRANSITIONS,
  jobStatuses: JOB_STATUSES, jobTransitions: JOB_TRANSITIONS,
  },
  "permissionIntentText.json": {
    generatedFrom: "@lanxin-claw/protocol/states/permission/intent-text", protocolVersion: PROTOCOL_VERSION,
    ...PERMISSION_INTENT_TEXT_RULES,
  },
};

for (const [name, contract] of Object.entries(contracts)) {
const target = path.join(phoneRoot, "phone/systems/lanxinClaw/contracts", name);
const expected = JSON.stringify(contract, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const actual = await readFile(target, "utf8");
  if (actual !== expected) throw new Error("phone_state_contract_drift: 请运行 npm run sync:phone-contract");
  console.log(`phone ${name} 与 protocol 一致`);
} else {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, expected, "utf8");
  console.log(`已生成 phone ${name} 部署合同`);
}
}
