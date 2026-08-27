/**
 * 首次启动配置门：provider + API key + endpoint + 模型引用，两级探针。
 *
 * 职责：未配置/探针失败时作为唯一入口；通过后才进入主界面。
 * 不拥有：key 明文落盘（主进程 safeStorage）、gateway 启动、权限裁决。
 * 副作用：提交配置到主进程；展示探针错误；成功回调父层。
 */

import type { ReactElement } from "react";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";
import { ConfigForm } from "./form/config-form.js";
import { useConfigGateModel } from "./use-config-gate-model.js";

/**
 * 配置门组件。
 *
 * @param props.bridge 渲染层桥接对象
 * @param props.onConfigured 配置与运行时均就绪后的回调
 * @returns JSX
 */
export function ConfigGate(props: {
  bridge: RendererBridgeApi;
  onConfigured: () => void;
}): ReactElement {
  const model = useConfigGateModel(props.bridge, props.onConfigured);
  return (
    <ConfigForm
      provider={model.provider}
      apiKey={model.apiKey}
      endpoint={model.endpoint}
      modelRef={model.modelRef}
      qwenRegion={model.qwenRegion}
      qwenModel={model.qwenModel}
      qwenAdvancedOpen={model.qwenAdvancedOpen}
      qwenWorkspaceId={model.qwenWorkspaceId}
      submitting={model.submitting}
      phase={model.phase}
      error={model.error}
      needsEndpoint={model.needsEndpoint}
      needsKey={model.needsKey}
      onProviderChange={model.changeProvider}
      onApiKeyChange={model.setApiKey}
      onEndpointChange={model.setEndpoint}
      onModelRefChange={model.setModelRef}
      onQwenRegionChange={model.setQwenRegion}
      onQwenModelChange={model.setQwenModel}
      onQwenAdvancedOpenChange={model.setQwenAdvancedOpen}
      onQwenWorkspaceIdChange={model.setQwenWorkspaceId}
      onSubmit={() => void model.submit()}
    />
  );
}
