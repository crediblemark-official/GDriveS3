import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * AES-256-GCM cipher using native Web Crypto API.
 * Encrypts/decrypts OAuth refresh tokens and S3 secrets at rest.
 */
export class TokenCipher {
  private cryptoKey: CryptoKey;

  private constructor(cryptoKey: CryptoKey) {
    this.cryptoKey = cryptoKey;
  }

  static async init(configuredKey: string, dataDir: string): Promise<TokenCipher> {
    let keyBase64 = configuredKey.trim();

    if (!keyBase64) {
      const keyPath = join(dataDir, ".enckey");
      if (existsSync(keyPath)) {
        keyBase64 = readFileSync(keyPath, "utf-8").trim();
      } else {
        const raw = new Uint8Array(32);
        crypto.getRandomValues(raw);
        keyBase64 = Buffer.from(raw).toString("base64");
        writeFileSync(keyPath, keyBase64, { mode: 0o600 });
      }
    }

    const keyBytes = Buffer.from(keyBase64, "base64");
    if (keyBytes.length !== 32) {
      throw new Error(`Enkripsi membutuhkan 32-byte key (didapat ${keyBytes.length} bytes)`);
    }

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );

    return new TokenCipher(cryptoKey);
  }

  async encrypt(plaintext: string): Promise<string> {
    const nonce = new Uint8Array(12); // 96-bit nonce standard untuk GCM
    crypto.getRandomValues(nonce);

    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      this.cryptoKey,
      encoded
    );

    // Format: base64(nonce [12 bytes] + ciphertext [with 16-byte auth tag])
    const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
    combined.set(nonce, 0);
    combined.set(new Uint8Array(ciphertext), nonce.length);

    return Buffer.from(combined).toString("base64");
  }

  async decrypt(encoded: string): Promise<string> {
    const raw = Buffer.from(encoded, "base64");
    if (raw.length < 12 + 16) {
      throw new Error("Ciphertext terlalu pendek");
    }

    const nonce = raw.subarray(0, 12);
    const ciphertext = raw.subarray(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      this.cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }
}
