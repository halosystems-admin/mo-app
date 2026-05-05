-- Allow the same Supabase patient row to appear on multiple ward boards (one per workspace).
-- Required after 007 adds board_entries.workspace_id.

alter table public.board_entries
  drop constraint if exists board_entries_patient_id_key;

create unique index if not exists board_entries_patient_workspace_uidx
  on public.board_entries (patient_id, workspace_id);
