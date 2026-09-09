# Auth-binding — hvem er hvem

Hvordan en Supabase-konto knyttes til vores egen række i `public.users`,
og hvorfor det er skrevet, som det er.

Koden er `bindKonto` i `lib/auth.ts`. Prøverne er
`scripts/test-authbinding.ts` (logikken) og
`scripts/cloud/samtidighed.ts` (rigtig parallelitet).

## Autoriteten er `auth_user_id` — ikke mailen

En mailadresse kan skifte. Den kan skifte til en, en anden havde. Derfor:

- **`auth_user_id` afgør ejerskabet.** Er en række først bundet til en
  konto, er det den samme interne bruger for altid — også hvis
  mailadressen siden ændres hos Supabase.
- **Mailen kan kun åbne én engangsbinding** af en række, som ingen konto
  ejer endnu. Det er alarmbrugerne: de oprettes på mailadressen alene og
  har aldrig haft en konto.

## Hvad der gik galt før

Den arvede binding matchede på mailadressen alene:

```
select ... where email = ?            -- læsning
update users set auth_user_id = ?     -- skrivning, UDEN vagt
  where id = <den fundne>
```

Tre huller på én gang:

1. **Overtagelse.** Enhver konto med den rigtige mailadresse fik rækken —
   også en, der allerede tilhørte en anden konto. Med den fulgte hendes
   gemte søgninger, favoritter og udlejerannoncer.
2. **Kapløb.** Mellem `select` og `update` kunne en anden request nå at
   binde rækken. Vores `update` skrev hen over den binding.
3. **Ingen verifikation.** Der blev ikke spurgt, om mailadressen
   overhovedet var bevist.

## Reglerne nu

| | Regel |
|---|---|
| **A** | Er rækken allerede bundet til kontoen, returneres den — uanset mailen. |
| **B** | En række bundet til en **anden** konto røres aldrig. Hverken binding eller rolle. |
| **C** | En ubunden række bindes kun med en bekræftet mailadresse. |
| **D** | «Ubunden» står i `UPDATE`ens egen `WHERE`, ikke i en forudgående `SELECT`. |
| **E** | Ramte `UPDATE`en nul rækker, udleveres den fundne række **aldrig**. Der genlæses kun på vores eget verificerede `auth_user_id`. |
| **F** | Samtidige førstegangsrequests løses af databasens unikhed. Gentagne requests er idempotente. |

En konto-konflikt afvises med `{ slags: 'konflikt' }` og en henvisning til
`info@bofinda.dk`. **Den løses aldrig ved at flytte data mellem konti.**

### Hvorfor to runder

`bindKonto` prøver bindingen op til to gange. En samtidig request kan nå
at **indsætte** rækken mellem vores `UPDATE` og vores læsning: første
runde finder så ingenting at binde og ingenting at oprette, men rækken
findes nu, og anden runde binder den.

Det blev fundet af samtidighedsprøven mod rigtig PostgreSQL, ikke af
PGlite: med tolv parallelle førstegangsrequests fra **samme** konto
fejlede én, fordi konflikt-tjekket kun så, *at* der lå en række på
adressen — ikke at den var vores egen. PGlite kører på én forbindelse og
kan ikke vise det.

---

## ⚠ Release-gate: «Confirm Email» skal være slået TIL

**Dette er en forudsætning, koden ikke kan efterprøve.**

`bindKonto` kræver `email_confirmed_at` på Auth-serverens brugerobjekt,
før en ubunden række bindes. Det felt er en **nødvendig, men ikke
tilstrækkelig** betingelse:

> Er «Confirm Email» slået **fra** i Supabase Auth, sætter serveren selv
> `email_confirmed_at` ved oprettelsen — uden at nogen har åbnet en mail.

Med indstillingen slået fra er tjekket altså sandt for alle, og enhver kan
oprette en konto på en fremmed adresse og arve hendes gemte søgninger.

Koden kan ikke se indstillingen og lader være med at lade som om. Den
tjekker det, den kan se, og lader resten stå her som en gate.

**Før release skal et menneske bekræfte i det rigtige Auth-miljø:**

- [ ] Authentication → Providers → Email → **Confirm email: ON**
- [ ] En nyoprettet konto kan **ikke** logge ind før bekræftelse
- [ ] `email_confirmed_at` er `null`, indtil linket i mailen er trykket
- [ ] Ændring af mailadresse kræver bekræftelse på den **nye** adresse

Konstanten `KRAEVER_CONFIRM_EMAIL` i `lib/auth.ts` findes for at gøre
kravet søgbart fra koden. Den ændrer ikke adfærd, og den må aldrig blive
til en «vi går ud fra, at mailen er verificeret»-antagelse.

## Stadig uverificeret

Følgende kan **ikke** lukkes af PGlite, af en auth-stub eller af
Cloud-testmiljøet, hvor Supabase-nøglen er en attrap:

- ende-til-ende signup, mailbekræftelse, login og logout mod rigtig
  Supabase Auth
- at sessionen udløber som forventet, og at en udløbet session ikke giver
  adgang
- at `getUser()` afviser en forfalsket eller genbrugt cookie
- selve indstillingen ovenfor

De hører til release-gaten, ikke til `npm test`.
