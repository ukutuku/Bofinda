#!/usr/bin/env python3
"""Koer det RETTEDE Laros-script mod isolerede testdobler.

Ingen netvaerk: proevedobler.mjs erstatter globalThis.fetch.
Ingen rigtig ventetid: setTimeout logges og fremskyndes.
Ingen database, ingen produktionsnoegler. Alle credentials er opdigtede.
"""
import json, os, pathlib, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
script = pathlib.Path(sys.argv[1]).resolve()
out = here / 'resultater'; out.mkdir(exist_ok=True)

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
    d = out / navn; d.mkdir(exist_ok=True)
    env = {'PATH': os.environ['PATH'], 'PROBE_CASE': sag, 'PROBE_OUT': str(d), 'HOME': str(d), **ekstra}
    kmd = ['node', '--import', str(here / 'proevedobler.mjs'), str(script), str(d)]
    p = subprocess.run(kmd, capture_output=True, text=True, env=env, timeout=20)
    rap = json.loads((d / 'rapport.json').read_text()) if (d / 'rapport.json').exists() else None
    har = json.loads((d / 'harness.json').read_text())
    raptekst = json.dumps(rap, ensure_ascii=False) if rap else ''
    laek = sorted(h for h in HEMMELIGE if h in raptekst or h in p.stdout or h in p.stderr)
    r = {
        'sag': navn, 'doubel': sag, 'exit': p.returncode,
        'rapport_gemt': rap is not None,
        'body_filer': sorted(x.name for x in d.glob('*.body')),
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
