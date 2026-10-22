// Import "rank → landmark + flora + fauna" datasets (e.g. AI-generated top-30 lists)
// into a candidates file. Every claim is treated as UNVERIFIED until the harvester
// or a human finds two independent sources — AI lists often overstate ("#1", "rarest").
//
//   node tools/harvest/import-triplets.mjs path/to/list.json [--country ZWE] [--out data/candidates/ZWE-import.json]
//
// Dedupes against data/seed.json (same slug/name, or within 3 km for landmarks).
import fs from 'node:fs';
import path from 'node:path';
import { slugify, km } from './harvest.mjs';

const GUESS = [[/fall|cascade/i, 'waterfall'], [/gorge|canyon/i, 'gorge'], [/cave|sinkhole|pool/i, 'cave'], [/mount|peak|range|hills?\b|highland/i, 'mountain'],
  [/lake|dam\b/i, 'lake'], [/river/i, 'river'], [/pan\b|wetland|swamp|pools/i, 'wetland'], [/forest|woodland/i, 'forest'], [/rock|kopje|granite|cliff|boulder/i, 'rock'],
  [/park|reserve|savanna/i, 'savanna'], [/ruin|monument|heritage|enclosure|cultural/i, 'heritage']];
const guessCategory = (txt) => (GUESS.find(([re]) => re.test(txt)) || [, 'landform'])[1];
const PALETTE = { flora: '#E85D75', fauna: '#9BE15D' };

export function importTriplets(data, { country = 'ZWE', seed = { wonders: [] } } = {}) {
  const out = [], skipped = [];
  const exists = (name, lat, lng, isPoint) => seed.wonders.find(w => slugify(w.name) === slugify(name) || w.slug === slugify(name)
    || (isPoint && lat != null && km([w.lng, w.lat], [lng, lat]) < 3 && !['flora', 'fauna'].includes(w.category)));
  for (const r of data.records || []) {
    const cite = r.citations_and_status || '';
    for (const kind of ['landmark', 'flora', 'fauna']) {
      const x = r[kind]; if (!x) continue;
      const name = (x.name || x.common_name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
      if (!name) continue;
      const dup = exists(name, x.latitude, x.longitude, kind === 'landmark');
      if (dup) { skipped.push({ rank: r.rank, kind, name, matches: dup.slug }); continue; }
      const category = kind === 'landmark' ? guessCategory(`${x.name} ${x.category || ''} ${x.significance || ''}`) : kind;
      out.push({
        kind: kind === 'landmark' ? 'site' : 'species', rank: r.rank, slug: slugify(name), name, country_iso: country, category,
        local_name: x.local_names || (/\((.+)\)/.exec(x.name || '')?.[1]) || null, scientific_name: x.scientific_name || null,
        lat: x.latitude, lng: x.longitude, coord_note: kind === 'landmark' ? null : `representative point — ${x.place_of_origin || 'range'}`,
        summary_draft: x.significance || '', place_of_origin: x.place_of_origin || null, citations_claimed: cite,
        art: { color: PALETTE[kind] || '#F4D35E', intensity: 0.8, motion: kind === 'flora' ? 'bloom' : kind === 'fauna' ? 'herd' : ({ waterfall: 'cascade', cave: 'sink', rock: 'orbit', heritage: 'orbit', wetland: 'ripple', mountain: 'mist' }[category] || 'orbit') },
        review: { approved: false, needs: ['verify every claim with 2 independent sources (imported list is unverified)', 'rewrite summary in your own words', 'footage'] },
      });
    }
  }
  return { imported: out, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), file = args[0], val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (!file) { console.error('usage: import-triplets.mjs list.json [--country ZWE] [--out file]'); process.exit(1); }
  const country = val('--country', 'ZWE');
  const seed = fs.existsSync('data/seed.json') ? JSON.parse(fs.readFileSync('data/seed.json', 'utf8')) : { wonders: [] };
  const res = importTriplets(JSON.parse(fs.readFileSync(file, 'utf8')), { country, seed });
  const outPath = val('--out', `data/candidates/${country}-import.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ source: path.basename(file), retrieved: new Date().toISOString(), candidates: res.imported, skipped_existing: res.skipped }, null, 2));
  console.error(`✓ ${res.imported.length} new, ${res.skipped.length} already in seed → ${outPath}`);
}
