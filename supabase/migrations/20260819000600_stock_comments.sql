-- Per-ticker comment threads on stock detail sheets.

create table public.stock_comments (
  id          uuid primary key default gen_random_uuid(),
  ticker      text not null references public.stocks (ticker),
  user_id     uuid not null references public.users (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index stock_comments_ticker_created_idx
  on public.stock_comments (ticker, created_at desc);

alter table public.stock_comments enable row level security;

drop policy if exists stock_comments_read on public.stock_comments;
create policy stock_comments_read on public.stock_comments
  for select to authenticated, anon using (true);

drop policy if exists stock_comments_insert_self on public.stock_comments;
create policy stock_comments_insert_self on public.stock_comments
  for insert to authenticated
  with check (user_id = app.current_user_id());
