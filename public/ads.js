/* ===== Ads, for the whole site =====
   OFF until the site runs on its own domain and AdSense has approved it (AdSense does not take *.workers.dev).
   To turn on: set CLIENT to your ca-pub id, fill SLOTS with the ad-unit ids from AdSense, set ENABLED = true.

   Where ads go (and where they never go):
     hub-top      hub, under the two big game cards             display, responsive
     hub-bottom   hub, under the list of games                  display, responsive
     lobby        online table, while people wait to start      display, small
     rules        bottom of every rules panel                   display, small
     between      between two hands / two matches               full-screen (H5 Games Ads, adBreak 'next')
     never        on the table while you play, near LUAJ/PAS, on a Mafia/Imposter role card.
                  Accidental clicks there break AdSense policy and would get the account closed.

   Preview: open any page with ?ads=preview to see every slot as a labelled box, and a fake
   full-screen break when you press "Dora tjetër". It stays on for that tab until ?ads=off. */
const ADS = (() => {
  const ENABLED = false;
  const CLIENT = 'ca-pub-0000000000000000';
  const SLOTS = { 'hub-top': '', 'hub-bottom': '', lobby: '', rules: '' };
  const SIZE = { 'hub-top': [320, 100], 'hub-bottom': [320, 250], lobby: [320, 100], rules: [320, 100] };

  let preview = false;
  try {
    const q = new URLSearchParams(location.search).get('ads');
    if (q === 'preview') sessionStorage.setItem('vw-ads', '1');
    if (q === 'off') sessionStorage.removeItem('vw-ads');
    preview = sessionStorage.getItem('vw-ads') === '1';
  } catch (e) {}
  const live = ENABLED && !preview;
  const on = live || preview;

  const css = document.createElement('style');
  css.textContent = `
.adslot{display:none}
.adslot.on{display:block;margin:18px auto;max-width:728px;text-align:center}
.adslot.prev{display:grid;place-items:center;border:2px dashed rgba(243,199,106,.6);border-radius:12px;color:#f3c76a;
  font:600 13px system-ui,sans-serif;letter-spacing:.08em;background:rgba(243,199,106,.06)}
.adslot .lbl{display:block;font:500 11px system-ui,sans-serif;color:rgba(255,255,255,.4);letter-spacing:.1em;margin-bottom:4px}
#adBreak{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(5,8,15,.92);color:#f3c76a;
  font:700 20px system-ui,sans-serif;letter-spacing:.06em;text-align:center}
#adBreak small{display:block;margin-top:8px;color:rgba(255,255,255,.55);font-weight:500;font-size:14px}`;
  document.head.appendChild(css);

  if (live) {
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
    s.dataset.adFrequencyHint = '120s';             // at most one full-screen break every 2 minutes
    document.head.appendChild(s);
  }
  window.adsbygoogle = window.adsbygoogle || [];
  const adBreak = o => window.adsbygoogle.push(o);
  if (live) adBreak({ preloadAdBreaks: 'on', sound: 'on' });   // adConfig

  // fill every <div class="adslot" data-ad="..."> on the page (and ones added later with ADS.fill)
  function fill(root = document){
    root.querySelectorAll('.adslot[data-ad]:not(.on)').forEach(el => {
      const k = el.dataset.ad;
      if (!on || !(k in SLOTS)) return;
      if (preview) {
        const [w, h] = SIZE[k] || [320, 100];
        el.classList.add('on', 'prev'); el.style.width = Math.min(w, 728) + 'px'; el.style.maxWidth = '100%'; el.style.height = h + 'px';
        el.textContent = `REKLAMË · ${k} · ${w}×${h}`;
        return;
      }
      if (!SLOTS[k]) return;
      el.classList.add('on');
      el.innerHTML = `<span class="lbl">REKLAMË</span><ins class="adsbygoogle" style="display:block" data-ad-client="${CLIENT}" data-ad-slot="${SLOTS[k]}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      try { window.adsbygoogle.push({}); } catch (e) {}
    });
  }

  // full-screen break between hands. done() always runs, ad or no ad.
  function between(name, done){
    if (!on) return done();
    if (preview) {
      const d = document.createElement('div'); d.id = 'adBreak';
      d.innerHTML = `<div>REKLAMË MES DUARSH<small>${name} · shfaqet nga Google jo më shpesh se një herë në 2 minuta</small></div>`;
      document.body.appendChild(d);
      setTimeout(() => { d.remove(); done(); }, 1600);
      return;
    }
    let called = false, showing = false;
    const fin = () => { if (!called) { called = true; done(); } };
    try { adBreak({ type: 'next', name, beforeAd: () => { showing = true; }, adBreakDone: fin }); } catch (e) { fin(); }
    setTimeout(() => { if (!showing) fin(); }, 4000);   // no ad came: never leave a player waiting
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fill());
  else fill();
  return { on, preview, fill, between };
})();
