#!/usr/bin/env python3
"""Writes the rules pages for vitoweb.al: Albanian in public/rregullat/, English in public/rules/.
Static output; the HTML is what ships. Run after changing a rule:   python3 scripts/rules.py
"""
import os, sys, html

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")

GAMES_EN = [
    ("murlan", "Murlan", "4 players · 54 cards · to 21"),
    ("spathi", "Spathi", "2 players · 52 cards · to 21"),
    ("derri", "Derri në dorë", "4 players · 49 cards"),
    ("domino", "Domino", "2 or 4 players · 28 tiles · to 100"),
    ("imposter", "Imposter", "3–12 people · party game"),
    ("mafia", "Mafia", "party game · roles on your phone"),
]
GAMES = [
    ("murlan", "Murlan", "4 lojtarë · 54 letra · deri në 21"),
    ("spathi", "Spathi", "2 lojtarë · 52 letra · deri në 21"),
    ("derri", "Derri në dorë", "4 lojtarë · 49 letra"),
    ("domino", "Domino", "2 ose 4 lojtarë · 28 gurë · deri në 100"),
    ("imposter", "Imposter", "3–12 veta · lojë për grupin"),
    ("mafia", "Mafia", "lojë për grupin · rolet në telefon"),
]

REDIRECT = "<script>/* one address: www. and the old loja. go to vitoweb.al */if(/^(www|loja)\\./.test(location.hostname))location.replace('https://vitoweb.al'+location.pathname+location.search+location.hash)</script>"


UI = {
    "sq": dict(dir="rregullat", all="Të gjitha lojërat", rules="Rregullat", rules_aria="Rregullat e lojërave", other="English", other_lang="en"),
    "en": dict(dir="rules", all="All games", rules="Rules", rules_aria="Game rules", other="Shqip", other_lang="sq"),
}
ICONS = """<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
<link rel="icon" type="image/png" sizes="144x144" href="/favicon-144.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">"""


def page(slug, title, desc, eyebrow, h1, lead, facts, cta_href, cta_label, body, canonical, lang="sq"):
    u = UI[lang]
    games = GAMES_EN if lang == "en" else GAMES
    others = "".join(
        f'<a href="/{u["dir"]}/{g}"{" aria-current=\"page\"" if g == slug else ""}>{html.escape(n)}</a>' for g, n, _ in games)
    sq_url = f"/rregullat/{slug}" if slug else "/rregullat/"
    en_url = f"/rules/{slug}" if slug else "/rules/"
    other_url = en_url if lang == "sq" else sq_url
    cta = f'<a class="cta" href="{cta_href}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>{cta_label}</a>' if cta_href else ""
    facts_html = f'<p class="facts">{html.escape(facts)}</p>' if facts else ""
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
{REDIRECT}
<link rel="canonical" href="https://vitoweb.al{canonical}">
<link rel="alternate" hreflang="sq" href="https://vitoweb.al{sq_url}">
<link rel="alternate" hreflang="en" href="https://vitoweb.al{en_url}">
<link rel="alternate" hreflang="x-default" href="https://vitoweb.al{sq_url}">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a1020">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="VITOWEB">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:url" content="https://vitoweb.al{canonical}">
<meta property="og:image" content="https://vitoweb.al/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
{ICONS}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">
<link rel="stylesheet" href="/rules.css">
<script src="/i18n.js"></script>
<script>/* the language chosen on the main page: the same rules in that language */if(window.VWL&&VWL.chosen&&VWL.lang!=="{lang}")location.replace("{other_url}")</script>
</head>
<body>
<header class="top"><a class="mark" href="/"><img src="/favicon-96.png" alt="VITOWEB" width="28" height="28">VITOWEB</a><a class="lang" href="{other_url}" hreflang="{u["other_lang"]}" lang="{u["other_lang"]}" onclick="window.VWL&&VWL.set('{u["other_lang"]}')">{u["other"]}</a><a class="play" href="/">{u["all"]}</a></header>
<main>
<div class="hero">
<p class="eyebrow">{html.escape(eyebrow)}</p>
<h1>{html.escape(h1)}</h1>
<p class="lead">{lead}</p>
{facts_html}
{cta}
</div>
<div class="adslot" data-ad="rules"></div>
<article>
{body}
</article>
{('<div class="end">' + cta + '</div>') if cta else ''}
</main>
<footer class="foot">
<nav class="others" aria-label="{u["rules_aria"]}"><span>{u["rules"]}</span>{others}</nav>
<nav class="legal"><a href="/">VITOWEB</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:info@vitoweb.al">Contact</a></nav>
</footer>
<script src="/ads.js"></script>
</body>
</html>
"""


def ul(*items):
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def table(head, rows):
    th = "".join(f"<th>{h}</th>" for h in head)
    tr = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tbl"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'


def cards(*labels):
    out = []
    for l in labels:
        if l in ("+", "="):
            out.append(f'<span class="op">{l}</span>'); continue
        red = any(s in l for s in "♥♦")
        cls = "c red" if red else "c"
        if l.startswith("JK"):
            cls = "c jk" + (" red" if l == "JKr" else "")
            l = "★"
        out.append(f'<span class="{cls}">{l}</span>')
    return '<div class="cards" aria-hidden="true">' + "".join(out) + "</div>"


def tiles(*pairs):
    def half(n):
        return f'<i data-n="{n}"></i>'
    return '<div class="tiles" aria-hidden="true">' + "".join(
        f'<span class="t">{half(a)}{half(b)}</span>' for a, b in pairs) + "</div>"


pages = {}

pages["murlan"] = dict(
    title="Rregullat e Murlanit · Si luhet Murlani · VITOWEB",
    desc="Rregullat e plota të Murlanit: renditja e letrave, kolori, bomba, flush-i, shkëmbimi i letrave dhe pikët deri në 21. Luaj Murlan online falas në VITOWEB.",
    eyebrow="Rregullat", h1="Si luhet Murlani",
    lead="Murlani luhet me katër veta dhe me një kuvertë me 54 letra, bashkë me dy xhokerët. Fiton kush heq qafe letrat i pari. Zakonisht luhet dy kundër dy, me partnerin përballë.",
    facts="4 lojtarë · 54 letra · deri në 21 pikë",
    cta=("/murlan", "Luaj Murlan"),
    body=f"""
<h2>Letrat dhe lojtarët</h2>
{ul("Kuverta ka 54 letra: 52 letrat e zakonshme dhe dy xhokerë.",
    "Ndahen të gjitha letrat: dy lojtarë marrin nga 14, dy të tjerët nga 13.",
    "Në lojën <b>2 kundër 2</b> partneri ulet përballë teje. Mund të luhet edhe <b>secili për vete</b>.")}

<h2>Renditja e letrave</h2>
<p>Nga më e ulëta te më e larta. 2-shi është letra më e fortë pas xhokerëve.</p>
{cards("3","4","5","6","7","8","9","10","J","Q","K","A","2","JKb","JKr")}
<p class="note">Në fund: xhokeri i zi, pastaj xhokeri me ngjyra.</p>

<h2>Si luhet një raund</h2>
{ul("Kush hap, hedh një kombinim: një letër, çift, treshe, kolor, bombë ose flush.",
    "Me radhë, të tjerët ose hedhin të njëjtin lloj kombinimi, më të lartë, ose pasojnë.",
    "Kush pason mund të luajë sërish në të njëjtin raund.",
    "Kur pasojnë të gjithë të tjerët, raundi mbyllet dhe hap sërish ai që luajti i fundit.",
    "Kush mbaron letrat del nga dora. Dora vazhdon derisa të mbetet me letra vetëm një lojtar.")}

<h2>Kombinimet</h2>
{table(["Kombinimi", "Çfarë është", "E mund vetëm"], [
    ["Letër, çift, treshe", "1, 2 ose 3 letra me të njëjtin numër", "I njëjti lloj, më i lartë"],
    ["Kolor", "5 ose më shumë letra radhazi", "Kolori një shkallë më lart me po aq letra, bomba ose flush-i"],
    ["Bombë", "4 letra të njëjta", "Bomba më e lartë ose flush-i"],
    ["Flush", "Kolor me letra të së njëjtës shenjë", "Flush-i më i lartë"],
])}
{ul("3-4-5-6-7 e mund vetëm 4-5-6-7-8. Jo 5-6-7-8-9, as një kolor me 6 letra.",
    "Kolori 7-8-9-10-J-Q e mund vetëm 8-9-10-J-Q-K, një bombë ose një flush.",
    "Asi mund të jetë lart (10-J-Q-K-A) ose poshtë (A-2-3-4-5). Në kolor 2-shi vlen si 2. Xhokerët nuk hyjnë në kolor.",
    "Bomba mund çdo gjë përveç një bombe më të lartë dhe flush-it.",
    "Flush-i mund edhe bombën. Flush-at krahasohen nga letra e fundit. Royal flush-i (10 deri A me një shenjë) është flush-i më i lartë me 5 letra.")}

<h2>Dora e parë dhe shkëmbimi i letrave</h2>
{ul("Dora e parë e hap kush ka 3♠, dhe hedhja e parë duhet ta ketë atë.",
    "Nga dora e dytë, kush doli i fundit i jep atij që doli i pari letrën e tij më të lartë. I pari i kthen një letër nga 3 deri te 10, cilën të dojë.",
    "Pas shkëmbimit hap kush doli i fundit.",
    "Nëse i fundit ka të dy xhokerët, shkëmbimi nuk bëhet dhe hap i pari.",
    "Në VITOWEB shkëmbimin e shohin të gjithë në tavolinë: letra kalon hapur nga njëri te tjetri.")}

<h2>Pikët</h2>
{table(["Kush del", "Pikë"], [["I pari", "3"], ["I dyti", "2"], ["I treti", "1"], ["I fundit", "0"]])}
{ul("Në 2 kundër 2 ekipi merr pikët e të dy lojtarëve.",
    "Fiton kush arrin i pari 21 pikë. Nëse dy palë e kalojnë 21 në të njëjtën dorë, caku bëhet 31, pastaj 41 dhe 51.")}

<h2>Murlan online në VITOWEB</h2>
{ul("Shtyp <b>LUAJ</b> dhe brenda pak sekondash ulesh në tavolinë me lojtarë të tjerë.",
    "Me shokët: krijo një dhomë dhe dërgoju kodin ose linkun në WhatsApp.",
    "Çdo lëvizje ka 15 sekonda. Letrat në dorë i rregullon si të duash, duke i tërhequr.",
    "Falas dhe pa shkarkim, në telefon ose kompjuter.")}
""")

pages["spathi"] = dict(
    title="Rregullat e Spathit · Si luhet Spathi · VITOWEB",
    desc="Si luhet Spathi: marrja me shuma, pikët për letrat, spathitë, 2♣ dhe 10♦, deri në 21 pikë. Luaj Spathi online falas në VITOWEB.",
    eyebrow="Rregullat", h1="Si luhet Spathi",
    lead="Spathi është lojë me letra për dy veta. Hedh nga një letër dhe merr letrat e tavolinës që kanë të njëjtën vlerë ose që mbledhin vlerën e saj. Pikët vijnë nga numri i letrave, spathitë, 2♣ dhe 10♦.",
    facts="2 lojtarë · 52 letra · deri në 21 pikë",
    cta=("/spathi", "Luaj Spathi"),
    body=f"""
<h2>Letrat dhe ndarja</h2>
{ul("Luhet me 52 letra, pa xhokerë, nga dy lojtarë.",
    "Secili merr 4 letra dhe 4 letra hapen në tavolinë.",
    "Kur mbarojnë letrat në dorë, ndahen edhe nga 4, derisa të mbarojë talloni.")}

<h2>Vlerat</h2>
{ul("Asi vlen 1. Nga 2 deri te 10, letra vlen sa numri i saj.",
    "J, Q dhe K nuk mblidhen: secila merr vetëm të njëjtën figurë.")}

<h2>Marrja</h2>
{ul("Në radhën tënde hedh një letër. Ajo merr letrat e tavolinës me të njëjtën vlerë, ose grupe letrash që mbledhin vlerën e saj, deri në 10.",
    "Mund të marrësh disa grupe njëherësh: me 10 merr 4+6 dhe 3+7.",
    "Nëse letra merr, merr patjetër. Nëse ka disa mënyra, zgjedh ti.",
    "Nëse nuk merr asgjë, letra mbetet në tavolinë.",
    "Në fund të dorës, letrat që mbeten në tavolinë i merr kush mori i fundit.")}
{cards("4","+","6","=","10♦")}

<h2>Pikët për çdo dorë</h2>
<p>Në çdo dorë ndahen 5 pikë.</p>
{table(["Për çfarë", "Pikë"], [
    ["Më shumë letra (27 e lart). Me 26 secili, 1 pikë secilit.", "2"],
    ["7 ose më shumë spathi", "1"],
    ["2♣", "1"],
    ["10♦", "1"],
])}

<h2>Fitorja</h2>
{ul("Fiton kush arrin i pari 21 pikë, ose 11 në lojën e shkurtër.",
    "Nëse të dy e kalojnë cakun në të njëjtën dorë, fiton kush ka më shumë pikë. Në barazim luhet edhe një dorë.")}

<h2>Spathi online në VITOWEB</h2>
{ul("1 kundër 1 me një lojtar online: shtyp <b>LUAJ</b>.",
    "Me një shok: krijo dhomë dhe dërgoji kodin ose linkun.",
    "Çdo lëvizje ka 15 sekonda. Zgjedh lojën deri në 21 ose deri në 11.")}
""")

pages["derri"] = dict(
    title="Rregullat e Derrit në dorë · Si luhet · VITOWEB",
    desc="Si luhet Derri në dorë: hidh çiftet, merr letra nga lojtari në të majtë dhe mos mbet me derrin, K♠. Luaj online falas në VITOWEB.",
    eyebrow="Rregullat", h1="Si luhet Derri në dorë",
    lead="Derri në dorë luhet me katër veta. Bën çifte dhe i hedh, derisa të mbarosh letrat. Kush mbetet i fundit me K♠, derrin, në dorë, humbet.",
    facts="4 lojtarë · 49 letra",
    cta=("/derri", "Luaj Derri në dorë"),
    body=f"""
<h2>Letrat</h2>
{ul("Hiqen tre mbretërit e tjerë dhe mbeten 49 letra. K♠, derri, nuk bën çift me asnjë letër.",
    "Një lojtar merr 13 letra, të tjerët nga 12.",
    "Secili hedh menjëherë çiftet që ka: dy letra me të njëjtin numër ose figurë.")}
{cards("7♥","7♣","Q♦","Q♠","K♠")}
<p class="note">Dy çifte hidhen. K♠ mbetet gjithmonë në dorë.</p>

<h2>Si luhet</h2>
{ul("Në radhën tënde merr një letër pa e parë nga lojtari në të majtë. Lojtari në të djathtë merr nga ti.",
    "Nëse letra që more bën çift me një letër tënden, të dyja hidhen. Përndryshe mbetet në dorë.",
    "Kush mbaron letrat del dhe shpëton. Pas tij, merret nga i radhës që ka ende letra.",
    "Në fund mbetet vetëm një lojtar, me derrin në dorë. Ai humbet dorën.")}

<h2>Derri në dorë online në VITOWEB</h2>
{ul("Shtyp <b>LUAJ</b> për një tavolinë me lojtarë online, ose krijo dhomë për shokët.",
    "Prek një nga letrat në mes për ta marrë. Ke 20 sekonda.",
    "<b>PRIT</b> të jep edhe 3 sekonda për t'i rregulluar letrat para se tjetri të zgjedhë nga ti, një herë në radhë. Ndërsa ai zgjedh, dora jote nuk lëviz.")}
""")

pages["domino"] = dict(
    title="Rregullat e Dominos · Si luhet Domino · VITOWEB",
    desc="Si luhet Domino 2 kundër 2 ose 1 kundër 1: 28 gurë, hapja me dyshen, pikët dhe 0|0. Luaj Domino online falas në VITOWEB.",
    eyebrow="Rregullat", h1="Si luhet Domino",
    lead="Domino luhet me 28 gurë, nga 0|0 deri te 6|6. Gurët vendosen në dy skajet e vargut dhe numrat duhet të përputhen. Kush mbaron gurët i pari, merr pikët që u mbetën kundërshtarëve.",
    facts="2 ose 4 lojtarë · 28 gurë · deri në 100 pikë",
    cta=("/domino", "Luaj Domino"),
    body=f"""
<h2>Gurët dhe lojtarët</h2>
{ul("28 gurë, nga 0|0 deri te 6|6. Secili lojtar merr 7.",
    "<b>2 kundër 2</b>: ti dhe partneri përballë, kundër dy lojtarëve anash. Ndahen të 28 gurët.",
    "<b>1 kundër 1</b>: 14 gurët e tepërt ose tërhiqen kur s'ke gur që hyn, ose mbeten jashtë loje. Zgjidhet para lojës.")}
{tiles((6,6),(6,3),(3,1),(1,0))}

<h2>Si luhet</h2>
{ul("Dorën e parë e hap kush ka dyshen më të lartë (te 2 kundër 2, 6|6), dhe hap me të.",
    "Nga dora e dytë hap kush doli i pari në dorën e kaluar.",
    "Guri vendoset në njërin nga dy skajet e vargut. Numri duhet të përputhet me skajin.",
    "Kush s'ka gur që hyn, pason. Te 1 kundër 1 me tërheqje, tërheq derisa të gjejë një gur që hyn.")}

<h2>Pikët</h2>
{ul("Kur dikush mbaron gurët, ana e tij merr pikët e gurëve që u mbetën në dorë kundërshtarëve. Guri vlen sa shuma e dy anëve: 6|6 vlen 12.",
    "0|0 vlen 10 pikë kur i mbetet dikujt i vetëm në dorë. Bashkë me gurë të tjerë vlen 0.",
    "Nëse loja bllokohet dhe askush s'ka lëvizje, fiton ana me më pak pikë në dorë dhe merr pikët e kundërshtarëve. Në barazim askush s'merr pikë.",
    "Fiton ana që arrin e para 100 pikë. Në VITOWEB mund të zgjedhësh edhe 50, 150 ose një cak tjetër.")}

<h2>Domino online në VITOWEB</h2>
{ul("Shtyp <b>LUAJ</b> për një tavolinë 2 kundër 2 ose 1 kundër 1, ose krijo dhomë për shokët.",
    "Çdo lëvizje ka 15 sekonda. Gurët në dorë i rregullon duke i tërhequr.")}
""")

pages["imposter"] = dict(
    title="Si luhet Imposter · Lojë për grupin · VITOWEB",
    desc="Imposter: të gjithë marrin të njëjtën fjalë, përveç një lojtari. Gjeni imposterin para se ai të gjejë fjalën. Nga 3 deri në 12 veta, me një telefon ose secili me të vetin.",
    eyebrow="Si luhet", h1="Si luhet Imposter",
    lead="Imposter është lojë për grupin, nga 3 deri në 12 veta. Të gjithë marrin të njëjtën fjalë të fshehtë, përveç imposterit. Ai duhet të bëjë sikur e di, dhe të tjerët duhet ta gjejnë.",
    facts="3–12 veta · një telefon ose secili me të vetin",
    cta=("/imposter", "Luaj Imposter"),
    body=f"""
<h2>Përgatitja</h2>
{ul("<b>Një telefon</b>: telefoni kalon dorë më dorë dhe secili sheh kartën e vet.",
    "<b>Secili me telefonin e vet</b>: njëri krijon dhomën dhe ndan kodin ose linkun. Çdo telefon sheh vetëm kartën e vet, dhe hosti drejton raundin.",
    "Zgjidhni sa kohë zgjat biseda, ose luani pa kohë.")}

<h2>Si luhet</h2>
{ul("Të gjithë marrin të njëjtën fjalë, përveç imposterit.",
    "Me radhë, secili thotë një fjalë që lidhet me fjalën e fshehtë. As shumë qartë, që imposteri të mos e marrë vesh, as shumë larg, që të mos dyshojnë te ti.",
    "Kur mendoni se e dini kush është, votoni me zë. Nëse votoni gabim, loja vazhdon me të njëjtin imposter.",
    "Kur mbaron koha, telefoni bie. Merrni edhe një minutë, ose hosti zbulon imposterin.",
    "Me më shumë lojtarë mund të keni dy imposterë. Me opsionin <b>1 ose 2</b>, askush nuk e di nëse janë një apo dy.")}
""")

pages["mafia"] = dict(
    title="Si luhet Mafia · Rolet në telefon · VITOWEB",
    desc="Si luhet Mafia me shokët: mafiozët, doktori, polici dhe fshatarët, nata, dita dhe votimi. Rolet ndahen në telefon, loja luhet në tavolinë.",
    eyebrow="Si luhet", h1="Si luhet Mafia",
    lead="Mafia luhet me grupin, rreth një tavoline. Çdo lojtar merr një rol të fshehtë në telefonin e vet, dhe njëri nga ju, narratori, drejton lojën. Fshati duhet ta gjejë mafian para se mafia të bëhet sa fshati.",
    facts="lojë për grupin · secili me telefonin e vet",
    cta=("/mafia", "Luaj Mafia"),
    body=f"""
<h2>Rolet</h2>
{table(["Roli", "Ana", "Çfarë bën"], [
    ["Mafioz", "Mafia", "Natën hap sytë bashkë me mafiozët e tjerë dhe zgjedhin kë të vrasin. Ditën nuk duhet të zbulohet."],
    ["Doktor", "Fshati", "Çdo natë zgjedh kë do të shpëtojë. Mund të shpëtojë edhe veten."],
    ["Polic", "Fshati", "Çdo natë zgjedh për kë dyshon. Narratori i tregon nëse është mafia. Nuk e thotë që është polic."],
    ["Fshatar", "Fshati", "Nuk ka fuqi nate. E gjen mafian me votë gjatë ditës."],
    ["Narrator", "Asnjëra", "Nuk merr rol. I sheh rolet e të gjithëve dhe drejton natën dhe ditën."],
])}

<h2>Përgatitja</h2>
{ul("Njëri krijon dhomën dhe ndan kodin ose linkun. Të tjerët hyjnë me telefonin e vet.",
    "Hosti zgjedh sa mafiozë, doktorë dhe policë do të ketë. Të tjerët janë fshatarë. Mafiozët duhet të jenë më pak se gjysma.",
    "Hosti shpërndan rolet. Secili e sheh rolin duke mbajtur shtypur ekranin; kur e lëshon, roli fshihet.")}

<h2>Nata</h2>
{ul("Narratori thotë: «Fshati fle.» Të gjithë mbyllin sytë.",
    "Mafia hap sytë dhe, pa folur, zgjedh kë do të vrasë.",
    "Doktori hap sytë dhe zgjedh kë do të shpëtojë.",
    "Polici hap sytë dhe tregon për kë dyshon. Narratori i bën me shenjë po ose jo.")}

<h2>Dita</h2>
{ul("Narratori tregon kush u vra natën, ose që doktori e shpëtoi.",
    "Kush u vra del nga loja dhe nuk flet më.",
    "Fshati diskuton dhe voton kë të nxjerrë. Kush merr më shumë vota del nga loja.")}

<h2>Fitorja</h2>
{ul("Fshati fiton kur dalin të gjithë mafiozët.",
    "Mafia fiton kur mafiozët bëhen sa të tjerët.",
    "Në fund, narratori mund t'i zbulojë të gjitha rolet në telefon.")}
""")


# ---------------------------------------------------------------- English
pages_en = {}

pages_en["murlan"] = dict(
    title="Murlan rules · How to play Murlan · VITOWEB",
    desc="Full Murlan rules: card order, straights, bombs, flushes, the card exchange and scoring to 21. Play Murlan online for free on VITOWEB.",
    eyebrow="Rules", h1="How to play Murlan",
    lead="Murlan is the Albanian card game for four players, played with a 54-card deck including two jokers. The first to get rid of all their cards wins. It is usually played two against two, with your partner sitting opposite you.",
    facts="4 players · 54 cards · to 21 points",
    cta=("/murlan", "Play Murlan"),
    body=f"""
<h2>Cards and players</h2>
{ul("The deck has 54 cards: the usual 52 plus two jokers.",
    "All cards are dealt: two players get 14, the other two get 13.",
    "In <b>2 vs 2</b> your partner sits opposite you. You can also play <b>every player for themselves</b>.")}

<h2>Card order</h2>
<p>From lowest to highest. The 2 is the strongest card after the jokers.</p>
{cards("3","4","5","6","7","8","9","10","J","Q","K","A","2","JKb","JKr")}
<p class="note">At the top: the black joker, then the colored joker.</p>

<h2>How a round goes</h2>
{ul("Whoever leads plays a combination: a single card, a pair, three of a kind, a straight, a bomb or a flush.",
    "In turn, the others either play the same kind of combination, higher, or pass.",
    "A player who passed may still play later in the same round.",
    "When everyone else has passed, the round ends and the last player to play leads again.",
    "Whoever runs out of cards is out of the hand. The hand goes on until only one player still has cards.")}

<h2>Combinations</h2>
{table(["Combination", "What it is", "Beaten only by"], [
    ["Single, pair, three of a kind", "1, 2 or 3 cards of the same rank", "The same kind, higher"],
    ["Straight", "5 or more cards in a row", "The straight one step higher with the same number of cards, a bomb or a flush"],
    ["Bomb", "4 cards of the same rank", "A higher bomb or a flush"],
    ["Flush", "A straight in one suit", "A higher flush"],
])}
{ul("3-4-5-6-7 is beaten only by 4-5-6-7-8. Not by 5-6-7-8-9, and not by a 6-card straight.",
    "The straight 7-8-9-10-J-Q is beaten only by 8-9-10-J-Q-K, a bomb or a flush.",
    "The ace can be high (10-J-Q-K-A) or low (A-2-3-4-5). In a straight the 2 counts as 2. Jokers can't be part of a straight.",
    "A bomb beats everything except a higher bomb and a flush.",
    "A flush beats bombs too. Flushes are compared by their top card. The royal flush (10 to A in one suit) is the highest 5-card flush.")}

<h2>The first hand and the card exchange</h2>
{ul("The first hand is led by whoever holds the 3♠, and the first play must include it.",
    "From the second hand on, the player who finished last gives their highest card to the player who finished first. The winner gives back any one card from 3 to 10.",
    "After the exchange, the player who finished last leads.",
    "If the last player holds both jokers, there is no exchange and the winner leads.",
    "On VITOWEB everyone at the table sees the exchange: the card travels face up from one player to the other.")}

<h2>Scoring</h2>
{table(["Finishes", "Points"], [["First", "3"], ["Second", "2"], ["Third", "1"], ["Last", "0"]])}
{ul("In 2 vs 2 the team scores the points of both players.",
    "The first to reach 21 points wins. If two sides pass 21 in the same hand, the target becomes 31, then 41 and 51.")}

<h2>Murlan online on VITOWEB</h2>
{ul("Press <b>LUAJ</b> (Play) and within seconds you sit down at a table with other players.",
    "With friends: create a room and send them the code or the link on WhatsApp.",
    "Each move has 15 seconds. Arrange the cards in your hand however you like by dragging them.",
    "Free and nothing to download, on a phone or a computer.")}
""")

pages_en["spathi"] = dict(
    title="Spathi rules · How to play Spathi · VITOWEB",
    desc="How to play Spathi: capturing by sums, points for cards, clubs, the 2♣ and the 10♦, played to 21. Play Spathi online for free on VITOWEB.",
    eyebrow="Rules", h1="How to play Spathi",
    lead="Spathi is an Albanian card game for two. You play one card at a time and capture the cards on the table that have the same value or add up to it. Points come from the number of cards, clubs, the 2♣ and the 10♦.",
    facts="2 players · 52 cards · to 21 points",
    cta=("/spathi", "Play Spathi"),
    body=f"""
<h2>Cards and the deal</h2>
{ul("Played with 52 cards, no jokers, by two players.",
    "Each player gets 4 cards and 4 cards are laid face up on the table.",
    "When both hands are empty, 4 more are dealt to each, until the deck runs out.")}

<h2>Values</h2>
{ul("The ace is worth 1. From 2 to 10, a card is worth its number.",
    "J, Q and K don't add up: each one captures only the same face card.")}

<h2>Capturing</h2>
{ul("On your turn you play one card. It captures the table cards of the same value, or groups of cards that add up to its value, up to 10.",
    "You can capture several groups at once: a 10 takes 4+6 and 3+7.",
    "If your card can capture, it must. If there are several ways, you choose.",
    "If it captures nothing, the card stays on the table.",
    "At the end of the hand, the cards left on the table go to whoever captured last.")}
{cards("4","+","6","=","10♦")}

<h2>Points each hand</h2>
<p>Each hand gives out 5 points.</p>
{table(["For", "Points"], [
    ["Most cards (27 or more). At 26 each, 1 point to each player.", "2"],
    ["7 or more clubs", "1"],
    ["2♣", "1"],
    ["10♦", "1"],
])}

<h2>Winning</h2>
{ul("The first to reach 21 points wins, or 11 in the short game.",
    "If both pass the target in the same hand, the higher score wins. On a tie, one more hand is played.")}

<h2>Spathi online on VITOWEB</h2>
{ul("1 vs 1 with a player online: press <b>LUAJ</b> (Play).",
    "With a friend: create a room and send them the code or the link.",
    "Each move has 15 seconds. Choose a game to 21 or to 11.")}
""")

pages_en["derri"] = dict(
    title="Derri në dorë rules · How to play · VITOWEB",
    desc="How to play Derri në dorë (Pig in Hand): throw your pairs, take cards from the player on your left and don't get stuck with the pig, the K♠. Play online for free on VITOWEB.",
    eyebrow="Rules", h1="How to play Derri në dorë",
    lead="Derri në dorë (“pig in hand”) is played by four. You make pairs and throw them away until you run out of cards. Whoever is left holding the K♠, the pig, loses.",
    facts="4 players · 49 cards",
    cta=("/derri", "Play Derri në dorë"),
    body=f"""
<h2>The cards</h2>
{ul("The other three kings are removed, leaving 49 cards. The K♠, the pig, pairs with nothing.",
    "One player gets 13 cards, the others 12.",
    "Everyone immediately throws away the pairs they hold: two cards of the same number or face.")}
{cards("7♥","7♣","Q♦","Q♠","K♠")}
<p class="note">Two pairs are thrown. The K♠ always stays in the hand.</p>

<h2>How to play</h2>
{ul("On your turn, take one card without looking from the player on your left. The player on your right takes from you.",
    "If the card you took pairs with one of yours, both are thrown. Otherwise it stays in your hand.",
    "Whoever runs out of cards is out and safe. After that, cards are taken from the next player who still has some.",
    "In the end only one player is left, holding the pig. They lose the hand.")}

<h2>Derri në dorë online on VITOWEB</h2>
{ul("Press <b>LUAJ</b> (Play) for a table with players online, or create a room for your friends.",
    "Tap a card to lift it, tap it again to take it. You have 20 seconds.",
    "<b>PRIT</b> (Wait) gives you 3 more seconds to rearrange your cards before the other player picks from you, once per turn. While they pick, your hand stays still.")}
""")

pages_en["domino"] = dict(
    title="Domino rules · How to play Domino · VITOWEB",
    desc="How to play Domino 2 vs 2 or 1 vs 1: 28 tiles, opening with the double, scoring and the 0|0. Play Domino online for free on VITOWEB.",
    eyebrow="Rules", h1="How to play Domino",
    lead="Domino is played with 28 tiles, from 0|0 to 6|6. Tiles are placed at either end of the line and the numbers must match. Whoever runs out of tiles first scores the points left in the opponents' hands.",
    facts="2 or 4 players · 28 tiles · to 100 points",
    cta=("/domino", "Play Domino"),
    body=f"""
<h2>Tiles and players</h2>
{ul("28 tiles, from 0|0 to 6|6. Each player gets 7.",
    "<b>2 vs 2</b>: you and your partner opposite, against the two players at the sides. All 28 tiles are dealt.",
    "<b>1 vs 1</b>: the 14 spare tiles are either drawn when you have no tile that fits, or stay out of play. You choose before the game.")}
{tiles((6,6),(6,3),(3,1),(1,0))}

<h2>How to play</h2>
{ul("The first hand is opened by whoever holds the highest double (in 2 vs 2, the 6|6), and they open with it.",
    "From the second hand on, the player who went out first in the last hand opens.",
    "A tile goes at either end of the line. Its number must match that end.",
    "If you have no tile that fits, you pass. In 1 vs 1 with drawing, you draw until you find a tile that fits.")}

<h2>Scoring</h2>
{ul("When someone runs out of tiles, their side scores the points of the tiles left in the opponents' hands. A tile is worth the sum of its two halves: 6|6 is worth 12.",
    "The 0|0 is worth 10 points when it is the only tile left in a hand. Together with other tiles it is worth 0.",
    "If the game is blocked and nobody can move, the side with fewer points in hand wins and scores the opponents' points. On a tie, nobody scores.",
    "The first side to reach 100 points wins. On VITOWEB you can also choose 50, 150 or another target.")}

<h2>Domino online on VITOWEB</h2>
{ul("Press <b>LUAJ</b> (Play) for a 2 vs 2 or 1 vs 1 table, or create a room for your friends.",
    "Each move has 15 seconds. Arrange the tiles in your hand by dragging them.")}
""")

pages_en["imposter"] = dict(
    title="How to play Imposter · Party game · VITOWEB",
    desc="Imposter: everyone gets the same word except one player. Find the imposter before they figure out the word. 3 to 12 people, with one phone or each with their own.",
    eyebrow="How to play", h1="How to play Imposter",
    lead="Imposter is a party game for 3 to 12 people. Everyone gets the same secret word, except the imposter. They have to act as if they know it, and the others have to find them.",
    facts="3–12 people · one phone or each with their own",
    cta=("/imposter", "Play Imposter"),
    body=f"""
<h2>Setting up</h2>
{ul("<b>One phone</b>: the phone goes from hand to hand and each person sees their own card.",
    "<b>Each with their own phone</b>: one person creates the room and shares the code or the link. Every phone shows only its own card, and the host runs the round.",
    "Choose how long the talking lasts, or play without a timer.")}

<h2>How to play</h2>
{ul("Everyone gets the same word, except the imposter.",
    "In turn, each player says one word connected to the secret word. Not too obvious, so the imposter can't work it out, and not too far off, so nobody suspects you.",
    "When you think you know who it is, vote out loud. If you vote wrong, the game goes on with the same imposter.",
    "When time is up, the phone rings. Take one more minute, or the host reveals the imposter.",
    "With more players you can have two imposters. With the <b>1 or 2</b> option, nobody knows whether there are one or two.")}
""")

pages_en["mafia"] = dict(
    title="How to play Mafia · Roles on your phone · VITOWEB",
    desc="How to play Mafia with friends: the mafia, the doctor, the police officer and the villagers, night, day and the vote. Roles are handed out on your phones, the game is played around the table.",
    eyebrow="How to play", h1="How to play Mafia",
    lead="Mafia is played as a group, around a table. Each player gets a secret role on their own phone, and one of you, the narrator, runs the game. The village has to find the mafia before the mafia matches the village in number.",
    facts="party game · each with their own phone",
    cta=("/mafia", "Play Mafia"),
    body=f"""
<h2>The roles</h2>
{table(["Role", "Side", "What they do"], [
    ["Mafia", "Mafia", "At night they open their eyes together with the other mafia members and choose whom to kill. By day they must not be found out."],
    ["Doctor", "Village", "Every night chooses someone to save. They can save themselves too."],
    ["Police officer", "Village", "Every night picks someone they suspect. The narrator tells them whether that person is mafia. They don't say they are the police officer."],
    ["Villager", "Village", "No night power. Finds the mafia by voting during the day."],
    ["Narrator", "Neither", "Gets no role. Sees everyone's role and runs the night and the day."],
])}

<h2>Setting up</h2>
{ul("One person creates the room and shares the code or the link. The others join on their own phones.",
    "The host chooses how many mafia, doctors and police officers there will be. Everyone else is a villager. The mafia must be fewer than half.",
    "The host hands out the roles. Each player sees their role by holding the screen down; when they let go, the role is hidden.")}

<h2>The night</h2>
{ul("The narrator says: “The village sleeps.” Everyone closes their eyes.",
    "The mafia open their eyes and, without talking, choose whom to kill.",
    "The doctor opens their eyes and chooses whom to save.",
    "The police officer opens their eyes and points at someone they suspect. The narrator signals yes or no.")}

<h2>The day</h2>
{ul("The narrator says who was killed in the night, or that the doctor saved them.",
    "Whoever was killed is out of the game and doesn't speak any more.",
    "The village discusses and votes on whom to throw out. Whoever gets the most votes is out.")}

<h2>Winning</h2>
{ul("The village wins when all the mafia are out.",
    "The mafia win when they are as many as everyone else.",
    "At the end, the narrator can reveal all the roles on the phones.")}
""")


def write(lang, pages_, games, dirname):
    out = os.path.join(ROOT, dirname)
    os.makedirs(out, exist_ok=True)
    for slug, p in pages_.items():
        with open(os.path.join(out, f"{slug}.html"), "w", encoding="utf-8") as f:
            f.write(page(slug, p["title"], p["desc"], p["eyebrow"], p["h1"], p["lead"], p["facts"],
                         p["cta"][0], p["cta"][1], p["body"], f"/{dirname}/{slug}", lang))
    items = "".join(f'<a class="game" href="/{dirname}/{g}"><b>{html.escape(n)}</b><small>{html.escape(fx)}</small></a>' for g, n, fx in games)
    if lang == "sq":
        body = f"""
<div class="games">{items}</div>
<h2>Pa shkarkim</h2>
<p>Të gjitha lojërat luhen në shfletues, në telefon ose në kompjuter. Lojërat me letra dhe Domino luhen online me lojtarë të tjerë ose me shokët me kod dhome. Imposter dhe Mafia luhen bashkë në një vend, me telefonin në dorë.</p>
"""
        args = ("Rregullat e lojërave · Murlan, Spathi, Domino · VITOWEB",
                "Rregullat e Murlanit, Spathit, Derrit në dorë, Dominos, Imposter dhe Mafias, të shpjeguara qartë. Luaji falas në VITOWEB.",
                "VITOWEB", "Rregullat e lojërave",
                "Si luhen Murlani, Spathi, Derri në dorë, Domino, Imposter dhe Mafia. Rregullat janë po ato që zbatohen në tavolinat e VITOWEB.",
                "", "/", "Luaj tani")
    else:
        body = f"""
<div class="games">{items}</div>
<h2>Nothing to download</h2>
<p>Every game runs in the browser, on a phone or a computer. The card games and Domino are played online with other players, or with friends using a room code. Imposter and Mafia are played together in one place, phone in hand.</p>
"""
        args = ("Game rules · Murlan, Spathi, Domino · VITOWEB",
                "The rules of Murlan, Spathi, Derri në dorë, Domino, Imposter and Mafia, explained clearly. Play them for free on VITOWEB.",
                "VITOWEB", "Game rules",
                "How to play Murlan, Spathi, Derri në dorë, Domino, Imposter and Mafia. These are the same rules the VITOWEB tables use.",
                "", "/", "Play now")
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(page("", *args, body, f"/{dirname}/", lang))
    print(lang, "ok", sorted(os.listdir(out)))


write("sq", pages, GAMES, "rregullat")
write("en", pages_en, GAMES_EN, "rules")
