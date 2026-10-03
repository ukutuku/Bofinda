// 0021 får et when FØR 0020's. drizzle ville springe den over i
// produktionen, uden en fejl — den anden form for tavs migration.
export const forventning = {
  fil: "db/migrations/meta/_journal.json",
  moenster: "    },\n    {\n      \"idx\": 21,\n      \"version\": \"7\",\n      \"when\": 1788811312600,\n      \"tag\": \"0021_maaling_afvisninger\",\n      \"breakpoints\": true\n    }",
  traeffere: 1,
  erstat: "    },\n    {\n      \"idx\": 21,\n      \"version\": \"7\",\n      \"when\": 1788811312500,\n      \"tag\": \"0021_maaling_afvisninger\",\n      \"breakpoints\": true\n    }",
}
