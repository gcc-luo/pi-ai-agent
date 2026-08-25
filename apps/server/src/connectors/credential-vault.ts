import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ulid } from "../util/ulid.js";

interface VaultRecord { iv: string; tag: string; ciphertext: string }

/**
 * Host-only encrypted credential store. The encryption key and vault are
 * permissioned to the current OS user and never exposed through HTTP APIs.
 */
export class CredentialVault {
  private readonly key: Buffer;
  private records: Record<string, VaultRecord> = {};

  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(directory, "connector-vault.key");
    const vaultPath = path.join(directory, "connector-vault.json");
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
    this.key = fs.readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error("连接器凭据密钥损坏");
    if (fs.existsSync(vaultPath)) {
      this.records = JSON.parse(fs.readFileSync(vaultPath, "utf8")) as Record<string, VaultRecord>;
    }
  }

  save(value: string): string {
    const id = `cred_${ulid()}`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    this.records[id] = {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    this.flush();
    return id;
  }

  resolve(id: string): string {
    const record = this.records[id];
    if (!record) throw new Error("凭据不存在或已被删除");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final(),
    ]).toString("utf8");
  }

  remove(id: string): void {
    if (!this.records[id]) return;
    delete this.records[id];
    this.flush();
  }

  private flush(): void {
    const target = path.join(this.directory, "connector-vault.json");
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.records), { mode: 0o600 });
    fs.renameSync(temporary, target);
  }
}
