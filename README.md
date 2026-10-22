# reafrondersbe — Supabase backend for ReAfronders

The database behind **[ReAfronders](https://github.com/edmundondo/reafronders)**, a living, generative atlas of Africa's natural wonders.

> **Analogy:** if the website is the club, this repo is the record crate and the mixer settings.
> `countries` = crates · `wonders` = the records inside · `presentation` = the mixer's saved knob positions · `editors` = who's allowed behind the decks.

## What's inside

| Path | What it is |
|---|---|
| `supabase/migrations/20261021000000_wonders_schema.sql` | Tables, triggers and Row Level Security |
| `data/seed.json` | **The source of truth** for content: edit this to add countries and wonders |
| `scripts/build-seed.mjs` | Turns `seed.json` → `supabase/seed.sql` |
| `supabase/seed.sql` | Generated insert/upsert statements (safe to run repeatedly) |
| `supabase/migrations/20261022000000_wonder_media.sql` | Adds `wonders.media` (virtual-tour footage + attribution) |
| `supabase/migrations/20261022100000_heritage_flora_fauna.sql` | Adds heritage/flora/fauna categories, `scientific_name`, `citations` |
| `tools/harvest/` | Open-data harvester, triplet importer, review-then-merge (see below) |
| `.github/workflows/harvest.yml` | Run the harvester on GitHub's free runners and commit candidates |

## Security model (Row Level Security)

- **Everyone (anon):** can *read* active countries, visible wonders, and the presentation settings.
- **Editors (signed-in users listed in `editors`):** can create, update and delete everything.
- No one can add themselves as an editor from the website. You add editors from the Supabase dashboard.

All of this was tested on Postgres: anon inserts are refused, signed-in non-editors hit the RLS wall, and editors can write.

## Set it up (free tier, ~10 minutes)

### Option A: dashboard only (no installs)
1. Create a project at [supabase.com](https://supabase.com) (free plan), or reuse an existing one.
2. **SQL Editor → New query**: paste `supabase/migrations/20261021000000_wonders_schema.sql`, then **Run**.
3. New query: paste `supabase/seed.sql`, then **Run**. All 7 countries (85 entries) are now live.
4. **Authentication → URL Configuration**: add your site URL (e.g. `https://edmundondo.github.io/reafronders/`) to *Redirect URLs* so magic-link sign-in returns there.
5. Make yourself an editor. Sign in once from the site's **Studio → Data** tab, then run:
   ```sql
   insert into public.editors (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
6. **Project Settings → API**: copy the *Project URL* and the *publishable / anon* key into `js/config.js` in the frontend repo.

### Option B: Supabase CLI (open source)
```bash
npm i -g supabase            # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push             # applies migrations
psql "$(supabase db url)" -f supabase/seed.sql   # or paste seed.sql in the SQL editor
```

## Adding the next country (e.g. Botswana)

1. In `data/seed.json`, add a `countries` entry (`iso_a3: "BWA"`, tagline, 5-colour palette, `active: true`).
2. Add its wonders: Okavango Delta, Makgadikgadi Pans, Tsodilo Hills, Chobe riverfront, and so on. Each needs `slug`, `country_iso`, `name`, `category`, `lat`, `lng`, `summary`, `uniqueness`, plus an `art` block (`color`, `intensity` 0.1–2, `motion`: `cascade | orbit | ripple | sink | zigzag | herd | mist`).
3. `node scripts/build-seed.mjs`, then run `supabase/seed.sql` again. It upserts, so nothing duplicates.

Or skip the JSON and add wonders visually in the site's **Studio**. When you're signed in as an editor, they save straight to this database. **Studio → Data → Export JSON** gives you a file you can drop back into `data/seed.json` as a backup.

## Open-data harvester (`tools/harvest/`)

Think of it as crate-digging for facts and footage. The harvester pulls every open record that might fit; you're the DJ who decides what makes the set. It only uses official open APIs, never HTML scraping:

| Source | What it gives | Licence / notes |
|---|---|---|
| **Wikidata** | Natural features by type, all UNESCO World Heritage items, endemic species, coordinates, Commons categories | CC0 data |
| **Wikimedia Commons** | Videos (480p VP9 + 360p fallback) and photos, with author and licence | CC / PD per file; CORS-ready, so the colour-morph works |
| **UNESCO World Heritage Centre** | Official list: ID, year inscribed, criteria, coordinates | Official XML; Node only (no CORS in browsers) |
| **GBIF** | Species match, occurrence count, median coordinates in the country, occurrence photos | CC0 / CC BY records |
| **iNaturalist** | Research-grade observation photos inside the country | Only CC0 / CC BY / CC BY-SA requested |
| **NASA Image & Video Library** | Satellite and astronaut views | Public domain |
| **Wikipedia** | A second source and a coordinate cross-check | Cited, never copied |
| **Protected Planet (UNEP-WCMC)** | Protected-area metadata | Optional; needs `PROTECTEDPLANET_TOKEN`; non-commercial terms |

**The criteria it enforces:**
- Licences: CC0, public domain, CC BY or CC BY-SA. NC and ND are excluded by default.
- Search hits must name the site or species. Media already tied to the item (its Commons category, Wikidata P10/P18, GBIF or iNaturalist occurrence) counts as trusted.
- Two independent sources per item.
- Coordinates must agree within 25 km.
- Nothing publishes automatically: every candidate has `review.approved: false` until you check it.

```bash
# 1) harvest (or Actions → "Harvest open data" → Run workflow)
node tools/harvest/harvest.mjs --iso3 ZWE --iso2 ZW --qid Q954 --country Zimbabwe \
  --extra "Great Zimbabwe" --extra "Gloriosa superba" --only "Great Zimbabwe,Khami"
# 2) import ranked landmark/flora/fauna lists (e.g. an AI "top 30"); every claim is marked unverified
node tools/harvest/import-triplets.mjs data/imports/zimbabwe-top30-gemini.json
# 3) review data/candidates/*.json: set review.approved = true and write summary/uniqueness in your own words
# 4) merge approved items, then rebuild the SQL
node tools/harvest/merge.mjs data/candidates/ZWE.json && node scripts/build-seed.mjs
```

**From the first Zimbabwe run (22 Oct 2026):**
- **72 candidates.** Notable ones not yet on the map: **Khami (UNESCO #365)**, Lake Kariba, the Eastern Highlands, the Bvumba Mountains, Nyanga, Matusadona, Chizarira and Kazuma Pan national parks, Ziwa ruins, Lake Mutirikwe.
- **Media:**
  - No openly licensed video exists yet for Great Zimbabwe, Matobo, Chinhoyi, Mutarazi, Nyangani, Chimanimani or Chilojo.
  - There are good CC photos for most of them, now used in the photo loops.
  - The Cave Squeaker has 4 GBIF records and no open images.

**From the six-country run (BWA, ZAF, NAM, MWI, ZMB, MOZ; 22 Oct 2026):**
- **55 entries added.** Every UNESCO site in each country is included. Victoria Falls stays under Zimbabwe, and the iSimangaliso–Maputo site appears once in each country, as two separate pins.
- **Media:** 12 entries have real video. 6 are labelled stand-ins: the dugong, gemsbok and Kgalagadi clips, the blackwood and mbuna photos, and the devil's-claw photos from Namibia. Gcwihaba Caves is swarm-only. The choices are in `data/imports/sadc6-media.tsv`.
- **Corrections:**
  - Wikidata places Gcwihaba ~220 km east of the cave, and Barberton Makhonjwa on the Cape Fold Belt. Both now use the Wikipedia/UNESCO coordinates.
  - Mulanje is a *cultural* landscape (2025), not a natural one.
- **Left for review:** Mount Gorongosa (no open photos), Lake Niassa Reserve (MOZ), Tswapong Hills (BWA), Sudwala Caves and Howick Falls (ZAF), Ruacana Falls (NAM), Kasungu NP (MWI), North Luangwa NP (ZMB).

## Schema at a glance

```
countries(iso_a3 PK, name, region, tagline, palette jsonb, active, sort_order)
wonders(id uuid PK, slug unique, country_iso → countries, name, local_name, category,
        lat, lng, summary, uniqueness, stat_label, stat_value, unesco, visible,
        sort_order, art jsonb {color, intensity, motion},
        scientific_name, citations jsonb [urls],
        media jsonb {video, fallback, images:[{url,credit,license,source}], credit, license, source, start, note})
presentation(id='default', settings jsonb {mode, palette, particles, speed, trail,
             glow, vortex, bpm, showBorders, showLabels, focusCountry})
editors(user_id → auth.users)
```

MIT licensed.
