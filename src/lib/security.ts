import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  const [, salt, expected] = (stored || "").split(":");
  const actual = await derive(password, salt || "constant-time-dummy-salt");
  return (
    !!expected &&
    expected.length === 128 &&
    timingSafeEqual(actual, Buffer.from(expected, "hex"))
  );
}
function encryptionKey() {
  const key = process.env.DATA_ENCRYPTION_KEY || "";
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new HttpError(
      503,
      "Die sichere Speicherung ist noch nicht eingerichtet. Bitte den Betreiber kontaktieren.",
    );
  return Buffer.from(key, "hex");
}
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decrypt(value: string) {
  const [iv, tag, encrypted] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
export function appUrl() {
  if (!process.env.APP_URL && process.env.NODE_ENV === "production")
    throw new HttpError(503, "APP_URL ist nicht konfiguriert.");
  const url = process.env.APP_URL || "http://localhost:3000";
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
    throw new HttpError(
      503,
      "HTTPS ist für öffentliche Installationen erforderlich.",
    );
  return parsed.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl())
    throw new HttpError(
      403,
      "Die Anfrage wurde aus Sicherheitsgründen abgewiesen.",
    );
}
export async function readJson<T>(
  request: Request,
  validator: z.ZodType<T>,
  maxBytes = 100_000,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "JSON-Daten erwartet.");
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new HttpError(413, "Die Datei ist zu groß.");
  if (!request.body) throw new HttpError(400, "Die Anfrage ist leer.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "Die Datei ist zu groß.");
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Ungültige JSON-Daten.");
  }
  return validator.parse(data);
}
export function api(fn: () => Promise<unknown>) {
  return fn()
    .then((data) =>
      NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }),
    )
    .catch((error: unknown) => {
      if (error instanceof HttpError)
        return NextResponse.json(
          { error: error.message },
          { status: error.status },
        );
      if (error instanceof z.ZodError)
        return NextResponse.json(
          { error: error.issues[0]?.message || "Bitte Eingaben prüfen." },
          { status: 400 },
        );
      console.error(
        "Request failed",
        error instanceof Error ? error.name : "Unknown error",
      );
      return NextResponse.json(
        {
          error:
            "Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.",
        },
        { status: 500 },
      );
    });
}
export async function rateLimit(
  key: string,
  maximum: number,
  periodMs: number,
) {
  const now = Date.now();
  const [result] = await db.query<{ count: number }>(
    `INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,$2)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at <= $3 THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at <= $3 THEN $2 ELSE rate_limits.reset_at END RETURNING count`,
    [hashToken(key), now + periodMs, now],
  );
  if (result.count > maximum)
    throw new HttpError(
      429,
      "Zu viele Versuche. Bitte später erneut versuchen.",
    );
}
export const passwordSchema = z
  .string()
  .min(12, "Das Passwort muss mindestens 12 Zeichen haben.")
  .max(128, "Das Passwort ist zu lang.");
export const emailSchema = z
  .email("Bitte eine gültige E-Mail-Adresse eingeben.")
  .max(254)
  .transform((value) => value.toLowerCase().trim());
