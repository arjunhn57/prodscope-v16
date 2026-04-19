"use strict";

/**
 * crypto.js — Credential encryption at rest.
 *
 * Encrypts credentials before storing in SQLite, decrypts when reading.
 * Uses AES-256-GCM with random IV per encryption.
 *
 * Set CREDENTIALS_ENCRYPTION_KEY (64 hex chars = 32 bytes) in .env.
 * If not set, credentials are stored as-is (dev mode only).
 */

const crypto = require("crypto");
const { logger } = require("./logger");
const log = logger.child({ component: "crypto" });

const ALGORITHM = "aes-256-gcm";
const KEY = process.env.CREDENTIALS_ENCRYPTION_KEY
  ? Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY, "hex")
  : null;

/**
 * Encrypt a plaintext string.
 * Returns "enc:<iv>:<authTag>:<ciphertext>" or the original string if no key.
 */
function encrypt(plaintext) {
  if (!KEY) return plaintext;
  if (!plaintext) return plaintext;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

/**
 * Decrypt an encrypted string.
 * Returns plaintext, or the original string if not encrypted or no key.
 */
function decrypt(ciphertext) {
  if (!KEY || !ciphertext || !ciphertext.startsWith("enc:")) return ciphertext;

  const parts = ciphertext.split(":");
  if (parts.length !== 4) return ciphertext;

  const [, ivHex, tagHex, data] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    log.error({ err: e }, "Decryption failed");
    return ciphertext;
  }
}

module.exports = { encrypt, decrypt };
