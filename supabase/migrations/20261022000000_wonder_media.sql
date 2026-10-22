-- Virtual-tour footage per wonder.
-- media = { video, fallback, credit, license, source, start, note }
--   video:    direct .webm/.mp4 URL (~30 s loop). Wikimedia Commons URLs allow the colour-morph (CORS).
--   fallback: .mp4/.mov for Safari / iPhone
--   credit/license/source: attribution shown on screen (required for CC BY / BY-SA)
alter table public.wonders add column if not exists media jsonb not null default '{}'::jsonb;
