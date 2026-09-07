create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_events_status_check
    check (status in ('pending', 'sent', 'failed'))
);

create index if not exists email_events_recipient_email_idx
on public.email_events (recipient_email);

create index if not exists email_events_event_type_idx
on public.email_events (event_type);

alter table public.email_events enable row level security;

revoke all on public.email_events from anon;
revoke all on public.email_events from authenticated;
grant select, insert, update on public.email_events to service_role;
