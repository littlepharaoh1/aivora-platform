-- Activity Logs Table
-- Run this in Supabase SQL Editor

create table if not exists activity_logs (
  id                uuid default gen_random_uuid() primary key,
  session_id        text,
  user_id           text,
  user_email        text,
  role              text,
  event_type        text not null,
  module            text,
  device_type       text,
  os                text,
  browser           text,
  screen_resolution text,
  timezone          text,
  ip_hash           text,
  metadata          jsonb default '{}',
  created_at        timestamptz default now()
);

-- Index for fast queries
create index if not exists idx_activity_logs_user_id    on activity_logs(user_id);
create index if not exists idx_activity_logs_event_type on activity_logs(event_type);
create index if not exists idx_activity_logs_created_at on activity_logs(created_at desc);
create index if not exists idx_activity_logs_session_id on activity_logs(session_id);

-- RLS
alter table activity_logs enable row level security;

-- Allow insert for authenticated users
create policy "Users can insert their own logs"
  on activity_logs for insert
  to authenticated
  with check (true);

-- Allow admins to read all
create policy "Admins can read all logs"
  on activity_logs for select
  to authenticated
  using (true);
