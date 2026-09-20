# Sådan skifter ejeren driftstilstand

To tilstande. **GRATIS er lanceringstilstanden.**

| | GRATIS | BETALING |
|---|---|---|
| Kontaktoplysninger | åbne | kræver abonnement |
| Kildelink (`/go/[id]`) | åbent | kræver abonnement |
| Søgeresultater, beskrivelser, billeder | offentlige | offentlige |
| Betalingsbokse og køb | findes ikke | vises |

Ingen ny deployment. Ingen kodeændring.

## Vej 1 — i appen (normalvejen)

1. Log ind på en konto med `users.role = 'admin'`.
2. Gå til **`/admin/drift`**.
3. «Slå muren TIL» / «Slå muren FRA».

Er du ikke admin, svarer siden «Ikke fundet» — den røber ikke, at der
findes et adminområde.

**Sådan bliver en konto admin** (én gang, i Supabases SQL-editor):

```sql
update users set role = 'admin' where email = 'DIN-MAIL';
```

## Vej 2 — Supabases dashboard (nødudgangen)

Hvis appen ikke kan nås:

```sql
update drift set tilstand = 'betaling', aendret_at = now(),
                 note = 'nødskift fra dashboard';
```

Tilstanden virker **med det samme** — der er ingen cache.

> **Vej 2 omgår vagten nedenfor.** Skifter du til `gratis` i dashboardet,
> mens nogen har et løbende abonnement, bliver de ved med at blive
> trukket. Tjek først:
> ```sql
> select count(*) from subscriptions
> where status in ('trialing','active','past_due','incomplete','paused','unpaid');
> ```

## Hvorfor et skift til GRATIS kan blive afvist

Muren og Stripes opkrævninger er to forskellige ting. Er der løbende
abonnementer, afviser `/admin/drift` skiftet og siger hvor mange. Ellers
ville vi enten trække 349 kr. hver 28. dag for noget, alle andre får
gratis — eller opsige fremmede mennesker automatisk, hvilket er en
beslutning om deres penge, ingen har bedt om.

Tag stilling til hver enkelt i Stripe først (opsig — adgangen løber
perioden ud), og skift så.

### …og hvorfor det kan blive afvist en anden gang

Der er **to** afvisninger, ikke én:

| Fejl | Betyder |
|---|---|
| `levende_abonnementer` | nogen betaler lige nu — tag stilling i Stripe |
| `aabne_koeb` | en påbegyndt betaling kunne **ikke lukkes hos Stripe** |

`aabne_koeb` er den nye. En kunde kan stå med betalingssiden åben i
netop det sekund; betaler hun bagefter, har hun et løbende abonnement i
gratis tilstand. Derfor lukkes sessionerne **hos Stripe**, før
tilstanden skrives — og svarer Stripe ikke, skiftes der ikke.

**Tryk på «Slå muren FRA» igen.** Knappen er ikke deaktiveret, selv om
der allerede står GRATIS: står der åbne påbegyndte betalinger, er
knappen afstemningen af dem. Siden viser tallet. Kun en lukning, Stripe
har bekræftet, bogføres som lukket — hverken en netværksfejl eller en
manglende Stripe-opsætning tæller.

**Et skift til BETALING opretter ingen abonnementer og opkræver ingen.**
Gratis brugere møder en betalingsboks og skal selv trykke.

## Før muren slås til første gang

1. Opret de to priser i Stripe (DKK, inkl. moms):
   - intro: **900 øre**, `recurring: { interval: 'day', interval_count: 1 }`
   - normal: **34900 øre**, `recurring: { interval: 'day', interval_count: 28 }`
2. Sæt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRIS_INTRO`,
   `STRIPE_PRIS_NORMAL`.
3. Peg Stripes webhook på `POST /api/stripe`.
4. **Kør sandbox-listen i `docs/betaling/RAPPORT.md` under «Manglende
   verifikation».** Intet Stripe-kald i dette modul er kørt mod Stripe.

Uden 1–3 virker GRATIS uændret; `startKoeb` svarer `stripe_mangler`.

## Hvis en kunde trykker «Køb» to gange

Der er **ét** åbent købsforsøg pr. konto — håndhævet af et delvist
entydighedsindeks i basen, ikke kun af kode. Møder et nyt tryk et
eksisterende, slås sessionen op hos Stripe, og der er tre udfald:

| Stripe siger | Hun får |
|---|---|
| sessionen er `open` | **samme** betalingsside igen |
| sessionen er død (`expired`/`complete`) | rækken lukkes, og der begyndes **forfra** |
| intet — opslaget fejlede | «du har et køb i gang», og rækken bliver stående |

Det tredje er med vilje forsigtigt: et opslag, der ikke kunne laves, er
ikke bevis for, at en session er ubetalbar. En reservation, ingen
færdiggør, ryddes af **tiden** — `udloeber_at`, 35 minutter — ikke af
det næste tryk.

## Timekørslens betalingstilsyn

`scripts/import.ts` kalder `betalingstilsyn()` i hver kørsel — også i
GRATIS tilstand, for et løbende abonnement skal have sin plan, uanset
hvad muren gør. Den gør to ting og skriver dem i kørselsrapporten:

```
[betaling] genbehandling: 2 taget · 1 færdige · 1 afventer · 0 fejlede · 1 ubehandlede tilbage
[betaling] planer: 1 forsøgt · 1 konfigureret · 0 opgivet efter 5 forsøg
```

* **genbehandling** — hændelser, der står med `behandlet_at = null`,
  køres om fra den gemte nyttelast. Stripes egne genforsøg holder op;
  denne gør ikke.
* **planer** — abonnementer, hvis `plan_status` ikke er
  `konfigureret`, forsøges igen.

Mangler Stripe-opsætningen i kørslen, **siger den det** i stedet for at
se ud som om der ikke var noget at gøre.

## Hvis introplanen ikke kan lægges inden døgnfornyelsen

Det er det alvorligste, der kan gå galt i betalingsmodulet, og det
kræver et menneske. Læs afsnittet, før muren slås til.

**Hvad der sker.** Kunden betaler 9 kr. og får sin adgang — den del er
sikker, og en planlægningsfejl rører den aldrig. Men introprisen har
`interval: 'day', interval_count: 1`, altså **hver dag**. Overgangen til
349 kr./28 dage findes kun i den `SubscriptionSchedule`, vi lægger
bagefter. Lykkes den ikke, fornyes abonnementet hos Stripe til **9 kr.
om dagen**, indtil nogen griber ind.

**Hvor lang tid er der.** Til den første fornyelse: 24 timer fra
betalingen. Tilsynet kører hver time og prøver igen, så der er normalt
~23 forsøg inden da. Efter `PLAN_MAX_FORSOEG` (5) mislykkede forsøg
sættes `plan_status = 'fejlet'`, og de automatiske forsøg stopper.

**«fejlet» stopper ingen opkrævning.** Det er en markering i vores
base, ikke en handling hos Stripe. Derfor skriver tilsynet linjen i
**hver eneste kørsel**, til nogen har gjort noget:

```
[betaling] ⚠ 1 abonnement(er) har INGEN bekræftet plan efter 5 forsøg og
fornyes til 9 kr./DAG hos Stripe, til nogen griber ind: sub_1abc…
```

**Hvad du gør.**

1. Find dem:
   ```sql
   select stripe_subscription_id, user_id, plan_status, plan_forsoeg,
          plan_fejl, adgang_til
   from subscriptions
   where plan_status is not null and plan_status <> 'konfigureret'
   order by adgang_til;
   ```
2. Læs `plan_fejl`. Er det en forbigående fejl hos Stripe, så nulstil
   tælleren, og lad tilsynet prøve igen i næste kørsel:
   ```sql
   update subscriptions set plan_forsoeg = 0, plan_status = 'mangler'
   where stripe_subscription_id = 'sub_…';
   ```
3. Kan planen ikke lægges, så **lad være med at lade abonnementet
   fornyes på forkerte vilkår.** Sæt `cancel_at_period_end` på
   abonnementet i Stripes dashboard. Den betalte periode løber ud —
   kunden beholder det, hun har betalt for — og der kommer ingen
   9 kr.-fornyelse.
4. Skriv til kunden, og lav købet om, når planen kan lægges.

**Opsig aldrig med `cancel` i stedet for `cancel_at_period_end`.** Det
ville afslutte abonnementet med det samme og tage en periode, kunden
har betalt for. Det er samme regel som i `sigOp()`.

**Hvad du IKKE skal gøre:** lade en plan i `fejlet` stå og regne med,
at den løser sig. Det gør den ikke, og hvert døgn koster kunden 9 kr.
