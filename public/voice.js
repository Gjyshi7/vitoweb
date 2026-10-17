/* ===== Voice at the table: hold to talk, like a radio =====
   Friends' rooms only, and only the player whose turn it is can talk: hold the mic button, speak, let go.
   Everyone else at the table hears it live. Nothing is recorded or stored: the server passes each piece of
   sound straight on to the other phones (worker/room.js, voice()) and forgets it.

   Sound: the microphone at 12 kHz, μ-law (one byte a sample, like a phone line), sent every 160 ms as one
   binary WebSocket frame:  [0x56 'V', 1 (version), seat (the server fills it in), flags (1 = last), rate code, ...samples]
   Plain Web Audio on both ends (no codecs, no MediaRecorder), so every phone that plays the game plays this.

   net.js wires it in: const V = VWVoice.create({ send(buf), plateEl(seat, tbl), T }) and then
     V.state(tbl | null)   every table state (null: left the table)
     V.frame(arrayBuffer)  a binary frame from the room
   Every entry point catches its own errors: voice can never stop the game. */
(() => {
  const RATE = 12000, RATE_CODE = 1, RATES = [8000, 12000, 16000];
  const FRAME = 1920;                   // samples per frame: 160 ms at 12 kHz
  const LEAD = 0.2;                     // s of sound the listener keeps in hand against a bumpy network
  const MAX_HOLD_MS = 30000;            // a stuck finger never keeps the mic open
  const MAGIC = 0x56, VER = 1, LAST = 1;

  // ---- μ-law (G.711) ----
  function ulawByte(f) {
    let x = Math.max(-1, Math.min(1, f)) * 32767 | 0;
    const sign = (x >> 8) & 0x80;
    if (sign) x = -x;
    if (x > 32635) x = 32635;
    x += 0x84;
    let exp = 7;
    for (let mask = 0x4000; (x & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
    const man = (x >> (exp + 3)) & 0x0f;
    return ~(sign | (exp << 4) | man) & 0xff;
  }
  const ULAW = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff, sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    const x = (((man << 3) + 0x84) << exp) - 0x84;
    ULAW[i] = (sign ? -x : x) / 32768;
  }

  function create(o) {
    const T = o.T || ((sq) => sq);
    const store = {
      get(k, d) { try { const v = localStorage.getItem('vw.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
      set(k, v) { try { localStorage.setItem('vw.' + k, JSON.stringify(v)); } catch (e) {} },
    };
    const canTalk = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { state() {}, frame() {} };

    let tbl = null, on = false, myTurn = false, muted = !!store.get('voice.mute', false);
    const stats = { sent: 0, played: 0, skipped: 0 };      // for tests (window.__voice)
    let ctx = null, ui = null;

    // ---- one audio context for listening and talking, started by a tap (phones only allow sound after one) ----
    function audio() {
      if (!ctx) { try { ctx = new AC(); } catch (e) { ctx = null; return null; } }
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      return ctx;
    }
    const unlock = () => { if (on) audio(); };
    ['pointerdown', 'touchend', 'keydown'].forEach(t => addEventListener(t, unlock, true));

    // a short soft click, like a radio opening and closing (at time `at` on the audio clock)
    let clickBuf = null;
    function click(at, up) {
      const c = ctx; if (!c || c.state !== 'running') return;
      if (!clickBuf) {
        const n = Math.round(c.sampleRate * 0.045);
        clickBuf = c.createBuffer(1, n, c.sampleRate);
        const d = clickBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n / 6));
      }
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = clickBuf; f.type = 'bandpass'; f.frequency.value = up ? 2400 : 1600; f.Q.value = 1.2; g.gain.value = 0.16;
      s.connect(f); f.connect(g); g.connect(c.destination);
      try { s.start(Math.max(c.currentTime, at || 0)); } catch (e) {}
    }
    const buzz = p => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} };

    /* ---------- the button ---------- */
    function build() {
      if (ui) return ui;
      const stage = document.getElementById('stage');
      if (!stage) return null;
      const st = document.createElement('style');
      st.textContent = `
#vwMic{position:absolute;left:105px;top:512px;width:84px;height:84px;border-radius:50%;border:0;padding:0;z-index:240;display:grid;place-items:center;
  color:rgba(255,255,255,.3);background:rgba(14,22,38,.78);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.08),0 8px 20px rgba(0,0,0,.35);
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;transition:transform .12s,background .15s,color .15s,box-shadow .15s}
#vwMic[hidden]{display:none}
#vwMic svg{width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
#vwMic.ready{color:#fff;box-shadow:inset 0 0 0 2px rgba(239,90,134,.85),0 8px 20px rgba(0,0,0,.35)}
#vwMic.wait{color:#fff;box-shadow:inset 0 0 0 2px rgba(239,90,134,.85),0 0 0 6px rgba(239,90,134,.18)}
#vwMic.live{color:#fff;transform:scale(1.08);background:linear-gradient(#f06a92,#ef5a86 45%,#b02a63);
  box-shadow:0 0 0 calc(4px + var(--lv,0) * 14px) rgba(239,90,134,.28),0 8px 22px rgba(176,42,99,.45)}
#vwMic.no{color:#ffb3a6;box-shadow:inset 0 0 0 2px rgba(255,179,166,.6)}
.plate.vw-talk::before{content:'';position:absolute;right:-12px;top:-12px;width:32px;height:32px;border-radius:50%;z-index:3;pointer-events:none;
  background:#ef5a86 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round'%3E%3Crect x='9' y='3' width='6' height='11' rx='3'/%3E%3Cpath d='M5 11a7 7 0 0 0 14 0M12 18v3'/%3E%3C/svg%3E") center/19px no-repeat;
  box-shadow:0 0 0 0 rgba(239,90,134,.5);animation:vwTalk 1s ease-out infinite}
@keyframes vwTalk{to{box-shadow:0 0 0 12px rgba(239,90,134,0)}}`;
      document.head.appendChild(st);
      const b = document.createElement('button');
      b.id = 'vwMic'; b.type = 'button'; b.hidden = true;
      b.setAttribute('aria-label', T('Mbaje shtypur dhe fol', 'Hold to talk'));
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"/></svg>';
      stage.appendChild(b);
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch (_) {} press(e.pointerId); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, e => { if (e.pointerId === holdPid) release(); }));
      b.addEventListener('contextmenu', e => e.preventDefault());
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
      addEventListener('blur', () => release());
      document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
      ui = { b };
      menuItem();
      return ui;
    }
    function paint() {
      if (!ui) return;
      const b = ui.b;
      b.hidden = !on || !canTalk;
      b.classList.toggle('ready', on && myTurn && !live && !waiting);
      b.classList.toggle('wait', waiting && !live);
      b.classList.toggle('live', live);
      if (!live) b.style.removeProperty('--lv');
    }
    let noT = 0;
    function refused() {
      if (!ui) return;
      ui.b.classList.add('no'); clearTimeout(noT);
      noT = setTimeout(() => ui && ui.b.classList.remove('no'), 2500);
      buzz([30, 60, 30]);
    }

    // the pause menu: switch the friends' voices off and on (an entry the table's own menu click handler opens)
    function menuItem() {
      const grid = document.querySelector('#ovMenu .grid');
      if (!grid || document.getElementById('vwMuteBtn')) return;
      const tgt = document.createElement('button');
      tgt.id = 'vwMuteBtn'; tgt.type = 'button'; tgt.hidden = true;
      document.getElementById('stage').appendChild(tgt);
      const mb = document.createElement('button');
      mb.className = 'mb'; mb.type = 'button'; mb.dataset.k = '#vwMuteBtn'; mb.id = 'vwMuteItem';
      mb.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg><span></span>';
      const exit = grid.querySelector('[data-k="#bHome"]');
      exit ? grid.insertBefore(mb, exit) : grid.appendChild(mb);
      const label = () => { mb.querySelector('span').textContent = muted ? T('Biseda: fikur', 'Voice chat: off') : T('Biseda: ndezur', 'Voice chat: on'); };
      tgt.addEventListener('click', () => { muted = !muted; store.set('voice.mute', muted); label(); if (muted) silenceAll(); });
      label();
      ui.item = mb;
    }

    /* ---------- talking ---------- */
    let holdPid = null, want = false, waiting = false, live = false, holdT = 0;
    let stream = null, srcNode = null, proc = null, sink = null;
    let tail = new Float32Array(0), frac = 0, pend = [], ratio = 4;
    function press(pid) {
      if (!on || !myTurn || !canTalk || want) return;
      holdPid = pid; want = true; waiting = true; paint();
      const c = audio();
      if (!c) { want = waiting = false; refused(); paint(); return; }
      clearTimeout(holdT); holdT = setTimeout(release, MAX_HOLD_MS);
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
        .then(s => {
          if (!want || !on || !myTurn) { s.getTracks().forEach(t => t.stop()); return; }
          stream = s;
          startCapture(c);
        })
        .catch(() => { const was = want; stopCapture(false); if (was) refused(); });
    }
    function startCapture(c) {
      try {
        if (c.state !== 'running') { try { c.resume(); } catch (e) {} }
        ratio = c.sampleRate / RATE; tail = new Float32Array(0); frac = 0; pend = [];
        srcNode = c.createMediaStreamSource(stream);
        proc = c.createScriptProcessor(4096, 1, 1);
        sink = c.createGain(); sink.gain.value = 0;              // the processor only runs when connected; nothing is heard here
        proc.onaudioprocess = ev => { try { capture(ev.inputBuffer.getChannelData(0)); } catch (e) {} };
        srcNode.connect(proc); proc.connect(sink); sink.connect(c.destination);
        live = true; waiting = false; paint();
        click(0, true); buzz(15);
      } catch (e) { stopCapture(false); refused(); }
    }
    function capture(x) {
      if (!live) return;
      // down to 12 kHz: the average of the input samples that make up each output sample
      let src = x;
      if (tail.length) { src = new Float32Array(tail.length + x.length); src.set(tail); src.set(x, tail.length); }
      let p = frac, sum2 = 0, n2 = 0;
      while (p + ratio <= src.length) {
        const a = Math.floor(p), b = Math.max(a + 1, Math.floor(p + ratio));
        let s = 0; for (let i = a; i < b; i++) s += src[i];
        const v = s / (b - a);
        pend.push(ulawByte(v)); sum2 += v * v; n2++;
        p += ratio;
      }
      const keep = Math.floor(p);
      tail = src.slice(keep); frac = p - keep;
      if (ui && n2) ui.b.style.setProperty('--lv', Math.min(1, Math.sqrt(sum2 / n2) * 6).toFixed(2));
      while (pend.length >= FRAME) sendFrame(pend.splice(0, FRAME), 0);
    }
    function sendFrame(samples, flags) {
      const buf = new Uint8Array(5 + samples.length);
      buf[0] = MAGIC; buf[1] = VER; buf[2] = 255; buf[3] = flags; buf[4] = RATE_CODE;
      buf.set(samples, 5);
      try { if (o.send(buf.buffer)) stats.sent++; } catch (e) {}
    }
    function stopCapture(fin) {
      const wasLive = live;
      want = false; waiting = false; live = false; holdPid = null; clearTimeout(holdT);
      if (wasLive && fin) { sendFrame(pend.slice(0, FRAME), LAST); click(0, false); }
      pend = []; tail = new Float32Array(0);
      try { if (proc) proc.onaudioprocess = null; } catch (e) {}
      try { if (srcNode) srcNode.disconnect(); } catch (e) {}
      try { if (proc) proc.disconnect(); } catch (e) {}
      try { if (sink) sink.disconnect(); } catch (e) {}
      if (stream) stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      stream = srcNode = proc = sink = null;
      paint();
    }
    function release() { if (want || live) stopCapture(true); }

    /* ---------- listening ---------- */
    const play = {};          // per seat: { next (audio clock), talkT }
    function silenceAll() { for (const k in play) { clearTimeout(play[k].talkT); talking(+k, false); delete play[k]; } }
    function talking(seat, yes) {
      let el = null;
      try { el = tbl && o.plateEl ? o.plateEl(seat, tbl) : null; } catch (e) { el = null; }
      document.querySelectorAll('.plate.vw-talk').forEach(x => { if (x !== el || !yes) x.classList.remove('vw-talk'); });
      if (el && yes) el.classList.add('vw-talk');
    }
    function frame(data) {
      if (!on || muted || !(data instanceof ArrayBuffer)) return;
      const u = new Uint8Array(data);
      if (u.length < 5 || u[0] !== MAGIC || u[1] !== VER) return;
      const seat = u[2], last = !!(u[3] & LAST), rate = RATES[u[4]] || RATE;
      if (tbl && seat === tbl.me) return;
      const c = audio(); if (!c || c.state !== 'running') { stats.skipped++; return; }
      const st = play[seat] || (play[seat] = { next: 0, talkT: 0, open: false });
      const now = c.currentTime;
      const n = u.length - 5;
      if (n > 0) {
        if (st.next > now + 1.5) st.next = 0;                    // far behind (the phone stalled): start fresh
        if (st.next < now + 0.02) { st.next = now + LEAD; }
        if (!st.open) { st.open = true; click(st.next - 0.05, true); }
        // μ-law to sound, then up to the phone's own rate (straight lines between samples)
        const sr = c.sampleRate, m = Math.max(1, Math.round(n * sr / rate)), step = (n - 1) / Math.max(1, m - 1);
        const buf = c.createBuffer(1, m, sr), d = buf.getChannelData(0);
        for (let i = 0; i < m; i++) {
          const p = i * step, a = Math.floor(p), b = Math.min(n - 1, a + 1), f = p - a;
          d[i] = ULAW[u[5 + a]] * (1 - f) + ULAW[u[5 + b]] * f;
        }
        const s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination);
        try { s.start(st.next); stats.played++; } catch (e) {}
        st.next += buf.duration;
      }
      talking(seat, true);
      clearTimeout(st.talkT);
      const left = Math.max(0, (st.next || now) - now) * 1000;
      if (last) {
        if (st.open) click(Math.max(now, st.next), false);
        st.open = false;
        st.talkT = setTimeout(() => { talking(seat, false); }, left + 80);
      } else st.talkT = setTimeout(() => { st.open = false; talking(seat, false); }, left + 700);   // the last frame got lost
    }

    /* ---------- the table ---------- */
    function state(t) {
      tbl = t || null;
      const was = on;
      on = !!(t && !t.pub && t.me >= 0 && t.phase === 'play');
      myTurn = on && t.actor === t.me;
      if (on && !was) { build(); audio(); }          // a phone that was tapped on this page already can start its sound now
      if (ui && ui.item) ui.item.hidden = !on;
      if ((want || live) && !myTurn) stopCapture(true);          // the turn moved on under your finger
      if (!on) silenceAll();
      paint();
    }

    const guard = fn => (...a) => { try { return fn(...a); } catch (e) { try { console.warn('voice', e); } catch (_) {} } };
    const api = { state: guard(state), frame: guard(frame), get talking() { return live; }, stats };
    window.__voice = api;
    return api;
  }

  window.VWVoice = { create };
})();
