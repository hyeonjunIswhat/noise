// engine.js — 오디오 그래프 (마이크 입력 + sin/cos 합성 출력)
// 출력은 <audio> 엘리먼트 경유: iOS가 미디어 재생으로 취급 → 수화부 라우팅/무음 스위치 회피

import { goertzelDb } from './dsp.js';

export class AudioEngine {
  constructor() {
    this.ctx = null; this.analyser = null; this.stream = null; this.audioEl = null;
    this.oscSin = null; this.oscCos = null;
    this.gSin = null; this.gCos = null; this.master = null;
    this.lockedFreq = 0; this.phaseDeg = 0; this.vol = 0;
    this.timeBuf = new Float32Array(8192);
  }

  async start() {
    // iOS 17+: 마이크 활성 시 출력이 수화부로 가는 것을 방지 — 재생 세션으로 강제
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    const micOpts = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: micOpts });
    // 유선 DAC의 헤드셋 마이크가 기본 선택되면 방 소음 측정이 불가 → 내장 마이크로 강제 전환
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const inputs = devs.filter(d => d.kind === 'audioinput');
      const builtin = inputs.find(d => /iphone|아이폰|내장|built/i.test(d.label));
      const cur = this.stream.getAudioTracks()[0];
      this.micLabel = cur.label || '(이름 없음)';
      if (builtin && builtin.label !== cur.label) {
        cur.stop();
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
          ...micOpts, deviceId: { exact: builtin.deviceId } } });
        this.micLabel = this.stream.getAudioTracks()[0].label;
      }
    } catch (_) { this.micLabel = this.micLabel || '기본'; }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 32768;
    this.analyser.smoothingTimeConstant = 0.4;
    src.connect(this.analyser);

    this.master = this.ctx.createGain(); this.master.gain.value = 0;
    // 출력 이중화: (1) audio 엘리먼트(미디어 경로, 수화부/무음 회피) + (2) ctx 직결(백업)
    this.master.connect(this.ctx.destination);
    const msDest = this.ctx.createMediaStreamDestination();
    this.master.connect(msDest);
    this.audioEl = new Audio();
    this.audioEl.srcObject = msDest.stream;
    this.audioEl.setAttribute('playsinline', '');
    this.elPlay = 'ok';
    try { await this.audioEl.play(); }
    catch (e) { this.elPlay = e.name; } // 실패해도 ctx 직결로 계속

    this.gSin = this.ctx.createGain(); this.gCos = this.ctx.createGain();
    this.gSin.connect(this.master); this.gCos.connect(this.master);
    this.oscSin = this.ctx.createOscillator(); this.oscSin.type = 'sine';
    const cosWave = this.ctx.createPeriodicWave(
      new Float32Array([0, 1]), new Float32Array([0, 0]),
      { disableNormalization: true });
    this.oscCos = this.ctx.createOscillator();
    this.oscCos.setPeriodicWave(cosWave);
    const t0 = this.ctx.currentTime + 0.05; // 동시 시작 = 위상 정렬
    this.oscSin.start(t0); this.oscCos.start(t0);
  }

  setFreq(f) {
    this.lockedFreq = f;
    this.oscSin.frequency.setValueAtTime(f, this.ctx.currentTime);
    this.oscCos.frequency.setValueAtTime(f, this.ctx.currentTime);
  }

  // sin·cosφ + cos·sinφ = sin(θ+φ) — 게인만 바꿔 무클릭 위상 전환
  setPhase(deg) {
    this.phaseDeg = ((deg % 360) + 360) % 360;
    const phi = this.phaseDeg * Math.PI / 180, t = this.ctx.currentTime;
    this.gSin.gain.setTargetAtTime(Math.cos(phi), t, 0.02);
    this.gCos.gain.setTargetAtTime(Math.sin(phi), t, 0.02);
  }

  setVol(v) { this.vol = Math.max(0, Math.min(0.85, v)); }

  applyMaster(level) {
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
  }

  measureResidualOnce() {
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    return goertzelDb(this.timeBuf, this.lockedFreq, this.ctx.sampleRate);
  }

  teardown() {
    if (this.audioEl) { try { this.audioEl.pause(); this.audioEl.srcObject = null; } catch (_) {} this.audioEl = null; }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) { try { this.ctx.close(); } catch (_) {} }
    this.ctx = null;
  }
}
