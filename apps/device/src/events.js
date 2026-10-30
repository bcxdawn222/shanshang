/**
 * 埋点（docs/02-业务设计/数据统计埋点.md）。Phase 7 实现批量上报：
 * 每条带 device_id、session_id、seq，每 10 秒或满 50 条上报，断网本地缓存后补报。
 * 目前为空操作占位：调用方先按口径埋好，不发任何请求。
 */
export function trackEvent(type, payload = {}) {
  void type;
  void payload;
}
