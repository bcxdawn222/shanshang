/**
 * 转盘“嗒”声：WebAudio 现场合成（三角波快速下滑 + 指数包络），不用音频文件。
 * AudioContext 全局只建一个，必须在用户手势里 unlockAudio() 后才会出声。
 */
let ctx = null;
let lastAt = 0;
const MIN_GAP_S = 0.025; // 高速时一帧可能过好几格，限制出声间隔免得糊成噪音

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch (error) {
    console.warn('[tick] 音频不可用', error);
  }
}

/** strength 0~1：越快越响 */
export function playTick(strength = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - lastAt < MIN_GAP_S) return;
  lastAt = now;
  const vol = 0.06 + 0.24 * Math.max(0, Math.min(1, strength));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(2400, now);
  osc.frequency.exponentialRampToValueAtTime(900, now + 0.03);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}
