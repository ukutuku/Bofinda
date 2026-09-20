# Tilstandene og deres relationer

Denne fil findes, fordi tre gennemgange i træk har fundet fejl af
**samme art**: en tilstand blev behandlet som afgjort, før den var det.
Ikke tre forskellige fejl — den samme fejl tre steder.

Læs den, før du retter noget i `lib/abonnement.ts`, `lib/webhook.ts`
eller `lib/driftskift.ts`.

## Fire enheder, fire skrivere

| Enhed | Hvor | Hvem skriver |
|---|---|---|
| **Købsforsøg** | `checkout_forsoeg` | `startKoebFor`, `lukAlleAabneKoeb`, webhooken, tilsynet |
| **Checkout-session** | hos Stripe | Stripe. Vi kan kun `create`, `retrieve` og `expire` |
| **Abonnement** | `subscriptions` | webhooken (`kassen`, `betalt`, `spejl`, `mislykkedes`), `sigOp` |
| **Driftstilstand** | `drift.tilstand` | `saetTilstand`, og nødudgangen i Supabases dashboard |

Ingen af de fire er kilden til de andre. Det er hele vanskeligheden:
de skal afstemmes, ikke udledes.

## Sessionen har TO akser, ikke én

Stripes Checkout Session bærer to felter, og de svarer på hvert sit
spørgsmål ([Sessions.d.ts:241 og :285](https://docs.stripe.com/api/checkout/sessions/object)):

```
status         : open | complete | expired
payment_status : unpaid | paid | no_payment_required
```

**`complete` betyder, at kassen blev gennemført — ikke at pengene er
modtaget, og ikke at intet abonnement opstod.** En session kan være
`complete` med `payment_status: unpaid`, mens betalingen behandles.

Den skelnen er fund 1 i tredje gennemgang: koden læste kun `status`,
så `complete` blev behandlet som «død betalingsside», og et nyt køb
blev åbnet oven i et, der netop var gennemført.

## Købsforsøgets tilstande

```
                  ┌──────────────────────────────────────┐
   startKoebFor → │ aaben                                │
                  │ kan stadig betales                   │
                  └───┬───────────┬──────────┬───────────┘
                      │           │          │
        Stripe: complete    Stripe: expired  vi expirede den
                      │        │  (eller sessionsløs   │
                      ▼        │   og udløbstid passeret)
        ┌─────────────────────┐│                       │
        │ afventer_afstemning ││                       │
        │ gennemført, men vi  ││                       │
        │ har ikke set        ││                       │
        │ abonnementet endnu  ││                       │
        └──────────┬──────────┘▼                       ▼
                   │      ┌──────────┐          ┌───────────┐
   abonnementet    │      │ udloebet │          │  afbrudt  │
   bogført lokalt  │      └──────────┘          └───────────┘
                   ▼
              ┌──────────┐
              │  betalt  │
              └──────────┘
```

`aaben` og `afventer_afstemning` er **ikke afgjorte**. Begge blokerer et
nyt køb, og begge blokerer et skift til GRATIS. `betalt`, `udloebet` og
`afbrudt` er terminale.

## De ti invarianter

| # | Invariant |
|---|---|
| **I1** | Et forsøg, hvis session stadig kan have modtaget penge, tæller aldrig som lukket |
| **I2** | GRATIS skrives kun, når ingen betaling kan lande bagefter |
| **I3** | Et forsøg lukkes kun af sin **egen** betaling — aldrig af en anden med samme kunde |
| **I4** | En terminal abonnementsstatus genoplives ikke af en hændelse, der ikke er strengt nyere |
| **I5** | Ingen ubehandlet hændelse kan fortrænges permanent af andre |
| **I6** | Vi fornyer ikke på vilkår, vi ikke kan levere |
| **I8** | En modtaget betaling markeres aldrig færdig uden at være bogført |
| **I9** | Vi tager ikke en plan eller en fornyelse fra nogen på et grundlag, vi ikke kunne bekræfte |
| **I10** | En stoppet fornyelse startes kun igen af et menneske |
| **I7** | `adgang_til` flyttes kun frem. Altid. Uden undtagelse |

I7 står sidst, fordi den er den eneste, der aldrig har været brudt, og
den eneste der aldrig må blive det. Alle de andre rettelser skal kunne
laves **uden** at røre den.

**I8, I9 og I10 kom til efter modstandsgennemgangen af rettelserne
selv.** De hører sammen to og to med noget, vi allerede havde:

· **I8** er I5 vendt den anden vej. I5 siger, at en hændelse ikke må
  blive fortrængt; I8 siger, at den ikke må blive *afsluttet*, når
  arbejdet ikke blev gjort. `betalt()` kunne før få sin indsættelse
  afvist af `sub_en_levende_pr_bruger`, skrive ingenting og alligevel
  markere hændelsen færdig og slette nyttelasten. Pengene var modtaget,
  og der var ingen vej tilbage til dem.

· **I9** er «AFSTEM FØR DU OPRETTER» i `laegPlan`, gentaget for den
  modsatte handling. At oprette en plan for meget koster en oprydning.
  At slippe en plan, der var rigtig, koster kunden hendes overgang til
  normalprisen **og** en opsigelse, hun ikke har bedt om. Den dyreste
  af de to var den, der ikke afstemte.

**I2 blev brudt igen, og på en ny måde.** Vagten var altid formuleret
som «ingen `aaben` række → ingen betaling kan lande». Men rækkens
`status` svarer på «må kontoen starte noget nyt?», mens sessionen hos
Stripe svarer på «kan der stadig komme penge?». De to kan stå
forskelligt: en reservation, der blev lukket under et kald i luften, er
afgjort **hos os** og stadig betalbar **hos Stripe**. Derfor er
prædikatet nu `SPAERRER_SKIFTET` — uafsluttet status ELLER en session,
vi ikke har fået bekræftet lukket — og sessions-id'et skrives FØR
kaldet, aldrig efter.

· **I10** følger af I9. Når et menneske — eller tilsynet — har stoppet
  en fornyelse, er det en beslutning. Tilsynet lagde før planen igen i
  næste time og markerede den `konfigureret`, mens basen og «Mit
  abonnement» blev ved med at sige, at der ikke bliver trukket mere. To
  kilder, der modsiger hinanden om kundens penge.

## Bindingerne mellem enhederne

Det, der gør afstemning mulig, er at hvert led har en **entydig** nøgle
til det næste:

| Fra | Til | Nøgle | Hvor den kommer fra |
|---|---|---|---|
| forsøg | session | `checkout_forsoeg.stripe_session_id` | skrives efter `sessions.create` |
| session | forsøg | sessionens `id` | `checkout.session.completed` |
| forsøg | abonnement | `checkout_forsoeg.stripe_subscription_id` | `kassen()` skriver den |
| faktura | forsøg | `parent.subscription_details.metadata.bofinda_forsoeg` | vi sætter den i `subscription_data.metadata` ved `sessions.create`; Stripe fastfryser den i fakturaen |
| abonnement | plan | `subscriptions.stripe_schedule_id` og Stripes egen `subscription.schedule` | to uafhængige kilder, og det er med vilje |

**Kunde-id er ikke en binding.** En kunde kan have et gammelt, opsagt
abonnement og et nyt købsforsøg samtidig. At lukke et forsøg på
kunde-id alene var fund 3 i tredje gennemgang.

## Hvornår et sessionsløst forsøg er harmløst

Et forsøg uden `stripe_session_id` kan betyde to ting: at kaldet til
Stripe aldrig blev lavet, eller at det **kører lige nu**. Vi kan ikke
se forskel udefra.

Men vi behøver ikke: sessionens `expires_at` er sat til præcis
forsøgets `udloeber_at`. Derfor gælder

```
sessionsløs  +  udloeber_at i fremtiden   →  UAFKLARET
sessionsløs  +  udloeber_at passeret      →  harmløs; luk som udloebet
```

Det er grunden til, at de to tidspunkter skal blive ved med at være det
samme tal. Bliver de forskellige, forsvinder argumentet.

Gratis-skiftet venter derfor højst ét forsøgs levetid (`CHECKOUT_LEVETID_MIN`,
35 minutter) på en uafklaret oprettelse — ikke for evigt, og ikke nul.

## Hændelsernes rækkefølge

Stripes `created` har **sekundopløsning**, og Stripe garanterer ikke
leveringsrækkefølgen. To hændelser i samme sekund siger derfor
ingenting om orden.

Derfor er statusafstemningen **ikke** ordnet på tid alene:

* Spejlingen (status, pris, periode) bruger `stripe_opdateret_at` med
  `<=`, så to hændelser i samme sekund stadig kan gøre fremskridt.
* **Men en terminal status forlades aldrig.** `canceled`,
  `incomplete_expired` og `expired` er endelige hos Stripe; en
  hændelse, der vil sætte noget andet, er ude af orden og afvises.

At ændre `<=` til `<` ville ikke løse det. Det ville genindføre fund 6
fra første runde, hvor `checkout.session.completed` og den første
`invoice.paid` deler sekund, og spejlingen aldrig blev skrevet.

## Hvad der IKKE hører sammen

Tre spørgsmål bliver hele tiden blandet sammen. De er forskellige:

1. **Kan sessionen stadig betales?** → Stripes `status`
2. **Er pengene modtaget?** → `invoice.paid`, og kun den
3. **Har kunden adgang?** → `subscriptions.adgang_til`, skrevet ét sted

Et svar på ét af dem er aldrig et svar på et andet.
