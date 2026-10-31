import { randomSessionId } from './segments.js';

/**
 * 设备会话：同一设备一次连续使用（离开待机 → 再次进入待机）。
 * 只是随机 id，不关联任何人脸或身份信息；Phase 6（AI智趣推荐去重）用。
 */
let sessionId = randomSessionId(16);

export function getDeviceSessionId() {
  return sessionId;
}

/** 离开播放页时调用：开始一次新的设备会话 */
export function startDeviceSession() {
  sessionId = randomSessionId(16);
  return sessionId;
}
