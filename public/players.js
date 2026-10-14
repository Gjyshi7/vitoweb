/* ===== Table players: names and pace for the other seats (shared by every card game) =====
   PLAYERS.seats(n)      -> n fresh players [{name, fem, color, speed}], never two alike at one table,
                            and not the same names as the last few tables (kept in localStorage).
   PLAYERS.think(pl, c)  -> ms a player takes to decide. c = {options, forced, first, hard}
   Names follow how people actually sign up on Albanian sites: a first name with a birth year,
   a city or the country they live in, nicknames, and a few joke names. Mostly without ë/ç,
   since people type usernames on phones. */
const PLAYERS = (() => {
  const R = Math.random;
  const pick = a => a[(R() * a.length) | 0];
  const chance = p => R() < p;

  // first names of people aged roughly 18–55 (born 1970–2007), plus a few rarer ones
  const MALE = ['Erion','Klajdi','Ardit','Arlind','Endri','Fatjon','Erjon','Besmir','Altin','Gentian','Dritan','Ilir',
    'Arbër','Valon','Driton','Kristi','Ergi','Alban','Elton','Ervin','Edison','Arben','Gëzim','Sokol','Agron','Blerim',
    'Lorenc','Mario','Denis','Aldo','Xhoni','Renaldo','Kevin','Jurgen','Eljon','Olsi','Redi','Andi','Taulant','Leutrim',
    'Shkëlzen','Visar','Labinot','Florian','Klevis','Orges','Arsen','Briken','Indrit','Amarildo','Rei','Enea','Dion',
    'Gerti','Fabio','Erald','Bujar','Petrit','Ylli','Luan','Astrit','Kujtim','Ermal','Saimir','Genc','Tedi','Noel','Aron'];
  const FEMALE = ['Klea','Elona','Ornela','Anisa','Xhesika','Kejsi','Jonida','Megi','Sara','Rea','Ledia','Era','Dea',
    'Bora','Lira','Blerta','Blerina','Vlora','Fjolla','Arta','Liridona','Teuta','Mimoza','Albana','Vjosa','Flutura',
    'Eriselda','Alketa','Entela','Brikena','Elsa','Amela','Kristina','Ina','Joana','Erisa','Greta','Klaudia','Livia',
    'Aurora','Erza','Rina','Dafina','Shqipe','Drita','Mirela','Anila','Jola','Etleva','Elira','Diana','Fiona','Ajla',
    'Ambra','Ariana','Besjana','Edlira','Gresa','Marsela','Nora','Tea','Zana'];
  // short forms people use for themselves
  const NICK_M = ['Besi','Geni','Toni','Beni','Lori','Xhoni','Mario','Endi','Edi','Ari','Gimi','Kristi','Dani','Bledi','Tani','Fredi','Nini','Kujti','Sali','Rami'];
  const NICK_F = ['Mimi','Lela','Kej','Xheni','Ani','Leda','Bebi','Ela','Joni','Kiki','Lori','Megi','Tina','Vivi'];
  const SURN = ['Hoxha','Shehu','Gjoka','Leka','Krasniqi','Kola','Marku','Dervishi','Brahimi','Muca','Bajrami','Hysa',
    'Cela','Gashi','Morina','Kelmendi','Duka','Prifti','Lika','Zeneli','Rexha','Kodra','Mema','Pepa','Xhafa'];
  const CITY = ['Tirana','Durres','Vlora','Shkodra','Elbasan','Korca','Fier','Berat','Lushnja','Kukes','Saranda',
    'Pogradec','Kavaja','Lezha','Prishtina','Prizren','Peja','Gjakova','Ferizaj','Tetova','Ulqin','Struga','Gostivar'];
  const ABROAD = ['IT','DE','UK','GR','CH','US','BE','FR','NY','AT','SE'];
  const ABROAD_CITY = ['Milano','London','Athina','Zurich','Torino','Munchen','Bari','Bologna','Firenze','Roma','Wien'];
  // joke names: [name, female?]
  const FUN = [['Mbreti_Murlanit',0],['Xhokeri_Pro',0],['Gjyshi_Pro',0],['Gjyshja_Online',1],['Xhaxhi_Lul',0],
    ['Teta_Mimoza',1],['Komshiu_77',0],['Shefi_Lagjes',0],['Djali_i_Nenes',0],['Mos_Me_Fol',0],['Vetem_Fitore',0],
    ['Humbes_Profi',0],['Ngel_Pa_Leter',0],['Gjumashi',0],['Kot_Po_Luaj',0],['Raki_Rrushi',0],['Tavllaxhiu',0],
    ['Mjeshtri_99',0],['Vjehrra_Ime',1],['Skam_Fat',0],['Byrek_me_Djath',0],['Qofte_Korce',0],['Kafe_Turke',0],
    ['Pas_Pas_Pas',0],['Bomba_Ime',0],['Kunati_Pro',0],['Ska_Leter',0],['Bosi_Tiranes',0],['Princesha_07',1],
    ['Mbretresha_K',1],['Zemra_Kosoves',1],['Shqiponja_9',0],['Ujku_Malit',0],['Ariu_Panda',0],['Kapiteni',0],
    ['Profesori_10',0],['Doktori_Kot',0],['S_ka_Problem',0],['Nuk_Fal_Kend',0],['Iku_Treni',0],['Tik_Tak_Bum',0],
    ['Kafja_e_Dyte',0],['Pa_Gjume',0],['Spathi_King',0],['Derri_Ik',0],['Dyshi_Spathi',0],['Fat_i_Madh',0]];
  const COLORS = ['#2c6e8f','#7a4fa8','#2f8a62','#a8662c','#8f2c4f','#3d5aa8','#5f7a2c','#2c8f86','#8a4f2f','#6b4fa8','#a83d5a','#2f6e4f'];

  const plain = s => s.replace(/ë/g, 'e').replace(/Ë/g, 'E').replace(/ç/g, 'c').replace(/Ç/g, 'C');
  const yr2 = () => String(70 + ((R() * 38) | 0)).slice(-2);                     // 70..99, 00..07
  const yr4 = () => String(1972 + ((R() * 35) | 0));
  const caseIt = s => { const r = R(); return r < .42 ? s.toLowerCase() : r < .47 ? s.toUpperCase() : s; };
  const sep = () => pick(['_', '_', '', '.', '']);

  function one(){
    const fem = chance(.42);
    const first = pick(fem ? FEMALE : MALE);
    const p = plain(first);
    const r = R();
    let name;
    if (r < .07) { const f = pick(FUN); return { name: f[0], fem: !!f[1] }; }
    if (r < .27) name = caseIt(p) + sep() + yr2();                                   // erion97, Klea_03
    else if (r < .34) name = caseIt(p) + yr4();                                      // Arlind1998
    else if (r < .45) name = caseIt(p) + sep() + pick(CITY);                         // ana_Durres
    else if (r < .55) name = chance(.5) ? first : p;                                 // Elona, Gëzim
    else if (r < .62) name = caseIt(p) + pick(['123','007','10','7','99','11','22','13','01','x','xx','_ks','_al']);
    else if (r < .71) name = pick(fem ? NICK_F : NICK_M) + sep() + (chance(.6) ? yr2() : pick(['10','7','23','__','_x','']));
    else if (r < .81) { const s = pick(SURN); name = chance(.5) ? caseIt(p) + '.' + s.toLowerCase() : p + '_' + s[0]; }
    else if (r < .88) name = p + '_' + pick(ABROAD);                                 // Blerta_DE
    else if (r < .93) name = caseIt(p) + sep() + pick(ABROAD_CITY);                  // ardi_Milano
    else name = pick(fem ? ['Princesha_','Zemra_','Bukuroshja_','Engjelli_'] : ['Princi_','Mbreti_','Djali_','Tigri_']) + p;
    name = name.replace(/[_.]{2,}/g, '_').replace(/[_.]$/, '');
    return { name, fem };
  }

  const KEY = 'vw_recent_seats';
  function recent(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
  function remember(list){ try { localStorage.setItem(KEY, JSON.stringify(list.slice(-24))); } catch {} }

  function seats(n){
    const used = new Set(recent().map(s => s.toLowerCase()));
    const out = [], cols = COLORS.slice().sort(() => R() - .5);
    while (out.length < n) {
      const s = one();
      const k = s.name.toLowerCase();
      if (s.name.length > 15 || s.name.length < 3 || used.has(k)) continue;
      used.add(k);
      // each player has their own pace: some are quick, some take their time
      out.push({ ...s, color: cols[out.length % cols.length], speed: .72 + R() * .7 });
    }
    remember(recent().concat(out.map(s => s.name)));
    return out;
  }

  // log-normal: most decisions near the median, now and then a long one
  function lognorm(median, sigma){
    const u = 1 - R(), v = R();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return median * Math.exp(sigma * z);
  }
  function think(pl, c = {}){
    const sp = (pl && pl.speed) || 1;
    if (c.forced) return Math.min(2600, Math.max(650, lognorm(1100, .35) * sp));      // nothing to decide
    let t = lognorm(1500, .42);
    t += Math.min(c.options || 1, 12) * 110;                                         // more choices, longer look
    if (c.first) t += 600 + R() * 1000;                                               // sorting the new hand
    if (c.hard) t += 500 + R() * 900;                                                 // a big decision (bomb, last cards)
    if (chance(.05)) t += 2200 + R() * 3500;                                          // got distracted
    return Math.min(9000, Math.max(800, t * sp));
  }

  return { seats, think, one };
})();
