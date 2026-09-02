export const metadata = {
  title: 'Privatlivspolitik — Bofinda',
  description: 'Hvilke oplysninger Bofinda behandler, hvorfor, og hvor længe.',
}

// Almindelig side, ikke genereret indhold. Teksten rettes her.
// Felterne i [kantede parenteser] skal udfyldes før siden er offentlig —
// se `.udfyld` i globals.css, som gør dem synlige.
export default function Side() {
  return (
    <article className="dokument">
      <h1>Privatlivspolitik</h1>
      <p className="dato">Sidst opdateret: 2. september 2026</p>

      <h2>Dataansvarlig</h2>
      <p>
        <span className="udfyld">[DIT NAVN / VIRKSOMHEDSNAVN]</span><br />
        <span className="udfyld">[CVR-NR, hvis relevant]</span><br />
        <span className="udfyld">[KONTAKTMAIL]</span>
      </p>

      <h2>Hvilke oplysninger vi behandler</h2>
      <p>Opretter du en boligalarm, gemmer vi:</p>
      <ul>
        <li>din mailadresse</li>
        <li>
          de søgekriterier, du har valgt (postnummer, by, pris, værelser,
          areal, kilde)
        </li>
        <li>tidspunktet for oprettelsen og for hver besked, vi sender</li>
      </ul>
      <p>
        Vi beder ikke om navn, telefonnummer eller adresse, og vi opretter
        ingen brugerkonto.
      </p>
      <p>
        Bruger du kun boligsøgningen uden at oprette en alarm, behandler vi
        ingen personoplysninger om dig.
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
        <li>Supabase Inc. — database, hostet i EU (Irland)</li>
        <li>Vercel Inc. — hosting af hjemmesiden, USA</li>
        <li>Railway Corp. — kørsel af boligimporten, USA</li>
        <li>Resend (Plus Five Five, Inc.) — udsendelse af mails, USA</li>
      </ul>
      <p>
        Overførsler til USA sker på grundlag af EU-Kommissionens
        standardkontraktbestemmelser og, hvor det er relevant, EU-US Data
        Privacy Framework.
      </p>

      <h2>Cookies</h2>
      <p>Vi bruger ingen cookies til statistik, markedsføring eller sporing.</p>

      <h2>Boligoplysninger</h2>
      <p>
        Boligerne på Bofinda er hentet fra offentligt tilgængelige
        udlejningsportaler. Vi viser ikke udlejeres eller nuværende lejeres
        kontaktoplysninger. Henvendelse om en bolig sker hos kilden.
      </p>

      <h2>Dine rettigheder</h2>
      <p>
        Du har ret til at få indsigt i de oplysninger, vi har om dig, at få
        dem rettet eller slettet, at få behandlingen begrænset, at gøre
        indsigelse, og at få oplysningerne udleveret i et maskinlæsbart
        format.
      </p>
      <p>
        Skriv til <span className="udfyld">[KONTAKTMAIL]</span>, så vender vi
        tilbage inden for en måned.
      </p>
      <p>
        Er du utilfreds med vores behandling, kan du klage til Datatilsynet,
        Carl Jacobsens Vej 35, 2500 Valby,{' '}
        <a href="mailto:dt@datatilsynet.dk">dt@datatilsynet.dk</a>.
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
