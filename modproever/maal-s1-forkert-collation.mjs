// S1 ser efter en collation, der ikke findes. De tre da-x-icu-rækker
// forsvinder stille — prøven skal se, at de mangler.
export const forventning = {
  fil: 'scripts/maalinger/skriv-bynavne-domaene-sql.ts',
  moenster: "where c.collname = 'da-x-icu'",
  traeffere: 1,
  erstat: "where c.collname = 'da-DK-x-icu'",
}
