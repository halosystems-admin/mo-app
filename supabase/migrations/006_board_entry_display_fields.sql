-- Optional ward-board display fields per patient card (Supabase path).
alter table public.board_entries
  add column if not exists bed text,
  add column if not exists ward_label text,
  add column if not exists notes text;

comment on column public.board_entries.bed is 'Optional bed label shown on ward board (may differ from Hospital Sheets)';
comment on column public.board_entries.ward_label is 'Optional ward/site label for the board card';
comment on column public.board_entries.notes is 'Short ward-board notes for this admission';
