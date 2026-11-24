import { describe, it, expect } from "bun:test";
import { TokenCipher } from "../server/core/crypto";

describe("TokenCipher (AES-256-GCM)", () => {
  const validKey = Buffer.from(new Uint8Array(32).fill(42)).toString("base64");

  it("should initialize cipher from 32-byte base64 key", async () => {
    const cipher = await TokenCipher.init(validKey, "./gdrives3-data");
    expect(cipher).toBeDefined();
  });

  it("should encrypt and decrypt a string roundtrip", async () => {
    const cipher = await TokenCipher.init(validKey, "./gdrives3-data");
    const plaintext = "1//04_secret_google_drive_refresh_token_here_123456";

    const ciphertext = await cipher.encrypt(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.length).toBeGreaterThan(16);

    const decrypted = await cipher.decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("should fail decryption if ciphertext is tampered with", async () => {
    const cipher = await TokenCipher.init(validKey, "./gdrives3-data");
    const original = "important-secret-data";
    const encrypted = await cipher.encrypt(original);

    // Tamper with ciphertext by altering characters
    const tampered = encrypted.slice(0, 10) + "xyz" + encrypted.slice(13);
    expect(cipher.decrypt(tampered)).rejects.toThrow();
  });
});
