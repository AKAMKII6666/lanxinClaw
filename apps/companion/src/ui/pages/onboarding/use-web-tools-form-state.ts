/**
 * onboarding 网页能力本地表单 state。
 */

import { useState } from "react";

/** 网页能力表单切片 */
export interface WebToolsFormState {
  enableWebSearch: boolean;
  enableBrowser: boolean;
  webSearchApiKey: string;
  setEnableWebSearch: (next: boolean) => void;
  setEnableBrowser: (next: boolean) => void;
  setWebSearchApiKey: (next: string) => void;
}

/**
 * @returns 网页能力字段 state
 */
export function useWebToolsFormState(): WebToolsFormState {
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [enableBrowser, setEnableBrowser] = useState(false);
  const [webSearchApiKey, setWebSearchApiKey] = useState("");
  return {
    enableWebSearch,
    enableBrowser,
    webSearchApiKey,
    setEnableWebSearch,
    setEnableBrowser,
    setWebSearchApiKey,
  };
}
