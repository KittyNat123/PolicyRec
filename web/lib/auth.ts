import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "policyrec_session";

const HASH_ITERATIONS = 120_000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = "sha256";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function authSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.SUPABASE_SERVICE_KEY ||
    "policyrec-local-dev-secret"
  );
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(
    password,
    salt,
    HASH_ITERATIONS,
    HASH_KEY_LENGTH,
    HASH_DIGEST
  ).toString("hex");

  return `pbkdf2_${HASH_DIGEST}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [algorithm, iterationsRaw, salt, hash] = storedHash.split("$");
  if (algorithm !== `pbkdf2_${HASH_DIGEST}` || !iterationsRaw || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    HASH_DIGEST
  );

  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

function signPayload(payload: string): string {
  return base64url(
    createHmac("sha256", authSecret()).update(payload).digest()
  );
}

export function createSessionToken(loginId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      login_id: loginId,
      iat: now,
      exp: now + 60 * 60 * 24 * 7,
    })
  );
  return `${payload}.${signPayload(payload)}`;
}

export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = signPayload(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(fromBase64url(payload).toString("utf8")) as {
      login_id?: unknown;
      exp?: unknown;
    };
    if (typeof data.login_id !== "string") return null;
    if (typeof data.exp !== "number") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.login_id;
  } catch {
    return null;
  }
}

export function getLoginIdFromRequest(request: NextRequest): string | null {
  return verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

