-- Shared timed captions so Vercel can reuse a successful YouTube fetch.
create table if not exists video_captions (
  video_id text primary key,
  source text not null,
  title text,
  duration_sec double precision not null default 0,
  captions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
