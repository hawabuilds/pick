-- Pick — first-run onboarding, and the fields the adoption story is told from.
--
-- The claim this product makes is "we turned people with no crypto knowledge
-- into real-world-asset holders, worldwide". These three columns are what make
-- that claim measurable rather than rhetorical.

alter table public.users
  -- Set when a new player is first sent into the guide on the Learn tab. Until
  -- then they are routed there rather than dropped on the dashboard. Whether
  -- they went on to finish it is learner_progress.tasks_done.
  add column if not exists onboarded_at timestamptz,
  -- Whether the browser already had a wallet extension at first login. A proxy
  -- for "already in crypto", captured once at signup because it stops being
  -- true the moment we hand them an embedded wallet. Null means unknown, which
  -- is treated as neither new nor existing rather than guessed at.
  add column if not exists had_wallet_at_signup boolean,
  -- Two-letter country from the edge at first login. Coarse by design: it
  -- answers "how many countries" without storing anything finer than that.
  add column if not exists signup_country text;

create index if not exists users_onboarded_idx
  on public.users (onboarded_at)
  where onboarded_at is not null;

create index if not exists users_country_idx
  on public.users (signup_country)
  where signup_country is not null;
