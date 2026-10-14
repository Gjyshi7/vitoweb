/* ===== Start menu, rooms and the connection (shared by every table game) =====
   The menu is NOT inside the rotated table: on a phone held upright it is laid out upright, so the
   keyboard and the inputs match. The table only takes over (and turns sideways) once you sit down.

     Luaj online   -> quick match: a public table with the same settings, or a new one others can join.
                      If nobody else sits down in a few seconds, the phone plays that table itself.
     Krijo dhomë   -> a private room with a code and a link to send. The host starts; empty seats fill.
     Hyr           -> join a room by its 4-letter code (or straight from a shared link: ?r=CODE).

   const NET = NETWORK({ game, title, modes, cfg(), seatsFor(cfg), onLocal(cfg, seats), onTable(tbl, S), onLeave(), onRules() })
     modes:      [{ label, cfg }]   the first is the default (e.g. 2 kundër 2)
     onLocal:    start the table on this phone. seats: [{name, fem, color}] by table seat, you at 0
     onTable:    every state from the server while a match is on (tbl = the table part)
     onLeave:    the player left the room: reset the table */
function NETWORK(G){
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ERR = {
    paused: 'Dhomat e reja janë ndalur për pak.', busy: 'Serveri është plot. Provo pas pak.', slow_down: 'Shumë kërkesa. Prit pak.',
    bad_game: 'Gabim.', not_your_turn: '', bad_move: '', bad_gift: '', must_lead: '', host_cant_leave: 'Hosti nuk del dot nga dhoma.',
  };
  const store = {
    get(k, d){ try { const v = localStorage.getItem('vw.' + k); return v === null ? d : JSON.parse(v); } catch(e) { return d; } },
    set(k, v){ try { localStorage.setItem('vw.' + k, JSON.stringify(v)); } catch(e) {} },
  };
  const KEY = (() => {
    let k = null;
    try { k = localStorage.getItem('vw.key'); } catch(e) {}
    if (!k || !/^[a-z0-9-]{16,64}$/i.test(k)) k = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 32);
    try { localStorage.setItem('vw.key', k); } catch(e) {}
    return k;
  })();
  const savedName = () => store.get('name', '') || store.get('imp.name', '') || '';

  /* ---------- markup ---------- */
  const css = document.createElement('style');
  css.textContent = `
#menu{position:fixed;inset:0;z-index:900;overflow:auto;background:radial-gradient(900px 600px at 50% 0%,#17233c 0%,#0b111d 70%);color:#eef2f8;
  font-family:var(--f-ui, system-ui, sans-serif);-webkit-user-select:none;user-select:none;padding:env(safe-area-inset-top,0) 16px env(safe-area-inset-bottom,0)}
#menu[hidden]{display:none}
#menu .wrap{max-width:440px;margin:0 auto;padding:18px 0 28px;min-height:100%;display:flex;flex-direction:column}
#menu .bar{display:flex;align-items:center;gap:10px;height:48px}
#menu .back{width:44px;height:44px;border:0;border-radius:12px;background:rgba(255,255,255,.06);color:#c9d2e3;display:grid;place-items:center;cursor:pointer}
#menu .back svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#menu .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;letter-spacing:.18em;color:#93a0b8}
#menu .brand img{width:22px}
#menu h1{font-size:46px;line-height:1;margin:22px 0 18px;font-weight:800;letter-spacing:-.01em}
#menu .seg{display:flex;gap:4px;padding:4px;border-radius:14px;background:rgba(255,255,255,.06);margin-bottom:14px}
#menu .seg button{flex:1;border:0;border-radius:11px;height:46px;font:700 16px inherit;font-family:inherit;color:#93a0b8;background:transparent;cursor:pointer}
#menu .seg button.on{background:#ef5a86;color:#fff}
#menu label{display:block;font-size:13px;letter-spacing:.12em;color:#93a0b8;margin:6px 0 6px;font-weight:600}
#menu input{width:100%;box-sizing:border-box;height:54px;border-radius:14px;border:0;padding:0 16px;font:600 20px inherit;font-family:inherit;color:#eef2f8;
  background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);-webkit-user-select:text;user-select:text}
#menu input:focus{outline:2px solid #f3c76a;outline-offset:1px}
#menu .b{display:block;width:100%;height:58px;margin-top:12px;border:0;border-radius:16px;font:700 18px inherit;font-family:inherit;letter-spacing:.06em;cursor:pointer;color:#eef2f8;background:rgba(255,255,255,.08)}
#menu .b.main{height:64px;font-size:20px;color:#fff;background:linear-gradient(#f06a92,#ef5a86 45%,#b02a63);box-shadow:0 8px 22px rgba(176,42,99,.35)}
#menu .b:disabled{opacity:.5;cursor:default}
#menu .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#menu .join{display:grid;grid-template-columns:1fr 110px;gap:10px;margin-top:12px}
#menu .join .b{margin:0;height:54px}
#menu #mCode{text-transform:uppercase;letter-spacing:.32em;text-align:center}
#menu .err{min-height:22px;margin:10px 2px 0;color:#ffb3a6;font-size:15px}
#menu .link{margin:14px auto 0;background:none;border:0;color:#93a0b8;font:600 15px inherit;font-family:inherit;text-decoration:underline;text-underline-offset:4px;cursor:pointer}
#menu .code{font-size:15px;letter-spacing:.12em;color:#93a0b8;margin:20px 0 4px;font-weight:600}
#menu .code b{display:block;font-size:44px;letter-spacing:.24em;color:#ef5a86;margin-top:2px}
#menu .seats{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0 4px}
#menu .seats.one{grid-template-columns:1fr}
#menu .team{font-size:12px;letter-spacing:.16em;color:#93a0b8;font-weight:700;margin:0 2px 8px}
#menu .seats > div{min-width:0}
#menu .seat{display:flex;align-items:center;gap:10px;height:58px;padding:0 12px;border-radius:14px;background:rgba(255,255,255,.06);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);font-size:17px;font-weight:600;min-width:0;border:0;color:inherit;font-family:inherit;text-align:left}
#menu .seat .av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;flex:none;font-size:16px}
#menu .seat b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
#menu .seat.me{box-shadow:inset 0 0 0 2px #ef5a86}
#menu .seat.empty{background:transparent;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.12);color:#93a0b8;font-weight:500}
#menu button.seat.empty{cursor:pointer}
#menu .seat.wait .av{background:rgba(255,255,255,.07)}
#menu .seat.wait .av:after{content:"";width:14px;height:14px;border-radius:50%;border:2px solid #93a0b8;border-top-color:transparent;animation:mspin .8s linear infinite}
@keyframes mspin{to{transform:rotate(360deg)}}
#menu .lead{color:#93a0b8;font-size:15px;margin:8px 2px 0;min-height:20px}
#menu .grow{flex:1}
#menu .rules h2{font-size:30px;margin:10px 0 8px}
#menu .rules p{color:#b8c2d4;font-size:16px;line-height:1.4;margin:0 0 12px}
#menu .rules .ladder{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 12px}
#menu .rules .ladder div{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:14px;color:#b8c2d4;line-height:1.3}
#menu .rules .ladder b{display:block;font-size:16px;color:#eef2f8}
#menu .rules ul{padding-left:20px;font-size:15px;line-height:1.45;color:#d9dfea;margin:0 0 6px}
#menu .rules li{margin-bottom:6px}
#menu .rules li b{color:#fff}
#netBadge{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%);z-index:880;padding:6px 14px;border-radius:12px;
  background:rgba(229,161,58,.95);color:#1a2233;font:700 13px system-ui,sans-serif;letter-spacing:.06em;pointer-events:none}
@media (orientation:landscape) and (max-height:520px){
  #menu .wrap{max-width:720px;padding-top:8px}
  #menu h1{font-size:34px;margin:8px 0 12px}
  #menu .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start}
}`;
  document.head.appendChild(css);

  const menu = document.createElement('div');
  menu.id = 'menu';
  const modeSeg = G.modes && G.modes.length > 1 ? `<div class="seg" id="mMode">${G.modes.map((m, i) => `<button type="button" data-i="${i}">${esc(m.label)}</button>`).join('')}</div>` : '';
  menu.innerHTML = `<div class="wrap">
    <div class="bar"><button class="back" id="mBack" type="button" aria-label="Kthehu te lojërat"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="brand"><img id="mLogo" alt="">LOJA</div></div>
    <section id="mHome">
      <h1>${esc(G.title)}</h1>
      <div class="cols"><div>
        ${modeSeg}
        <label for="mName">EMRI</label>
        <input id="mName" maxlength="16" autocomplete="nickname" enterkeyhint="done" spellcheck="false">
      </div><div>
        <button class="b main" id="mQuick" type="button">Luaj online</button>
        <button class="b" id="mCreate" type="button">Krijo dhomë</button>
        <div class="join"><input id="mCode" maxlength="4" placeholder="KODI" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go"><button class="b" id="mJoin" type="button">Hyr</button></div>
      </div></div>
      <p class="err" id="mErr"></p>
      <div class="grow"></div>
      <button class="link" id="mRules" type="button">Rregullat</button>
    </section>
    <section id="mRulesSec" hidden>
      <div class="rules" id="mRulesBody"></div>
      <button class="b" id="mRulesClose" type="button">Mbyll</button>
    </section>
    <section id="mRoom" hidden>
      <div class="code" id="mCodeBox">DHOMA<b id="mCodeTxt"></b></div>
      <div class="seats" id="mSeats"></div>
      <p class="lead" id="mLead"></p>
      <div class="row" id="mRoomBtns"><button class="b" id="mShare" type="button">Dërgo linkun</button><button class="b main" id="mStart" type="button">Fillo</button></div>
      <p class="err" id="mErr2"></p>
      <div class="adslot" data-ad="lobby"></div>
      <div class="grow"></div>
      <button class="link" id="mLeave" type="button">Dil</button>
    </section>
  </div>`;
  document.body.appendChild(menu);
  const badge = document.createElement('div'); badge.id = 'netBadge'; badge.hidden = true; badge.textContent = 'PO LIDHET…';
  document.body.appendChild(badge);
  if (typeof ADS !== 'undefined') ADS.fill(menu);

  /* ---------- state ---------- */
  const N = { room: null, ws: null, S: null, want: false, retry: 0, pingT: 0, quick: false, mode: Math.min(store.get(G.game + '.mode', 0), (G.modes || [1]).length - 1), table: false, tries: 0 };
  const cfgNow = () => Object.assign({}, (G.modes && G.modes[N.mode] || {}).cfg || {}, G.cfg ? G.cfg() : {});

  function show(which){
    menu.hidden = which === 'none';
    $('#mHome').hidden = which !== 'home';
    $('#mRoom').hidden = which !== 'room';
    $('#mRulesSec').hidden = which !== 'rules';
    if (window.VWP) VWP.set(G.game, which === 'none' ? 'play' : which === 'room' ? (N.quick ? 'search' : 'room') : 'menu');
  }
  function err(t, two){ $(two ? '#mErr2' : '#mErr').textContent = t || ''; }
  function renderModes(){ document.querySelectorAll('#mMode button').forEach(b => b.classList.toggle('on', +b.dataset.i === N.mode)); }
  renderModes();
  $('#mMode') && $('#mMode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    N.mode = +b.dataset.i; store.set(G.game + '.mode', N.mode); renderModes();
  });
  $('#mName').value = savedName();
  $('#mName').addEventListener('change', () => store.set('name', clean($('#mName').value)));
  const clean = v => String(v || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  function needName(){
    const n = clean($('#mName').value);
    if (!n) { err('Shkruaj emrin.'); $('#mName').focus(); return null; }
    store.set('name', n); err(''); $('#mName').blur(); return n;
  }

  /* ---------- connection ---------- */
  const send = o => { if (N.ws && N.ws.readyState === 1) { N.ws.send(JSON.stringify(o)); return true; } return false; };
  function connect(){
    if (!N.room) return;
    N.want = true;
    if (N.ws && N.ws.readyState < 2) return;
    const q = new URLSearchParams({ name: savedName() || 'Lojtar', k: KEY });
    const host = store.get('host.' + N.room, ''); if (host) q.set('host', host);
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${N.room}?${q}`);
    N.ws = sock;
    const slow = setTimeout(() => { if (N.ws === sock && sock.readyState !== 1) badge.hidden = !N.table; }, 1500);
    sock.onopen = () => { clearTimeout(slow); N.retry = 0; badge.hidden = true; clearInterval(N.pingT); N.pingT = setInterval(() => send({ t: 'ping' }), 25000); };
    sock.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch(_) { return; }
      if (m.t === 'state') onState(m);
      else if (m.t === 'error') { if (G.onError) G.onError(m.e, m.why); if (ERR[m.e]) err(ERR[m.e], true); }
      else if (m.t === 'kicked') leave('Hosti të nxori nga dhoma.');
      else if (m.t === 'closed') leave('Dhoma u mbyll.');
      else if (m.t === 'refused' || m.t === 'replaced') { const code = m.t === 'replaced' ? 4002 : m.code; const h = sock.onclose; sock.onclose = null; try { sock.close(); } catch(_) {} h({ code }); }
    };
    sock.onclose = e => {
      clearTimeout(slow); clearInterval(N.pingT);
      if (N.ws !== sock || !N.want || e.code === 4000 || e.code === 4001) return;
      if (e.code === 4004) return leave('Kjo dhomë nuk ekziston më.');
      if (e.code === 4003 || e.code === 4005) {
        if (N.quick && N.tries < 3) { N.tries++; return quick(); }        // that table just filled: find another
        return leave(e.code === 4003 ? 'Dhoma është plot.' : 'Loja në këtë dhomë ka nisur.');
      }
      if (e.code === 4400 || e.code === 4401) return leave('Shkruaj emrin dhe provo përsëri.');
      if (e.code === 4002) { badge.textContent = 'HAPUR NË NJË DRITARE TJETËR'; badge.hidden = false; return; }
      badge.textContent = 'PO LIDHET…'; badge.hidden = !N.table && menu.hidden;
      setTimeout(connect, Math.min(5000, 600 * 2 ** N.retry++));
    };
  }
  // a table on this phone doesn't wait for you either: gone a minute and the others carried on without you
  const AWAY_MSG = 'Ishe larg më shumë se një minutë dhe loja vazhdoi pa ty.';
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (N.table && !N.room && hiddenAt && Date.now() - hiddenAt > 60_000) { hiddenAt = 0; return leave(AWAY_MSG); }
    hiddenAt = 0;
    if (N.room) { N.retry = 0; connect(); }
  });
  // a phone that slept without telling the page (no visibility event): the clock jumps
  let lastTick = Date.now();
  setInterval(() => {
    const n = Date.now();
    if (n - lastTick > 60_000 && N.table && !N.room && document.visibilityState === 'visible') leave(AWAY_MSG);
    lastTick = n;
  }, 5000);
  addEventListener('online', () => { if (N.room) { N.retry = 0; connect(); } });

  function enter(code, quickMatch){
    N.room = code; N.S = null; N.quick = !!quickMatch; N.table = false;
    const u = new URL(location.href); u.search = quickMatch ? '' : '?r=' + code; history.replaceState(null, '', u);
    $('#mCodeTxt').textContent = code;
    $('#mCodeBox').hidden = !!quickMatch;
    $('#mSeats').innerHTML = ''; $('#mLead').textContent = quickMatch ? 'Po kërkohen lojtarë…' : '';
    $('#mRoomBtns').hidden = true; err('', true);
    show('room');
    connect();
  }
  function leave(msg){
    const wasTable = N.table;
    if (N.ws && N.room) { if (!isHost() || N.quick) send({ t: 'leave' }); }
    N.want = false; if (N.ws) try { N.ws.close(); } catch(e) {}
    N.ws = null; N.S = null; N.room = null; N.table = false; N.quick = false; badge.hidden = true;
    history.replaceState(null, '', location.pathname);
    clearTimeout(voteT); if (window.ENDP) ENDP.reset();
    if (wasTable || G.onLeave) G.onLeave();
    show('home'); err(msg || '');
  }
  const isHost = () => !!N.S && N.S.me === N.S.hostPid;

  /* ---------- menu actions ---------- */
  async function post(path, body){
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }
  async function quick(){
    if (!needName()) return;
    $('#mQuick').disabled = true;
    try {
      const j = await post('/api/quick', { game: G.game, cfg: cfgNow() });
      if (!j.code) throw (ERR[j.error] || 0);
      enter(j.code, true);
    } catch(e) {
      // no server (offline, blocked): play the table on this phone
      if (typeof e !== 'string') { local(); }
      else err(e);
    }
    $('#mQuick').disabled = false;
  }
  function local(seats){
    show('none'); N.table = true;
    if (window.VWP) VWP.played(G.game);
    const others = seats || PLAYERS.seats(G.seatsFor(cfgNow()).length - 1).map(s => ({ name: s.name, fem: s.fem, color: s.color }));
    G.onLocal(cfgNow(), [{ name: 'Ti', fem: false, color: '#b02a63' }, ...others]);
  }
  $('#mQuick').onclick = () => { N.tries = 0; quick(); };
  $('#mCreate').onclick = async () => {
    if (!needName()) return;
    $('#mCreate').disabled = true;
    try {
      const j = await post('/api/create', { game: G.game, cfg: cfgNow() });
      if (!j.code) throw (ERR[j.error] || 0);
      store.set('host.' + j.code, j.hostToken);
      enter(j.code, false);
    } catch(e) { err(typeof e === 'string' ? e : 'Dhoma nuk u krijua. Kontrollo internetin.'); }
    $('#mCreate').disabled = false;
  };
  async function join(){
    if (!needName()) return;
    const code = $('#mCode').value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { err('Kodi ka 4 shkronja.'); return; }
    try {
      const j = await (await fetch('/api/room/' + code)).json();
      if (!j.ok) { err('Kjo dhomë nuk ekziston.'); return; }
      if (j.game && j.game !== G.game) { location.href = j.game + '?r=' + code; return; }
    } catch(e) { err("S'ka lidhje."); return; }
    enter(code, false);
  }
  $('#mJoin').onclick = join;
  $('#mCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('#mCode').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('#mName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#mName').blur(); });
  // the game's own rules panel, shown upright inside the menu
  $('#mRules').onclick = () => {
    const src = document.querySelector('#ovRules .panel'); if (!src) return;
    const box = $('#mRulesBody'); box.innerHTML = src.innerHTML;
    box.querySelectorAll('button, .adslot').forEach(b => b.remove());
    show('rules'); menu.scrollTop = 0;
  };
  $('#mRulesClose').onclick = () => { show('home'); };
  $('#mBack').onclick = () => { if (window.parent !== window) { try { parent.postMessage({ vw: 'home' }, '*'); } catch(e) {} } else location.href = './'; };
  $('#mLeave').onclick = () => leave();
  $('#mStart').onclick = () => send({ t: 'start' });
  $('#mShare').onclick = async () => {
    const url = `${location.origin}${location.pathname}?r=${N.room}`;
    try { if (navigator.share) { await navigator.share({ title: G.title, text: `${G.title} · dhoma ${N.room}`, url }); return; } } catch(e) { return; }
    try { await navigator.clipboard.writeText(url); err('Linku u kopjua', true); } catch(e) { err(url, true); }
  };
  $('#mSeats').addEventListener('click', e => {
    const b = e.target.closest('button.seat.empty'); if (!b) return;
    send({ t: 'seat', seat: +b.dataset.seat });
  });

  /* ---------- states from the room ---------- */
  function seatHTML(x, i, t, waiting){
    if (!x) return waiting
      ? `<div class="seat empty wait"><div class="av"></div></div>`
      : `<button type="button" class="seat empty" data-seat="${i}"><div class="av" style="box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.2)"></div>Ulu këtu</button>`;
    return `<div class="seat${i === t.me ? ' me' : ''}"><div class="av" style="background:${x.color || '#3a4a66'}">${esc((x.name[0] || '?').toUpperCase())}</div><b>${esc(x.name)}</b></div>`;
  }
  function renderRoom(t){
    const list = t.seatList, waiting = t.pub;
    const teams = G.teamsFor && G.teamsFor(t.cfg);
    let html;
    if (teams) html = teams.map((grp, k) => `<div><div class="team">EKIPI ${k + 1}</div>${grp.map(i => seatHTML(t.seats[i], i, t, waiting)).join('<div style="height:10px"></div>')}</div>`).join('');
    else html = list.map(i => seatHTML(t.seats[i], i, t, waiting)).join('');
    $('#mSeats').innerHTML = html;
    $('#mSeats').classList.toggle('one', !teams && list.length === 2);
    const humans = list.filter(i => t.seats[i]).length;
    if (t.pub) {
      $('#mRoomBtns').hidden = true;
      $('#mLead').textContent = 'Po kërkohen lojtarë…';
    } else {
      $('#mRoomBtns').hidden = false;
      $('#mStart').hidden = !isHost();
      $('#mShare').style.gridColumn = isHost() ? '' : '1/-1';
      $('#mLead').textContent = isHost() ? (humans < list.length ? 'Vendet bosh zihen kur shtyp Fillo.' : '') : 'Pret hostin të fillojë.';
    }
  }
  function onState(S){
    S._at = Date.now();
    N.S = S;
    const t = S.tbl; if (!t) return;
    if (t.phase === 'lobby') {
      if (N.table) { N.table = false; if (G.onLeave) G.onLeave(); }
      show('room'); renderRoom(t); return;
    }
    if (t.phase === 'solo') {
      // nobody else sat down: this phone plays the same table with the same people
      const names = rotateSeats(t);
      N.want = false; try { N.ws.close(); } catch(e) {}
      N.ws = null; N.room = null; N.S = null; N.quick = false;
      history.replaceState(null, '', location.pathname);
      local(names.slice(1));
      return;
    }
    if (t.phase === 'closed') return leave('Loja mbaroi.');
    if (t.out) return leave(t.why === 'away' ? AWAY_MSG : '');
    if (!N.table) { N.table = true; show('none'); if (window.VWP) VWP.played(G.game); }
    G.onTable(t, S);
    voteUI();
  }

  /* ---------- votes at the end of a hand / match (buttons inside the game's result panel) ---------- */
  const skew = () => N.S ? N.S.now - (N.S._at || Date.now()) : 0;
  let voteT = 0, voteKey = '', voteSeen = 0;
  function voteUI(){
    clearTimeout(voteT);
    const t = N.S && N.S.tbl, end = document.getElementById('ovEnd');
    if (t && t.vote && end && end.hidden && window.ENDP) {
      // a vote is open but the result panel is closed: give the game a moment to show it, then open it ourselves
      const k = t.vote.kind + ':' + t.vote.until;
      if (voteKey !== k) { voteKey = k; voteSeen = Date.now(); }
      else if (Date.now() - voteSeen > 3500) end.hidden = false;
    }
    if (!t || !window.ENDP || !end || end.hidden) { if (t && (t.vote || t.step === 'end' || t.step === 'choice')) voteT = setTimeout(voteUI, 400); return; }
    const v = t.vote;
    if (v) {
      const left = Math.max(0, Math.ceil((v.until - Date.now() - skew()) / 1000));
      if (v.kind === 'again') {
        const ready = v.tally.yes || 0;
        ENDP.set([
          { label: v.mine === 'yes' ? 'Gati' : 'Luaj sërish', primary: true, on: v.mine === 'yes', click: () => send({ t: 'vote', kind: 'again', v: 'yes' }) },
          { label: 'Dil', click: () => { send({ t: 'vote', kind: 'again', v: 'no' }); leave(); } },
        ], `${ready}/${v.n} gati · ${left}s`);
      } else {
        const opts = (G.voteOptions && G.voteOptions(v.kind, t)) || [];
        ENDP.set(opts.map((o, i) => ({ label: o.label + (v.tally[o.v] ? ` · ${v.tally[o.v]}` : ''), primary: i === 0, on: v.mine === o.v,
          click: () => send({ t: 'vote', kind: v.kind, v: o.v }) })), `${left}s`);
      }
      voteT = setTimeout(voteUI, 500);
      return;
    }
    if (t.phase === 'play' && G.rematch !== false) {
      // between hands: carry on, and say early that you want another match after this one
      ENDP.set([
        { label: t.pre ? 'Revansh ✓' : 'Revansh', on: t.pre, click: () => send({ t: 'vote', kind: 'again', v: t.pre ? 'no' : 'yes' }) },
        { label: 'Vazhdo', primary: true, click: () => { end.hidden = true; ENDP.reset(); } },
      ]);
      return;
    }
    ENDP.reset();
  }
  // the room's seats with you first, then the others in table order
  function rotateSeats(t){
    const list = t.seatList, k = list.indexOf(t.me);
    return list.map((_, j) => list[(k + j) % list.length]).map(i => ({ name: i === t.me ? 'Ti' : t.seats[i].name, fem: !!t.seats[i].fem, color: t.seats[i].color }));
  }

  /* ---------- start ---------- */
  ART_LOGO();
  function ART_LOGO(){ if (window.VWCards && window.VWCards.logoURL) window.VWCards.logoURL(80).then(u => { $('#mLogo').src = u; }).catch(() => {}); }
  show('home');
  const code = (new URLSearchParams(location.search).get('r') || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(code)) { $('#mCode').value = code; if (savedName()) enter(code, false); }

  return {
    send, isHost, leave, local, show,
    menu: () => { leave(); },
    get state(){ return N.S; },
    get online(){ return !!N.room; },
  };
}
