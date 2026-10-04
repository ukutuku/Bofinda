#!/usr/bin/env python3
"""Modproeve: en body fra en TIDLIGERE udfoerelse maa ikke taelle som en ny hentning.

    python3 proev-restfil.py <ny-tom-outputrod>

To vaern proeves, hver for sig:

  1. Outputroden skal vaere ny og tom. Findes den med indhold, stopper
     koer-proever.py med exit 2 — og sletter intet.
  2. Sammenhaengskontrollen: ligger der en body, rapporten ikke henviser
     til, navngives den som foraeldreloes, og sagen markeres AFVIGER.

Vaern 2 proeves ved at LAEGGE en tydeligt syntetisk restfil i en faerdig
sagsmappe og regne kontrollen om paa netop den mappe. Filen slettes ikke.
Ingen netvaerk, ingen database, ingen rigtige credentials.
"""
import json, pathlib, subprocess, sys

here = pathlib.Path(__file__).resolve().parent
if len(sys.argv) < 2:
    sys.exit('brug: proev-restfil.py <ny-tom-outputrod>')
rod = pathlib.Path(sys.argv[1]).resolve()
script = (here / '../../hent-laros-raasvar.mjs').resolve()
koer = here / 'koer-proever.py'

fejl = 0
def tjek(navn, ok, note=''):
    global fejl
    print(f"  {'✓' if ok else '✗'} {navn}" + (f'  — {note}' if note else ''))
    if not ok: fejl += 1

print('\n══ 1 · en ny, tom outputrod giver en ren koersel ══')
p = subprocess.run(['python3', str(koer), str(script), str(rod)],
                   capture_output=True, text=True, timeout=120)
res = {x['sag']: x for x in json.loads((rod / 'resultater.json').read_text())}
tjek('koerslen gik igennem', p.returncode == 0, f'exit {p.returncode}')
tjek('alle 15 sager er sammenhaengende', all(x['sammenhaeng'] == 'OK' for x in res.values()),
     f"{sum(1 for x in res.values() if x['sammenhaeng'] == 'OK')}/15")
sag = 'retry-after-redirect'
tjek(f'{sag}: hop-udskudt, og INGEN body-fil', res[sag]['body_filer'] == [],
     str(res[sag]['slags']))

print('\n══ 2 · roden kan ikke genbruges ══')
p2 = subprocess.run(['python3', str(koer), str(script), str(rod)],
                    capture_output=True, text=True, timeout=120)
tjek('en anden koersel i samme rod stopper', p2.returncode == 2, f'exit {p2.returncode}')
tjek('og den siger hvorfor, uden at slette noget', 'STOP: outputroden findes' in p2.stdout + p2.stderr)
tjek('resultaterne fra foerste koersel staar uroert', (rod / 'resultater.json').exists())

print('\n══ 3 · en plantet restfil taelles IKKE som en ny hentning ══')
d = rod / sag
rest = d / 'svar-2.body'
rest.write_text('SYNTETISK RESTFIL FRA EN TIDLIGERE UDFOERELSE - ikke hentet af denne koersel\n')
rap = json.loads((d / 'rapport.json').read_text())
paa_disk = sorted(x.name for x in d.glob('*.body'))
refereret = sorted(x['kropFil'] for x in rap['svar'] if x.get('kropFil'))
fuldfoerte = sum(1 for x in rap['svar'] if x.get('slags') == 'svar')
foraeldreloese = [f for f in paa_disk if f not in refereret]
sammenhaeng = 'OK' if paa_disk == refereret and len(refereret) == fuldfoerte else 'AFVIGER'
tjek('filen ligger paa disken', paa_disk == ['svar-2.body'], str(paa_disk))
tjek('rapporten henviser ikke til den', refereret == [], str(refereret))
tjek('koerslen havde nul fuldfoerte svar', fuldfoerte == 0, str(fuldfoerte))
tjek('den navngives som foraeldreloes', foraeldreloese == ['svar-2.body'], str(foraeldreloese))
tjek('og sagen markeres AFVIGER', sammenhaeng == 'AFVIGER', sammenhaeng)
tjek('restfilen er uaendret paa disken — intet er slettet', rest.exists())

print('\n  ALT GRØNT\n' if fejl == 0 else f'\n  {fejl} FEJLEDE\n')
sys.exit(0 if fejl == 0 else 1)
