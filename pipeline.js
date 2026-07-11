// pipeline.js — 자동 보정 상태머신
// 자가진단 → 주파수 측정 → 거친/정밀 위상 스캔 → 볼륨 최적화 → 상시 추적

import { detectFreqOnce, sleep, median } from './dsp.js';

export class AutoPipeline {
  constructor(engine, ui) {
    this.e = engine; this.ui = ui;
    this.running = false; this.paused = false; this.aborted = false;
    this.baselineDb = 0; this.bestDb = 0; this.residual = -80;
  }

  async sample(ms) {
    const vals = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      vals.push(this.e.measureResidualOnce());
      await sleep(50);
      if (this.aborted) return 0;
    }
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  async detectFreqStable(ms) {
    const t0 = performance.now(); const fs = [];
    while (performance.now() - t0 < ms) {
      fs.push(detectFreqOnce(this.e.analyser, this.e.ctx.sampleRate));
      await sleep(200);
      if (this.aborted) return 0;
    }
    return median(fs);
  }

  show(db) {
    this.residual = db;
    this.ui.residual(db, this.baselineDb);
  }

  // ⓪ 출력 자가진단: 440Hz 테스트음이 마이크로 되돌아오는지
  async selfTest() {
    this.ui.stage('⓪ 출력 자가진단 — 테스트음 (삐— 소리가 나야 정상)');
    const TEST_F = 440;
    const saved = this.e.lockedFreq;
    this.e.setFreq(TEST_F);
    this.e.setPhase(0);
    const bg = await this.sample(500);
    this.e.applyMaster(0.5);
    await sleep(300);
    const on = await this.sample(700);
    this.e.applyMaster(0);
    await sleep(200);
    this.e.lockedFreq = saved;
    const snr = on - bg;
    if (snr < 8) {
      this.ui.error('⚠️ 자가진단 실패: 테스트음(+' + snr.toFixed(1) + ' dB)이 마이크에 감지되지 않습니다.<br>'
        + '① 무음 스위치 해제 ② 미디어 볼륨 올리기 ③ 블루투스 이어폰 연결 끊기 ④ 유선 스피커 확인. '
        + '해결 후 [종료]→[시작].');
      return false;
    }
    this.ui.error('');
    this.ui.status('자가진단 통과: 출력→마이크 +' + snr.toFixed(1) + ' dB');
    return true;
  }

  async calibrate(fullCoarse) {
    // ① 주파수 측정 (무음 상태)
    this.ui.stage('① 주파수 측정 중 (3초)');
    this.e.applyMaster(0);
    await sleep(400);
    const f = await this.detectFreqStable(3000);
    if (this.aborted) return false;
    this.e.setFreq(f);
    this.ui.freq(f, true);
    this.baselineDb = await this.sample(600);
    if (this.aborted) return false;

    // ② 거친 스캔 (10° 간격)
    this.e.setVol(Math.max(this.e.vol, 0.12));
    this.e.applyMaster(this.e.vol);
    let best = { deg: this.e.phaseDeg, level: Infinity }, worst = -Infinity;
    if (fullCoarse) {
      this.ui.stage('② 위상 거친 스캔 (약 11초)');
      for (let d = 0; d < 360; d += 10) {
        this.e.setPhase(d); this.ui.phase(d); await sleep(120);
        const r = await this.sample(180);
        if (this.aborted) return false;
        this.show(r);
        if (r < best.level) best = { deg: d, level: r };
        if (r > worst) worst = r;
      }
      if (worst - best.level < 2) {
        this.ui.error('⚠️ 위상 변화에 잔류가 반응하지 않습니다(변화폭 '
          + (worst - best.level).toFixed(1) + ' dB). 스피커 소리가 아이폰 마이크에 '
          + '도달하지 않거나 너무 작습니다 — 스피커를 가까이, 볼륨을 올려보세요.');
      }
    } else {
      best = { deg: this.e.phaseDeg, level: await this.sample(300) };
    }

    // ③ 정밀 스캔 (±10°, 2° 간격)
    this.ui.stage('③ 위상 정밀 스캔');
    let fine = best;
    for (let d = best.deg - 10; d <= best.deg + 10; d += 2) {
      const dd = ((d % 360) + 360) % 360;
      this.e.setPhase(dd); this.ui.phase(dd); await sleep(100);
      const r = await this.sample(160);
      if (this.aborted) return false;
      this.show(r);
      if (r < fine.level) fine = { deg: dd, level: r };
    }
    this.e.setPhase(fine.deg); this.ui.phase(fine.deg);

    // ④ 볼륨 최적화 (잔류가 되레 커지기 직전까지)
    this.ui.stage('④ 볼륨 자동 최적화');
    let bestV = { v: this.e.vol, level: fine.level };
    for (let v = this.e.vol + 0.05; v <= 0.8; v += 0.05) {
      this.e.setVol(v); this.e.applyMaster(v); this.ui.vol(v); await sleep(120);
      const r = await this.sample(220);
      if (this.aborted) return false;
      this.show(r);
      if (r < bestV.level) bestV = { v, level: r };
      else if (r > bestV.level + 3) break;
    }
    this.e.setVol(bestV.v); this.e.applyMaster(bestV.v); this.ui.vol(bestV.v);
    this.bestDb = bestV.level;
    this.ui.stage('⑤ 상시 추적 중 — 자동 미세보정');
    this.ui.status('상쇄 동작 중: ' + this.e.lockedFreq.toFixed(1) + ' Hz, '
      + Math.max(0, this.baselineDb - this.bestDb).toFixed(1) + ' dB 감쇄');
    return true;
  }

  // ⑤ 상시 추적: 힐클라임 + 악화 감시 + 60초 주파수 재확인
  async trackLoop() {
    let lastRecheck = performance.now();
    let worseCount = 0;
    while (this.running && !this.aborted) {
      if (this.paused) { await sleep(300); continue; }

      const cur = await this.sample(400);
      if (this.aborted) break;
      this.show(cur);

      if (cur > this.bestDb + 6) worseCount++; else worseCount = 0;
      if (worseCount >= 4) {
        this.ui.status('소음 변화 감지 — 자동 재보정');
        await this.calibrate(true);
        worseCount = 0; lastRecheck = performance.now();
        continue;
      }

      // 위상 ±2° 힐클라임
      for (const delta of [2, -2]) {
        if (this.paused || this.aborted || !this.running) break;
        const orig = this.e.phaseDeg;
        this.e.setPhase(orig + delta); this.ui.phase(this.e.phaseDeg); await sleep(80);
        const r = await this.sample(260);
        if (r < cur - 0.4) { if (r < this.bestDb) this.bestDb = r; break; }
        this.e.setPhase(orig); this.ui.phase(orig); await sleep(60);
      }
      // 가끔 볼륨 ±0.03
      if (Math.random() < 0.3) {
        const origV = this.e.vol;
        const tryV = origV + (Math.random() < 0.5 ? 0.03 : -0.03);
        this.e.setVol(tryV); this.e.applyMaster(this.e.vol); this.ui.vol(this.e.vol);
        await sleep(80);
        const r = await this.sample(260);
        if (!(r < this.residual - 0.4)) {
          this.e.setVol(origV); this.e.applyMaster(origV); this.ui.vol(origV);
        } else if (r < this.bestDb) this.bestDb = r;
      }

      // 60초마다 주파수 재확인
      if (performance.now() - lastRecheck > 60000) {
        this.ui.stage('주파수 재확인 중');
        this.e.applyMaster(0);
        await sleep(600);
        const f = await this.detectFreqStable(1500);
        this.e.applyMaster(this.paused ? 0 : this.e.vol);
        if (f > 0 && Math.abs(f - this.e.lockedFreq) > 1.0) {
          this.ui.status('주파수 드리프트 — 자동 재보정');
          await this.calibrate(true);
        }
        lastRecheck = performance.now();
        this.ui.stage('⑤ 상시 추적 중 — 자동 미세보정');
      }
      await sleep(1200);
    }
  }
}
