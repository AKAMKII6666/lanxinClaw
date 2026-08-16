/**
 * Companion 壳进程入口骨架。
 *
 * 职责：标明 companion app 启动边界，并输出最小联通摘要。
 * 不拥有：renderer 直连副作用、OpenClaw core 改造、电话端 call chain。
 * 副作用：当前仅读内存常量；discovery / pairing / identity / desktop shell 由调用方显式启动。
 */

/**
 * 返回 companion 骨架启动摘要，供后续诊断页与 mock companion 对齐。
 *
 * @returns 不含凭据明文的短摘要
 */
export function describeCompanionBootstrap(): string {
  return "companion=0.1.0-dev; discovery=mdns; pairing=lifecycle; identity=store; shell=electron+mui; bridge=ipc-whitelist; overview=status-cards; jobs=low-risk-readonly; protocol=@lanxin-claw/protocol@0.1; adapter=@lanxin-claw/openclaw-adapter";
}
