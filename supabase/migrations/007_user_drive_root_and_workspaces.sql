-- Per-user OneDrive root folder + workspace-scoped ward boards.
--
-- Goal:
-- - Each app user can default into a specific OneDrive root folder (e.g. 'Halo_Patients' or 'Henk Kruger')
-- - Ward board (Supabase backend) can be scoped per workspace so switching workspaces swaps wards cleanly

alter table public.app_users
  add column if not exists drive_root_folder_name text;

comment on column public.app_users.drive_root_folder_name is
  'OneDrive root folder name for this user. When null, defaults to Halo_Patients.';

alter table public.board_entries
  add column if not exists workspace_id text not null default 'halo_patients';

create index if not exists idx_board_entries_workspace
  on public.board_entries (workspace_id, ward_column_id, sort_order);

