// ui.js — DOM 바인딩
const $ = id => document.getElementById(id);

export const ui = {
  els: {},
  init() {
    for (const id of ['status','freq','flabel','resDb','resFill','err','stage',
      'phaseRO','volRO','gainRO','startBtn','pauseBtn','stopBtn']) this.els[id] = $(id);
  },
  status(t){ this.els.status.textContent = t; },
  stage(t){ this.els.stage.textContent = t; },
  error(html){ this.els.err.innerHTML = html; },
  freq(f, locked){
    this.els.freq.textContent = f > 0 ? f.toFixed(1) + ' Hz' : '— Hz';
    this.els.freq.classList.toggle('on', !!locked);
    this.els.flabel.textContent = locked ? '타겟 고정' : '타겟 주파수';
  },
  phase(d){ this.els.phaseRO.textContent = d.toFixed(0) + '°'; },
  vol(v){ this.els.volRO.textContent = v.toFixed(2); },
  residual(db, baseline){
    this.els.resDb.textContent = db.toFixed(1) + ' dB';
    const norm = Math.max(0, Math.min(1, (db + 90) / 70));
    this.els.resFill.style.width = (norm * 100) + '%';
    this.els.resFill.style.background =
      norm > 0.65 ? 'var(--warn)' : norm > 0.4 ? 'var(--mid)' : 'var(--accent)';
    if (baseline) this.els.gainRO.textContent = Math.max(0, baseline - db).toFixed(1) + ' dB';
  },
  reset(){
    this.freq(0, false);
    this.els.resDb.textContent = '— dB';
    this.els.resFill.style.width = '0%';
    this.els.phaseRO.textContent = '—';
    this.els.volRO.textContent = '—';
    this.els.gainRO.textContent = '—';
    this.stage('');
  },
  buttons(running, paused){
    this.els.startBtn.disabled = running;
    this.els.pauseBtn.disabled = !running;
    this.els.stopBtn.disabled = !running;
    this.els.pauseBtn.textContent = paused ? '재개' : '대기';
  }
};
