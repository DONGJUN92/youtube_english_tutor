-- YouTube player duration and ASR timestamps are fractional (e.g. 340.32).
-- node-postgres sends params as text, so INTEGER columns reject that string.
-- 0004 declared duration_sec as double precision, but CREATE TABLE IF NOT EXISTS
-- left an older integer column in place.
alter table video_captions
  alter column duration_sec type double precision
  using duration_sec::double precision;

alter table vocab_saves
  alter column clip_start type double precision
  using clip_start::double precision;

alter table vocab_saves
  alter column clip_end type double precision
  using clip_end::double precision;

alter table clip_bookmarks
  alter column start_sec type double precision
  using start_sec::double precision;

alter table clip_bookmarks
  alter column end_sec type double precision
  using end_sec::double precision;
