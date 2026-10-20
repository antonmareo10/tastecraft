// Encryption for the recorded-runs file (src/data/demos.json), so a deployment can download it
// without the readable Qloo data ever living in the public repository.
// Format: "tcdemo1.<iv>.<tag>.<ciphertext>" (base64url), AES-256-GCM over gzip(JSON).
import crypto from "node:crypto";
import zlib from "node:zlib";

const PREFIX = "tcdemo1";

export function newKey() {
  return crypto.randomBytes(32).toString("base64");
}

function keyBytes(key) {
  const buf = Buffer.from(String(key ?? "").trim(), "base64");
  if (buf.length !== 32) throw new Error("The demos key must be 32 bytes, base64-encoded.");
  return buf;
}

export function encryptDemos(json, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const body = Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(json, "utf8"))), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptDemos(text, key) {
  const [prefix, iv, tag, body] = String(text).trim().split(".");
  if (prefix !== PREFIX || !iv || !tag || !body) throw new Error("Not a Tastecraft demos file.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const zipped = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]);
  const json = zlib.gunzipSync(zipped).toString("utf8");
  const demos = JSON.parse(json);
  if (!Array.isArray(demos) || !demos.every((d) => d && typeof d.slug === "string" && Array.isArray(d.events))) {
    throw new Error("Decrypted file is not a list of recorded runs.");
  }
  return demos;
}
