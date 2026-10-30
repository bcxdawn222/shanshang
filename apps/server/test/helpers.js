import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createLocalStorage } from '../src/lib/storage.js';

export const ADMIN = { username: 'root', password: 'admin-pass-1234' };

/** 内存库 + 假 Xmax + 可拨动时钟 */
export async function makeApp({ env = {}, fetchImpl } = {}) {
  const db = openDb(':memory:');
  let clock = Date.UTC(2026, 9, 30, 8, 0, 0);
  const now = () => clock;
  const config = loadConfig({
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD: ADMIN.password,
    XMAX_API_KEY: 'test-permanent-key',
    XMAX_API_BASE: 'https://xmax.example.test/open/api/v1',
    ...env,
  });
  const calls = [];
  const fakeFetch =
    fetchImpl ??
    (async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ code: 0, data: { temporaryApiKey: 'test-temporary-key', expireTimestamp: 123, pointsLimit: 200 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  // 每个测试一个临时媒体目录，结束即删
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shanshang-media-'));
  const storage = createLocalStorage(mediaDir);
  const app = await buildApp({ config, db, storage, fetchImpl: fakeFetch, now });
  return {
    app,
    db,
    calls,
    storage,
    mediaDir,
    advance(ms) {
      clock += ms;
    },
    async close() {
      await app.close();
      db.close();
      fs.rmSync(mediaDir, { recursive: true, force: true });
    },
  };
}

export function cookieOf(res) {
  const c = res.cookies.find((x) => x.name === 'sl_sid');
  return c?.value ? `sl_sid=${c.value}` : null;
}

export async function loginAdmin(app) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/admin/login', payload: ADMIN });
  if (res.statusCode !== 200) throw new Error(`admin login failed: ${res.body}`);
  return cookieOf(res);
}

export async function registerMerchant(app, { username = 'shop01', password = 'shop-pass-01', brandName = '测试女装' } = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/merchant/register',
    payload: { username, password, brandName, contact: '13800000000' },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return { cookie: cookieOf(res), id: res.json().account.id, username, password };
}

export async function approve(app, adminCookie, id) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/merchants/${id}/approve`,
    headers: { cookie: adminCookie },
    payload: {},
  });
  if (res.statusCode !== 200) throw new Error(`approve failed: ${res.body}`);
  return res.json();
}
