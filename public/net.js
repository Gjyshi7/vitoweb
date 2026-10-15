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
#menu{--pk:#ef5a86;--pk2:#b02a63;--gd:#f3c76a;--ink:#eef2f8;--sub:#8f9bb2;--card:rgba(255,255,255,.055);--ln:rgba(255,255,255,.09);
  position:fixed;inset:0;z-index:900;overflow:auto;color:var(--ink);background:#090e19;
  font-family:var(--f-ui, "Barlow Semi Condensed", system-ui, sans-serif);-webkit-user-select:none;user-select:none;
  padding:env(safe-area-inset-top,0) max(16px,env(safe-area-inset-right,0)) env(safe-area-inset-bottom,0) max(16px,env(safe-area-inset-left,0))}
#menu::before{content:"";position:fixed;inset:0;pointer-events:none;background:
  radial-gradient(60% 55% at 28% 42%,rgba(35,84,112,.55),transparent 70%),radial-gradient(50% 40% at 80% 0%,rgba(176,42,99,.16),transparent 70%)}
#menu[hidden]{display:none}
#menu .wrap{position:relative;max-width:1040px;margin:0 auto;min-height:100%;display:flex;flex-direction:column;padding-bottom:16px}
#menu .bar{display:flex;align-items:center;gap:12px;height:60px;flex:none}
#menu .back{width:44px;height:44px;border:0;border-radius:14px;background:var(--card);color:#c9d2e3;display:grid;place-items:center;cursor:pointer;flex:none}
#menu .back svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#menu .brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;letter-spacing:.2em;color:var(--sub)}
#menu .brand img{width:22px}
#menu .me{margin-left:auto;display:flex;align-items:center;gap:10px;height:44px;padding:0 14px 0 5px;border:0;border-radius:22px;background:var(--card);
  box-shadow:inset 0 0 0 1px var(--ln);color:var(--ink);font:700 16px inherit;font-family:inherit;cursor:pointer;max-width:56%}
#menu .me .av{width:34px;height:34px;border-radius:50%;background:var(--pk2);display:grid;place-items:center;font-size:15px;color:#fff;flex:none;overflow:hidden}
#menu .me .av img{width:100%;height:100%;object-fit:cover}
#menu .me span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#menu .me.anon span{color:var(--sub);font-weight:600}

/* home: the game on the left, what to do on the right */
#menu .home{flex:1;display:grid;grid-template-columns:1fr;gap:18px;align-content:start}
#menu .hero{position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:230px;border-radius:26px;overflow:hidden;
  background:radial-gradient(120% 90% at 60% 30%,#1f4d68 0%,#10283a 55%,#0b1a28 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 24px 50px rgba(0,0,0,.35)}
#menu .hero canvas{position:absolute;right:-4%;top:6%;width:72%;height:auto;pointer-events:none}
#menu .htxt{position:relative;padding:20px 22px}
#menu .hero h1{margin:0;font:800 64px/.9 var(--f-d, "Barlow Condensed", "Arial Narrow", sans-serif);letter-spacing:.01em;text-transform:uppercase;text-shadow:0 4px 24px rgba(0,0,0,.4)}
#menu .hero .sub{margin:8px 0 0;color:#c4cede;font-size:17px;font-weight:600}
#menu .live{display:inline-flex;align-items:center;gap:8px;margin-top:10px;padding:5px 12px 5px 10px;border-radius:999px;background:rgba(0,0,0,.28);font-size:14px;font-weight:600;color:#d7f3e8}
#menu .live i{width:8px;height:8px;border-radius:50%;background:#5fd0a8;box-shadow:0 0 0 3px rgba(95,208,168,.2)}
#menu .act{display:flex;flex-direction:column;gap:12px}
#menu .modes{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:10px}
#menu .modes button{text-align:left;min-height:64px;padding:10px 14px;border:0;border-radius:16px;background:var(--card);box-shadow:inset 0 0 0 1px var(--ln);
  color:var(--sub);font:700 18px/1.15 inherit;font-family:inherit;cursor:pointer}
#menu .modes button small{display:block;margin-top:3px;font-size:13px;font-weight:600;opacity:.8}
#menu .modes button.on{color:var(--ink);background:rgba(239,90,134,.12);box-shadow:inset 0 0 0 2px var(--pk)}
#menu .b{display:block;width:100%;height:56px;border:0;border-radius:16px;font:700 18px inherit;font-family:inherit;letter-spacing:.04em;cursor:pointer;color:var(--ink);background:var(--card);box-shadow:inset 0 0 0 1px var(--ln)}
#menu .b:active{transform:scale(.98)}
#menu .b.main{height:76px;color:#fff;background:linear-gradient(#f37399,var(--pk) 45%,var(--pk2));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 10px 26px rgba(176,42,99,.38)}
#menu .b.main span{display:block;font:800 30px/1 var(--f-d, "Barlow Condensed", sans-serif);letter-spacing:.12em}
#menu .b.main small{display:block;margin-top:4px;font-size:14px;font-weight:600;letter-spacing:.02em;opacity:.9}
#menu .b:disabled{opacity:.5;cursor:default}
#menu .b.chev{display:flex;align-items:center;justify-content:space-between;padding:0 18px;text-align:left}
#menu .b.chev:after{content:"";width:9px;height:9px;border-right:2px solid var(--sub);border-bottom:2px solid var(--sub);transform:rotate(45deg);margin-top:-5px;transition:transform .2s}
#menu .b.chev.open:after{transform:rotate(225deg);margin-top:4px}
#menu .fr{display:grid;gap:10px;padding:12px;border-radius:18px;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px var(--ln)}
#menu .fr[hidden]{display:none}
#menu .join{display:grid;grid-template-columns:1fr 104px;gap:10px}
#menu .join .b{height:54px}
#menu input{width:100%;box-sizing:border-box;height:54px;border-radius:14px;border:0;padding:0 16px;font:600 20px inherit;font-family:inherit;color:var(--ink);
  background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);-webkit-user-select:text;user-select:text}
#menu input:focus{outline:2px solid var(--gd);outline-offset:1px}
#menu #mCode{text-transform:uppercase;letter-spacing:.32em;text-align:center}
#menu .err{min-height:20px;margin:0 2px;color:#ffb3a6;font-size:15px}
#menu .me .gi{display:none;width:20px;height:20px;padding:3px;border-radius:7px;background:#fff;flex:none;box-sizing:content-box}
#menu .me.gout{background:linear-gradient(#f37399,var(--pk) 45%,var(--pk2))!important;color:#fff!important;box-shadow:0 6px 18px rgba(176,42,99,.35)!important}
#menu .me.gout .gi{display:block}
#menu .me.gout span,#menu .me.gout.anon span{color:#fff!important;font-weight:700}
#menu .me.gout .av{display:none}
#menu .link{align-self:center;background:none;border:0;color:var(--sub);font:600 15px inherit;font-family:inherit;text-decoration:underline;text-underline-offset:4px;cursor:pointer;padding:6px}
#menu .grow{flex:1}

/* name sheet */
#menu .nsh{position:fixed;inset:0;z-index:5;background:rgba(4,7,14,.7);display:flex;align-items:flex-end;justify-content:center;padding:12px}
#menu .nsh[hidden]{display:none}
#menu .nsh .box{width:100%;max-width:420px;padding:22px 18px calc(18px + env(safe-area-inset-bottom,0px));border-radius:22px;background:#111a2b;box-shadow:inset 0 0 0 1px var(--ln),0 30px 60px rgba(0,0,0,.5);display:grid;gap:12px}
#menu .nsh h3{margin:0;font-size:26px;font-weight:800}
#menu .nsh p{margin:-4px 0 2px;color:var(--sub);font-size:16px}
#menu .nsh .or{display:flex;align-items:center;gap:10px;color:var(--sub);font-size:14px}
#menu .nsh .or:before,#menu .nsh .or:after{content:"";flex:1;height:1px;background:var(--ln)}

/* room: the table seen from above, people sitting down */
#menu .room{flex:1;display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:4px}
#menu .rhead{text-align:center}
#menu .rhead h2{margin:0;font:800 34px/1 var(--f-d, "Barlow Condensed", sans-serif);letter-spacing:.02em;text-transform:uppercase}
#menu .rhead p{margin:6px 0 0;color:var(--sub);font-size:16px;min-height:20px}
#menu .dots:after{content:"";display:inline-block;width:1.2em;text-align:left;animation:mdots 1.4s steps(4) infinite}
@keyframes mdots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
#menu .code{display:inline-flex;align-items:center;gap:12px;padding:8px 10px 8px 18px;border-radius:16px;background:var(--card);box-shadow:inset 0 0 0 1px var(--ln)}
#menu .code[hidden]{display:none}
#menu .code span{font-size:13px;letter-spacing:.16em;color:var(--sub);font-weight:700}
#menu .code b{font:800 34px/1 var(--f-d, "Barlow Condensed", sans-serif);letter-spacing:.22em;color:var(--gd)}
#menu .tbl{position:relative;width:min(560px,100%);aspect-ratio:16/9;margin:6px 0}
#menu .tbl:before{content:"";position:absolute;inset:14% 14% 22%;border-radius:50%;background:radial-gradient(closest-side,#235470,#123048);box-shadow:inset 0 0 0 6px #3a2617,inset 0 0 0 8px #5a3a22,0 18px 40px rgba(0,0,0,.4)}
#menu .tbl .s{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:5px;width:120px;text-align:center;border:0;background:none;color:inherit;font-family:inherit;padding:0}
#menu .tbl .s .av{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:21px;color:#fff;box-shadow:0 6px 16px rgba(0,0,0,.35);animation:mpop .35s cubic-bezier(.2,1.4,.4,1)}
#menu .tbl .s b{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:700}
#menu .tbl .s small{font-size:12px;color:var(--sub);letter-spacing:.06em;margin-top:-3px}
#menu .tbl .s.mine .av{box-shadow:0 0 0 3px var(--pk),0 6px 16px rgba(0,0,0,.35)}
#menu .tbl .s.empty .av{background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14);animation:none}
#menu .tbl .s.empty b{color:var(--sub);font-weight:600}
#menu .tbl .s.wait .av:after{content:"";width:16px;height:16px;border-radius:50%;border:2px solid var(--sub);border-top-color:transparent;animation:mspin .8s linear infinite}
#menu .tbl button.s{cursor:pointer}
@keyframes mspin{to{transform:rotate(360deg)}}
@keyframes mpop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
#menu .rside{display:flex;flex-direction:column;gap:10px;align-items:stretch;width:min(560px,100%)}
#menu .rside .code{align-self:center}
#menu .rside .link{margin-top:4px}
#menu .rbtns{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:10px;width:min(560px,100%)}
#menu .rbtns[hidden]{display:none}

/* rules */
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
@media (min-width:700px), (orientation:landscape){
  #menu .home{grid-template-columns:1.1fr 1fr;align-items:start;gap:20px}
  #menu .hero{min-height:0;height:min(520px,calc(100dvh - 92px))}
  #menu .act{max-height:none}
}
@media (orientation:landscape) and (max-height:520px){
  #menu .bar{height:52px}
  #menu .hero h1{font-size:52px}
  #menu .hero .sub{font-size:15px}
  #menu .htxt{padding:16px 18px}
  #menu .act{gap:10px}
  #menu .modes button{min-height:54px;font-size:16px}
  #menu .b{height:50px}
  #menu .b.main{height:66px}
  #menu .b.main span{font-size:26px}
  #menu .tbl{width:min(430px,62vw);margin:0}
  #menu .tbl .s .av{width:44px;height:44px;font-size:18px}
  #menu .rhead p{margin-top:2px}
  #menu .room{gap:6px}
  #menu .rhead h2{font-size:28px}
  #menu .room{flex-direction:row;flex-wrap:wrap;justify-content:center;align-content:flex-start;column-gap:24px}
  #menu .rhead{flex-basis:100%}
  #menu .rside{width:min(300px,30vw)}
  #menu .rside .code{align-self:stretch;justify-content:center}
  #menu .rbtns{grid-auto-flow:row;width:100%}
}
@media (orientation:portrait){ #menu .hero canvas{width:78%;right:-6%;top:4%} #menu .hero{min-height:270px} }`;
  document.head.appendChild(css);

  const menu = document.createElement('div');
  menu.id = 'menu';
  const modeTiles = G.modes && G.modes.length > 1 ? `<div class="modes" id="mMode">${G.modes.map((m, i) => `<button type="button" data-i="${i}">${esc(m.label)}${m.sub ? `<small>${esc(m.sub)}</small>` : ''}</button>`).join('')}</div>` : '';
  menu.innerHTML = `<div class="wrap">
    <div class="bar"><button class="back" id="mBack" type="button" aria-label="Kthehu te lojërat"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="brand"><img id="mLogo" alt="">LOJA</div>
      <button class="me anon" id="mMe" type="button"><svg class="gi" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.4-4.6 7.1l7.4 5.8c4.3-4 6.9-9.9 6.9-17.4z"/><path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg><span class="av" id="mMeAv">?</span><span id="mMeName">Emri yt</span></button></div>
    <section id="mHome" class="home">
      <div class="hero"><canvas id="mArt" width="900" height="600" aria-hidden="true"></canvas>
        <div class="htxt"><h1>${esc(G.title)}</h1>${G.sub ? `<p class="sub">${esc(G.sub)}</p>` : ''}<div class="live" id="mLive" hidden><i></i><span></span></div></div></div>
      <div class="act">
        ${modeTiles}
        <button class="b main" id="mQuick" type="button"><span>LUAJ</span><small>me lojtarë online</small></button>
        <button class="b chev" id="mFriends" type="button" aria-expanded="false">Me shokët</button>
        <div class="fr" id="mFr" hidden>
          <button class="b" id="mCreate" type="button">Krijo dhomë</button>
          <div class="join"><input id="mCode" maxlength="4" placeholder="KODI" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-label="Kodi i dhomës"><button class="b" id="mJoin" type="button">Hyr</button></div>
        </div>
        <p class="err" id="mErr"></p>
        <button class="link" id="mRules" type="button">Rregullat</button>
      </div>
      <div class="nsh" id="mNameSh" hidden><div class="box" role="dialog" aria-modal="true" aria-labelledby="mNameT">
        <h3 id="mNameT">Si të quajnë?</h3><p>Ky emër shfaqet te tavolina.</p>
        <input id="mName" maxlength="16" autocomplete="nickname" enterkeyhint="go" spellcheck="false" aria-label="Emri yt">
        <button class="b main" id="mNameOk" type="button"><span style="font-size:24px">VAZHDO</span></button>
        <div id="mNameG" hidden><div class="or">ose</div><button class="b" id="mNameGo" type="button" style="margin-top:12px">Hyr me Google</button></div>
      </div></div>
    </section>
    <section id="mRulesSec" hidden>
      <div class="rules" id="mRulesBody"></div>
      <button class="b" id="mRulesClose" type="button">Mbyll</button>
    </section>
    <section id="mRoom" class="room" hidden>
      <div class="rhead"><h2 id="mRoomT">Dhoma</h2><p id="mLead"></p></div>
      <div class="tbl" id="mSeats"></div>
      <div class="rside">
        <div class="code" id="mCodeBox"><span>KODI</span><b id="mCodeTxt"></b></div>
        <div class="rbtns" id="mRoomBtns"><button class="b" id="mShare" type="button">Dërgo linkun</button><button class="b" id="mInvite" type="button" hidden>Fto shokët</button><button class="b main" id="mStart" type="button"><span style="font-size:24px">FILLO</span></button></div>
        <p class="err" id="mErr2"></p>
        <div class="adslot" data-ad="lobby"></div>
        <button class="link" id="mLeave" type="button">Dil</button>
      </div>
    </section>
  </div>`;
  document.body.appendChild(menu);
  const badge = document.createElement('div'); badge.id = 'netBadge'; badge.hidden = true; badge.textContent = 'PO LIDHET…';
  document.body.appendChild(badge);
  if (typeof ADS !== 'undefined') ADS.fill(menu);

  /* ---------- the picture: a hand of this game ---------- */
  function drawArt(){
    const c = $('#mArt'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (G.art === 'domino') {
      const tiles = [[6, 6], [6, 3], [3, 5], [5, 5], [5, 1]];
      tiles.forEach(([a, b], k) => {
        ctx.save(); ctx.translate(250 + k * 120, 300 + Math.abs(k - 2) * 26); ctx.rotate((k - 2) * .16);
        tile(ctx, a, b); ctx.restore();
      });
      return;
    }
    if (!window.VWCards) return;
    const ids = G.art || [], n = ids.length;
    ids.forEach((id, k) => {
      const img = VWCards.drawFace(id, '2');
      ctx.save(); ctx.translate(430 + (k - (n - 1) / 2) * 92, 520); ctx.rotate((k - (n - 1) / 2) * .17);
      ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10;
      ctx.drawImage(img, -105, -420, 210, 294); ctx.restore();
    });
  }
  function tile(ctx, a, b){
    const w = 110, h = 220, r = 16;
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, r); ctx.fillStyle = '#f7f4ec'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-w / 2 + 14, 0); ctx.lineTo(w / 2 - 14, 0); ctx.stroke();
    const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    [[a, -h / 4], [b, h / 4]].forEach(([v, cy]) => (P[v] || []).forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x * 28, cy + y * 28, 10, 0, Math.PI * 2); ctx.fillStyle = '#1b1f27'; ctx.fill(); }));
  }
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(drawArt);

  /* ---------- you: name, picture, account ---------- */
  function renderMe(){
    const u = window.VWA && VWA.me, n = (u && u.uname) || savedName();
    $('#mMe').classList.toggle('anon', !n);
    $('#mMeName').textContent = n || (window.VWA && VWA.enabled ? 'Hyr' : 'Emri yt');
    $('#mMe').classList.toggle('gout', !!(window.VWA && VWA.enabled && !u));
    if (window.VWA && VWA.enabled && !u) $('#mMeName').textContent = 'Hyr me Google';
    $('#mMeAv').innerHTML = u && u.pic ? `<img src="${esc(u.pic)}" alt="" referrerpolicy="no-referrer">` : esc((n || '?')[0].toUpperCase());
  }
  if (window.VWA) {
    VWA.onChange(u => { if (u) { store.set('name', u.uname); $('#mName').value = u.uname; if (afterName && !$('#mNameSh').hidden) nameOk(); } renderMe(); });
    VWA.ready.then(() => { $('#mNameG').hidden = !VWA.enabled; renderMe(); });
  }
  $('#mMe').onclick = () => { if (window.VWA && VWA.enabled) VWA.open(); else askName(); };
  $('#mNameGo').onclick = () => { if (window.VWA) VWA.open(); };

  // people at this game right now (only shown when it's worth saying)
  function renderLive(){
    const c = window.VWP && VWP.count, n = c && c.by ? (c.by[G.game] || 0) : 0;
    $('#mLive').hidden = n < 5;
    if (n >= 5) $('#mLive').lastChild.textContent = `${n} në ${G.title} tani`;
  }
  setInterval(renderLive, 5000); setTimeout(renderLive, 1500);
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
  const clean = v => String(v || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  // a name is needed before sitting down: ask once, in a small sheet, then carry on with what was tapped
  let afterName = null;
  function askName(then){
    afterName = then || null;
    $('#mName').value = savedName(); $('#mNameSh').hidden = false;
    setTimeout(() => $('#mName').focus(), 60);
  }
  function nameOk(){
    const n = clean($('#mName').value);
    if (!n) { $('#mName').focus(); return; }
    store.set('name', n); $('#mNameSh').hidden = true; $('#mName').blur(); renderMe();
    const t = afterName; afterName = null; if (t) t();
  }
  $('#mNameOk').onclick = nameOk;
  $('#mName').addEventListener('keydown', e => { if (e.key === 'Enter') nameOk(); });
  $('#mNameSh').addEventListener('click', e => { if (e.target.id === 'mNameSh') { $('#mNameSh').hidden = true; afterName = null; } });
  function needName(then){
    const n = clean(savedName());
    if (!n) { askName(then); return null; }
    err(''); return n;
  }
  renderMe();

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
  const AWAY_MSG = 'Ishe larg më shumë se një minutë, ndaj vendin tënd e zuri një lojtar tjetër.';
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

  // the table you're at: kept fresh while you're there, so the main page and this page only offer to take
  // you back within KEEP_MS of when you were last at it (the server ends a game nobody is at after 90 s)
  const KEEP_MS = 90_000;
  const touchTable = () => { const t = store.get('table', null); if (t && N.room && t.code === N.room) store.set('table', { ...t, at: Date.now() }); };
  setInterval(touchTable, 10_000);
  addEventListener('pagehide', touchTable);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') touchTable(); });

  function enter(code, quickMatch){
    N.room = code; N.S = null; N.quick = !!quickMatch; N.table = false; N.seen = null;
    store.set('table', { game: G.game, code, quick: !!quickMatch, at: Date.now() });
    const u = new URL(location.href); u.search = quickMatch ? '' : '?r=' + code; history.replaceState(null, '', u);
    $('#mCodeTxt').textContent = code;
    $('#mCodeBox').hidden = !!quickMatch;
    $('#mSeats').innerHTML = ''; $('#mLead').textContent = ''; $('#mRoomT').innerHTML = quickMatch ? '<span class="dots">Po kërkohen lojtarë</span>' : 'Dhoma me shokë';
    $('#mRoomBtns').hidden = true; err('', true);
    show('room');
    connect();
  }
  function leave(msg){
    const wasTable = N.table;
    if (N.ws && N.room) { if (!isHost() || N.quick) send({ t: 'leave' }); }
    N.want = false; if (N.ws) try { N.ws.close(); } catch(e) {}
    N.ws = null; N.S = null; N.room = null; N.table = false; N.quick = false; badge.hidden = true; N.seen = null;
    store.set('table', null);
    history.replaceState(null, '', location.pathname);
    clearTimeout(voteT); clearTimeout(awayT); document.querySelectorAll('.plate.vw-away').forEach(el => el.classList.remove('vw-away')); if (window.ENDP) ENDP.reset();
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
    if (!needName(quick)) return;
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
    if (!needName(() => $('#mCreate').click())) return;
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
    if (!needName(join)) return;
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
  $('#mFriends').onclick = () => {
    const open = $('#mFr').hidden; $('#mFr').hidden = !open;
    $('#mFriends').classList.toggle('open', open); $('#mFriends').setAttribute('aria-expanded', open);
    if (open) setTimeout(() => $('#mFr').scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
  };
  $('#mInvite').onclick = () => { if (window.VWA && N.room) VWA.open({ invite: { code: N.room, game: G.game, label: G.title } }); };
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
    const b = e.target.closest('button.s.empty'); if (!b) return;
    send({ t: 'seat', seat: +b.dataset.seat });
  });

  /* ---------- states from the room ---------- */
  // the lobby as a table seen from above: you at the bottom, the others where they will sit
  const SPOT = { 4: [[50, 80], [9, 47], [50, 14], [91, 47]], 2: [[50, 80], [50, 14]] };
  function renderRoom(t){
    const list = t.seatList, n = list.length, k = Math.max(0, list.indexOf(t.me));
    const teams = G.teamsFor && G.teamsFor(t.cfg);
    const spots = SPOT[n] || SPOT[4];
    $('#mSeats').innerHTML = list.map((_, j) => {
      const i = list[(k + j) % n], x = t.seats[i], [left, top] = spots[j];
      const pos = `style="left:${left}%;top:${top}%"`;
      const tag = teams && j === 2 ? '<small>PARTNERI</small>' : '';
      if (!x) return t.pub ? `<div class="s empty wait" ${pos}><span class="av"></span><b>…</b></div>`
        : `<button type="button" class="s empty" data-seat="${i}" ${pos}><span class="av"></span><b>Ulu këtu</b></button>`;
      return `<div class="s${i === t.me ? ' mine' : ''}" ${pos}><span class="av" style="background:${x.color || '#3a4a66'}">${esc((x.name[0] || '?').toUpperCase())}</span><b>${esc(i === t.me ? x.name : x.name)}</b>${tag}</div>`;
    }).join('');
    const filled = list.filter(i => t.seats[i]).length;
    const signed = !!(window.VWA && VWA.me);
    if (t.pub) {
      $('#mRoomT').innerHTML = '<span class="dots">Po kërkohen lojtarë</span>';
      $('#mLead').textContent = `${filled} nga ${n} · loja nis sapo të mbushet tavolina`;
      $('#mRoomBtns').hidden = true;
    } else {
      $('#mRoomT').textContent = 'Dhoma me shokë';
      $('#mRoomBtns').hidden = false;
      $('#mStart').hidden = !isHost();
      $('#mInvite').hidden = !signed;
      $('#mLead').textContent = isHost() ? (filled < n ? 'Dërgoju kodin ose linkun. Vendet që mbeten bosh i zënë lojtarë të tjerë kur shtyp Fillo.' : 'Gati. Shtyp Fillo.') : 'Pret hostin të fillojë.';
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
    seatNews(t);
    G.onTable(t, S);
    voteUI();
    awayMarks();
  }

  /* ---------- someone isn't at the table any more: the others see it on their plate ---------- */
  const AWAY_SHOW_MS = 5_000;         // a short network drop doesn't flash it
  let awayT = 0;
  (() => {
    const st = document.createElement('style');
    st.textContent = `.plate.vw-away{opacity:.62;filter:saturate(.4)}
.plate.vw-away::after{content:'NUK ËSHTË KËTU';position:absolute;left:50%;top:100%;transform:translate(-50%,6px);padding:3px 10px;border-radius:8px;
background:rgba(10,16,30,.94);color:#ffb3a6;font:700 13px/1.3 inherit;font-family:inherit;letter-spacing:.08em;white-space:nowrap;
box-shadow:inset 0 0 0 1px rgba(255,179,166,.4);pointer-events:none;z-index:2}`;
    document.head.appendChild(st);
  })();
  function awayMarks(){
    clearTimeout(awayT);
    const t = N.S && N.S.tbl;
    document.querySelectorAll('.plate.vw-away').forEach(el => el.classList.remove('vw-away'));
    if (!t || !N.table || t.me < 0 || (t.phase !== 'play' && t.phase !== 'over')) return;
    const n = t.seatList.some(i => i > 1) ? 4 : 2, srv = Date.now() + skew();
    let next = 0;
    t.seatList.forEach(i => {
      const x = t.seats[i]; if (!x || i === t.me || !x.off) return;
      const el = document.getElementById('pl' + ((i - t.me + n) % n)); if (!el) return;
      const wait = x.off + AWAY_SHOW_MS - srv;
      if (wait <= 0) el.classList.add('vw-away');
      else next = next ? Math.min(next, wait) : wait;
    });
    if (next) awayT = setTimeout(awayMarks, next + 50);
  }

  /* ---------- someone left the table, someone new sat down ---------- */
  function seatNews(t){
    const now = t.seatList.map(i => (t.seats[i] && i !== t.me) ? { name: t.seats[i].name, fem: !!t.seats[i].fem } : null);
    const was = N.seen; N.seen = now;
    if (!was || t.phase !== 'play' && t.phase !== 'over') return;
    const msgs = [];
    now.forEach((n, k) => { const o = was[k]; if (o && n && o.name !== n.name) msgs.push(`${o.name} doli nga loja · ${n.name} u ul në vend të ${o.fem ? 'saj' : 'tij'}`); });
    if (msgs.length) tableNote(msgs.join('\n'));
  }
  let noteT = 0;
  function tableNote(txt){
    const stage = document.getElementById('stage') || document.body;
    let el = document.getElementById('netNote');
    if (!el) {
      el = document.createElement('div'); el.id = 'netNote';
      el.style.cssText = 'position:absolute;left:50%;top:76px;transform:translateX(-50%);z-index:440;max-width:80%;padding:10px 18px;border-radius:14px;background:rgba(10,16,30,.92);color:#eef1f6;font:600 19px/1.35 inherit;font-family:inherit;text-align:center;white-space:pre-line;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 10px 30px rgba(0,0,0,.4);transition:opacity .3s;pointer-events:none';
      stage.appendChild(el);
    }
    el.textContent = txt; el.style.opacity = '1';
    clearTimeout(noteT); noteT = setTimeout(() => { el.style.opacity = '0'; }, 4500);
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
        { label: t.pre ? 'Rematch ✓' : 'Rematch', on: t.pre, click: () => send({ t: 'vote', kind: 'again', v: t.pre ? 'no' : 'yes' }) },
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
  function ART_LOGO(){ if (window.VWCards && window.VWCards.logoURL) window.VWCards.logoURL(80).then(u => { $('#mLogo').src = u; }).catch(() => {}); else $('#mLogo').hidden = true; }
  show('home');
  const code = (new URLSearchParams(location.search).get('r') || '').toUpperCase();
  const back = store.get('table', null);
  if (/^[A-Z]{4}$/.test(code)) { $('#mCode').value = code; if (savedName()) enter(code, !!(back && back.code === code && back.quick)); }
  else if (back && back.game === G.game && /^[A-Z]{4}$/.test(back.code) && Date.now() - back.at < KEEP_MS && savedName()) {
    // you closed the page at a table a moment ago: go back to it. Gone longer than that, the game is gone.
    fetch('/api/room/' + back.code).then(r => r.json()).then(j => { if (j.ok && j.game === G.game && j.phase !== 'closed' && !N.room) enter(back.code, !!back.quick); else store.set('table', null); }).catch(() => {});
  } else if (back) store.set('table', null);

  return {
    send, isHost, leave, local, show,
    menu: () => { leave(); },
    get state(){ return N.S; },
    get online(){ return !!N.room; },
  };
}
