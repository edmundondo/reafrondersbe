// Browser-side media + facts pass for a list of atlas items (runs in any page that can reach
// Wikimedia, Wikipedia and iNaturalist with CORS). Paced to stay under Commons rate limits,
// and every finished item is cached in localStorage so a reload never loses work.
//
//   const P = await import('https://raw.githubusercontent.com/.../tools/harvest/atlas-pass.mjs');
//   await P.run(items, { onProgress })   // items: [{iso, kind, name, wiki, q, sci?, whs?}]
//   P.lines(items)                       // TSV media lines for data/imports/*-media.tsv
//   P.facts(items)                       // key, lng/lat, Wikipedia extract
import * as HV from './harvest.mjs';

const NAMES = { BEN: 'Benin', BFA: 'Burkina Faso', CPV: 'Cabo Verde', CIV: "Côte d'Ivoire", GMB: 'Gambia', GHA: 'Ghana', GIN: 'Guinea', GNB: 'Guinea-Bissau',
  LBR: 'Liberia', MLI: 'Mali', MRT: 'Mauritania', NER: 'Niger', NGA: 'Nigeria', SEN: 'Senegal', SLE: 'Sierra Leone', TGO: 'Togo', AGO: 'Angola', CMR: 'Cameroon',
  CAF: 'Central African Republic', TCD: 'Chad', COD: 'Democratic Republic of the Congo', COG: 'Republic of the Congo', GNQ: 'Equatorial Guinea', GAB: 'Gabon',
  STP: 'São Tomé and Príncipe', BDI: 'Burundi', COM: 'Comoros', DJI: 'Djibouti', ERI: 'Eritrea', ETH: 'Ethiopia', KEN: 'Kenya', MDG: 'Madagascar', MUS: 'Mauritius',
  RWA: 'Rwanda', SYC: 'Seychelles', SOM: 'Somalia', SSD: 'South Sudan', TZA: 'Tanzania', UGA: 'Uganda', SWZ: 'Eswatini', LSO: 'Lesotho' };
const BAD = /\b(map|maps|locator|logo|flag|coat of arms|emblem|diagram|chart|banknote|stamp|poster|signboard|seal|drawing|engraving|illustration|lithograph|herbarium|specimen|skull|museum|figure|table|graph|screenshot|cover|book|page|document|djvu|pdf|tif)\b/i;
const NEWS = /VOA|Voice of America|LUSA|news|interview|press conference|President|minister|election|BBC|CCTV|AFP|parliament|summit/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const key = (it) => `${it.iso}:${it.name}`;
const LS = 'atlas41:';
const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(LS + k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch { } } };

async function paced(fn, tries = 5) {
  for (let k = 0; k < tries; k++) {
    try { const r = await fn(); await sleep(350); return r; }
    catch (e) { if (k === tries - 1) throw e; await sleep(2500 * (k + 1)); }
  }
}

const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/[|\t\n;]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
function encode(m) {
  const c = /commons\/(?:transcoded\/|thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)(?:\/(.+))?$/.exec(m.url || '');
  if (c) {
    const name = decodeURIComponent(c[1]);
    if (m.type === 'video') return ['V', name, m.fallback ? 1 : 0, clean(m.credit), m.licence].join('|');
    let th = '0'; if (/\/thumb\//.test(m.url)) { const tn = decodeURIComponent(c[2]); th = tn === '1280px-' + name ? '1' : tn; }
    return ['I', name, th, clean(m.credit), m.licence].join('|');
  }
  const n = /inaturalist-open-data\.s3\.amazonaws\.com\/photos\/(\d+)\/\w+\.(\w+)/.exec(m.url || ''), ob = /observations\/(\d+)/.exec(m.page || '');
  if (n && ob) return ['N', n[1], n[2], ob[1], clean(m.credit).replace(/^\(c\)\s*/i, ''), m.licence].join('|');
  return null;
}

export async function one(it) {
  const names = [it.name, it.q, it.sci, it.wiki].filter(Boolean);
  const out = { k: key(it), err: null };
  try {
    const s = await paced(() => HV.wikipediaSummary(it.wiki));
    out.coords = s?.coords || null; out.extract = (s?.extract || '').replace(/\s+/g, ' ').slice(0, 260); out.page = s?.page || null;
    let mc = [];
    mc.push(...await paced(() => HV.commonsSearch(it.q, { video: true, limit: 10 })));
    mc.push(...await paced(() => HV.commonsSearch(it.q, { video: false, limit: 20 })));
    if (it.q !== it.name) mc.push(...await paced(() => HV.commonsSearch(it.name, { video: false, limit: 12 })));
    if (it.sci) { const n = await HV.inat(it.sci, NAMES[it.iso]).catch(() => null); if (n) { out.inat = n.count; mc.push(...n.media.map(m => ({ ...m, trusted: true }))); } }
    const seen = new Set();
    const ok = mc.filter(m => m.url && !seen.has(m.url) && seen.add(m.url))
      .filter(m => !BAD.test(`${m.title || ''} ${m.description || ''}`) && !/\.(svg|gif)$/i.test(m.title || m.url) && !(m.type === 'image' && m.width && m.width < 900))
      .map(m => ({ ...m, score: HV.scoreMedia(m, names) })).filter(m => m.score >= 0).sort((a, b) => b.score - a.score);
    const v = ok.find(m => m.type === 'video' && m.seconds >= 6 && m.seconds <= 300 && !NEWS.test(`${m.description || ''} ${m.credit || ''} ${m.title || ''}`));
    const im = ok.filter(m => m.type === 'image').slice(0, 3);
    out.media = [v, ...im].filter(Boolean).map(encode).filter(Boolean);
    out.alts = ok.filter(m => m.type === 'image').slice(3, 8).map(encode).filter(Boolean);
    out.desc = [v, ...im].filter(Boolean).map(m => clean(m.description || m.title).slice(0, 60));
  } catch (e) { out.err = String(e.message || e).slice(0, 80); }
  if (!out.err) store.set(out.k, out);
  return out;
}

export async function run(items, { onProgress = () => { }, force = false } = {}) {
  let done = 0;
  for (const it of items) {
    if (force || !store.get(key(it))) await one(it);
    onProgress(++done, items.length);
  }
}

export const result = (it) => store.get(key(it));
export const lines = (items) => items.map(it => { const r = result(it); return `${key(it)}\t\t${(r?.media || []).join(' ;; ')}`; }).join('\n');
export const facts = (items) => items.map(it => { const r = result(it); return `${key(it)}\t${(r?.coords || []).map(n => n.toFixed(3)).join(',')}\t${r?.extract || ''}`; }).join('\n');
