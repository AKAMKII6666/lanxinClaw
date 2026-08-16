/**
 * JSON 文件持久化 port。
 *
 * 职责：提供小型本机 JSON load/save 能力，供 identity/audit/job store 复用。
 * 不拥有：业务 schema 校验、凭据管理、OpenClaw。
 * 副作用：读写本机 JSON 文件。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * JSON 文件持久化。
 */
export class JsonFilePersistence<T> {
  private readonly filePath: string;
  private readonly fallback: T;

  /**
   * @param filePath 文件路径
   * @param fallback 文件不存在时返回
   */
  constructor(filePath: string, fallback: T) {
    this.filePath = path.resolve(filePath);
    this.fallback = fallback;
  }

  /**
   * 读取 JSON。
   *
   * @returns 数据
   */
  load(): T {
    if (!fs.existsSync(this.filePath)) {
      return this.clone(this.fallback);
    }
    return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as T;
  }

  /**
   * 保存 JSON。
   *
   * @param value 数据
   */
  save(value: T): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.partial`;
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  /**
   * @param value 数据
   * @returns 深副本
   */
  private clone(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

