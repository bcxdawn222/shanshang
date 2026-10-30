import { createHash, randomBytes, randomInt } from 'node:crypto';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

// 去掉 0/O、1/I/L 这类在屏幕上容易看错的字符
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomFrom(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** 设备码：显示在广告机屏幕上，管理员据此绑定 */
export function randomCode(length = 8) {
  return randomFrom(CODE_ALPHABET, length);
}

/** 重置密码时生成的临时密码 */
export function randomPassword(length = 12) {
  return randomFrom(PASSWORD_ALPHABET, length);
}
