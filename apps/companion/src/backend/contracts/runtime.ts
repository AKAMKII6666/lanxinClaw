/** backend 运行时注入合同；仅声明端口，不执行协议或权限操作。 */
import type { ProtocolEnvelope } from "@lanxin-claw/protocol";
import { AffairActionCoordinator } from "../../affairs/actions/coordinator.js";
import { type AppendAuditInput } from "../../audit/memory-store.js";
import type { AuditRecord } from "../../audit/types.js";
import type {
BridgeActionDelivery,
BridgeActionResult,
BridgeUiAction,
ControlPanelSnapshotView,
} from "../../bridge/contract.js";
import { CompanionBridgeHost, type SnapshotListener } from "../../bridge/host.js";
import {
type PendingContextQueue
} from "../../chat/channel/pending-context.js";
import { type BuildDiagnosticReportInput } from "../../diagnostics/probes.js";
import { PermissionGate } from "../../permissions/gate/permission-gate.js";
import type { PendingPermissionCardView } from "../../permissions/views.js";
import {
type BackendMirrorStore
} from "../../state/mirror/backend-mirror.js";
import { type SnapshotProjectionExtras } from "../../state/projector.js";
import type { ApplyProtocolResult, CompanionBackendState } from "../../state/types.js";
import type { DiagnosticReportView } from "../../ui/pages/diagnostics/diagnostics-models.js";


/**
 * Backend runtime 选项。
 */
export interface CompanionBackendRuntimeOptions {
  /** 初始 state；缺省创建空 state */
  state?: CompanionBackendState;
  /** 权限 gate；缺省空 gate */
  permissionGate?: PermissionGate;
  /** audit store；缺省内存，Electron main 注入文件实现 */
  auditStore?: {
    append: (record: AppendAuditInput) => { ok: true; record: AuditRecord } | { ok: false; code: string; message: string };
    listRecent: (limit?: number) => AuditRecord[];
  };
  /** 诊断实时输入；由 shell/protocol/gateway 层提供 */
  diagnosticsInput?: () => BuildDiagnosticReportInput;
  /** snapshot 投影覆盖（Gateway / 凭据） */
  snapshotExtras?: () => SnapshotProjectionExtras;
  /** in-flight 镜像落盘 */
  mirrorStore?: BackendMirrorStore;
  /** pending 精确文本队列 */
  pendingContext?: PendingContextQueue;
  /** 监督 tick 间隔毫秒；0 关闭。默认关闭，桌面壳显式打开 */
  supervisionIntervalMs?: number;
  /** 把监督动作送到 protocol broadcast（已含 apply）；缺省只写本地 state */
  onProtocolBroadcast?: (envelope: ProtocolEnvelope) => void;
  /** 桌面提醒 */
  onDesktopNotify?: (title: string, body: string) => void;
  /** 桌面设备 id */
  desktopDeviceId?: string;
  /** 撤销配对时回调（identity + protocol） */
  onDeviceRevokePairing?: (input: {
    phoneDeviceId: string;
    desktopDeviceId: string;
  }) => Promise<void>;
  /** bridge action 被接受后的 backend side-effect；不得暴露给 renderer */
  onBridgeAction?: (action: BridgeUiAction, result: BridgeActionResult) => void | Promise<void>;
}

/**
 * Companion backend API。
 */
export interface CompanionBackendRuntime {
  /** 已认证创建命令的原子 job/currentJobId 登记；不启动执行 */
  applyJobCreation(command: ProtocolEnvelope, events: readonly ProtocolEnvelope[]): ApplyProtocolResult;
  /** UI、WS 和委派共用的事务动作权威 */
  getAffairActions(): AffairActionCoordinator;
  /** 应用入站协议 envelope */
  applyProtocolEnvelope(envelope: ProtocolEnvelope): ApplyProtocolResult;
  /** 应用 UI 操作 */
  applyBridgeAction(action: BridgeUiAction): Promise<BridgeActionResult>;
  /** 订阅 snapshot */
  subscribeSnapshot(listener: SnapshotListener): () => void;
  /** 读取 snapshot */
  getSnapshot(): ControlPanelSnapshotView;
  /** 读取待确认权限卡片 */
  listPendingPermissionCards(): PendingPermissionCardView[];
  /** 标记电话会话失联（心跳超时）；affair/job 保留，业务消息重新要求 session */
  markConnectionLost(): void;
  /** 读取内部 state（测试/诊断用） */
  getState(): CompanionBackendState;
  /** 读取 bridge host */
  getBridgeHost(): CompanionBridgeHost;
  /** 读取权限 gate（仅 backend/server 层使用） */
  getPermissionGate(): PermissionGate;
  /** 读取真实诊断报告 */
  getDiagnosticReport(): DiagnosticReportView;
  /** pending 队列（出站 flush 用） */
  getPendingContext(): PendingContextQueue;
  /** 记录 bridge action 投递后继回执 */
  recordBridgeActionDelivery(delivery: BridgeActionDelivery): void;
  /** 停止监督 loop */
  stopSupervision(): void;
  /** 记录入站 messageId（job.create 等 ack 前去重） */
  recordInboundMessageId(messageId: string): void;
  /**
   * 追加脱敏审计。
   *
   * @param input 审计字段
   */
  appendAudit(input: AppendAuditInput): void;
}
