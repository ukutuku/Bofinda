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
