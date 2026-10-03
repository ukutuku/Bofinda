// ═══════════════════════════════════════════════════════════════
//  Tallene i båndets kort («Talt i dag»): forsidetal() fra lib/soeg.ts,
//  gennem en read-only-forbindelse med NAVNGIVET mål (laast-base.mjs).
//  Afløser kommandoen, der stod i greb/forsidetal.sql: den navngav ikke
//  sit mål, havde ingen read-only-session og gjorde, som den stod,
//  ingenting (tsx' --tsconfig slugte -e).
//
//  Fra roden af en checkout af main — den kode, produktionen kører:
//
//      ROD=$PWD npx tsx --tsconfig tsconfig.scripts.json --env-file=.env \
//        <sti>/maal-forsidetal.mjs --maal prod
//
//  Mod testbasen: source scripts/cloud/miljoe.sh; export
//  DATABASE_URL_DIRECT="$(test_url)", og --maal test, uden --env-file.
//  Første linje er målet (vært, base, --maal og kodens commit) og
//  read-only; sidste linje gentager read-only og at forbindelsen er den
//  samme. Exit 3 ved et mål, der ikke svarer til navnet.
// ═══════════════════════════════════════════════════════════════
const ROD = process.env.ROD
if (!ROD) { console.error('ROD mangler (roden af checkout’en).'); process.exit(2) }
const laas = await (await import('./laast-base.mjs')).laastBase(ROD)
process.stdout.write(`mål: ${laas.navn} · read-only: ${await laas.laast()}\n`)
const { forsidetal } = await import(`${ROD}/lib/soeg.ts`)
process.stdout.write(JSON.stringify(await forsidetal(), null, 1) + '\n')
process.stdout.write(`read-only til sidst, samme forbindelse: ${await laas.afslut()}\n`)
process.exit(0)
