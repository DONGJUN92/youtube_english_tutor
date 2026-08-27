-- Cross-device accounts + learner preferences (Neon).
create table if not exists cloud_accounts (
  id text primary key,
  email text not null unique,
  name text,
  image text,
  password_salt text,
  password_hash text,
  google_sub text unique,
  created_at timestamptz not null default now()
);

create table if not exists study_starts (
  user_id text not null,
  video_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists study_starts_user_idx on study_starts (user_id);

alter table profiles add column if not exists playback_speed double precision not null default 1;
alter table profiles add column if not exists show_ko_hints boolean not null default true;
alter table profiles add column if not exists preferred_cefr text;
alter table profiles add column if not exists lessons_started integer not null default 0;
