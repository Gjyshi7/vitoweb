/* Presence: this page tells the server it is open, where (hub or a game) and what this phone usually
   plays (a count per game, kept on the phone). The quick match uses it to keep a seat open for
   someone who is likely to sit down in a moment, instead of filling every seat with a bot at once.
   Nothing personal is sent: no name, just a place and the play counts.
     VWP.set(where, state)   where: 'hub' | game id;  state: 'menu' | 'search' | 'play' | 'room'
     VWP.played(game)        one more game played here
     VWP.pause(on)           the hub stops reporting while a game page (in its frame) reports for itself
     VWP.count               the last { all, by } the server answered (people on the site, per page) */
(() => {
  // Every report costs the site a request, so: once a minute on menus (30 s signed in, for friends' invitations),
  // once every 5 minutes while playing (the table itself knows you're there), and right away when the place changes.
  const KEY = 'vw.hist', EVERY = 60_000, EVERY_SIGNED = 30_000, EVERY_PLAY = 300_000;
  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '').toLowerCase();
  const P = { where: /^[a-z]{2,12}$/.test(page) && page !== 'index' ? page : 'hub', state: 'menu', count: null, t: 0, last: 0, paused: false };
  const hist = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
  function send(now){
    if (document.visibilityState !== 'visible' || P.paused) return;
    if (!now && Date.now() - P.last < 4000) return;
    P.last = Date.now();
    fetch('/api/presence', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ where: P.where, state: P.state, hist: hist() }) })
      .then(r => r.ok ? r.json() : null).then(j => {
        if (!j) return;
        if (typeof j.all === 'number') P.count = j;
        if (j.invites && j.invites.length) dispatchEvent(new CustomEvent('vw-invites', { detail: j.invites }));
      }).catch(() => {});
  }
  function loop(){ clearTimeout(P.t); send(true); P.t = setTimeout(loop, P.state === 'play' ? EVERY_PLAY : P.signed ? EVERY_SIGNED : EVERY); }
  window.VWP = {
    set(where, state){
      const changed = where !== P.where || state !== P.state;
      P.where = where || P.where; P.state = state || P.state;
      if (changed) loop();          // report now, and set the next report for the new state's pace
    },
    played(game){
      const h = hist(); h[game] = (h[game] || 0) + 1;
      try { localStorage.setItem(KEY, JSON.stringify(h)); } catch (e) {}
    },
    signedIn(on){ const was = P.signed; P.signed = !!on; if (on && !was) loop(); },
    pause(on){ P.paused = !!on; if (!on) send(true); },
    get count(){ return P.count; },
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loop(); else clearTimeout(P.t); });
  loop();
})();
