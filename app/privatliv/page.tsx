import { Valg } from './Valg'

export const metadata = {
  title: 'Privatlivspolitik — Bofinda',
  description: 'Hvilke oplysninger Bofinda behandler, hvorfor, og hvor længe.',
}

// Almindelig side, ikke genereret indhold. Teksten rettes her, og den er
// ejerens — ikke noget vi formulerer på hans vegne.
//
// ⚠ TEKSTEN SKAL BESKRIVE DET, KODEN GØR — ikke omvendt. Cookienavnene og
// levetiderne bor i lib/samtykke.ts, lib/kontovej.ts, lib/gemoenske.ts og
// lib/gemudkast.ts; fristerne bor i `ryd()` i lib/alarm.ts. Der er ikke
// noget, der måler, at de to stemmer, og det har kostet to gange: først
// blev cookielisten udvidet uden at datoen fulgte med, og siden fik
// boligsøgende konti og favoritter (Min side), uden at ét ord her blev
// rødt. Ændres en cookie, en frist eller hvad en konto kan, hører denne
// side med i SAMME ændring.
//
// info@bofinda.dk modtager mail siden 7. september 2026 — domænet er
// registreret og flyttet til Simply, som leverer indgående mail. Politikken
// er dermed gyldig. Se CLAUDE.md for hvad der skal overleve, hvis nogen
// rører DNS igen.
export default function Side() {
  return (
    <article className="dokument">
      <h1>Privatlivspolitik</h1>
      <p className="dato">Sidst opdateret: 19. september 2026</p>

      <h2>Dataansvarlig</h2>
      <p>
        Bofinda drives som et privat projekt. Spørgsmål om behandling af
        personoplysninger, indsigt, rettelse eller sletning kan rettes til{' '}
        <a href="mailto:info@bofinda.dk">info@bofinda.dk</a>.
      </p>
      <p>
        Du har ret til at klage til Datatilsynet, Carl Jacobsens Vej 35,
        2500 Valby, <a href="https://www.datatilsynet.dk">datatilsynet.dk</a>.
      </p>

      <h2>Hvilke oplysninger vi behandler</h2>
      <p>Opretter du en boligalarm, gemmer vi:</p>
      <ul>
        <li>din mailadresse</li>
        <li>
          de søgekriterier, du har valgt (postnummer, by, pris, værelser,
          areal, kilde)
        </li>
        <li>
          et navn til søgningen, så du kan kende den igen — det du selv
          skriver i feltet, eller et, vi laver af kriterierne, hvis du lader
          det stå tomt
        </li>
        <li>tidspunktet for oprettelsen og for hver besked, vi sender</li>
      </ul>
      <p>
        Vi beder ikke om dit navn, dit telefonnummer eller din adresse. En
        boligbesked opretter <strong>ingen brugerkonto</strong> — du skal
        hverken vælge en adgangskode eller logge ind for at få besked. Vil
        du derudover gemme boliger, kan du oprette en konto; det er et andet
        forløb, og det er beskrevet under <a href="#konto">Din konto og dine
        gemte boliger</a>.
      </p>
      <p>
        Bruger du kun boligsøgningen uden at oprette en alarm, og uden at
        sige ja til statistik, <strong>registrerer vi ingenting om dit
        besøg</strong>. Vores egen kode henter aldrig din IP-adresse.
        At siden overhovedet kan vises, kræver dog, at din forespørgsel når
        de servere, der leverer den, og dér kan leverandørerne have
        IP-adressen i deres egne driftslogs. Det er teknisk drift og noget
        andet end den besøgsstatistik, du selv vælger til; IP-adressen
        indgår ikke i statistikken. Siger du ja til statistik, gemmer vi to
        tilfældige numre i din browser — se afsnittet nedenfor.
      </p>

      <h2>Formål og retsgrundlag</h2>
      <p>
        Vi behandler oplysningerne for at kunne sende dig besked, når en ny
        bolig matcher dine kriterier.
      </p>
      <p>
        Retsgrundlaget er dit samtykke, jf. databeskyttelsesforordningens
        artikel 6, stk. 1, litra a. Du giver samtykke ved at bekræfte
        tilmeldingen via linket i bekræftelsesmailen, og du kan trække det
        tilbage til enhver tid ved at afmelde dig.
      </p>

      <h2>Hvor længe vi gemmer dem</h2>
      <p>Vi sletter din alarm og de tilknyttede oplysninger:</p>
      <ul>
        <li>90 dage efter du har afmeldt dig</li>
        <li>efter 30 dage, hvis du aldrig bekræftede tilmeldingen</li>
        <li>
          efter 24 måneder fra oprettelsen, medmindre du har oprettet en ny
          søgning i mellemtiden
        </li>
      </ul>

      <h2>Hvem oplysningerne deles med</h2>
      <p>Vi sælger eller udlejer ikke oplysninger til nogen.</p>
      <p>Vi bruger disse databehandlere til at drive tjenesten:</p>
      <ul>
        <li>
          Supabase (Irland) — database og fillager. Billeder, du uploader til
          en annonce, gemmes i et privat lager hos Supabase og vises kun
          gennem vores egen billedtjeneste.
        </li>
        <li>Vercel Inc. — hosting af hjemmesiden, USA</li>
        <li>Railway Corp. — kørsel af boligimporten, USA</li>
        <li>Resend (Plus Five Five, Inc.) — udsendelse af mails, USA</li>
      </ul>
      <p>
        Overførsler til USA sker på grundlag af EU-Kommissionens
        standardkontraktbestemmelser og, hvor det er relevant, EU-US Data
        Privacy Framework.
      </p>

      <h2 id="statistik">Statistik om brugen af siden</h2>
      <p>
        Vi måler, hvordan Bofinda bliver brugt, så vi kan gøre boligsøgningen
        bedre. Målingen er vores egen: den kører på vores eget domæne, og der
        er ingen tredjepart involveret. Vi bruger ikke Google Analytics eller
        lignende tjenester, og vi sælger eller deler ikke tal om din adfærd
        med nogen.
      </p>
      <p>
        <strong>Vi måler ikke, før du har sagt ja.</strong> Har du ikke
        taget stilling, eller har du sagt nej, registrerer vi ingenting om
        dit besøg — hverken med eller uden numre — og vi gemmer intet i din
        browser.
      </p>

      <Valg />

      <h3>Hvad vi registrerer, når du har sagt ja</h3>
      <p>Vi registrerer hændelser — at noget skete, ikke hvem der gjorde det:</p>
      <ul>
        <li>at forsiden blev vist, og hvilken hjemmeside du eventuelt kom fra</li>
        <li>at der blev søgt, hvilke filtre der var sat, og om de blev ændret</li>
        <li>hvor mange resultater søgningen gav, og om den gav nul</li>
        <li>at en bolig blev åbnet, og hvilken kilde den kom fra</li>
        <li>at flere ens boliger på samme vej blev foldet ud</li>
        <li>
          for en del af besøgene: hvilke boliger der nåede at blive vist i
          listen, og på hvilken plads
        </li>
        <li>
          at nogen gik videre til kilden, fik vist en udlejers
          kontaktoplysninger, eller trykkede på den viste mailadresse eller
          det viste telefonnummer
        </li>
        <li>at en boligbesked blev påbegyndt, oprettet og bekræftet</li>
        <li>at nogen oprettede en konto eller loggede ind</li>
        <li>at kortet blev brugt, og at filtrene blev foldet ud</li>
        <li>at en handling på siden fejlede — men aldrig fejlbeskeden</li>
      </ul>
      <p>
        Til hver hændelse gemmer vi kategoriske oplysninger: postnummer,
        bynavn fra vores egen liste over byer, prisinterval, antal værelser,
        boligtype, hvilken kilde boligen kom fra, og hvor mange resultater
        der var.
      </p>

      <h3>Hvad vi aldrig gemmer i statistikken</h3>
      <ul>
        <li>din mailadresse, dit navn eller dit telefonnummer</li>
        <li>det du selv har skrevet i søgefeltet eller i en formular</li>
        <li>navnet du gav din gemte søgning</li>
        <li>din adresse</li>
        <li>indholdet af beskeder</li>
        <li>din IP-adresse</li>
        <li>adgangskoder eller sikkerhedsnøgler</li>
      </ul>
      <p>
        Skriver du et bynavn, vi ikke kender, gemmer vi ikke det, du skrev —
        kun at søgningen gjaldt et sted, vi ikke kender. Som beskrevet
        ovenfor kan vores leverandører have din IP-adresse i deres egne
        driftslogs; hvor længe, er deres opbevaring og ikke noget, vi
        fastsætter. Vi henter den ikke ind i vores statistik og bruger den
        ikke til at genkende dig.
      </p>

      <h3>Genkendelse på tværs af besøg</h3>
      <p>Siger du ja til statistik, gemmer vi to tilfældige numre i din browser:</p>
      <ul>
        <li>
          et <strong>besøgsnummer</strong>, der udløber efter 30 minutters
          pause og senest efter 12 timer
        </li>
        <li>et <strong>browsernummer</strong>, der gemmes i 180 dage</li>
      </ul>
      <p>
        Numrene er tilfældige. De indeholder ingen oplysninger om dig, de kan
        ikke regnes tilbage til hverken din mailadresse eller din maskine, og
        vi kan ikke genskabe dem, hvis du sletter dem. Vi laver ikke
        fingeraftryk af din browser.
      </p>
      <p>
        Når du opretter en konto — som boligsøgende eller som udlejer —
        kobles netop den hændelse til dit
        interne bruger-id — et tilfældigt nummer i vores egen database. Dine
        øvrige besøg kobles ikke til kontoen, kun til browsernummeret. Din
        mailadresse indgår aldrig i statistikken.
      </p>

      <h3>Samtykke og tilbagetrækning</h3>
      <p>
        Retsgrundlaget for statistikken er dit samtykke, jf.
        databeskyttelsesforordningens artikel 6, stk. 1, litra a. Du kan
        trække det tilbage når som helst med knappen ovenfor eller via linket
        i sidefoden. Så sletter vi de to numre i din browser med det samme, og
        vi holder op med at registrere. Siger du ja igen senere, får du et nyt
        browsernummer — det gamle forløb kan ikke genoptages.
      </p>
      <p>
        Vil du også have slettet det, vi allerede har målt, kan du bede om det
        med knappen ovenfor. Vi ved ikke, hvem du er, men din browser bærer
        nummeret, så du kan bede om sletning uden at oplyse noget om dig selv.
      </p>

      <h3>Hvor længe vi gemmer statistikken</h3>
      <ul>
        <li>hændelser: 12 måneder</li>
        <li>oplysninger om, hvilke boliger der blev vist i en liste: 60 dage</li>
        <li>hændelser fra en brugertest: 90 dage</li>
      </ul>
      <p>
        Derefter slettes de automatisk. Vi beholder sammentalte dagstal — hvor
        mange søgninger, hvor mange visninger pr. kilde — uden numre af nogen
        art. De kan ikke føres tilbage til nogen.
      </p>

      <h3>Brugertests</h3>
      <p>
        Deltager du i en brugertest, hvor vi sidder med, tilføjer vi et
        tilfældigt holdnummer til hændelserne, så vi kan finde netop den
        session igen. Du får det at vide og trykker selv ja, før testen
        begynder. Holdnummeret er et løbenummer og siger intet om, hvem du er.
      </p>

      <h2 id="konto">Din konto og dine gemte boliger</h2>
      <p>
        Du kan oprette en konto for at gemme boliger og samle dine gemte
        søgninger ét sted. Det er frivilligt: boligsøgningen virker uden, og
        en boligbesked kræver det ikke.
      </p>
      <p>
        Adgangskoden vælger du selv, og den <strong>går gennem vores egen
        server</strong>: du skriver den i formularen, formularen sendes til
        os, og vores server sender den videre til vores databehandler
        Supabase Auth, der står for selve kontoen. Vælger du en ny
        adgangskode, tjekker vores server undervejs, at den er lang nok — og
        at de to felter er ens, dér hvor du skriver den to gange. Ved et
        almindeligt login sender den den bare videre.
      </p>
      <p>
        Vi skriver den ingen steder: hverken i vores egne tabeller, i en
        cookie eller i vores statistik. Går et login galt, registrerer vi
        kun hvilken <em>slags</em> fejl det var — «forkert login»,
        «for mange forsøg» — aldrig hvad du skrev.
      </p>
      <p>
        Supabase Auth gemmer den ikke som tekst, men som et hash: et aftryk,
        der ikke kan regnes tilbage til adgangskoden. Aftrykket ligger i den
        samme database som resten af vores data og følger med, når vi tager
        en sikkerhedskopi. <strong>Vi kan derfor ikke slå din adgangskode
        op</strong> — hverken for dig eller for andre. Har du glemt den,
        sætter du en ny gennem «Glemt adgangskode?» på loginsiden.
      </p>
      <p>Har du en konto, gemmer vi:</p>
      <ul>
        <li>din mailadresse</li>
        <li>
          et internt bruger-id og en markering af, om kontoen er oprettet som
          boligsøgende eller som udlejer
        </li>
        <li>
          tidspunktet, vi første gang oprettede en række om dig. Det er, da du
          oprettede kontoen — eller da du oprettede en boligbesked, hvis du
          havde en først
        </li>
        <li>
          for hver bolig, du gemmer: hvilken bolig det er, og hvornår du
          gemte den. Ikke hvad du har set på, og ikke hvor længe
        </li>
      </ul>
      <p>
        Retsgrundlaget er artikel 6, stk. 1, litra b: behandlingen er
        nødvendig for at levere det, du har bedt om. Uden oplysningerne kan vi
        hverken vise dig listen igen på en anden enhed eller kende den fra en
        andens.
      </p>
      <p>
        Du kan fjerne en gemt bolig igen med «Fjern» på Min side; rækken
        slettes, den bliver ikke bare skjult. Og du kan afmelde en gemt
        søgning med «Afmeld» samme sted — så holder beskederne op med det
        samme, og selve søgningen slettes 90 dage efter, som beskrevet
        ovenfor.
      </p>
      <p>
        <strong>Der er ingen knap, der sletter hele kontoen.</strong> Vil du
        have den slettet, beder du om det ved at skrive til{' '}
        <a href="mailto:info@bofinda.dk">info@bofinda.dk</a> — det er den
        samme vej som de øvrige rettigheder længere nede på siden.
      </p>
      <p>
        Havde du en boligbesked i forvejen og opretter en konto med den
        samme mailadresse, samles de to, så søgningerne står på Min side.
        Det sker kun, når Auth-serveren melder mailadressen bekræftet —
        ellers ville en fremmed kunne overtage dine søgninger ved at skrive
        din adresse.
      </p>

      <h2>Cookies</h2>
      <p>Vi bruger cookies til otte ting og ikke andet:</p>
      <ul>
        <li>
          at holde dig logget ind, når du har en konto. Det er den samme
          cookie, uanset om du søger bolig eller udlejer
        </li>
        <li>at huske, om du har sagt ja eller nej til statistik</li>
        <li>statistik, hvis du har sagt ja — de to numre beskrevet ovenfor</li>
        <li>
          holdnummeret, hvis du deltager i en brugertest. Den udløber efter
          fire timer
        </li>
        <li>
          at bære det, du lige har skrevet i «Få besked om nye boliger», med
          tilbage til formularen, hvis noget gik galt — så du kan rette det i
          stedet for at skrive det hele igen. Den indeholder kun det, du selv
          har tastet, og den udløber efter to minutter
        </li>
        <li>
          at vise dig, hvad der skete, lige før du blev sendt videre — at
          adgangskoden blev skiftet, eller at mailadressen blev bekræftet.
          Den siger hvad, aldrig hvem, og den udløber efter to minutter
        </li>
        <li>
          at vise dig, om boligen blev gemt, når du har trykket på et hjerte
          og derefter logget ind. Den bærer ikke hvilken bolig det var, og
          den udløber efter 30 sekunder
        </li>
        <li>
          Ved oprettelse af en konto eller nulstilling af adgangskoden bruger
          vi nødvendige cookies til at knytte maillinket til den browser, hvor
          du startede forløbet. De bruges ikke til statistik eller
          markedsføring og har en udløbstid på op til 400 dage.
        </li>
      </ul>
      <p>
        Ingen af dem bruges til markedsføring, og ingen af dem deles med
        nogen. Vi bruger ingen cookies fra tredjepart.
      </p>

      <h2>Boligoplysninger</h2>
      <p>
        Boligerne på Bofinda er hentet fra offentligt tilgængelige
        udlejningsportaler.
      </p>

      <h2>Udlejeres kontaktoplysninger</h2>
      <p>
        Når du opretter en annonce som udlejer, oplyser du en mailadresse og
        eventuelt et telefonnummer. Disse oplysninger vises på boligsiden,
        når en besøgende trykker &laquo;Vis kontaktoplysninger&raquo;. De står
        ikke i sidens kildekode, men de er offentligt tilgængelige for enhver,
        der trykker.
      </p>
      <p>
        Retsgrundlaget er artikel 6, stk. 1, litra b: behandlingen er
        nødvendig for at levere den tjeneste, du har bedt om. En annonce uden
        kontaktvej har ingen funktion.
      </p>
      <p>
        Fjerner du annoncen, kan en besøgende ikke længere få oplysningerne
        udleveret: forespørgslen kræver, at annoncen er aktiv. Men{' '}
        <strong>værdierne bliver stående</strong> — det er dem, annoncen får
        igen, hvis du udgiver den på ny. Vil du have dem væk, rydder du
        felterne under Mine annoncer, hvor du også til enhver tid kan rette
        dem; eller du beder os om det på{' '}
        <a href="mailto:info@bofinda.dk">info@bofinda.dk</a>.
      </p>
      <p>
        For boliger, vi henter fra andre portaler, viser vi ikke
        kontaktoplysninger. Henvendelse sker hos kilden.
      </p>

      <h2>Dine rettigheder</h2>
      <p>
        Du har ret til at få indsigt i de oplysninger, vi har om dig, at få
        dem rettet eller slettet, at få behandlingen begrænset, at gøre
        indsigelse, og at få oplysningerne udleveret i et maskinlæsbart
        format.
      </p>
      <p>
        Skriv til <a href="mailto:info@bofinda.dk">info@bofinda.dk</a>, så
        vender vi tilbage inden for en måned.
      </p>

      <h2>Ændringer</h2>
      <p>
        Vi opdaterer denne politik, hvis tjenesten ændrer sig. Ændringer
        offentliggøres på denne side med ny dato.
      </p>

      <p className="note"><a href="/">← Til boligsøgningen</a></p>
    </article>
  )
}
