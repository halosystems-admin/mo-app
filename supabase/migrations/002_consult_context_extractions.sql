-- Structured Smart Context (Gemini vision) — optional Supabase mirror when service role is configured.

create table if not exists public.consult_context_extractions (
  id uuid primary key default gen_random_uuid(),
  halo_patient_id text not null,
  drive_file_id text,
  file_name text,
  summary_markdown text,
  extracted_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_consult_context_halo_patient
  on public.consult_context_extractions (halo_patient_id);

comment on table public.consult_context_extractions is 'Gemini structured Smart Context for clinical images; halo_patient_id matches Drive folder id';
