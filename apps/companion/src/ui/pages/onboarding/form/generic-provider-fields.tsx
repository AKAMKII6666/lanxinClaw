/**
 * 非千问 provider 的 endpoint / modelRef 字段。
 */

import TextField from "@mui/material/TextField";
import type { ReactElement } from "react";

/** 通用 provider 字段 props */
export interface GenericProviderFieldsProps {
  endpoint: string;
  modelRef: string;
  needsEndpoint: boolean;
  /** 提交中锁定 */
  disabled?: boolean;
  onEndpointChange: (next: string) => void;
  onModelRefChange: (next: string) => void;
}

/**
 * OpenAI 兼容 / 本地等 provider 的手填字段。
 *
 * @param props 字段状态
 * @returns JSX
 */
export function GenericProviderFields(props: GenericProviderFieldsProps): ReactElement {
  const locked = props.disabled === true;
  return (
    <>
      {props.needsEndpoint ? (
        <TextField
          label="端点地址"
          value={props.endpoint}
          disabled={locked}
          onChange={(event) => props.onEndpointChange(event.target.value)}
          placeholder="http://127.0.0.1:11434/v1"
        />
      ) : null}
      <TextField
        label="模型引用"
        value={props.modelRef}
        disabled={locked}
        onChange={(event) => props.onModelRefChange(event.target.value)}
        helperText="格式：provider/model"
      />
    </>
  );
}
