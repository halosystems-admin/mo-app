-- Tags on ward board patient entries (Supabase path only).
alter table public.board_entries
  add column if not exists tags text[] not null default '{}';

comment on column public.board_entries.tags is 'Ward card tags (seen, unseen, custom); max length enforced in app';
