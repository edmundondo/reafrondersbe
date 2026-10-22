// Merge reviewed candidates into data/seed.json — only those with review.approved === true.
// A reviewer must have written `summary` (and ideally `uniqueness`) in their own words.
//
//   node tools/harvest/merge.mjs data/candidates/ZWE.json [--media-only] [--dry]
//
// --media-only: only fill `media` on wonders that already exist and have none.
import fs from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('usage: merge.mjs candidates.json [--media-only] [--dry]'); process.exit(1); }
const seedPath = 'data/seed.json';
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const cands = JSON.parse(fs.readFileSync(file, 'utf8')).candidates || [];
const COLS = ['slug', 'country_iso', 'name', 'local_name', 'scientific_name', 'category', 'lat', 'lng', 'summary', 'uniqueness', 'stat_label', 'stat_value', 'unesco', 'visible', 'sort_order', 'art', 'media', 'citations'];
let added = 0, updated = 0; const problems = [];

for (const c of cands.filter(c => c.review?.approved === true)) {
  const existing = seed.wonders.find(w => w.slug === c.slug);
  const media = c.media || c.suggested_media || {};
  if (existing) {
    if (media.video && !existing.media?.video) { existing.media = Object.fromEntries(Object.entries(media).filter(([, v]) => v != null)); updated++; }
    continue;
  }
  if (flags.includes('--media-only')) continue;
  if (!c.summary) { problems.push(`${c.slug}: missing reviewer-written summary`); continue; }
  if (c.lat == null || c.lng == null) { problems.push(`${c.slug}: missing coordinates`); continue; }
  const w = {
    slug: c.slug, country_iso: c.country_iso || seed.countries[0]?.iso_a3, name: c.name, local_name: c.local_name || null, scientific_name: c.scientific_name || null,
    category: c.category || 'landform', lat: +(+c.lat).toFixed(4), lng: +(+c.lng).toFixed(4), summary: c.summary, uniqueness: c.uniqueness || null,
    stat_label: c.stat_label || null, stat_value: c.stat_value || null, unesco: !!(c.unesco || c.unesco_id), visible: true,
    sort_order: Math.max(0, ...seed.wonders.map(x => x.sort_order || 0)) + 1, art: c.art || { color: '#F4D35E', intensity: 0.8, motion: 'orbit' },
    media: Object.fromEntries(Object.entries(media).filter(([, v]) => v != null)), citations: (c.evidence || []).map(e => e.page).filter(Boolean),
  };
  seed.wonders.push(Object.fromEntries(COLS.map(k => [k, w[k] ?? null]))); added++;
}
problems.forEach(p => console.error('✗', p));
if (!flags.includes('--dry')) fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
console.error(`${flags.includes('--dry') ? '(dry run) ' : ''}✓ added ${added}, media filled ${updated}. Next: node scripts/build-seed.mjs`);
