-- Pick — resolution results.
--
-- Scores alone are not auditable: if a player disputes a call, or a data
-- provider revises a close, you need the exact prices the job scored against.
-- One row per ticker per resolved slate, written once by the resolution job.

create table if not exists public.slate_results (
  slate_date  date not null references public.daily_slates (slate_date) on delete cascade,
  ticker      text not null references public.stocks (ticker),
  close       numeric(14, 4) not null,
  prev_close  numeric(14, 4) not null,
  -- 'flat' means the close matched the prior close exactly. Neither call is
  -- right, so picks on that ticker score nothing rather than being awarded to
  -- whichever direction we happened to round towards.
  direction   text not null check (direction in ('up', 'down', 'flat')),
  source      text not null,
  resolved_at timestamptz not null default now(),
  primary key (slate_date, ticker)
);

create index if not exists slate_results_slate_idx on public.slate_results (slate_date);

alter table public.slate_results enable row level security;

drop policy if exists results_read on public.slate_results;
create policy results_read on public.slate_results
  for select to authenticated using (true);

-- Records which slate a streak was last evaluated against, so a job that runs
-- twice cannot double-count a day.
alter table public.streaks
  add column if not exists last_resolved_date date;

-- Lets the resolution job find every player who has ever submitted, in order to
-- reset or freeze the streaks of those who sat a day out.
create index if not exists submissions_user_idx on public.submissions (user_id);
