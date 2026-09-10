# Auth-binding — hvem er hvem

Hvordan en Supabase-konto knyttes til vores egen række i `public.users`,
og hvorfor det er skrevet, som det er.

Koden er `bindKonto` i `lib/auth.ts`. Prøverne er
`scripts/test-authbinding.ts` (logikken),
`scripts/cloud/samtidighed.ts` (rigtig parallelitet) og
`scripts/test-kontovej.ts` (destination, callback og cookies).

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

---

## Login-, callback- og fornyelseskontrakten

Tre ting, der før var uskrevne — og derfor hver især gik galt.

### 1 · Destinationen kommer fra ét bord

`lib/kontovej.ts` er det eneste sted, et kontoforløb kan ende.

| kontekst | login | logud | efter bekræftelse | ved linkfejl |
|---|---|---|---|---|
| `bolig` | `/min-side` | `/min-side` | `/min-side` | `/min-side` |
| `udlejer` | `/udlejer/boliger` | `/udlejer` | `/udlejer/boliger` | `/udlejer` |

Klienten sender **et nøgleord** — `k=bolig` eller `k=udlejer` — aldrig en
adresse. Kender bordet det ikke, bruges `bolig`. Der findes altså ikke et
åbent redirect at lukke: hvert mål i tabellen er en litteral i filen, og
der er hverken `returnTo`, `next` eller `Referer` inde i billedet.

**Konteksten vælger en destination, ikke en rettighed.** Målet afgør
transitivt, hvilken `role` der skrives ved første binding — men
`users.role` læses ikke ét eneste sted, og `/udlejer/boliger` viser
`mineBoliger(u)`, altså hendes egne rækker. En, der selv sætter
`k=udlejer`, får en tom annonceliste og et forkert ord i sin egen række.
Hun får ikke andres data.

### 2 · Bekræftelseslinket har en callback

`@supabase/ssr` kører **PKCE**. Linket i mailen peger på Supabase, som
verificerer adressen og sender browseren videre til os med `?code=…`.
Den kode skal veksles. Det gjorde ingen: `emailRedirectTo` pegede på
`/udlejer`, og der fandtes ingen rute til at veksle. Brugeren landede
udlogget med en uforklaret parameter — mens adressen **faktisk var
bekræftet** hos Supabase. Forløbet var ikke brudt, det var uafsluttet.

`app/auth/callback/route.ts` veksler nu koden og sender hende til
kontekstens mål. Fem ting er bygget ind:

- **Svaret bygges før vekslingen**, så SDK'ets sessionscookies kan skrives
  direkte på det redirect, browseren får. Gøres det omvendt, falder de på
  gulvet, og hun lander udlogget — netop den fejl, ruten skal rette.
- **Fem fejlårsager, én besked.** Manglende kode, ugyldig, udløbet,
  allerede brugt, og manglende PKCE-verifier (linket åbnet i en anden
  browser). Brugeren kan ikke skelne dem og behøver det ikke; hun får
  begge veje videre — log ind, eller opret igen for et nyt link.
- **Ingen 500 og ingen løkke.** Også et netværksudfald mod Auth-serveren
  ender som en redirect, og fejlmålene peger aldrig tilbage på ruten selv.
- **Ingen koder eller tokens** i logs, i events eller i en URL. Auth-
  serverens engelske fejltekst kommer heller ikke med — landingssiden får
  ét fast ord, `linkfejl=1`, og skriver sin egen besked af det.
- **`Cache-Control: no-store`.** Svaret bærer sessionscookies for ét
  bestemt menneske.

### 3 · Sessionen fornyes i middleware

En server component kan **læse** cookies, men ikke sætte dem — `setAll` i
`lib/auth.ts` sluger derfor skrivningen. Når access-tokenet udløber,
roterer `getUser()` refresh-tokenet, og det nye ville blive kasseret.
Bruges et forbrugt refresh-token igen uden for GoTrues genbrugsinterval,
tilbagekaldes **hele** sessionen. Brugeren logges ud «af sig selv» — og
under en udløbsprøve ser det ud, som om udløbet virker efter hensigten.

Middleware er det ene sted, hvor både requesten og svaret kan skrives.
Tre ting skal blive, som de er:

- **Fornyelsen ligger IKKE bag samtykket.** Filen begyndte med
  `if (!plan) return`. Lå auth bag den linje, ville «kun det nødvendige»
  betyde «ingen login-session, der holder» — en cookiebanner-knap ville
  være blevet til en adgangsspærring. En session er strengt nødvendig;
  den er ikke statistik.
- **Ét svar.** Analytics- og auth-cookies skrives på det samme
  `NextResponse`. Bygges der et nyt undervejs, falder det, der allerede
  var sat, af.
- **Kun når der er noget at forny.** Uden en auth-cookie springes kaldet
  over, så de anonyme visninger af områdesiderne ikke betaler for en
  session, der ikke findes. `/api/*` er også undtaget: målingsbeaconet har
  ingen brug for en bruger.

`lib/supabase-klient.ts` findes, fordi middleware kører i edge-runtime og
**ikke må importere `db`**. Efterprøvet på det byggede bundt: `drizzle`,
`db/client` og `pg-native` optræder nul gange i `middleware.js`.

### 4 · Tilmeldingsbeskeden siger det samme begge veje

En fejlfri `signUp()` er **ikke** bevis for, at der blev sendt en mail.
Med «Confirm email» slået til svarer GoTrue uden fejl på en adresse, der
allerede har en bekræftet konto, og sender ingenting — beskyttelsen mod
at afsøge, hvem der er kunde hos os.

Den beskyttelse ophæves ikke, og vi slår **ikke** op selv: et opslag i
`auth.users` med en secret-nøgle ville flytte lækagen fra Supabase til os.
Beskeden er derfor den samme, om adressen var ledig eller ej, og
formuleret som en betingelse til hende — ikke som en oplysning om
adressen. `findes-allerede` bogføres stadig som fejlklasse i vores egen
statistik; det er ikke et svar til en fremmed.

Vejen videre ved en manglende mail er **ikke** at slette kontoen.
`signUp()` på en ubekræftet konto sender linket igen, så «udfyld
formularen en gang til» er den rigtige handling — og en, hun selv kan
gøre.

---

## Hvad staging skal indstilles til

Ud over «Confirm email: ON» ovenfor kræver callback-kontrakten to felter
under **Authentication → URL Configuration**:

- **Site URL** = præcis den origin, appen åbnes på, tegn for tegn og uden
  skråstreg til sidst. Den skal være **identisk** med
  `NEXT_PUBLIC_BASE_URL` i appens miljø: `localhost` og `127.0.0.1` er
  forskellige oprindelser for cookies.
- **Redirect URLs** skal indeholde `<origin>/auth/callback`. Et
  wildcard `<origin>/**` dækker den også. Står målet ikke på listen,
  **afviser GoTrue det uden fejl** og sender brugeren til Site URL i
  stedet — bekræftelsen lykkes teknisk, landingen er forkert, og der er
  ingenting at fejlsøge på.

`NEXT_PUBLIC_BASE_URL` er den eneste variabel, der bestemmer, hvad
Supabase får som redirect-mål: `emailRedirectTo` bygges af den i
`callbackUrl()`. Er den tom, sendes intet `emailRedirectTo`, og GoTrue
falder tilbage på Site URL — så virker linket, men konteksten er tabt, og
en boligsøgende lander på udlejersiden igen.

Se `docs/staging-opsaetning.md` for resten.

## Stadig uverificeret

`scripts/test-kontovej.ts` lægger attrappen på **HTTP-grænsen** ud til
Auth-tjenesten, ikke på SDK'et: en lille GoTrue-efterligning lytter på
loopback, og `@supabase/ssr` laver sin egen PKCE-verifier, veksler den,
deler cookies i bidder og skriver dem. Prøven ser altså den ægte
cookiemekanik.

Men efterligningen svarer, som vi **tror** GoTrue svarer. Følgende kan
derfor stadig kun afgøres i et rigtigt Auth-miljø:

- at det rigtige Supabase Auth sender, verificerer og veksler, som
  efterligningen gør — herunder at bekræftelseslinket faktisk lander på
  `/auth/callback` med den kontekst, vi satte
- at maillevering overhovedet virker (kræver custom SMTP; den indbyggede
  tjeneste leverer kun til organisationens egne medlemmer)
- at sessionen udløber som forventet, og at en udløbet session ikke giver
  adgang
- at `getUser()` afviser en forfalsket eller genbrugt cookie
- at Site URL og Redirect URLs er sat, så GoTrue ikke tavst kasserer
  vores `emailRedirectTo`
- selve «Confirm email»-indstillingen ovenfor — i **både** staging og
  produktion

De hører til release-gaten, ikke til `npm test`.
