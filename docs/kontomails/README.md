# Kontomails

Skabelonerne til Supabase Auths mails. **Filerne her er kilden,
dashboardet er kopien.** Skal en tekst ændres, ændres den her først og
indsættes derefter — ellers findes der to udgaver, og ingen ved hvilken
der er sendt.

| Fil | Supabase-skabelon | Status |
|---|---|---|
| `bekraeft-signup.html` | Authentication → Emails → **Confirm signup** | klar til indsættelse, **ikke aktiveret** |

Ingen af dem er sat ind i noget miljø. Se aktiveringen nederst.

## Emnelinje

Confirm signup:

```
Velkommen til BOFINDA — bekræft din mailadresse
```

## Hvad der ikke må ændres

- **`{{ .ConfirmationURL }}`.** Det er selve bekræftelseslinket, og det
  står to steder: på knappen og som kopierbar adresse nedenunder. Begge
  skal være den samme værdi. Erstattes den med `{{ .Token }}` eller
  `{{ .TokenHash }}`, taler mailen et andet forløb end appen, og
  vekslingen i `app/auth/callback/route.ts` knækker.
- **Ingen returadresse skrevet ind.** Hverken staging eller produktion.
  Målet kommer fra `emailRedirectTo`, som `tilmeld()` bygger af
  `NEXT_PUBLIC_BASE_URL` gennem `callbackUrl()` i `lib/kontovej.ts`.
  Skrives en adresse ind i mailen, lander alle miljøer samme sted.
- **Ingen sporing.** Ingen pixel, ingen omdirigerede links, ingen
  eksterne filer. Privatlivspolitikken lover, at vi ikke måler åbninger
  og klik, og en skabelon, der gør det, ville gøre løftet usandt.

## Mærket er tekst, ikke et billede

**BOFINDA har ingen logofil.** Der er ingen `.svg`, `.png` eller anden
billedfil i repoet og ingen `public/`-mappe; mærket på hjemmesiden er
sat med CSS — `bo` i `--tekst` og `finda` i `--accent`, se `.maerke` i
`app/globals.css`. Mailen gengiver præcis det, med de samme to farver,
som tekst.

Det er ikke en nødløsning, det er det rigtige valg her: en mail skal
kunne læses uden billeder, og de fleste mailprogrammer blokerer dem som
standard for en afsender, modtageren ikke har skrevet til før.

**Skal der en dag et rigtigt logo i mailen, mangler to ting**, og ingen
af dem findes i dag:

1. selve billedfilen i et format og en opløsning, der holder på et
   retina-display (2× PNG eller SVG med PNG-fallback), og
2. en **offentligt tilgængelig** vært til den, som holder så længe
   mailen kan ligge i en indbakke.

Vercel-previewet duer ikke som billedvært: det er beskyttet, adressen
skifter med grenen, og et deploy kan forsvinde. `/api/billede` duer
heller ikke — den signerer og tjekker værter for boligbilleder fra
kilderne og har ingen plads til vores eget mærke. Indtil begge dele
findes, står mærket som tekst.

## Værd at vide, før den aktiveres

- **Mailskannere henter links.** Nogle firmamailsystemer åbner hvert
  link i en mail for at tjekke det. Et bekræftelseslink kan kun bruges
  én gang, så en skanner kan nå at bruge det først. Brugeren får da
  «Linket virkede ikke» på landingssiden — med den rigtige vej videre:
  log ind, hvis kontoen allerede er bekræftet, ellers opret igen for et
  nyt link. Det er en egenskab ved engangslinks, ikke en fejl i
  skabelonen, og den løses ikke i mailen.
- **Ingen velkomstmail efter klikket.** Kvitteringen står på
  hjemmesiden, ikke i en mail mere. Se nedenfor.
- **Skabelonen er kontrolleret som layout, ikke som levering.** Den er
  gengivet i Chromium på 1280 og 390 px bredde. Det er en
  layoutkontrol — ikke bevis for, hvordan Outlook, Gmail eller Apple
  Mail gengiver den, og ikke bevis for at en mail overhovedet bliver
  leveret.

## Kvitteringen på hjemmesiden hører sammen med mailen

Når linket er vekslet, sætter `app/auth/callback/route.ts` en kvittering
(`bofinda_kvittering=bekraeftet`, HttpOnly, to minutter), og
landingssiden viser:

> **Din mailadresse er bekræftet. Velkommen til BOFINDA.**

Resten af beskeden afhænger af, hvad siden selv kan se: er hun logget
ind, står der hvad hun kan gøre nu; er hun ikke, står der at hun skal
logge ind. Kvitteringen giver ingen adgang — den siger kun, hvad
serveren nåede at gøre.

Kunne linket ikke veksles, sættes ingen kvittering, og siden siger det
ligeud i stedet for at byde velkommen.

## Aktivering på staging — når nogen beslutter det

**Intet af dette er gjort.** Rækkefølgen er:

1. Åbn Supabase-projektet **Bofinda Staging** (`prgmenbwabwkgitjclrj`)
   → Authentication → Emails → **Confirm signup**.
2. Gem den nuværende skabelon og det nuværende emne et sted først. Der
   er ingen fortryd-knap, og standardskabelonen er ikke i repoet.
3. Indsæt emnelinjen ovenfor og hele indholdet af
   `bekraeft-signup.html`.
4. Send **én** prøvebekræftelse til en adresse, I selv ejer, og se
   mailen i mindst ét mobilt og ét desktop-mailprogram.
5. Klik linket, og se at landingssiden viser kvitteringen.

Rør ikke Site URL, Redirect URLs, «Confirm email», SMTP eller
Vercel-indstillinger i samme omgang. Skifter flere ting på én gang, kan
en fejl ikke henføres til noget.

Produktionen er en **særskilt** beslutning og en særskilt indsættelse.
