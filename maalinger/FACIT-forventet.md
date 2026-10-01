# Facit — skrevet FØR målingen kørte

Dette er, hvad jeg forventer, at `maalinger/traef-paa-nedtagne.mjs`
svarer, når den kører den genererede SELECT mod PGlite med sit eget
forlæg. Skrevet ned først, så et sammenfald ikke kan læses som et bevis
bagefter.

## Forlægget (6 træf)

Gemte søgninger:

| | bekræftet | notify_email | afmeldt |
|---|---|---|---|
| S1 | ja | true | nej |
| S2 | ja | **false** | nej |
| S3 | **nej** | true | nej |

Boliger:

| | status | delisted_at |
|---|---|---|
| L_aktiv | active | — |
| L_ned_efter | delisted | EFTER træffet |
| L_ned_foer | delisted | FØR træffet |
| L_ned_sendt | delisted | efter |

Træf:

| | søgning | bolig | sent_at | matched_at alder |
|---|---|---|---|---|
| M1 | S1 | L_aktiv | null | 10 t |
| M2 | S1 | L_ned_efter | null | 30 t |
| M3 | S1 | L_ned_foer | null | 5 t |
| M4 | S1 | L_ned_sendt | **sat** | 50 t |
| M5 | S2 | L_ned_efter | null | 20 t |
| M6 | S3 | L_ned_efter | null | 40 t |

## Forventet svar

Populationen er appens egen `ventende()`-betingelse
(`sent_at is null and confirmed_at is not null`) PLUS `status <> 'active'`.

| kolonne | forventet | hvorfor |
|---|---|---|
| `traef` | **3** | M2, M3, M5. M1 er aktiv, M4 er sendt, M6 er ubekræftet. |
| `soegninger` | **2** | S1 og S2 |
| `boliger` | **2** | L_ned_efter og L_ned_foer |
| `kan_mailes` | **2** | M2 og M3. M5 hører til S2, hvor mail er slået fra — `ventende()` filtrerer det IKKE, `sendAlarmer` afviser det senere. |
| `ned_efter_traef` | **2** | M2 og M5 (`delisted_at > matched_at`). M3 blev taget ned FØR træffet. |
| `aeldste_timer` | **30** | M2 |
| `nyeste_timer` | **5** | M3 |
| `median_timer` | **20** | median af {5, 20, 30} |
| `traef_i_alt` | **4** | hele køen uanset status: M1, M2, M3, M5 |

## Hvad et afvigende svar ville betyde

- `traef = 4` → status-leddet virker ikke (M1 kom med).
- `traef = 4` med `traef_i_alt = 4` → begge led virker ikke.
- `traef = 2` → ét af de bekræftede blev tabt; join'en er for stram.
- `kan_mailes = 3` → `notify_email` læses ikke.
- `ned_efter_traef = 3` → sammenligningen af de to tidspunkter er vendt
  om eller mangler.
