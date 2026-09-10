import { BrowserProxyFormFields } from "./browser-proxy/form.js";
/**
 * 诊断页「运行偏好」：托管浏览器本地代理。
 *
 * 职责：展示/编辑开关与 URL，经「应用并重启」提交 settings.setBrowserProxy。
 * 不拥有：openclaw.json 写入、Gateway 重启细节、SSRF 字段生成。
 * 副作用：submitAction；本地表单状态。
 */

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactElement } from "react";
import {
  DEFAULT_BROWSER_PROXY_URL,
  parseBrowserProxyUrl,
} from "../../../shell/desktop/shell-settings.js";
import type { RendererBridgeApi } from "../../bridge/renderer-api.js";

/**
 * 提交当前 UI 上的代理配置；失败保留表单。
 *
 * @param input bridge、表单值与回调
 * @returns 是否提交成功
 */
async function submitBrowserProxyDraft(input: {
  bridge: RendererBridgeApi;
  enabled: boolean;
  url: string;
  onFeedback: (message: string) => void;
  onError: (message: string) => void;
}): Promise<boolean> {
  const result = await input.bridge.submitAction({
    type: "settings.setBrowserProxy",
    enabled: input.enabled,
    url: input.url.trim() || DEFAULT_BROWSER_PROXY_URL,
  });
  if (!result.ok) {
    input.onError(result.error.message);
    void input.bridge.reportError({
      source: "diagnostics",
      message: result.error.message,
    });
    return false;
  }
  input.onFeedback("已应用；将重启 Gateway 使托管浏览器代理生效");
  return true;
}

/**
 * 点击时校验即将提交的配置；开代理时 URL 必须合法。
 *
 * @param enabled 是否开启
 * @param url 用户输入
 * @returns 规范化 URL 或错误文案
 */
function validateProxyDraftForApply(
  enabled: boolean,
  url: string,
): { ok: true; url: string } | { ok: false; message: string } {
  if (!enabled) {
    return { ok: true, url: url.trim() || DEFAULT_BROWSER_PROXY_URL };
  }
  const parsed = parseBrowserProxyUrl(url.trim() || DEFAULT_BROWSER_PROXY_URL);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  return parsed;
}

/**
 * 执行应用：校验 → 提交 → 成功后清 edited。
 *
 * @param input 当前表单与状态写入
 */
function runApplyBrowserProxy(input: {
  saving: boolean;
  enabled: boolean;
  url: string;
  bridge: RendererBridgeApi;
  onFeedback: (message: string) => void;
  onError: (message: string) => void;
  setUrlError: (next: string | null) => void;
  setSaving: (next: boolean) => void;
  setUrl: (next: string) => void;
  setEdited: (next: boolean) => void;
}): void {
  if (input.saving) {
    return;
  }
  const validated = validateProxyDraftForApply(input.enabled, input.url);
  if (!validated.ok) {
    input.setUrlError(validated.message);
    input.onError(validated.message);
    return;
  }
  input.setUrlError(null);
  input.setSaving(true);
  void submitBrowserProxyDraft({
    bridge: input.bridge,
    enabled: input.enabled,
    url: validated.url,
    onFeedback: input.onFeedback,
    onError: input.onError,
  })
    .then((ok) => {
      if (ok) {
        input.setUrl(validated.url);
        input.setEdited(false);
      }
    })
    .finally(() => {
      input.setSaving(false);
    });
}

/**
 * @param props bridge 与当前持久化偏好
 * @returns 运行偏好区块
 */
export function DiagnosticsBrowserProxyPrefs(props: {
  bridge: RendererBridgeApi;
  enabled: boolean;
  url: string;
  onFeedback: (message: string) => void;
  onError: (message: string) => void;
}): ReactElement {
  const [enabled, setEnabled] = useState(props.enabled);
  const [url, setUrl] = useState(props.url || DEFAULT_BROWSER_PROXY_URL);
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  /** 仅阻止诊断刷新冲掉编辑中的值；不用于禁用按钮 */
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (edited || saving) {
      return;
    }
    setEnabled(props.enabled);
    setUrl(props.url || DEFAULT_BROWSER_PROXY_URL);
    setUrlError(null);
  }, [props.enabled, props.url, edited, saving]);

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        运行偏好
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        仅影响 OpenClaw 打开的托管浏览器与同源 web_fetch，不会自动继承系统 VPN。改完后点「应用并重启」写入配置并热重启
        Gateway；有任务在跑时会拒绝重启。
      </Alert>
      <BrowserProxyFormFields
        enabled={enabled}
        url={url}
        saving={saving}
        urlError={urlError}
        onEnabledChange={(next) => {
          setEdited(true);
          setEnabled(next);
          setUrlError(null);
        }}
        onUrlChange={(next) => {
          setEdited(true);
          setUrl(next);
          setUrlError(null);
        }}
        onApply={() => {
          runApplyBrowserProxy({
            saving,
            enabled,
            url,
            bridge: props.bridge,
            onFeedback: props.onFeedback,
            onError: props.onError,
            setUrlError,
            setSaving,
            setUrl,
            setEdited,
          });
        }}
      />
    </Box>
  );
}
