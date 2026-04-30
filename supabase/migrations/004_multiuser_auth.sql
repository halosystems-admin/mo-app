-- Multi-user auth: users, invites, shared OAuth tokens, and persistent sessions.
--
-- NOTE: This app uses its own credential store (NOT Supabase Auth).
-- DEV-ONLY RLS: anon/authenticated roles have full access (mirrors existing migrations).

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- app_users — email/password users for the web app
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  password_hash text not null,
  first_name text not null default '',
  last_name text not null default '',
  role text not null check (role in ('admin', 'user')),
  halo_user_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists idx_app_users_role on public.app_users (role);
create index if not exists idx_app_users_active on public.app_users (is_active);

-- ---------------------------------------------------------------------------
-- app_invites — one-time invite tokens (hash stored, raw token only in link)
-- ---------------------------------------------------------------------------
create table if not exists public.app_invites (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  role text not null check (role in ('admin', 'user')),
  first_name text not null default '',
  last_name text not null default '',
  halo_user_id text,
  token_hash text not null unique,
  invited_by uuid references public.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz
);

create index if not exists idx_app_invites_email on public.app_invites (email);
create index if not exists idx_app_invites_expires on public.app_invites (expires_at);
create index if not exists idx_app_invites_accepted on public.app_invites (accepted_at);

-- ---------------------------------------------------------------------------
-- app_oauth_tokens — shared provider tokens (Mo's Microsoft refresh token)
-- ---------------------------------------------------------------------------
create table if not exists public.app_oauth_tokens (
  provider text primary key,
  access_token text,
  refresh_token text,
  expiry timestamptz,
  account_email text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- session — connect-pg-simple compatible sessions table
-- ---------------------------------------------------------------------------
create table if not exists public.session (
  sid varchar not null primary key,
  sess json not null,
  expire timestamptz not null
);

create index if not exists idx_session_expire on public.session (expire);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuse existing function if present)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_proc
    where proname = 'set_updated_at' and pronamespace = 'public'::regnamespace
  ) then
    create or replace function public.set_updated_at()
    returns trigger
    language plpgsql
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end;
$$;

drop trigger if exists app_users_updated_at on public.app_users;
create trigger app_users_updated_at
  before update on public.app_users
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — TEMPORARY DEV POLICIES (anon full access)
-- ---------------------------------------------------------------------------
alter table public.app_users enable row level security;
alter table public.app_invites enable row level security;
alter table public.app_oauth_tokens enable row level security;
alter table public.session enable row level security;

-- DEV ONLY — remove before production
create policy "dev_anon_all_app_users"
  on public.app_users for all to anon
  using (true) with check (true);

create policy "dev_anon_all_app_invites"
  on public.app_invites for all to anon
  using (true) with check (true);

create policy "dev_anon_all_app_oauth_tokens"
  on public.app_oauth_tokens for all to anon
  using (true) with check (true);

create policy "dev_anon_all_session"
  on public.session for all to anon
  using (true) with check (true);

-- Authenticated role (future): mirror policies or tighten separately
create policy "dev_authenticated_all_app_users"
  on public.app_users for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_app_invites"
  on public.app_invites for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_app_oauth_tokens"
  on public.app_oauth_tokens for all to authenticated
  using (true) with check (true);

create policy "dev_authenticated_all_session"
  on public.session for all to authenticated
  using (true) with check (true);

