-- HALO ward core schema — run in Supabase SQL Editor (or supabase db push).
--
-- DEV-ONLY RLS: anon role has full access. Replace with auth.uid() (or workspace_id)
-- policies before production. See policy comments below.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- patients — Supabase source of truth; halo_patient_id bridges Drive/Graph folder id
-- ---------------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  halo_patient_id text unique,
  full_name text not null,
  dob text,
  sex text check (sex is null or sex in ('M', 'F')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_patients_halo_patient_id on public.patients (halo_patient_id)
  where halo_patient_id is not null;

comment on column public.patients.halo_patient_id is 'HALO folder / Patient.id from Drive or OneDrive; nullable for future non-folder patients';

-- ---------------------------------------------------------------------------
-- ward_columns — DB-driven board lanes (seed matches client fallback order)
-- ---------------------------------------------------------------------------
create table public.ward_columns (
  id text primary key,
  label text not null,
  sort_order int not null
);

-- ---------------------------------------------------------------------------
-- board_entries — one row per patient on the board (one column at a time)
-- ---------------------------------------------------------------------------
create table public.board_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  ward_column_id text not null references public.ward_columns (id) on delete restrict,
  admitted boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id)
);

create index idx_board_entries_column_sort on public.board_entries (ward_column_id, sort_order);

-- ---------------------------------------------------------------------------
-- ward_tasks — tasks on a patient card; status open|done maps UI To do|Done
-- ---------------------------------------------------------------------------
create table public.ward_tasks (
  id uuid primary key default gen_random_uuid(),
  board_entry_id uuid not null references public.board_entries (id) on delete cascade,
  title text not null,
  status text not null check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ward_tasks_board_entry on public.ward_tasks (board_entry_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger patients_updated_at
  before update on public.patients
  for each row execute procedure public.set_updated_at();

create trigger board_entries_updated_at
  before update on public.board_entries
  for each row execute procedure public.set_updated_at();

create trigger ward_tasks_updated_at
  before update on public.ward_tasks
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed ward columns (ids must stay stable for FK references; labels can change in UI reload)
-- ---------------------------------------------------------------------------
insert into public.ward_columns (id, label, sort_order) values
  ('icu', 'ICU', 0),
  ('f', 'F ward', 1),
  ('s', 'S ward', 2),
  ('m', 'Medical', 3),
  ('paeds', 'Paediatrics', 4),
  ('ed', 'Emergency', 5),
  ('labour', 'Labour', 6)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security — TEMPORARY DEV POLICIES (anon full access)
-- TODO: Replace with e.g. using (auth.uid() = owner_id) after Supabase Auth + owner_id column.
-- ---------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.ward_columns enable row level security;
alter table public.board_entries enable row level security;
alter table public.ward_tasks enable row level security;

-- DEV ONLY — remove before production
create policy "dev_anon_all_patients"
  on public.patients for all to anon
  using (true) with check (true);

create policy "dev_anon_all_ward_columns"
  on public.ward_columns for all to anon
  using (true) with check (true);

create policy "dev_anon_all_board_entries"
  on public.board_entries for all to anon
  using (true) with check (true);

create policy "dev_anon_all_ward_tasks"
  on public.ward_tasks for all to anon
  using (true) with check (true);

-- Authenticated role (future): mirror policies or tighten separately
create policy "dev_authenticated_all_patients"
  on public.patients for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_ward_columns"
  on public.ward_columns for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_board_entries"
  on public.board_entries for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_ward_tasks"
  on public.ward_tasks for all to authenticated
  using (true) with check (true);
