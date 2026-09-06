# Besked til CEJ om persondata i den offentlige boligpayload

Udkast, 6. september 2026. Faktuel orientering — ingen krav, intet ultimatum.
Sendes til `bolig@cej.dk` (afdelingsadressen i deres egen payload) eller til
kontakten fra telefonsamtalen, jf. `docs/kildetilladelser.md`.

---

**Emne:** Personoplysninger i den offentlige boligliste på udlejning.cej.dk

Hej [navn]

Vi henter jeres ledige boliger til Bofinda efter aftalen fra vores telefonsamtale,
og i den forbindelse er vi stødt på noget, vi tænker, I bør vide.

Boligoversigten på udlejning.cej.dk sender boligdataene med i selve HTML-siden,
og den datablok indeholder flere felter end dem, der vises på siden. Blandt dem er
oplysninger om private personer:

- et `tenant`-felt med navn og privat e-mailadresse på den nuværende lejer
  (til stede på 24 af de 63 boliger, vi kunne se den 6. september)
- et `reservation.lead`-felt med navn, e-mail og telefonnummer på boligsøgende,
  der har henvendt sig (27 af 63)

Felterne er ikke synlige på siden, men de ligger i kildekoden og kan læses af
enhver, der åbner den — der skal ikke login eller særlige værktøjer til.

Vi vil gerne understrege, at vi ikke gemmer, viser eller på anden måde bruger de
felter. Vores importer læser kun de boligoplysninger, vi har brug for til
annoncen — adresse, husleje, aconto, depositum, forudbetalt leje, areal, status,
overtagelsesdato og billeder — og resten kasseres, før noget skrives ned hos os.
Vi har lagt en fast prøve ind i vores kode, der fejler, hvis den slags felter
nogensinde skulle slippe igennem.

Vi har ikke gemt eksempler på de konkrete personoplysninger, og vi sender dem
naturligvis ikke videre. Skulle I have brug for at se præcis, hvor i svaret
felterne optræder, hjælper vi gerne med at pege på det.

Da systemet leveres af bolig.io, er det formentlig dem, der skal rette det, men vi
tænkte, det var mest naturligt at sige det til jer først.

Sig endelig til, hvis vi kan uddybe.

Venlig hilsen
[navn], Bofinda
[kontakt]
