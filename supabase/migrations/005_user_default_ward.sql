-- Per-user default ward board column (for post-login focus on mobile + navigation).
-- References public.ward_columns from 001_ward_core.sql.

alter table public.app_users
  add column if not exists default_ward_column_id text
  references public.ward_columns (id) on delete set null;

comment on column public.app_users.default_ward_column_id is
  'Ward board column to open by default after sign-in (e.g. m, f, s).';
