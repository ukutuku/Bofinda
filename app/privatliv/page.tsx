export const metadata = {
  title: 'Privatlivspolitik — Bofinda',
  description: 'Hvilke oplysninger Bofinda behandler, hvorfor, og hvor længe.',
}

// Almindelig side, ikke genereret indhold. Teksten rettes her, og den er
// ejerens — ikke noget vi formulerer på hans vegne.
//
// BEMÆRK: info@bofinda.dk modtager ikke mail endnu; domænet er ikke købt.
// Politikken er først gyldig, når adressen virker. Se CLAUDE.md.
export default function Side() {
  return (
    <article className="dokument">
      <h1>Privatlivspolitik</h1>
      <p className="dato">Sidst opdateret: 3. september 2026</p>

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

      <h2>Cookies</h2>
      <p>Vi bruger ingen cookies til statistik, markedsføring eller sporing.</p>

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
        Oplysningerne slettes, når du fjerner annoncen eller din konto. Du kan
        til enhver tid rette dem under Mine annoncer.
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
