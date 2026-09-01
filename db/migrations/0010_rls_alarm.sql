-- Ny tabel = RLS i samme migration. Se reglen i CLAUDE.md.
alter table "alert_matches" enable row level security;
revoke all on "alert_matches" from anon, authenticated;
