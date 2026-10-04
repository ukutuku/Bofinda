#!/usr/bin/env python3
"""Koer Laros-indsamlingsscriptet mod isolerede testdobler.

    python3 koer-proever.py <script> <ny-tom-outputrod>

Ingen netvaerk: proevedobler.mjs erstatter globalThis.fetch.
Ingen rigtig ventetid: setTimeout logges og fremskyndes.
Ingen database, ingen produktionsnoegler. Alle credentials er opdigtede.

── OUTPUTROD PR. UDFOERELSE, OG DEN GENBRUGES IKKE ──────────────

Foerste udgave lavede `resultater/<sag>` med `exist_ok=True` og
optalte ALLE `*.body` i mappen. En body fra en TIDLIGERE udfoerelse
blev derfor talt med i et nyt resultat. Maalt i afleveringen:
`retry-after-redirect` og `retry-after-dato` bar en `svar-2.body`,
som deres egen rapport ikke henviste til, og hvis kaldspor kun havde
ét fetch-kald — filen var fra en koersel FOER et udskudt hop stoppede
indsamlingen.

To ting staar nu i vejen for den sammenblanding:

· Outputroden skal vaere NY og tom. Findes den med indhold, stopper
  koerslen med exit 2. Intet slettes — gamle maalinger er belaeg.
  Exitkoderne er adskilte: 2 = naegtede at genbruge roden, 1 = en sag
  var usammenhaengende.
· Hver sag faar en SAMMENHAENGSKONTROL: rapportens `kropFil`, de
  filer der faktisk ligger paa disken, og antallet af fuldfoerte svar
  i NETOP den koersel skal stemme. Gor de ikke det, navngives de
  overskydende filer som `foraeldreloese_body_filer`, og sagen
  markeres `sammenhaeng: "AFVIGER"`. En gammel body kan dermed ikke
  passere som en ny hentning — heller ikke hvis nogen omgaar det
  foerste vaern.
"""
import json, os, pathlib, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
if len(sys.argv) < 3:
    sys.exit('brug: koer-proever.py <script> <ny-tom-outputrod>')
script = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]).resolve()
if out.exists() and any(out.iterdir()):
    # Exit 2 og ikke 1: en kalder skal kunne skelne «jeg naegtede at
    # genbruge roden» fra «en sag var usammenhaengende» (exit 1).
    print(f'STOP: outputroden findes og er ikke tom: {out}\n'
          '      Vaelg en NY mappe. Gamle maalinger slettes ikke herfra.', file=sys.stderr)
    sys.exit(2)
out.mkdir(parents=True, exist_ok=True)

SAGER = [
    ('normal',               {}),
    ('redirect',             {}),
    ('gateway-no-proxy',     {}),
    ('gateway-med-proxy',    {'HTTPS_PROXY': 'http://proxy.invalid:3128'}),
    ('proxy-credentials',    {'HTTPS_PROXY': 'http://PROBE_USER:PROBE_PASSWORD@proxy.invalid:3128'}),
    ('proxy-credentials-lowercase', {'https_proxy': 'http://PROBE_USER2:PROBE_PASSWORD2@proxy.invalid:3128'}),
    ('fetch-fails',          {}),
    ('body-fails-first',     {}),
    ('body-fails-second',    {}),
    ('retry-after-redirect', {}),
    ('retry-after-dato',     {}),
    ('retry-after-kort',     {}),
    ('retry-after-503',      {}),
    ('afslag-403',           {}),
    ('afslag-429',           {}),
]
HEMMELIGE = ['PROBE_PASSWORD', 'PROBE_PASSWORD2', 'PROBE_USER', 'PROBE_USER2', 'proxy.invalid']

res, log = [], []
for navn, ekstra in SAGER:
    # «gateway-med-proxy» og «proxy-credentials*» deler PROBE_CASE med en
    # eksisterende doubel; miljoeet er forskellen.
    sag = {'gateway-med-proxy': 'gateway-no-proxy',
           'proxy-credentials': 'normal',
           'proxy-credentials-lowercase': 'normal'}.get(navn, navn)
    d = out / navn; d.mkdir()   # ikke exist_ok: en eksisterende mappe er en fejl
    env = {'PATH': os.environ['PATH'], 'PROBE_CASE': sag, 'PROBE_OUT': str(d), 'HOME': str(d), **ekstra}
    kmd = ['node', '--import', str(here / 'proevedobler.mjs'), str(script), str(d)]
    p = subprocess.run(kmd, capture_output=True, text=True, env=env, timeout=20)
    rap = json.loads((d / 'rapport.json').read_text()) if (d / 'rapport.json').exists() else None
    har = json.loads((d / 'harness.json').read_text())
    # SAMMENHAENG: rapportens kropFil ↔ filerne paa disken ↔ denne
    # koersels fuldfoerte svar. Tre udtryk for ét spoergsmaal, som skal
    # stemme — ellers er der bytes i mappen, koerslen ikke hentede.
    paa_disk = sorted(x.name for x in d.glob('*.body'))
    refereret = sorted(x['kropFil'] for x in (rap['svar'] if rap else []) if x.get('kropFil'))
    fuldfoerte = sum(1 for x in (rap['svar'] if rap else []) if x.get('slags') == 'svar')
    foraeldreloese = [f for f in paa_disk if f not in refereret]
    sammenhaeng = ('OK' if paa_disk == refereret and len(refereret) == fuldfoerte
                   else 'AFVIGER')
    raptekst = json.dumps(rap, ensure_ascii=False) if rap else ''
    laek = sorted(h for h in HEMMELIGE if h in raptekst or h in p.stdout or h in p.stderr)
    r = {
        'sag': navn, 'doubel': sag, 'exit': p.returncode,
        'rapport_gemt': rap is not None,
        'body_filer': paa_disk,
        'body_filer_refereret_af_rapporten': refereret,
        'fuldfoerte_svar_i_denne_koersel': fuldfoerte,
        'foraeldreloese_body_filer': foraeldreloese,
        'sammenhaeng': sammenhaeng,
        'fetch_kald': len(har['calls']),
        'anmodede_ventetider_ms': har['waits'],
        'slags': [x.get('slags') for x in rap['svar']] if rap else None,
        'svarafsender': sorted({str(x.get('svarafsender')) for x in rap['svar']}) if rap else None,
        'proxyvariablerSat': rap.get('proxyvariablerSat') if rap else None,
        'hemmeligheder_i_output': laek,
        'kanTilskrivesVaerten_findes': 'kanTilskrivesVaerten' in raptekst,
        'rigtigt_netvaerk': False,
    }
    res.append(r)
    (d / 'stdout.txt').write_text(p.stdout); (d / 'stderr.txt').write_text(p.stderr)
    log += [f'══ SAG {navn}  (doubel: {sag}) ══', '$ ' + ' '.join(kmd),
            'ENV: ' + (', '.join(f'{k}=<opdigtet>' for k in ekstra) or 'ingen proxyvariabler'),
            '--- stdout ---', p.stdout.rstrip(), '--- stderr ---', p.stderr.rstrip(),
            f'EXIT {p.returncode}', json.dumps(r, ensure_ascii=False), '']
(out / 'resultater.json').write_text(json.dumps(res, indent=2, ensure_ascii=False))
(out / 'kontrollog.txt').write_text('\n'.join(log))
print(json.dumps(res, indent=2, ensure_ascii=False))
afviger = [r['sag'] for r in res if r['sammenhaeng'] != 'OK']
print(f"\nsammenhaeng: {len(res) - len(afviger)}/{len(res)} OK"
      + (f"  AFVIGER: {afviger}" if afviger else ''))
sys.exit(1 if afviger else 0)
