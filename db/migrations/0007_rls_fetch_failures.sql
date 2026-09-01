-- Ny tabel = RLS i samme migration. Se reglen i CLAUDE.md.
alter table "fetch_failures" enable row level security;
revoke all on "fetch_failures" from anon, authenticated;
