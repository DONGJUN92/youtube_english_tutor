alter table watch_progress add column if not exists first_seen_at timestamptz;
update watch_progress set first_seen_at = coalesce(first_seen_at, updated_at) where first_seen_at is null;
