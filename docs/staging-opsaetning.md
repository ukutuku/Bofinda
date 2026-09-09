# Staging — opsætning og køreseddel til Auth-prøven

Formålet er ÉN ting: at køre signup, mailbekræftelse, login, logout og
sessionudløb mod rigtig Supabase Auth, så release-gaten i
`docs/auth-binding.md` kan lukkes.

**Staging er `prgmenbwabwkgitjclrj`. Produktionen er `musbnojvamcihazcljpp`
og må ikke røres.**

> **Skrevet uden adgang.** Cloud-sessionen, der skrev dette, kunne ikke nå
> Supabase: egress-proxyen afviste CONNECT til både
> `prgmenbwabwkgitjclrj.supabase.co:443` og pooleren. Intet herunder er
> altså afprøvet mod det rigtige projekt. Panelernes tekster kan hedde
> noget lidt andet, end der står; feltet er beskrevet ved sin funktion, så
> det kan genkendes alligevel.

---

## 0 · Tre ting, før noget andet

Alle tre kan spilde en halv dag, hvis de ikke holder — og alle tre ligner
noget helt andet, når de fejler.

- [ ] **Projektet findes og er ikke pauset.** Supabases free-plan pauser et
      projekt efter en uges stilstand. Et pauset projekt svarer hverken på
      `/auth/v1` eller på pooleren, og fejlen ligner nøjagtig en spærret
      egress eller en forkert nøgle. Panelet viser «Restore project».
- [ ] **Du er Owner eller Administrator i Supabase-organisationen.** SMTP,
      rate limits, Confirm email, URL Configuration og visning af nøgler
      kræver det. En Developer kan se projektet og ikke sætte det op — og
      opdager det felt for felt, halvvejs nede i listen.
- [ ] **Én app-adresse er valgt** — protokol, vært og port, uden skråstreg
      til sidst. Den skal stå ordret tre steder (`NEXT_PUBLIC_BASE_URL`,
      Site URL, Redirect URLs). `localhost` og `127.0.0.1` er **forskellige
      oprindelser for cookies**; vælg én og hold fast.

**Appen behøver ingen offentlig adresse.** Supabase kalder aldrig appen
server-til-server i dette forløb. Bekræftelseslinket peger på Supabase, og
det er brugerens egen browser, der bliver sendt videre til app-adressen
bagefter. `http://localhost:3000` på din egen maskine dækker hele opgaven —
Vercel, tunnel og DNS er ikke nødvendigt.

---

## 1 · Hvad der skal skaffes, og hvor det tastes

**Intet af dette skal skrives i en chat.** Kolonnen «hvor» er der, hvor
værdien hører hjemme.

### Fra Supabase-panelet, staging-projektet

| Felt | Hvor det aflæses | Hvor det tastes |
|---|---|---|
| Project URL | Project Settings → Data API | `.env` som `NEXT_PUBLIC_SUPABASE_URL` |
| Publishable key (`sb_publishable_…`) | Project Settings → API Keys | `.env` som `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Databasekodeord | Project Settings → Database → **Reset database password** | din kodeordsmanager |
| Forbindelsesstreng, session pooler (5432) | Project Settings → Database → Connection string | `.env` som `DATABASE_URL_DIRECT` |
| Forbindelsesstreng, transaction pooler (6543) | samme sted | `.env` som `DATABASE_URL` |

Kodeordet kan **ikke** læses igen — panelet viser `[YOUR-PASSWORD]`. En
nulstilling er den eneste vej. Specialtegn skal URL-enkodes (`@`→`%40`,
`/`→`%2F`, `:`→`%3A`, `#`→`%23`, `?`→`%3F`); et uenkodet tegn får
`new URL()` til at læse en anden vært, end du tror — og så måler
projekt-ref-værnet det forkerte.

Regionen i poolerværtsnavnet **kopieres**, gættes ikke.

### Til maillevering

Supabases indbyggede mailtjeneste kan **ikke** bruges: den leverer kun til
adresser, der hører til et medlem af Supabase-organisationen, og den er
begrænset til ~2 mails i timen. To valgfri testadresser får **ingenting** —
og GoTrue svarer stadig 200, så appen viser «Tjek din mail». Der er intet
at fejlsøge på.

| Felt | Værdi | Hvor |
|---|---|---|
| Host | `smtp.resend.com` | Authentication → Emails → SMTP Settings |
| Port | `587` | samme |
| Username | `resend` | samme |
| Password | Resend-API-nøglen (`re_…`) | samme — tastes i panelfeltet, **ikke** i `.env` |
| Sender email | en adresse på `bofinda.dk` | samme |

Afsenderen skal ligge på et domæne, der er verificeret hos udbyderen.
Resends delte `onboarding@resend.dev` leverer kun til Resend-kontoens egen
ejer. `bofinda.dk` har verificeret DKIM — men Simply satte DMARC til
`p=reject`, så er `resend._domainkey` eller CNAME'en
`send.bofinda.dk → send.forge.rmta.net` faldet ud, afvises mailen hos
modtageren og ikke hos os. Efterprøv med `dig`.

**Nøglen må ikke ende i `.env`.** Står `RESEND_API_KEY` der, bliver
`scripts/import.ts` til en mailafsender mod rigtige modtagere ved næste
kørsel.

### To testadresser

To rigtige, forskellige postkasser, du selv kontrollerer. Helst uden
link-scanning: privat Gmail duer, en firma-Outlook med Safe Links gør ikke
— en scanner, der henter linket, **bruger det op**, og bekræftelsen er
engangs.

To er ikke til pynt: konflikt-grenen (regel B i `bindKonto`) og den
manglende RLS-prøve på `storage.objects` kræver begge to konti.

---

## 2 · Panelindstillinger

Authentication → Sign In / Providers → **Email**:

- [ ] Enable email provider: **TIL**
- [ ] Allow new users to sign up: **TIL** — er den fra, svarer signUp
      «Signups not allowed for this instance», en tekst `oversaet()` ikke
      kender, så den vises rå og engelsk og ligner en kodefejl
- [ ] **Confirm email: TIL** ← release-gaten
- [ ] Secure email change: **TIL**
- [ ] Minimum password length: **10** — `tilmeld()` kræver 10 selv, og to
      udtryk, der svarer på det samme spørgsmål, skal beregnes ens

Authentication → URL Configuration:

- [ ] Site URL = den valgte app-adresse, tegn for tegn
- [ ] Redirect URLs: `<app-adresse>/**` (`**` krydser skråstreger, `*` gør
      ikke). Står målet ikke på listen, **afviser GoTrue det uden fejl** og
      sender brugeren til Site URL i stedet

Authentication → Attack Protection:

- [ ] CAPTCHA: **FRA**

Authentication → Emails / Rate Limits — noter de nuværende værdier først:

- [ ] Minimum interval between emails: ned fra 60 s
- [ ] Rate limit for sending emails: op fra 2/time

**Opret aldrig testbrugerne med «Add user» i panelet.** Den auto-bekræfter
kontoen og springer præcis den gate over, hele øvelsen findes for. Slette
er i orden; oprette er ikke.

---

## 3 · Rækkefølge

Den er ikke vilkårlig. To af trinene kan ikke gøres om bagefter.

1. **`launchctl unload ~/Library/LaunchAgents/dk.bofinda.import.plist`** —
   FØR `.env` røres. Ellers importerer timekørslen i **staging** ved næste
   hele time, produktionen får ingen nye boliger imens, og
   `first_seen_at`/`crawl_runs` forurenes begge steder.
2. Nulstil databasekodeordet, hent begge forbindelsesstrenge, Project URL
   og publishable key i samme omgang.
3. Skriv `.env` med **kun** staging-værdier. Efterprøv:
   `grep -c musbnojvamcihazcljpp .env` → skal give `0`.
   Brug `.env` og ikke `.env.local`: `drizzle.config.ts` gør
   `import 'dotenv/config'`, som kun læser `.env`.
4. **Migrationerne, før den første konto:**
   ```bash
   export STAGING_DATABASE_URL='…5432…'      # session pooler
   export STAGING_SUPABASE_URL='https://prgmenbwabwkgitjclrj.supabase.co'
   export BOFINDA_STAGING_BEKRAEFT='prgmenbwabwkgitjclrj'
   npm run staging:tjek        # efterprøver målet på tre kanaler
   ```
   og derefter den kommando, `staging:tjek` skriver ud. `db:status` skal
   sige 21/21/21. Uden `0013` findes `users.auth_user_id` ikke, og
   `bindKonto` fejler ved første login i stedet for at binde.
5. **Custom SMTP, før den første signup.** Appen har ingen «send mailen
   igen»-knap — der er intet kald til `auth.resend()` i repoet. Oprettes
   den første konto uden SMTP, står hun ubekræftet uden mail, `login()`
   svarer «tryk på linket i mailen» om et link, hun aldrig fik, og eneste
   udvej er at slette brugeren i panelet.
6. Noter nuværende JWT expiry, mailinterval og rate limits. Billigt nu,
   umuligt at gætte bagefter.
7. `npm run typecheck`, start appen, åbn app-adressen. Viser `/udlejer`
   kontoformularen — og ikke «Kontooprettelse er ikke sat op på dette miljø
   endnu» — er begge `NEXT_PUBLIC`-variabler nået frem. `NEXT_PUBLIC_*`
   bages ind ved byg; efter en ændring skal der bygges igen.
8. Kør prøven, trin for trin (afsnit 4).
9. **Rul tilbage:** JWT expiry, mailinterval, rate limits, CAPTCHA til de
   noterede værdier. Slet testbrugerne i Authentication → Users **og**
   deres rækker i `public.users` — FK'en i `0013` er `on delete set null`,
   så en slettet auth-konto efterlader en forældreløs brugerrække med en
   rigtig mailadresse. Genindlæs launchd-agenten. Fjern staging-strengene
   fra `.env`.

---

## 4 · Selve prøven

Hvert trin noteres med hvad der skete, ikke med et flueben.

1. Signup fra `/udlejer` med adresse 1.
2. **Læs Logs → Auth Logs, før du venter på indbakken.** Det er det eneste
   sted, det kan ses, om mailen faktisk blev afsendt, om SMTP fejlede, og
   hvilken redirect GoTrue rent faktisk brugte. Uden den er alle de tavse
   fejl ovenfor også tavse for den, der fejlsøger.
3. Authentication → Users: `email_confirmed_at` skal være **tom**. Er den
   sat allerede her, er Confirm email slået fra, og prøven er ugyldig.
4. Åbn linket i samme browser. **Forvent at lande bekræftet, men ikke
   logget ind** — se fundet nedenfor. Bekræft at `email_confirmed_at` nu er
   sat.
5. Log ind. Bekræft at rækken i `public.users` blev oprettet og bundet på
   `auth_user_id`.
6. Log ud. Log ind igen.
7. Sessionudløb som et **selvstændigt** trin: JWT expiry ned til 300 s
   (Supabases minimum — 60 afvises), eller Authentication → Users →
   «Sign out user». Meld det aldrig grønt på en udløbstid alene.
8. Adresse 2: konflikt-grenen, og RLS-prøven på `storage.objects`, hvor den
   ene konto forsøger at signere en upload til den andens mappe. Den skal
   bevises ved at svække politikken midlertidigt — ellers måler den kun, at
   politikken findes.

---

## 5 · Fund fra koden, som prøven vil løbe ind i

Fundet ved læsning, ikke ved kørsel. De er ikke opsætningsfejl, og de
forsvinder ikke af en rigtig indstilling.

**`/min-side` og `/udlejer` deler `app/udlejer/Konto.tsx`.** Derfor:

- `login()` slutter med `redirect('/udlejer/boliger')`, hårdkodet. **En
  boligsøgende, der logger ind fra Min side, lander på udlejersiden.**
- `tilmeld()` sender `emailRedirectTo: <base>/udlejer`, hårdkodet.
  **Bekræftelsesmailen sender hende til udlejersiden.**
- Opret-formularens tekst siger «en annonce kræver en konto» — udlejersprog
  til en boligsøgende.

**Der er ingen callback-rute.** Ingen `exchangeCodeForSession`, intet
`/auth/callback`, og `middleware.ts` rører kun samtykkecookier. `lib/auth.ts`
bruger `createServerClient`, og `@supabase/ssr` kører PKCE. Bekræftelses-
linket lander derfor på `<base>/udlejer?code=…`, hvor **ingenting** veksler
koden. Adressen ER bekræftet — det sker hos Supabase — så hun kan logge ind
manuelt bagefter. Men hun lander udlogget, på den forkerte side, med en
uforklaret parameter i adresselinjen.

**GoTrue skjuler en eksisterende adresse.** Med Confirm email slået til
svarer `signUp()` på en allerede bekræftet adresse **uden fejl** og sender
ingen mail. `tilmeld()` svarer så «Tjek din mail. Vi har sendt et link…»,
og man venter på post, der aldrig blev afsendt. `already registered`-grenen
i `oversaet()` rammes ikke i det flow.

**Refresh-token-rotation kan give falsk grønt på sessionudløb.**
`setAll` i `lib/auth.ts` sluger cookieskrivningen i en server component
(`catch { }`), og `middleware.ts` kalder aldrig `getUser`. Efter
access-tokenets udløb roterer hvert `getUser()`-kald refresh-tokenet uden
at kunne gemme det nye. Gentagen brug af et forbrugt token uden for
genbrugsintervallet får GoTrue til at tilbagekalde **hele** sessionen — og
under en udløbsprøve ser det ud som «sessionudløb virker efter hensigten».
Se Authentication → Sessions → «Detect and revoke potentially compromised
refresh tokens».

**Bekræftelseslinket er engangs** og udløber (Email OTP Expiration,
standard 24 timer). Åbnet to gange — eller hentet af en mailscanner —
svarer verify med `otp_expired`/`access_denied` på redirect-adressen. Det
læses let som en forkert Redirect URL. Udvejen er at slette brugeren og
begynde forfra.

---

## 6 · Fælder

- **`scripts/cloud/*` kan ikke genbruges til staging.** `app-op.sh` sætter
  `NEXT_PUBLIC_SUPABASE_URL` til en loopback-attrap og nøglen til
  `sb_publishable_ATTRAP_kun_til_cloudtest`. Startes appen den vej, ser
  login-siden helt normal ud og gør ingenting — det ligner en gennemført
  prøve. `krav_isoleret` i `miljoe.sh` afviser desuden alt andet end
  `127.0.0.1:55432/bofinda_test`, med vilje. **Blød den ikke op.** Brug
  `npm run staging:tjek`.
- **Sæt variabler foran den enkelte kommando, ikke som `export` i skallen.**
  `npm test` loader bevidst ikke `.env` og kan derfor ikke nå produktionen.
  Står `DATABASE_URL` i skallen, forsvinder den spærring for alt, der
  kører bagefter i samme vindue.
- **`NODE_TLS_REJECT_UNAUTHORIZED=0`** er den nærliggende «løsning», når TLS
  fejler. Den gælder hele processen og ville også ramme Supabase. Forbudt i
  `CLAUDE.md`. Det rigtige er et sammensat CA-bundt.
- **Kør ikke `stubSupabase()` mod det rigtige projekt.** Den overskriver
  `auth.uid()`, `auth.users` og rollerne. Den hører til PGlite.

---

## 7 · Hvis prøven skal køre fra en Claude Cloud-session

Ikke nødvendigt — punkt 0 siger hvorfor. Men skal det, mangler alt dette,
og **halv adgang rækker ikke**:

- `prgmenbwabwkgitjclrj.supabase.co:443` på egress-allowlisten (i dag:
  `connect_rejected`, 403 fra proxyen)
- rå TCP til `aws-0-<region>.pooler.supabase.com` på **både** 5432 og 6543.
  Postgres' protokol er ikke HTTP; proxyen tunnelerer kun CONNECT. Åbnes
  kun 443, kan migrationerne stadig ikke køre
- `NODE_USE_ENV_PROXY=1` foran enhver Node-proces — `@supabase/supabase-js`
  bruger Nodes indbyggede fetch, som ikke læser `HTTPS_PROXY` af sig selv.
  Uden flaget får man timeouts uden en eneste proxyfejl
- et CA-bundt, der dækker **både** proxyen og `certs/`. `package.json`
  sætter allerede `NODE_EXTRA_CA_CERTS` i `dev`/`build`/`start`, og den
  værdi overskriver proxyens
- en modtagende postkasse. Der er ingen mail i en cloud-session
- `supabase.com:443` og en personal access token, hvis «Confirm email»
  skal kunne **aflæses** programmatisk. Ellers må sessionen tage et
  menneskes ord for den, og så skal det stå som en uafprøvet forudsætning
  — ikke som et grønt flueben

**Der rutes ikke uden om.** Rå TCP til `…supabase.co:443` kan faktisk
etableres uden proxy — blokeringen ligger i politikken, ikke i ruten. Et
resultat opnået den vej ville i øvrigt være ubrugeligt som dokumentation.

---

## 8 · Produktionen

**At staging er rigtigt sat op, beviser intet om produktionen.** Før
release skal «Confirm email: TIL» også aflæses i `musbnojvamcihazcljpp` —
det er dér, gaten i `docs/auth-binding.md` gælder. Læs den; ret ingenting.
