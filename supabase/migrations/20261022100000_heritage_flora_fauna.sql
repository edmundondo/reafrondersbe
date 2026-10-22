-- Heritage sites, flora and fauna join the atlas; species carry a scientific name; every
-- wonder can list its sources. (Function-free on purpose: safe to paste or run via MCP.)
alter table public.wonders drop constraint if exists wonders_category_check;
alter table public.wonders add constraint wonders_category_check check (category in
  ('waterfall','mountain','gorge','rock','cave','wetland','river','lake','forest','desert','savanna','coast','volcano','landform','heritage','flora','fauna'));
alter table public.wonders add column if not exists scientific_name text;
alter table public.wonders add column if not exists citations jsonb not null default '[]'::jsonb;
-- media may now also hold { images: [{url, credit, license, source}] } — a photo "virtual camera" loop
comment on column public.wonders.media is '{video, fallback, images:[{url,credit,license,source}], credit, license, source, start, note}';
