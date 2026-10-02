// Migrationen glemmer RLS på tællerens tabel. Rettighedskontrollen i
// test-redigering.ts skal fange det i testbasen.
export const forventning = {
  fil: "db/migrations/0021_maaling_afvisninger.sql",
  moenster: "alter table \"maaling_afvisninger\" enable row level security;\n--> statement-breakpoint\nrevoke all on \"maaling_afvisninger\" from anon, authenticated;\n",
  traeffere: 1,
  erstat: "",
}
