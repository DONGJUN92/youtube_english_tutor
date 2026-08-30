alter table cloud_accounts add column if not exists x_sub text unique;
alter table watch_progress add column if not exists level_delta smallint not null default 0;
alter table clip_bookmarks add column if not exists review_at timestamptz;
alter table vocab_saves add column if not exists example_text text;
