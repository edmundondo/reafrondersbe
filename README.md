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

## Security model (Row Level Security)

- **Everyone (anon):** can *read* active countries, visible wonders, and the presentation settings.
- **Editors (signed-in users listed in `editors`):** can create, update and delete everything.
- No one can add themselves as an editor from the website. You add editors from the Supabase dashboard.

All of this was tested on Postgres: anon inserts are refused, signed-in non-editors hit the RLS wall, and editors can write.

## Set it up (free tier, ~10 minutes)

### Option A: dashboard only (no installs)
1. Create a project at [supabase.com](https://supabase.com) (free plan), or reuse an existing one.
2. **SQL Editor → New query**: paste `supabase/migrations/20261021000000_wonders_schema.sql`, then **Run**.
3. New query: paste `supabase/seed.sql`, then **Run**. Zimbabwe's 11 wonders are now live.
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

## Schema at a glance

```
countries(iso_a3 PK, name, region, tagline, palette jsonb, active, sort_order)
wonders(id uuid PK, slug unique, country_iso → countries, name, local_name, category,
        lat, lng, summary, uniqueness, stat_label, stat_value, unesco, visible,
        sort_order, art jsonb {color, intensity, motion},
        media jsonb {video, fallback, credit, license, source, start, note})
presentation(id='default', settings jsonb {mode, palette, particles, speed, trail,
             glow, vortex, bpm, showBorders, showLabels, focusCountry})
editors(user_id → auth.users)
```

MIT licensed.
