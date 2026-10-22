// ReAfronders open-data harvester
// Finds sites, species and openly licensed media for one country from official,
// open APIs (no HTML scraping): Wikidata, Wikimedia Commons, UNESCO World Heritage,
// GBIF, iNaturalist, NASA Image Library, Wikipedia summaries, and (optional, token)
// UNEP-WCMC Protected Planet. Output is a *candidates* file for human review —
// nothing is published until a reviewer sets `approved: true` and runs merge.mjs.
//
// Works in Node 18+ (CLI below) and in a browser (import the module; every source
// except UNESCO's XML and Protected Planet allows CORS).
//
// Analogy: this is crate-digging. The harvester pulls every record that might fit;
// the reviewer is the DJ who decides what actually makes the set.

export const CRITERIA = {
  // Licences we can show publicly with attribution. NC/ND are excluded by default
  // (exhibitions and commissions can be commercial); flip allowNC for strictly non-commercial use.
  licences: { allow: [/^cc0/i, /public domain/i, /^pd/i, /^cc[- ]by(-sa)?([- ][\d.]+)?$/i, /^cc[- ]by[- ](sa[- ])?[\d.]+/i], allowNC: false },
  video: { minSeconds: 6, maxSeconds: 900, prefer: '480p.vp9.webm', fallback: '360p.mpeg4.mov' },
  // The colour-morph needs CORS on the media host; others can still crossfade.
  corsHosts: ['upload.wikimedia.org'],
  verify: { minIndependentSources: 2, maxCoordDriftKm: 25 },
  categories: ['waterfall', 'mountain', 'gorge', 'rock', 'cave', 'wetland', 'river', 'lake', 'forest', 'desert', 'savanna', 'coast', 'volcano', 'landform', 'heritage', 'flora', 'fauna'],
};

const UA = 'ReAfrondersHarvester/1.0 (https://github.com/edmundondo/reafrondersbe; open-data art project)';
const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function get(url, { json = true, headers = {}, polite = 350 } = {}) {
  const wait = lastCall + polite - Date.now(); if (wait > 0) await sleep(wait); lastCall = Date.now();
  const h = { Accept: json ? 'application/json' : '*/*', ...headers };
  if (isNode) h['User-Agent'] = UA; else h['Api-User-Agent'] = UA;
  const r = await fetch(url, { headers: h });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 120)}`);
  return json ? r.json() : r.text();
}
const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
export function licenceOK(l) {
  const s = String(l || '').trim(); if (!s) return false;
  if (/\bnd\b|noderiv/i.test(s)) return false;
  if (/\bnc\b|noncommercial/i.test(s)) return CRITERIA.licences.allowNC;
  return CRITERIA.licences.allow.some(re => re.test(s)) || /^cc[- ]?by/i.test(s);
}
export function km(a, b) {
  const R = 6371, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLng = (b[0] - a[0]) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ── Wikidata ──────────────────────────────────────────────────────────────
const CLASS_TO_CATEGORY = {
  Q34038: 'waterfall', Q8502: 'mountain', Q46831: 'mountain', Q1437299: 'mountain', Q150784: 'gorge', Q2042028: 'gorge', Q35509: 'cave',
  Q23397: 'lake', Q131681: 'lake', Q4022: 'river', Q170321: 'wetland', Q46169: 'savanna', Q194195: 'rock', Q1123733: 'rock', Q8072: 'volcano', Q4421: 'forest',
};
export async function wikidataSites(qid) {
  const classes = Object.keys(CLASS_TO_CATEGORY).map(q => `wd:${q}`).join(' ');
  const q = `SELECT ?item ?itemLabel ?class ?coord ?whs ?commonscat ?video ?image ?article WHERE {
    { ?item wdt:P17 wd:${qid}; wdt:P31 ?class. VALUES ?class { ${classes} } }
    UNION { ?item wdt:P17 wd:${qid}; wdt:P1435 wd:Q9259. OPTIONAL { ?item wdt:P31 ?class } }
    ?item wdt:P625 ?coord.
    OPTIONAL { ?item wdt:P757 ?whs } OPTIONAL { ?item wdt:P373 ?commonscat } OPTIONAL { ?item wdt:P10 ?video } OPTIONAL { ?item wdt:P18 ?image }
    OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { polite: 1000 });
  const by = new Map();
  for (const b of j.results.bindings) {
    const id = b.item.value.split('/').pop(); const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value); if (!m) continue;
    const cls = b.class?.value.split('/').pop();
    const prev = by.get(id) || { wikidata: id, name: b.itemLabel.value, lng: +m[1], lat: +m[2], classes: new Set(), kind: 'site' };
    if (cls) prev.classes.add(cls);
    if (b.whs) prev.unesco_id = b.whs.value; if (b.commonscat) prev.commons_category = b.commonscat.value;
    if (b.video) prev.wd_video = decodeURIComponent(b.video.value.split('/').pop()); if (b.image) prev.wd_image = decodeURIComponent(b.image.value.split('/').pop());
    if (b.article) prev.wikipedia = b.article.value;
    by.set(id, prev);
  }
  return [...by.values()].filter(s => !/^Q\d+$/.test(s.name)).map(s => ({ ...s, classes: [...s.classes], category: s.classes.size ? (CLASS_TO_CATEGORY[[...s.classes].find(c => CLASS_TO_CATEGORY[c])] || (s.unesco_id ? 'heritage' : 'landform')) : (s.unesco_id ? 'heritage' : 'landform') }));
}
export async function wikidataEndemics(qid, limit = 60) {
  const q = `SELECT ?t ?tLabel ?name ?iucnLabel ?image ?video ?commonscat ?kingdomLabel WHERE {
    ?t wdt:P183 wd:${qid}; wdt:P225 ?name.
    OPTIONAL { ?t wdt:P141 ?iucn } OPTIONAL { ?t wdt:P18 ?image } OPTIONAL { ?t wdt:P10 ?video } OPTIONAL { ?t wdt:P373 ?commonscat }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT ${limit}`;
  const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { polite: 1000 });
  const by = new Map();
  for (const b of j.results.bindings) {
    const id = b.t.value.split('/').pop();
    if (!by.has(id)) by.set(id, { wikidata: id, kind: 'species', name: b.tLabel.value, scientific_name: b.name.value, iucn: b.iucnLabel?.value || null,
      wd_image: b.image ? decodeURIComponent(b.image.value.split('/').pop()) : null, wd_video: b.video ? decodeURIComponent(b.video.value.split('/').pop()) : null, commons_category: b.commonscat?.value || null });
  }
  return [...by.values()];
}

// ── Wikimedia Commons ─────────────────────────────────────────────────────
const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo|videoinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|ImageDescription|GPSLatitude|GPSLongitude|DateTimeOriginal&viprop=derivatives';
function commonsRecord(p) {
  const i = p.imageinfo?.[0] || {}, md = i.extmetadata || {}, d = p.videoinfo?.[0]?.derivatives || [];
  const isVideo = /^video\//.test(i.mime || '') || /\.(webm|ogv|mp4)$/i.test(p.title);
  const prefer = d.find(x => x.src.includes(CRITERIA.video.prefer))?.src, fallback = d.find(x => x.src.includes(CRITERIA.video.fallback))?.src;
  return {
    host: 'commons', title: p.title, page: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title.replace(/ /g, '_')),
    type: isVideo ? 'video' : 'image', url: isVideo ? (prefer || i.url) : (i.thumburl || i.url), fallback: isVideo ? (fallback || null) : null,
    width: i.width, height: i.height, seconds: i.duration ? Math.round(i.duration) : null,
    licence: md.LicenseShortName?.value || '', credit: strip(md.Artist?.value).slice(0, 80), description: strip(md.ImageDescription?.value).slice(0, 300),
    gps: md.GPSLatitude ? [+md.GPSLongitude.value, +md.GPSLatitude.value] : null, cors: true,
  };
}
export async function commonsSearch(term, { video = true, limit = 12 } = {}) {
  const j = await get(`${COMMONS}&iiurlwidth=1280&generator=search&gsrnamespace=6&gsrlimit=${limit}&gsrsearch=${encodeURIComponent(term + (video ? ' filemime:video' : ' filemime:image'))}`);
  return Object.values(j.query?.pages || {}).map(commonsRecord);
}
export async function commonsCategory(cat, { limit = 40 } = {}) {
  const j = await get(`${COMMONS}&iiurlwidth=1280&generator=categorymembers&gcmtype=file&gcmlimit=${limit}&gcmtitle=${encodeURIComponent('Category:' + cat)}`);
  return Object.values(j.query?.pages || {}).map(commonsRecord);
}
export async function commonsFiles(titles) {
  if (!titles.length) return [];
  const j = await get(`${COMMONS}&iiurlwidth=1280&titles=${encodeURIComponent(titles.map(t => t.startsWith('File:') ? t : 'File:' + t).join('|'))}`);
  return Object.values(j.query?.pages || {}).filter(p => p.imageinfo).map(commonsRecord);
}

// ── GBIF (biodiversity occurrences + media; CC0/CC BY) ────────────────────
export async function gbif(scientificName, iso2) {
  const m = await get(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(scientificName)}`);
  if (!m.usageKey) return null;
  const occ = await get(`https://api.gbif.org/v1/occurrence/search?taxonKey=${m.usageKey}&country=${iso2}&hasCoordinate=true&limit=100`);
  const pts = occ.results.map(o => [o.decimalLongitude, o.decimalLatitude]).filter(p => p[0] != null);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const media = occ.results.flatMap(o => (o.media || []).filter(x => x.identifier && /StillImage|MovingImage/.test(x.type || '')).map(x => ({
    host: 'gbif', type: /Moving/.test(x.type) ? 'video' : 'image', url: x.identifier, licence: normaliseLicence(x.license || o.license), credit: x.rightsHolder || x.creator || o.recordedBy || '',
    page: `https://www.gbif.org/occurrence/${o.key}`, description: `${o.scientificName} · ${o.locality || o.stateProvince || o.country} · ${o.eventDate?.slice(0, 10) || ''}`, cors: null }))).slice(0, 12);
  return { key: m.usageKey, kingdom: m.kingdom, rank: m.rank, matchType: m.matchType, occurrences: occ.count, median: pts.length ? [med(pts.map(p => p[0])), med(pts.map(p => p[1]))] : null, media,
    page: `https://www.gbif.org/species/${m.usageKey}` };
}
function normaliseLicence(l) {
  const s = String(l || '');
  if (/zero|cc0/i.test(s)) return 'CC0';
  const m = /licenses\/([a-z-]+)\/([\d.]+)/i.exec(s); if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return s.replace(/^http.*$/, 'unknown');
}

// ── iNaturalist (research-grade, CC photos) ───────────────────────────────
export async function inat(scientificName, countryName) {
  const places = await get(`https://api.inaturalist.org/v1/places/autocomplete?q=${encodeURIComponent(countryName)}`);
  const place = places.results.find(p => p.admin_level === 0) || places.results[0];
  const obs = await get(`https://api.inaturalist.org/v1/observations?taxon_name=${encodeURIComponent(scientificName)}${place ? `&place_id=${place.id}` : ''}&quality_grade=research&photo_license=cc0,cc-by,cc-by-sa&per_page=12&order_by=votes`);
  return { place: place?.id, count: obs.total_results, media: obs.results.flatMap(o => (o.photos || []).slice(0, 1).map(ph => ({
    host: 'inaturalist', type: 'image', url: ph.url?.replace('/square.', '/large.'), licence: (ph.license_code || '').toUpperCase().replace(/-/g, ' '), credit: ph.attribution,
    page: o.uri, description: `${o.taxon?.name} · ${o.place_guess || ''} · ${o.observed_on || ''}`, gps: o.geojson?.coordinates || null, cors: null }))) };
}

// ── NASA Image & Video Library (public domain; great satellite views) ─────
export async function nasa(term) {
  const j = await get(`https://images-api.nasa.gov/search?q=${encodeURIComponent(term)}&media_type=image,video`);
  return (j.collection?.items || []).slice(0, 8).map(it => { const d = it.data?.[0] || {}; return {
    host: 'nasa', type: d.media_type, url: it.links?.find(l => l.rel === 'preview')?.href || null, manifest: it.href, licence: 'Public domain (NASA)', credit: d.center ? `NASA ${d.center}` : 'NASA',
    page: `https://images.nasa.gov/details/${d.nasa_id}`, description: strip(d.title + ' — ' + (d.description || '')).slice(0, 260), cors: null }; });
}

// ── UNESCO World Heritage list (official XML; run in Node — no CORS) ──────
export async function unescoList(iso2) {
  const xml = await get('https://whc.unesco.org/en/list/xml/', { json: false, polite: 1000 });
  const rows = xml.split('<row>').slice(1);
  const tag = (r, t) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(r)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return rows.filter(r => tag(r, 'iso_code').toLowerCase().split(',').includes(iso2.toLowerCase())).map(r => ({
    unesco_id: tag(r, 'id_number'), name: strip(tag(r, 'site')), year: +tag(r, 'date_inscribed'), category: tag(r, 'category'),
    criteria: tag(r, 'criteria_txt'), lat: +tag(r, 'latitude'), lng: +tag(r, 'longitude'), page: tag(r, 'http_url'), short: strip(tag(r, 'short_description')).slice(0, 400) }));
}

// ── Protected Planet / UNEP-WCMC (optional; needs a free token; NC licence) ──
export async function protectedPlanet(iso3, token) {
  if (!token) return { skipped: 'set PROTECTEDPLANET_TOKEN to include WDPA protected areas (metadata only; non-commercial terms)' };
  const j = await get(`https://api.protectedplanet.net/v3/protected_areas/search?country=${iso3}&token=${token}&per_page=50`);
  return (j.protected_areas || []).map(p => ({ wdpa_id: p.wdpa_id, name: p.name, designation: p.designation?.name, iucn_category: p.iucn_category?.name, page: p.links?.protected_planet }));
}

export async function wikipediaSummary(titleOrUrl) {
  const t = titleOrUrl.includes('/wiki/') ? titleOrUrl.split('/wiki/')[1] : encodeURIComponent(titleOrUrl.replace(/ /g, '_'));
  try { const j = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${t}`); return { page: j.content_urls?.desktop?.page, extract: j.extract?.slice(0, 500), coords: j.coordinates ? [j.coordinates.lon, j.coordinates.lat] : null }; }
  catch { return null; }
}

// ── scoring ───────────────────────────────────────────────────────────────
// Rank media by: licence OK → video → CORS host (morph-ready) → place named in description → resolution
export function scoreMedia(m, names) {
  if (!licenceOK(m.licence)) return -1;
  let s = 0;
  if (m.type === 'video') s += 50;
  if (m.seconds && (m.seconds < CRITERIA.video.minSeconds || m.seconds > CRITERIA.video.maxSeconds)) s -= 30;
  if (m.cors || CRITERIA.corsHosts.some(h => (m.url || '').includes(h))) s += 25;
  const text = `${m.title || ''} ${m.description || ''}`.toLowerCase();
  if (names.some(n => n && text.includes(n.toLowerCase()))) s += 20; else s -= 10;
  if ((m.width || 0) >= 1280) s += 5;
  return s;
}

// ── main pipeline ─────────────────────────────────────────────────────────
// opts: { iso3, iso2, qid, country, extras: [{name, scientific_name?, category?, lat?, lng?}], species: true, sites: true, protectedPlanetToken }
export async function harvest(opts, log = () => { }) {
  const { iso3, iso2, qid, country } = opts;
  const out = { country: { iso3, iso2, qid, name: country }, retrieved: new Date().toISOString(), criteria: { licences: 'CC0 / PD / CC BY / CC BY-SA (NC & ND excluded)', morph: 'CORS host required for colour-morph', verify: '2 independent sources; coords within 25 km' }, sources: {}, candidates: [] };
  const add = (c) => {
    const dup = out.candidates.find(x => (x.wikidata && x.wikidata === c.wikidata) || slugify(x.name) === slugify(c.name) || (c.scientific_name && x.scientific_name === c.scientific_name));
    if (dup) { Object.assign(dup, Object.fromEntries(Object.entries(c).filter(([k, v]) => v != null && dup[k] == null))); return dup; }
    out.candidates.push(c); return c;
  };
  if (opts.sites !== false) { log('wikidata sites…'); try { (await wikidataSites(qid)).forEach(add); out.sources.wikidata_sites = 'ok'; } catch (e) { out.sources.wikidata_sites = String(e.message); } }
  if (opts.species !== false) { log('wikidata endemic species…'); try { (await wikidataEndemics(qid)).forEach(add); out.sources.wikidata_species = 'ok'; } catch (e) { out.sources.wikidata_species = String(e.message); } }
  for (const x of opts.extras || []) add({ kind: x.scientific_name ? 'species' : 'site', ...x });
  log('unesco…');
  try { const list = await unescoList(iso2); out.sources.unesco = `${list.length} sites`; out.unesco = list;
    for (const u of list) { const c = out.candidates.find(x => x.unesco_id === u.unesco_id) || add({ kind: 'site', name: u.name, lat: u.lat, lng: u.lng, unesco_id: u.unesco_id, category: /natural/i.test(u.category) ? 'landform' : 'heritage' });
      c.unesco = { id: u.unesco_id, year: u.year, criteria: u.criteria, category: u.category, page: u.page }; }
  } catch (e) { out.sources.unesco = `skipped (${isNode ? e.message : 'browser: no CORS — run in Node'})`; }
  if (opts.protectedPlanetToken !== undefined) out.protected_areas = await protectedPlanet(iso3, opts.protectedPlanetToken).catch(e => ({ error: e.message }));

  for (const c of out.candidates) {
    log(`media: ${c.name}`);
    c.slug = c.slug || slugify(c.name); c.media_candidates = []; c.evidence = [];
    const names = [c.name, c.scientific_name, country].filter(Boolean);
    try {
      const files = [c.wd_video, c.wd_image].filter(Boolean);
      if (files.length) c.media_candidates.push(...await commonsFiles(files));
      if (c.commons_category) c.media_candidates.push(...await commonsCategory(c.commons_category, { limit: 30 }));
      c.media_candidates.push(...await commonsSearch(c.scientific_name || c.name, { video: true, limit: 8 }));
      if (c.kind === 'species') {
        const g = await gbif(c.scientific_name || c.name, iso2).catch(() => null);
        if (g) { c.gbif = { key: g.key, kingdom: g.kingdom, occurrences: g.occurrences, page: g.page }; c.media_candidates.push(...g.media); c.evidence.push({ source: 'GBIF', page: g.page });
          if (c.lat == null && g.median) { c.lng = g.median[0]; c.lat = g.median[1]; c.coord_note = 'median of GBIF occurrences in country'; }
          c.category = c.category || (g.kingdom === 'Plantae' || g.kingdom === 'Fungi' ? 'flora' : 'fauna'); }
        const n = await inat(c.scientific_name || c.name, country).catch(() => null);
        if (n) { c.inat_observations = n.count; c.media_candidates.push(...n.media); }
      } else {
        c.media_candidates.push(...(await nasa(c.name).catch(() => [])).filter(m => (m.description || '').toLowerCase().includes(c.name.toLowerCase().split(/[ ,(]/)[0])));
      }
    } catch (e) { c.media_error = e.message; }
    if (c.wikipedia || c.name) { const w = await wikipediaSummary(c.wikipedia || c.name); if (w?.page) { c.evidence.push({ source: 'Wikipedia', page: w.page }); c.wiki_extract = w.extract;
      if (w.coords && c.lat != null && km([c.lng, c.lat], w.coords) > CRITERIA.verify.maxCoordDriftKm) (c.flags ||= []).push(`coords differ from Wikipedia by ${Math.round(km([c.lng, c.lat], w.coords))} km`); } }
    if (c.wikidata) c.evidence.push({ source: 'Wikidata', page: `https://www.wikidata.org/wiki/${c.wikidata}` });
    if (c.unesco) c.evidence.push({ source: 'UNESCO', page: c.unesco.page });
    // dedupe + rank media
    const seen = new Set();
    c.media_candidates = c.media_candidates.filter(m => m.url && !seen.has(m.url) && seen.add(m.url))
      .map(m => ({ ...m, score: scoreMedia(m, names) })).filter(m => m.score >= 0).sort((a, b) => b.score - a.score).slice(0, 8);
    const v = c.media_candidates.find(m => m.type === 'video');
    c.suggested_media = v ? { video: v.url, fallback: v.fallback || undefined, credit: v.credit, license: v.licence, source: v.page, note: v.score < 60 ? 'check location — description does not name the site' : undefined } : null;
    c.suggested_image = c.media_candidates.find(m => m.type === 'image')?.url || null;
    const independent = new Set(c.evidence.map(e => e.source)).size;
    c.review = { approved: false, independent_sources: independent, needs: [
      ...(independent < CRITERIA.verify.minIndependentSources ? ['find a second independent source'] : []),
      ...(c.lat == null ? ['coordinates'] : []), ...(!c.suggested_media ? ['footage'] : []), ...(c.flags || []),
      'write summary + uniqueness in your own words (do not paste source text)'] };
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────
// node tools/harvest/harvest.mjs --iso3 ZWE --iso2 ZW --qid Q954 --country Zimbabwe \
//   [--extra "Great Zimbabwe" --extra "Gloriosa superba"] [--no-species] [--out data/candidates/ZWE.json]
if (isNode && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), val = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const extras = args.flatMap((a, i) => a === '--extra' ? [args[i + 1]] : []).map(n => / [a-z]+$/.test(n) && /^[A-Z][a-z]+ [a-z]+$/.test(n) ? { name: n, scientific_name: n } : { name: n });
  const opts = { iso3: val('--iso3', 'ZWE'), iso2: val('--iso2', 'ZW'), qid: val('--qid', 'Q954'), country: val('--country', 'Zimbabwe'), extras,
    species: !args.includes('--no-species'), sites: !args.includes('--no-sites'), protectedPlanetToken: process.env.PROTECTEDPLANET_TOKEN };
  const outPath = val('--out', `data/candidates/${opts.iso3}.json`);
  const res = await harvest(opts, (m) => console.error('·', m));
  const fs = await import('node:fs'); const path = await import('node:path');
  fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(res, null, 2));
  console.error(`✓ ${res.candidates.length} candidates → ${outPath}`);
}
