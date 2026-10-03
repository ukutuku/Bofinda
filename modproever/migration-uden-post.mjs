// 0021's journalpost fjernes. Filen ligger der stadig og ville aldrig blive
// kørt — hverken af testbasen eller af drizzle-kit i produktionen.
export const forventning = {
  fil: "db/migrations/meta/_journal.json",
  moenster: "    },\n    {\n      \"idx\": 21,\n      \"version\": \"7\",\n      \"when\": 1788811312600,\n      \"tag\": \"0021_maaling_afvisninger\",\n      \"breakpoints\": true\n    }",
  traeffere: 1,
  erstat: "    }",
}
