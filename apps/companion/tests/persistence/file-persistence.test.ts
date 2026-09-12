/**
 * Companion 文件持久化测试。
 *
 * 职责：验证 identity/audit 文件后端可 round-trip 且保持脱敏。
 * 不拥有：OS secure storage、真实 Gateway、renderer。
 * 副作用：写入临时目录。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createDeviceIdentityStore } from "../../src/credentials/identity-store.js";
import { EncryptedIdentityPersistence } from "../../src/credentials/persistence/encrypted-identity-persistence.js";
import { FileIdentityPersistence } from "../../src/credentials/persistence/file-identity-persistence.js";
import { createFileAuditStore } from "../../src/audit/file-store.js";
import { createUnavailableSecrets } from "../../src/onboarding/store/secrets.js";

describe("companion file persistence", () => {
  it("identity 文件后端支持保存、重载和 revoke 不复活", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-identity-"));
    const file = path.join(dir, "identity.json");
    const first = createDeviceIdentityStore(new FileIdentityPersistence(file));
    await first.savePairedIdentity({
      pairingId: "pair_file_001",
      phoneDeviceId: "phone_file_001",
      phoneDisplayName: "phone",
      desktopDeviceId: "desktop_file_001",
      desktopDisplayName: "desktop",
      pairedAt: new Date().toISOString(),
    });
    await first.revokeIdentity("phone_file_001", "desktop_file_001", "test", new Date().toISOString());

    const second = createDeviceIdentityStore(new FileIdentityPersistence(file));
    const active = await second.listActiveIdentities();
    assert.equal(active.length, 0);
    const found = await second.findIdentity("phone_file_001", "desktop_file_001");
    assert.equal(found?.lifecycle, "revoked");
  });

  it("audit 文件后端拒绝凭据摘要并可重载", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-audit-"));
    const file = path.join(dir, "audit.json");
    const first = createFileAuditStore(file);
    assert.equal(first.append({ kind: "permission", summary: "允许 workspace.read" }).ok, true);
    assert.equal(first.append({ kind: "permission", summary: "Bearer secret" }).ok, false);
    const second = createFileAuditStore(file);
    assert.equal(second.listRecent().length, 1);
    assert.equal(fs.readFileSync(file, "utf8").includes("Bearer"), false);
  });

  it("pairingSecret 加密落盘；secrets 不可用时拒绝保存", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lanxin-identity-enc-"));
    const file = path.join(dir, "identity.json");
    const secrets = {
      encrypt: (plain: string) => `enc:${Buffer.from(plain, "utf8").toString("base64")}`,
      decrypt: (encrypted: string) => {
        if (!encrypted.startsWith("enc:")) {
          return null;
        }
        return Buffer.from(encrypted.slice(4), "base64").toString("utf8");
      },
      isAvailable: () => true,
    };
    const store = createDeviceIdentityStore(
      new EncryptedIdentityPersistence(new FileIdentityPersistence(file), secrets),
    );
    const saved = await store.savePairedIdentity({
      pairingId: "pair_enc_001",
      phoneDeviceId: "phone_enc_001",
      phoneDisplayName: "phone",
      desktopDeviceId: "desktop_enc_001",
      desktopDisplayName: "desktop",
      pairedAt: new Date().toISOString(),
    });
    assert.ok(saved.pairingSecret);
    const raw = fs.readFileSync(file, "utf8");
    assert.equal(raw.includes(saved.pairingSecret ?? ""), false);
    assert.equal(raw.includes("enc:"), true);
    const reloaded = createDeviceIdentityStore(
      new EncryptedIdentityPersistence(new FileIdentityPersistence(file), secrets),
    );
    const found = await reloaded.findIdentity("phone_enc_001", "desktop_enc_001");
    assert.equal(found?.pairingSecret, saved.pairingSecret);

    const blocked = createDeviceIdentityStore(
      new EncryptedIdentityPersistence(new FileIdentityPersistence(file), createUnavailableSecrets()),
    );
    await assert.rejects(
      () =>
        blocked.savePairedIdentity({
          pairingId: "pair_enc_002",
          phoneDeviceId: "phone_enc_002",
          phoneDisplayName: "phone",
          desktopDeviceId: "desktop_enc_002",
          desktopDisplayName: "desktop",
          pairedAt: new Date().toISOString(),
        }),
      /identity_secrets_unavailable/,
    );
  });
});
