/**
 * 权限建议的目标文本规则；phone 部署副本由合同生成器同步。
 * 职责：过滤明确禁止的子句，供关键词推断使用。
 * 不拥有：目标原文修改、权限授予或撤销。纯函数：只返回过滤后的文本。
 * 这是有限的语句启发式，不承担自然语言授权判断。
 */
export const PERMISSION_INTENT_TEXT_RULES = {
  clauseBoundary: "[，,。；;！!？?\\n]|\\.\\s+|但是|但|而是|然后|\\b(?:but|instead|and then)\\b",
  prohibition: "不要|不需要|无需|无须|禁止|不得|不能|切勿|避免|严禁|不允许|不(?=联网|搜索|调用|使用|打开|执行|访问|上网)|\\b(?:do not|don't|must not|should not|never|without|avoid)\\b|\\bno\\s+(?:network|internet|web|browser|search)",
} as const;

/**
 * 提取可用于权限建议的文本；负面限制原文仍须完整传给执行器。
 * @param goal 原目标
 * @returns 排除明确禁止子句后的文本
 */
export function permissionInferenceText(goal: string | null | undefined): string {
  const boundary = new RegExp(PERMISSION_INTENT_TEXT_RULES.clauseBoundary, "i");
  const prohibition = new RegExp(PERMISSION_INTENT_TEXT_RULES.prohibition, "i");
  return String(goal ?? "").split(boundary).map((clause) => {
    const index = clause.search(prohibition);
    return index < 0 ? clause : clause.slice(0, index);
  }).join(" ");
}
