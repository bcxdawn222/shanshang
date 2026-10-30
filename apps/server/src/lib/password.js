import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** scrypt 加盐哈希，格式：scrypt$N$r$p$salt$hash（base64） */
export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

let dummyHash;
/** 用户不存在时也跑一次哈希，避免靠响应时间探测用户名是否存在 */
export async function dummyVerify(plain) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(plain, dummyHash);
  return false;
}
