/**
 * 千问（阿里云百炼 / DashScope）onboarding 预设。
 *
 * 职责：地域 baseUrl、模型列表、解析为 onboarding endpoint/modelRef。
 * 不拥有：API Key 存储、探针执行、gateway 启动。
 * 纯函数：无 I/O。
 */

/** 地域 preset */
export interface QwenRegionPreset {
  /** 内部 id */
  id: string;
  /** 下拉展示标签 */
  label: string;
  /** Legacy 共享域名 baseUrl（无需 WorkspaceId） */
  legacyBaseUrl: string;
  /** 业务空间专属域名模板；{workspaceId} 占位 */
  workspaceBaseUrlTemplate: string;
}

/** 模型 preset */
export interface QwenModelPreset {
  /** DashScope model id */
  id: string;
  /** 下拉展示标签 */
  label: string;
  /** 简短说明 */
  description: string;
}

/** 获取 API Key 官方文档 */
export const QWEN_API_KEY_HELP_URL = "https://help.aliyun.com/zh/model-studio/get-api-key";

/** 美国（弗吉尼亚）地域 id；无 workspace 专属域名变体 */
export const QWEN_US_VIRGINIA_REGION_ID = "us-virginia";

/** 默认地域 */
export const QWEN_DEFAULT_REGION_ID = "cn-beijing";

/** 默认模型 */
export const QWEN_DEFAULT_MODEL_ID = "qwen3.7-plus";

/** 千问 onboarding modelRef 前缀 */
export const QWEN_MODEL_REF_PREFIX = "qwen";

/** 地域列表（Legacy 共享域名为主路径） */
export const QWEN_REGION_PRESETS: readonly QwenRegionPreset[] = [
  {
    id: "cn-beijing",
    label: "中国大陆（北京）【推荐】",
    legacyBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    workspaceBaseUrlTemplate:
      "https://{workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "intl-sg",
    label: "国际（新加坡）",
    legacyBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    workspaceBaseUrlTemplate:
      "https://{workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "us-virginia",
    label: "美国（弗吉尼亚）",
    legacyBaseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    workspaceBaseUrlTemplate: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "cn-hongkong",
    label: "中国香港",
    legacyBaseUrl: "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
    workspaceBaseUrlTemplate:
      "https://{workspaceId}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1",
  },
] as const;

/** 模型列表（仅 3.5 / 3.7 系列 + Coder，Claw 友好） */
export const QWEN_MODEL_PRESETS: readonly QwenModelPreset[] = [
  {
    id: "qwen3.7-plus",
    label: "Qwen 3.7 Plus【推荐】",
    description: "日常与 Agent 能力均衡",
  },
  {
    id: "qwen3.7-flash",
    label: "Qwen 3.7 Flash",
    description: "更快更省",
  },
  {
    id: "qwen3.5-plus",
    label: "Qwen 3.5 Plus",
    description: "3.5 系列均衡",
  },
  {
    id: "qwen3.5-flash",
    label: "Qwen 3.5 Flash",
    description: "3.5 系列轻量",
  },
  {
    id: "qwen3-coder-plus",
    label: "Qwen 3 Coder Plus",
    description: "编码与 Claw 协作向",
  },
] as const;

/** 解析千问 onboarding 入参 */
export interface ResolveQwenOnboardingInput {
  /** 地域 id */
  regionId: string;
  /** 模型 id */
  modelId: string;
  /** 业务空间 ID；非空时使用专属域名 */
  workspaceId?: string | null;
}

/** 解析结果 */
export interface ResolveQwenOnboardingResult {
  /** 模型服务 baseUrl */
  endpoint: string;
  /** OpenClaw modelRef（qwen/{modelId}） */
  modelRef: string;
}

/** 业务空间专属 endpoint 匹配（不含美国区 workspace 变体） */
const QWEN_WORKSPACE_ENDPOINT_PATTERN =
  /^https:\/\/[^/]+\.(cn-beijing|ap-southeast-1|cn-hongkong)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/;

/** preset 允许的 Legacy baseUrl 集合 */
const QWEN_LEGACY_ENDPOINTS = new Set(QWEN_REGION_PRESETS.map((item) => item.legacyBaseUrl));

/** preset 允许的 modelId 集合 */
const QWEN_ALLOWED_MODEL_IDS = new Set(QWEN_MODEL_PRESETS.map((item) => item.id));

/**
 * 判断 endpoint 是否为 preset 允许的千问 baseUrl。
 *
 * @param endpoint 候选 endpoint
 * @returns 是否允许
 */
export function isAllowedQwenEndpoint(endpoint: string): boolean {
  const normalized = endpoint.trim().replace(/\/+$/, "");
  if (QWEN_LEGACY_ENDPOINTS.has(normalized)) {
    return true;
  }
  return QWEN_WORKSPACE_ENDPOINT_PATTERN.test(normalized);
}

/**
 * 判断 modelRef 是否为 preset 允许的千问引用。
 *
 * @param modelRef 候选 modelRef
 * @returns 是否允许
 */
export function isAllowedQwenModelRef(modelRef: string): boolean {
  const trimmed = modelRef.trim();
  if (!trimmed.startsWith(`${QWEN_MODEL_REF_PREFIX}/`)) {
    return false;
  }
  const modelId = trimmed.slice(QWEN_MODEL_REF_PREFIX.length + 1);
  return QWEN_ALLOWED_MODEL_IDS.has(modelId);
}

/**
 * 校验千问 onboarding 的 endpoint 与 modelRef 组合。
 *
 * @param endpoint 模型服务 endpoint
 * @param modelRef 模型引用
 * @returns 校验结果
 */
export function validateQwenOnboardingFields(
  endpoint: string,
  modelRef: string,
): { ok: true } | { ok: false; message: string } {
  if (!isAllowedQwenModelRef(modelRef)) {
    return { ok: false, message: "千问模型不在允许列表内" };
  }
  if (!isAllowedQwenEndpoint(endpoint)) {
    return { ok: false, message: "千问 endpoint 不在允许列表内" };
  }
  return { ok: true };
}

/**
 * 按 id 查找地域 preset。
 *
 * @param regionId 地域 id
 * @returns preset 或 null
 */
export function findQwenRegionPreset(regionId: string): QwenRegionPreset | null {
  return QWEN_REGION_PRESETS.find((item) => item.id === regionId) ?? null;
}

/**
 * 按 id 查找模型 preset。
 *
 * @param modelId 模型 id
 * @returns preset 或 null
 */
export function findQwenModelPreset(modelId: string): QwenModelPreset | null {
  return QWEN_MODEL_PRESETS.find((item) => item.id === modelId) ?? null;
}

/**
 * 将地域 + 模型解析为 onboarding endpoint 与 modelRef。
 *
 * @param input 地域、模型与可选 WorkspaceId
 * @returns endpoint 与 modelRef
 * @throws 非法 regionId 或 modelId
 */
export function resolveQwenOnboarding(input: ResolveQwenOnboardingInput): ResolveQwenOnboardingResult {
  const region = findQwenRegionPreset(input.regionId);
  if (!region) {
    throw new Error(`qwen_region_invalid:${input.regionId}`);
  }
  const model = findQwenModelPreset(input.modelId);
  if (!model) {
    throw new Error(`qwen_model_invalid:${input.modelId}`);
  }
  const workspaceId = input.workspaceId?.trim();
  const endpoint = workspaceId
    ? region.workspaceBaseUrlTemplate.replace("{workspaceId}", workspaceId)
    : region.legacyBaseUrl;
  return {
    endpoint,
    modelRef: `${QWEN_MODEL_REF_PREFIX}/${model.id}`,
  };
}
