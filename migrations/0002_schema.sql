-- TubeShadow per-user learning data
create table if not exists profiles (
  user_id text primary key,
  locale text not null default 'ko',
  age_band text not null default 'adult',
  display_name text,
  cefr_level text,
  listening_score integer,
  speaking_score integer,
  placement_completed_at timestamptz,
  placement_path jsonb,
  openai_key_enc text,
  openai_model text not null default 'gpt-4.1-mini',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lessons (
  id text primary key,
  user_id text not null,
  video_id text not null,
  skill text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists lessons_user_video_idx on lessons (user_id, video_id);

create table if not exists vocab_saves (
  id serial primary key,
  user_id text not null,
  video_id text,
  word text not null,
  meaning_ko text,
  meaning_en text,
  ipa text,
  clip_start integer,
  clip_end integer,
  created_at timestamptz not null default now()
);
create index if not exists vocab_saves_user_idx on vocab_saves (user_id);

create table if not exists clip_bookmarks (
  id serial primary key,
  user_id text not null,
  video_id text not null,
  start_sec integer not null,
  end_sec integer not null,
  note text,
  caption text,
  created_at timestamptz not null default now()
);
create index if not exists clip_bookmarks_user_idx on clip_bookmarks (user_id);

create table if not exists watch_progress (
  user_id text not null,
  video_id text not null,
  position_sec integer not null default 0,
  title text,
  thumbnail text,
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists speaking_attempts (
  id serial primary key,
  user_id text not null,
  lesson_id text,
  video_id text,
  target text not null,
  transcript text not null,
  accuracy integer not null,
  created_at timestamptz not null default now()
);
create index if not exists speaking_attempts_user_idx on speaking_attempts (user_id);
