// app.js — 엔트리: 버튼/수명주기/wake lock
import { AudioEngine } from './engine.js';
import { AutoPipeline } from './pipeline.js';
import { ui } from './ui.js';

let engine = null, pipe = null, wakeLock = null;

async function start() {
  ui.error('');
  try {
    engine = new AudioEngine();
    await engine.start();
    pipe = new AutoPipeline(engine, ui);
    pipe.running = true;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    ui.buttons(true, false);
    ui.status('자동 보정 시작');

    const pathOk = await pipe.selfTest();
    if (!pathOk) { ui.stage('출력 경로 문제 — 위 안내 확인'); return; }
    const ok = await pipe.calibrate(true);
    if (ok) await pipe.trackLoop();
  } catch (e) {
    ui.error('오류: ' + e.message + ' — 무음 스위치 해제, 마이크 권한 확인.');
    stop();
  }
}

function pause() {
  if (!pipe || !pipe.running) return;
  pipe.paused = !pipe.paused;
  engine.applyMaster(pipe.paused ? 0 : engine.vol);
  ui.buttons(true, pipe.paused);
  ui.status(pipe.paused ? '대기 중 — 출력 정지, 설정 유지' : '상쇄 재개');
  ui.stage(pipe.paused ? '' : '⑤ 상시 추적 중 — 자동 미세보정');
}

function stop() {
  if (pipe) { pipe.aborted = true; pipe.running = false; pipe.paused = false; }
  if (wakeLock) { try { wakeLock.release(); } catch (_) {} wakeLock = null; }
  if (engine) engine.teardown();
  engine = null; pipe = null;
  ui.buttons(false, false);
  ui.reset();
  ui.status('종료 — 다시 시작하려면 [시작]');
}

window.addEventListener('DOMContentLoaded', () => {
  ui.init();
  ui.els.startBtn.addEventListener('click', start);
  ui.els.pauseBtn.addEventListener('click', pause);
  ui.els.stopBtn.addEventListener('click', stop);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
