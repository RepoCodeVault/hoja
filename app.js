'use strict';
(() => {
const KEY = 'lw-companion-v1';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

// Unbiased 0-9 (rejection sampling on one random byte)
function rn() {
  const b = new Uint8Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= 250);
  return b[0] % 10;
}

/* ---------- state ---------- */
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.chars) return d; } catch (e) { /* storage blocked or corrupt */ }
  return { chars: {}, active: null };
}
function migrate(d) { // older saves lack the newer fields
  Object.values(d.chars).forEach(c => { c.legacy = c.legacy || { basic: false, magnakai: false }; c.trail = c.trail || []; c.combatHere = !!c.combatHere; });
  return d;
}
const S = { data: migrate(load()), tab: 'sheet', wiz: null, modal: null, roll: null, rollHist: [], rollBonus: 0, tableRatio: null };
let warned = false;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S.data)); }
  catch (e) { if (!warned) { warned = true; toast('No se puede guardar en este navegador'); } }
}
const cur = () => S.data.chars[S.data.active] || null;

/* ---------- derived values ---------- */
const SR = c => SERIES[c.series];
const has = (c, n) => c.disc.includes(n);
const FREE_MEAL = ['Hunting', 'Huntmastery', 'Grand Huntmastery'];
const WM_NAMES = ['Weaponskill', 'Weaponmastery', 'Grand Weaponmastery'];

function permBonus(c) { // Lore-circles (Magnakai) and extra Grand Master Disciplines
  let cs = 0, end = 0;
  if (c.series === 'magnakai') { const l = loreBonus(c.disc); cs += l.cs; end += l.end; }
  if (c.series === 'gm' || c.series === 'no') { const n = Math.max(0, c.disc.length - 4); cs += n; end += 2 * n; }
  return { cs, end };
}
const itemEnd = c => c.special.reduce((a, i) => a + (i.end || 0), 0);
const totalCS = c => c.cs + permBonus(c).cs;
const maxEnd = c => c.end + permBonus(c).end + itemEnd(c);
const packUsed = c => c.pack.length + c.meals;
const discAllowed = c => Math.min(SR(c).discMax, SR(c).discBase + c.book - SR(c).first);
const hasWM = c => c.disc.some(d => WM_NAMES.includes(d));
const wmAllowed = c => (hasWM(c) ? SR(c).wmBase + (SR(c).wmGrows ? c.book - SR(c).first : 0) : 0);
const pendDisc = c => Math.max(0, discAllowed(c) - c.disc.length);
const pendWm = c => Math.max(0, wmAllowed(c) - c.wm.length);
const leg = c => c.legacy || {};
// Veteran bonuses: Newsletters #8, #10 and #28 (Readers' Handbook, Topical Guide: Healing).
const hasHeal = c => c.disc.includes('Healing') || c.disc.includes('Curing') || (c.series === 'magnakai' && !!leg(c).basic) || (c.series === 'gm' && !!leg(c).magnakai);
const healName = c => (c.disc.includes('Healing') ? 'Healing' : c.disc.includes('Curing') ? 'Curing' : 'Bonus de veterano');
const freeMeals = c => c.disc.some(d => FREE_MEAL.includes(d)) || (c.series === 'magnakai' && !!leg(c).basic);
const MODS = c => mods(c.series, c.disc);
const specialMax = c => specialMaxFor(c.series, c.book);
const psyOptions = c => MODS(c).psy;

const freshCombat = () => ({ name: '', ecs: 15, eend: 25, started: false, e: 0, log: [], last: null, over: null, psy: 'none', weaponId: null, items: {}, extra: 0, undead: false, flame: false });
const itemMode = (cb, i) => cb.items[i.id] || (i.cs ? 'base' : 'off');

function combatCalc(c) {
  const s = SR(c), cb = c.combat, m = MODS(c), parts = [['Combat Skill', totalCS(c)]];
  let cs = totalCS(c), armed = false;
  const active = c.special.filter(i => { const x = itemMode(cb, i); return x === 'base' || x === 'alt'; });
  const specWeapon = active.find(i => i.isWeapon); // Sommerswerd & co. are Special Items used as the weapon
  const w = c.weapons.find(x => x.id === cb.weaponId);
  if (specWeapon) armed = true;
  else if (w && w.type !== 'Bow') {
    armed = true;
    if (c.wm.includes(w.type)) { cs += m.wmBonus; parts.push([`${s.wmName} (${w.type})`, m.wmBonus]); }
    if (w.cs) { cs += w.cs; parts.push([w.name, w.cs]); }
  }
  active.forEach(i => { const v = itemMode(cb, i) === 'alt' ? i.alt : i.cs; if (v) { cs += v; parts.push([i.name, v]); } });
  if (specWeapon && specWeapon.wmOf && c.wm.some(x => specWeapon.wmOf.includes(x))) { cs += m.wmBonus; parts.push([`${s.wmName} (${specWeapon.name})`, m.wmBonus]); }
  if (!armed) { cs += m.unarmed; parts.push(['Sin arma', m.unarmed]); }
  const opt = m.psy.find(o => o.id === cb.psy);
  const psy = opt && !(opt.cost > 0 && c.endNow <= opt.minEnd) ? opt : null;
  if (psy) { cs += psy.cs; parts.push([psy.label, psy.cs]); }
  if (cb.extra) { cs += cb.extra; parts.push(['Otros', cb.extra]); }
  const drain = active.reduce((a, i) => a + (i.drain || 0), 0); // e.g. Helshezag: -1 END from the second round
  const cost = (psy ? psy.cost : 0) + (cb.log.length ? drain : 0);
  return { cs, parts, psy, cost, specWeapon, drain, dbl: active.some(i => i.dbl), flame: m.flame };
}

/* ---------- mutations ---------- */
// Keeps current END consistent when the maximum moves (new Discipline, Helmet, ...)
function mut(fn, opts) {
  const c = cur(); if (!c) return;
  const before = maxEnd(c);
  fn(c);
  const after = maxEnd(c);
  if (after > before) c.endNow += after - before;
  c.endNow = clamp(c.endNow, 0, after);
  save(); render(opts);
}

function applyStartItem(c, it) {
  if (it.kind === 'weapon') c.weapons.push({ id: uid(), name: it.type, type: it.type, cs: 0 });
  else if (it.kind === 'pack') c.pack.push({ id: uid(), name: it.name, heal: it.heal || 0 });
  else if (it.kind === 'special') c.special.push({ id: uid(), name: it.name, cs: 0, end: it.end || 0, qty: it.qty, note: '' });
  else if (it.kind === 'meals') c.meals += it.n;
  else if (it.kind === 'gold') c.gold = Math.min(50, c.gold + it.n);
}

function createChar(w) {
  const sk = seriesOfBook(w.book), s = SERIES[sk];
  const c = {
    id: uid(), name: w.name.trim() || 'Lone Wolf', series: sk, book: w.book, cs: w.cs, end: w.end, endNow: w.end,
    gold: clamp(w.gold || 0, 0, 50), meals: 0, disc: w.disc.slice(), wm: w.wm.slice(), weapons: [], pack: [], special: [],
    section: '', notes: '', usedDel: false, combat: freshCombat(),
    legacy: { basic: !!(w.legacy && w.legacy.basic), magnakai: !!(w.legacy && w.legacy.magnakai) }, trail: [], combatHere: false,
  };
  if (w.book === s.first) {
    if (sk === 'kai') {
      applyStartItem(c, { kind: 'weapon', type: 'Axe' });
      c.meals = 1;
      if (w.kaiItem) applyStartItem(c, KAI_START_ITEMS[w.kaiItem.rn]);
    } else {
      w.picks.forEach(i => applyStartItem(c, START_PICKS[sk][i]));
    }
    if (sk === 'no' && w.kw != null) {
      const k = KAI_WEAPONS[w.kw];
      c.special.push({ id: uid(), name: `${k.type} “${k.name}”`, cs: 5, alt: k.alt, end: 0, isWeapon: true, note: `+${k.alt} CS ${k.prop}` });
    }
  }
  c.endNow = maxEnd(c);
  S.data.chars[c.id] = c;
  S.data.active = c.id;
  save();
  return c;
}

function completeBook() {
  const c = cur(); if (!c) return;
  const s = SR(c);
  if (c.book >= 32) { toast('Es el último libro de la colección'); return; }
  if (c.book === 20) { alert('El libro 21 abre la serie New Order con un personaje nuevo. Crea uno desde “Personajes”.'); return; }
  const next = c.book + 1;
  if (next <= s.last) {
    if (!confirm(`Libro ${c.book} completado. Pasas al libro ${next}: ${BOOK_TITLES[next]}.\n\nGanas una disciplina nueva y recuperas tu Endurance máxima.`)) return;
    mut(x => { x.book = next; x.endNow = maxEnd(x); x.usedDel = false; x.combat = freshCombat(); x.trail = []; x.section = ''; x.combatHere = false; });
    return;
  }
  // series boundary: Kai -> Magnakai (6) or Magnakai -> Grand Master (13)
  const toGM = c.series === 'magnakai';
  const lost = toGM ? c.special.filter(i => !GM_CARRYOVER.some(n => n.toLowerCase() === i.name.toLowerCase())) : [];
  const msg = `Empiezas la serie ${toGM ? 'Grand Master' : 'Magnakai'} (libro ${next}: ${BOOK_TITLES[next]}).\n\n` +
    `Conservas CS, END, armas y objetos${toGM ? ' (con los bonus de Lore-circles incluidos en tus valores base)' : ''}. Tendrás que elegir de nuevo tus ${toGM ? 4 : 3} disciplinas de la nueva serie.` +
    (lost.length ? `\n\nObjetos especiales que NO pasan a la serie Grand Master:\n- ${lost.map(i => i.name).join('\n- ')}` : '');
  if (!confirm(msg)) return;
  mut(x => {
    const p = permBonus(x);
    x.cs += p.cs; x.end += p.end;
    x.series = toGM ? 'gm' : 'magnakai';
    x.book = next; x.disc = []; x.wm = []; x.usedDel = false; x.combat = freshCombat(); x.trail = []; x.section = ''; x.combatHere = false;
    x.legacy = { ...leg(x), [toGM ? 'magnakai' : 'basic']: true };
    if (toGM) x.special = x.special.filter(i => !lost.includes(i));
    x.endNow = maxEnd(x);
  });
}

/* ---------- views ---------- */
const ICONS = {
  sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',
  gear: '<path d="M8 8a4 4 0 0 1 8 0"/><rect x="5" y="8" width="14" height="13" rx="3"/><path d="M9 14h6"/>',
  combat: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4"/><path d="M7 17l-3 3"/><path d="M3 19l2 2"/>',
  roll: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  more: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};
const TABS = [['sheet', 'Ficha'], ['gear', 'Equipo'], ['combat', 'Combate'], ['roll', 'Dado'], ['more', 'Más']];

function stepper(act, val, steps, extra) {
  const neg = steps.slice().reverse().map(n => `<button class="btn" data-act="${act}" data-arg="${-n}">−${n}</button>`).join('');
  const pos = steps.map(n => `<button class="btn" data-act="${act}" data-arg="${n}">+${n}</button>`).join('');
  return `<div class="steps" style="grid-template-columns:repeat(${steps.length},1fr) 1.3fr repeat(${steps.length},1fr)">${neg}<div class="num" style="display:grid;place-items:center;font-size:24px;font-weight:700">${val}${extra || ''}</div>${pos}</div>`;
}

function viewSheet(c) {
  const s = SR(c), max = maxEnd(c), pct = clamp(c.endNow / max * 100, 0, 100);
  const cls = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : '';
  const p = permBonus(c);
  const csNote = p.cs ? `base ${c.cs} · bonus ${sgn(p.cs)}` : 'base';
  const endNote = (p.end || itemEnd(c)) ? `base ${c.end} · bonus ${sgn(p.end + itemEnd(c))}` : 'máximo';
  const pd = pendDisc(c), pw = pendWm(c);
  const rank = rankOf(c.series, discAllowed(c));
  const quick = [];
  if (hasHeal(c)) quick.push(`<button class="btn sm" data-act="heal-section" ${c.endNow >= max ? 'disabled' : ''}>${esc(healName(c))} +1 manual</button>`);
  const em = MODS(c).emergency;
  if (em) quick.push(`<button class="btn" data-act="emergency" ${c.usedDel || c.endNow > em.threshold ? 'disabled' : ''}>${em.name} +${em.amount} END</button>`);
  if (em && c.usedDel) quick.push(`<button class="btn sm" data-act="emergency-reset">Han pasado ${em.days} días</button>`);
  const lore = c.series === 'magnakai' ? loreStatus(c.disc) : null;

  return `
  <section class="hero card">
    <div class="title">${esc(c.name)}</div>
    <div class="meta">Libro ${c.book} · ${esc(BOOK_TITLES[c.book])}<br>${esc(s.label)} · ${esc(rank)}</div>
  </section>
  <div class="card" style="margin-top:10px">
    <div class="row"><label class="field grow">Sección actual<input id="f-section" inputmode="numeric" value="${esc(c.section)}" placeholder="Número" autocomplete="off"></label>
      <button class="btn primary" data-act="go-section" style="align-self:end">Ir</button>
      <button class="icon-btn" data-act="undo-section" aria-label="Deshacer la última sección" style="align-self:end;width:46px;height:46px" ${c.trail.length ? '' : 'disabled'}>↶</button></div>
    ${hasHeal(c) ? `<div class="muted small" style="margin-top:8px">${esc(healName(c))}: +1 END automático por cada sección sin combate.</div>` : ''}
  </div>
  <div class="vs" style="margin-top:10px">
    <div class="card"><div class="stat-label">Combat Skill</div><div class="stat-big">${totalCS(c)}</div><div class="muted small" style="margin-top:6px">${csNote}</div></div>
    <div class="card"><div class="stat-label">Endurance</div><div class="stat-big">${c.endNow}<small> / ${max}</small></div>
      <div class="bar ${cls}"><i style="width:${pct}%"></i></div><div class="muted small">${endNote}</div></div>
  </div>
  <div class="steps" style="margin-top:10px"><button class="btn" data-act="end" data-arg="-5">−5</button><button class="btn" data-act="end" data-arg="-1">−1</button><button class="btn" data-act="end" data-arg="1">+1</button><button class="btn" data-act="end" data-arg="5">+5</button></div>
  ${c.endNow <= 0 ? '<div class="banner red" style="margin-top:10px"><b>Endurance a cero: la aventura ha terminado.</b></div>' : ''}
  ${quick.length ? `<div class="row wrap" style="margin-top:10px">${quick.join('')}</div>` : ''}

  <h2>Gold Crowns <small class="muted">máx. 50</small></h2>
  ${stepper('gold', c.gold, [1, 10])}

  <h2>Disciplinas <small class="muted">${c.disc.length} de ${discAllowed(c)}</small></h2>
  ${pd ? `<div class="banner"><div class="grow"><b>Tienes ${pd} disciplina${pd > 1 ? 's' : ''} por elegir</b></div><button class="btn primary sm" data-act="pick-disc">Elegir</button></div>` : ''}
  <div class="list" style="margin-top:${pd ? 10 : 0}px">
    ${c.disc.map(n => { const d = s.disciplines.find(x => x.name === n); return `<details class="disc"><summary>${esc(n)}</summary><p>${esc(d ? d.desc : '')}</p></details>`; }).join('') || '<p class="muted">Aún no has elegido disciplinas.</p>'}
  </div>
  ${hasWM(c) ? `
  <h2>${esc(s.wmName)} <small class="muted">${c.wm.length} de ${wmAllowed(c)}</small></h2>
  ${pw ? `<div class="banner"><div class="grow"><b>Elige ${pw} arma${pw > 1 ? 's' : ''} más</b></div><button class="btn primary sm" data-act="pick-wm">Elegir</button></div>` : ''}
  <div class="row wrap" style="margin-top:${pw ? 10 : 0}px">${c.wm.map(w => `<span class="chip">${esc(w)}</span>`).join('')}</div>` : ''}
  ${lore ? `
  <h2>Lore-circles</h2>
  <div class="list">${lore.map(l => `<div class="item"><div class="name">${l.name}<small>${l.needs.join(' · ')}</small></div>${l.done ? `<span class="badge green">${l.cs ? '+' + l.cs + ' CS ' : ''}+${l.end} END</span>` : `<span class="badge">${l.have}/${l.needs.length}</span>`}</div>`).join('')}</div>` : ''}
  `;
}

function viewGear(c) {
  const s = SR(c), used = packUsed(c);
  const weaponRow = w => `<div class="item"><div class="name">${esc(w.name)}${w.name !== w.type ? `<small>${esc(w.type)}</small>` : ''}</div>${w.cs ? `<span class="badge">${sgn(w.cs)} CS</span>` : ''}${c.wm.includes(w.type) ? `<span class="badge green">${esc(s.wmName)}</span>` : ''}<button class="icon-btn" data-act="del-weapon" data-arg="${w.id}" aria-label="Quitar">✕</button></div>`;
  const packRow = i => `<div class="item"><div class="name">${esc(i.name)}</div>${i.heal ? `<button class="btn sm" data-act="use-pack" data-arg="${i.id}">Usar +${i.heal} END</button>` : ''}<button class="icon-btn" data-act="del-pack" data-arg="${i.id}" aria-label="Quitar">✕</button></div>`;
  const specRow = i => `<div class="item"><div class="name">${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</div>
    ${i.cs ? `<span class="badge">${sgn(i.cs)} CS</span>` : ''}${i.end ? `<span class="badge green">${sgn(i.end)} END</span>` : ''}
    ${i.qty != null ? `<div class="row" style="gap:6px"><button class="icon-btn" data-act="qty" data-arg="${i.id}:-1">−</button><b class="num">${i.qty}</b><button class="icon-btn" data-act="qty" data-arg="${i.id}:1">+</button></div>` : ''}
    <button class="icon-btn" data-act="del-special" data-arg="${i.id}" aria-label="Quitar">✕</button></div>`;
  const smax = specialMax(c);
  return `
  <h2>Armas <small class="muted">${c.weapons.length} de 2</small></h2>
  <div class="list">${c.weapons.map(weaponRow).join('') || '<p class="muted">Sin armas: combatirás con −4 CS.</p>'}</div>
  <div class="card stack" style="margin-top:10px">
    <div class="grid2">
      <label class="field">Tipo<select id="f-wtype">${WEAPONS.map(w => `<option>${w}</option>`).join('')}</select></label>
      <label class="field">Nombre (opcional)<input id="f-wname" autocomplete="off"></label>
    </div>
    <div class="row"><label class="field grow">Bonus CS (opcional)<input id="f-wcs" type="number" inputmode="numeric" placeholder="0"></label><button class="btn primary" data-act="add-weapon" style="align-self:end">Añadir arma</button></div>
  </div>

  <h2>Mochila <small class="muted">${used} de ${s.pack}</small></h2>
  <div class="card">
    <div class="row"><div class="grow"><b>Meals</b><div class="muted small">${freeMeals(c) ? 'Caza: no gastas comida' : 'Sin comida: −3 END'}</div></div>
      <button class="icon-btn" data-act="meal" data-arg="-1">−</button><b class="num" style="min-width:24px;text-align:center;font-size:20px">${c.meals}</b><button class="icon-btn" data-act="meal" data-arg="1">+</button>
      <button class="btn sm" data-act="eat">Comer</button></div>
  </div>
  <div class="list" style="margin-top:10px">${c.pack.map(packRow).join('')}</div>
  <div class="card stack" style="margin-top:10px">
    <div class="row"><label class="field grow">Objeto<input id="f-pname" autocomplete="off"></label><label class="field" style="width:96px">Cura END<input id="f-pheal" type="number" inputmode="numeric" placeholder="0"></label></div>
    <div class="row wrap"><button class="btn primary grow" data-act="add-pack">Añadir a la mochila</button><button class="btn sm" data-act="quick-potion">Potion of Laumspur (+4)</button></div>
  </div>

  <h2>Objetos especiales <small class="muted">${c.special.length}${smax ? ' de ' + smax : ''}</small></h2>
  <div class="list">${c.special.map(specRow).join('') || '<p class="muted">Aquí van los objetos que el libro llama Special Items.</p>'}</div>
  <div class="card stack" style="margin-top:10px">
    <label class="field">Nombre<input id="f-sname" autocomplete="off"></label>
    <div class="grid2"><label class="field">Bonus CS en combate<input id="f-scs" type="number" inputmode="numeric" placeholder="0"></label><label class="field">Bonus END máximo<input id="f-send" type="number" inputmode="numeric" placeholder="0"></label></div>
    <label class="field">Efecto / nota<input id="f-snote" autocomplete="off"></label>
    <button class="btn primary" data-act="add-special">Añadir objeto especial</button>
    <div class="row wrap">${PRESET_SPECIALS.map((q, i) => `<button class="chip" data-act="quick-special" data-arg="${i}">${esc(q.name)}${q.cs ? ` +${q.cs} CS` : ''}${q.end ? ` +${q.end} END` : ''}${q.qty ? ` (${q.qty})` : ''}</button>`).join('')}</div>
  </div>`;
}

function viewCombat(c) {
  const cb = c.combat, calc = combatCalc(c), s = SR(c), max = maxEnd(c);
  const ratio = calc.cs - cb.ecs;
  const epct = cb.started ? clamp(cb.e / cb.eend * 100, 0, 100) : 100;
  const lpct = clamp(c.endNow / max * 100, 0, 100);
  const psyOpts = psyOptions(c);
  const specials = c.special.filter(i => i.cs);
  const last = cb.last;
  const fmt = v => (v === 'K' ? 'K' : v);
  const over = cb.over;
  return `
  <div class="vs">
    <div class="card">
      <div class="stat-label">Enemigo</div>
      <input data-bind="cb-name" value="${esc(cb.name)}" placeholder="Nombre" autocomplete="off" style="margin:8px 0">
      <div class="stat-label">Combat Skill</div>
      <div class="steps" style="margin:6px 0 8px;grid-template-columns:1fr 1.2fr 1fr"><button class="btn" data-act="cb-ecs" data-arg="-1">−</button><div class="num" style="display:grid;place-items:center;font-size:26px;font-weight:700">${cb.ecs}</div><button class="btn" data-act="cb-ecs" data-arg="1">+</button></div>
      <div class="stat-label">Endurance</div>
      ${cb.started ? `<div class="stat-big" style="margin-top:4px">${cb.e}<small> / ${cb.eend}</small></div><div class="bar enemy"><i style="width:${epct}%"></i></div>` :
        `<div class="steps" style="margin:6px 0 0;grid-template-columns:1fr 1.2fr 1fr"><button class="btn" data-act="cb-eend" data-arg="-1">−</button><div class="num" style="display:grid;place-items:center;font-size:26px;font-weight:700">${cb.eend}</div><button class="btn" data-act="cb-eend" data-arg="1">+</button></div>`}
    </div>
    <div class="card">
      <div class="stat-label">Tú</div>
      <div class="stat-big" style="margin-top:8px">${totalCS(c)}<small> CS</small></div>
      <div class="stat-label" style="margin-top:10px">Endurance</div>
      <div class="stat-big" style="margin-top:4px">${c.endNow}<small> / ${max}</small></div>
      <div class="bar ${lpct <= 25 ? 'low' : lpct <= 50 ? 'mid' : ''}"><i style="width:${lpct}%"></i></div>
    </div>
  </div>

  <h2>Modificadores</h2>
  <div class="card stack">
    <label class="field">Arma en uso<select data-bind="cb-weapon"><option value="">Sin arma (${sgn(MODS(c).unarmed)} CS)</option>${c.weapons.map(w => `<option value="${w.id}" ${w.id === cb.weaponId ? 'selected' : ''}>${esc(w.name)}${w.type === 'Bow' ? ' (el arco no cuenta cuerpo a cuerpo)' : c.wm.includes(w.type) ? ` · ${s.wmName} ${sgn(MODS(c).wmBonus)}` : ''}</option>`).join('')}</select></label>
    ${calc.specWeapon ? `<div class="muted small">Estás usando ${esc(calc.specWeapon.name)} como arma: se ignora el arma de arriba.</div>` : ''}
    ${psyOpts.length ? `<div><div class="muted small" style="margin-bottom:6px">Ataque psíquico</div><div class="row wrap">
      <button class="chip ${cb.psy === 'none' || !calc.psy ? 'on' : ''}" data-act="cb-psy" data-arg="none">Ninguno</button>
      ${psyOpts.map(o => { const blocked = o.cost > 0 && c.endNow <= o.minEnd; return `<button class="chip ${calc.psy && calc.psy.id === o.id ? 'on' : ''}" data-act="cb-psy" data-arg="${o.id}" ${blocked ? 'disabled style="opacity:.4"' : ''}>${o.label} ${sgn(o.cs)} CS${o.cost ? ` · −${o.cost} END/asalto` : ''}</button>`; }).join('')}
    </div>${psyOpts.some(o => o.cost > 0 && c.endNow <= o.minEnd) ? '<div class="muted small" style="margin-top:6px">Con tu END actual no puedes usar el ataque con coste.</div>' : ''}<div class="muted small" style="margin-top:6px">Si la criatura es inmune, deja “Ninguno”.</div></div>` : ''}
    ${specials.map(i => `<label class="field">${esc(i.name)}<select data-bind="cb-item" data-id="${i.id}">
      <option value="off" ${itemMode(cb, i) === 'off' ? 'selected' : ''}>No usar</option>
      <option value="base" ${itemMode(cb, i) === 'base' ? 'selected' : ''}>${sgn(i.cs)} CS</option>
      ${i.alt ? `<option value="alt" ${itemMode(cb, i) === 'alt' ? 'selected' : ''}>${sgn(i.alt)} CS (${esc(i.note)})</option>` : ''}</select></label>`).join('')}
    ${calc.dbl ? `<button class="chip ${cb.undead ? 'on' : ''}" data-act="cb-flag" data-arg="undead">Enemigo no-muerto: daño ×2</button>` : ''}
    ${calc.flame ? `<button class="chip ${cb.flame ? 'on' : ''}" data-act="cb-flag" data-arg="flame">Arma en llamas: +1 daño por asalto</button>` : ''}
    ${calc.drain ? `<div class="muted small">Tu arma especial te cuesta −${calc.drain} END por asalto desde el segundo.</div>` : ''}
    <div class="row"><div class="grow"><b>Otros bonus de CS</b><div class="muted small">Condiciones que cita la sección</div></div>
      <button class="icon-btn" data-act="cb-extra" data-arg="-1">−</button><b class="num" style="min-width:30px;text-align:center;font-size:20px">${sgn(cb.extra) || 0}</b><button class="icon-btn" data-act="cb-extra" data-arg="1">+</button></div>
    <div class="breakdown">${calc.parts.map(p => `<div><span>${esc(p[0])}</span><b>${typeof p[1] === 'number' && p[0] !== 'Combat Skill' ? sgn(p[1]) : p[1]}</b></div>`).join('')}</div>
  </div>

  <div class="ratio" style="margin-top:10px"><div class="stat-label">Combat Ratio</div><div class="big">${sgn(ratio) || 0}</div><div class="muted small">${calc.cs} − ${cb.ecs}</div></div>

  ${over === 'win' ? '<div class="banner green" style="margin-top:10px"><b>Enemigo derrotado.</b></div>' : ''}
  ${over === 'dead' ? '<div class="banner red" style="margin-top:10px"><b>Lone Wolf ha caído.</b></div>' : ''}
  ${over === 'evade' ? '<div class="banner" style="margin-top:10px"><b>Has escapado del combate.</b></div>' : ''}

  ${last ? `<div class="result" style="margin-top:10px"><div class="muted small">Asalto ${cb.log.length} · número ${last.rn}${last.evade ? ' · evasión' : ''}</div><div class="rn">${last.rn}</div>
    <div class="loss"><span>Enemigo <b style="color:var(--red)">${last.evade ? 0 : last.e === 'K' ? 'K' : '−' + last.eLoss}</b>${last.extra ? `<small class="muted"> (${last.extra})</small>` : ''}</span><span>Tú <b style="color:var(--red)">${last.l === 'K' ? 'K' : '−' + (last.lLoss)}</b>${last.cost ? `<small class="muted"> (incl. −${last.cost} por ataque psíquico)</small>` : ''}</span></div></div>` : ''}

  <div class="stack" style="margin-top:10px">
    ${!cb.started ? `<button class="btn primary big block" data-act="cb-start">Empezar combate</button>` :
      over ? `<button class="btn primary big block" data-act="cb-end">Cerrar combate</button>` :
        `<button class="btn primary big block" data-act="cb-round">Tirar asalto</button>
         <div class="grid2"><button class="btn" data-act="cb-evade">Evadir</button><button class="btn" data-act="cb-undo" ${cb.log.length ? '' : 'disabled'}>Deshacer último</button></div>
         <details class="disc"><summary>Usar mi propio número</summary><div style="padding:0 12px 12px"><div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => `<button class="btn" data-act="cb-manual" data-arg="${n}">${n}</button>`).join('')}</div></div></details>
         <details class="disc"><summary>Ajustes manuales de END</summary><div style="padding:0 12px 12px" class="stack"><div class="muted small">Enemigo</div>${stepper('cb-eadj', cb.e, [1, 5])}<div class="muted small">Tú</div>${stepper('end', c.endNow, [1, 5])}</div></details>
         <button class="btn danger" data-act="cb-end">Abandonar combate</button>`}
    ${over && cb.log.length ? `<button class="btn" data-act="cb-undo">Deshacer último asalto</button>` : ''}
  </div>

  ${cb.log.length ? `<h2>Registro</h2><div class="card"><table class="log"><thead><tr><th>#</th><th>Ratio</th><th>N.º</th><th>Enemigo</th><th>Tú</th></tr></thead><tbody>
    ${cb.log.map((l, i) => `<tr><td>${i + 1}</td><td>${sgn(l.ratio) || 0}</td><td>${l.rn}</td><td>${l.evade ? '–' : (l.e === 'K' ? 'K' : l.eLoss) + ' → ' + l.eAfter}</td><td>−${l.lLoss} → ${l.lAfter}</td></tr>`).join('')}</tbody></table></div>` : ''}
  `;
}

function crtColumn(c) {
  const auto = combatCalc(c).cs - c.combat.ecs;
  const ratio = S.tableRatio != null ? S.tableRatio : (c.combat.started ? auto : 0);
  return { ratio, auto, col: crtCol(ratio) };
}

function viewRoll(c) {
  const n = S.roll, b = S.rollBonus, mb = missileBonus(c.series, c.disc, c.wm);
  const { ratio, col } = crtColumn(c);
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  const cell = v => (v === 'K' ? '<b style="color:var(--red)">K</b>' : v);
  const notes = rankNotes(c.series, c.disc);
  return `
  <h2 style="margin-top:8px">Número aleatorio <small>0 – 9</small></h2>
  <div class="card">
    <div class="die">${n == null ? '·' : n + b}</div>
    <div class="muted" style="text-align:center;min-height:22px">${n != null && b ? `${n} ${b > 0 ? '+' : '−'} ${Math.abs(b)}` : '&nbsp;'}</div>
    <button class="btn primary big block" data-act="roll" style="margin-top:12px">Tirar</button>
  </div>
  <div class="card" style="margin-top:10px">
    <div class="row"><div class="grow"><b>Bonus al número</b><div class="muted small">Para el arco y otras secciones que lo piden</div></div>
      <button class="icon-btn" data-act="roll-bonus" data-arg="-1">−</button><b class="num" style="min-width:30px;text-align:center;font-size:20px">${b > 0 ? '+' : b < 0 ? '−' : ''}${Math.abs(b)}</b><button class="icon-btn" data-act="roll-bonus" data-arg="1">+</button></div>
    ${mb ? `<div class="row wrap" style="margin-top:10px"><button class="chip ${b === mb ? 'on' : ''}" data-act="roll-bonus-set" data-arg="${mb}">Arco: +${mb}</button><button class="chip" data-act="roll-bonus-set" data-arg="0">Sin bonus</button></div>` : ''}
  </div>
  ${S.rollHist.length ? `<h2>Últimas tiradas</h2><div class="hist">${S.rollHist.map(x => `<span>${x}</span>`).join('')}</div>` : ''}

  <h2>Tabla de combate <small class="muted">columna ${CRT_LABELS[col]}</small></h2>
  <div class="card stack">
    <div><div class="stat-label" style="margin-bottom:6px">Combat Ratio</div>${stepper('tbl-ratio', sgn(ratio) || 0, [1, 5])}</div>
    ${c.combat.started ? '<button class="btn sm" data-act="tbl-auto">Usar el Combat Ratio del combate</button>' : ''}
    <table class="log"><thead><tr><th>N.º</th><th>Enemigo pierde</th><th>Tú pierdes</th></tr></thead><tbody>
    ${order.map(r => { const [e, l] = CRT[r][col]; return `<tr${S.roll === r ? ' style="background:rgba(216,166,74,.16)"' : ''}><td><b>${r}</b></td><td class="num">${cell(e)}</td><td class="num">${cell(l)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="muted small">K = muerte automática.</div>
  </div>
  <details class="disc" style="margin-top:10px"><summary>Tabla completa</summary><div class="crt-wrap" style="padding:0 12px 12px"><table class="crt"><thead><tr><th>N.º</th>${CRT_LABELS.map((l, i) => `<th class="${i === col ? 'hl' : ''}">${l}</th>`).join('')}</tr></thead><tbody>
    ${order.map(r => `<tr><th>${r}</th>${CRT[r].map(([e, l], i) => `<td class="${i === col ? 'hl' : ''}">${e}/${l}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <div class="muted small" style="margin-top:6px">Cada celda: enemigo / tú.</div></div></details>

  <h2>Reglas rápidas</h2>
  <details class="disc"><summary>Combate y evasión</summary><p>1) Suma a tu Combat Skill los bonus de disciplinas y objetos. 2) Combat Ratio = tu CS − CS del enemigo. 3) Saca un número 0–9. 4) Búscalo en la tabla y resta END a cada uno. 5) Repite hasta que uno llegue a 0. Para evadir, si la sección lo permite, resuelve ese asalto con normalidad pero ignora la pérdida del enemigo.</p></details>
  <details class="disc" style="margin-top:8px"><summary>Equipo y comida</summary><p>Máximo 2 armas. Sin arma, −4 CS. Mochila de ${SR(c).pack} objetos y las Meals ocupan sitio. Gold Crowns hasta 50. Sin comida pierdes 3 END. Las pociones se toman después del combate. Los objetos especiales no ocupan mochila${specialMax(c) ? ` (máximo ${specialMax(c)})` : ''}.</p></details>
  ${notes.auto.length || notes.manual.length ? `<details class="disc" style="margin-top:8px"><summary>Mejoras de tu rango</summary><p>${notes.auto.length ? '<b>La app las aplica:</b><br>' + notes.auto.map(esc).join('<br>') : ''}${notes.manual.length ? '<br><br><b>A mano:</b><br>' + notes.manual.map(esc).join('<br>') : ''}</p></details>` : ''}`;
}

function viewMore(c) {
  const chars = Object.values(S.data.chars);
  return `
  <h2 style="margin-top:8px">Ruta del libro <small class="muted">${c.trail.length} secciones</small></h2>
  <div class="row wrap">${c.trail.slice(-40).map(x => `<span class="chip">${esc(x.s)}</span>`).join('') || '<p class="muted">Registra tu ruta con el botón Ir de la Ficha.</p>'}</div>
  ${c.trail.length ? '<button class="btn sm" data-act="clear-trail" style="margin-top:10px">Limpiar ruta</button>' : ''}
  <h2>Notas del libro</h2>
  <textarea data-bind="notes" placeholder="Pistas, códigos, nombres…">${esc(c.notes)}</textarea>

  <h2>Progreso</h2>
  <div class="card stack">
    <div><b>Libro ${c.book}: ${esc(BOOK_TITLES[c.book])}</b><div class="muted small">${esc(SR(c).label)} · libros ${SR(c).first}–${SR(c).last}</div></div>
    <button class="btn primary" data-act="complete-book">Libro completado → siguiente</button>
    <div class="grid2"><button class="btn" data-act="edit-disc">Editar disciplinas</button><button class="btn" data-act="edit-wm" ${hasWM(c) ? '' : 'disabled'}>Editar armas</button></div>
    <div class="grid2"><button class="btn" data-act="edit-stats">Corregir CS / END base</button><button class="btn" data-act="restore">Restaurar END</button></div>
  </div>

  ${c.series === 'magnakai' || c.series === 'gm' ? `<h2>Historial</h2><div class="list">
    ${c.series === 'magnakai' ? `<label class="check ${leg(c).basic ? 'on' : ''}"><input type="checkbox" data-bind="legacy" data-v="basic" ${leg(c).basic ? 'checked' : ''}><span><b>Completé los libros 1–5</b><span class="muted small">Conservas Hunting (sin gastar comida) y Healing (+1 END por sección sin combate).</span></span></label>` : `<label class="check ${leg(c).magnakai ? 'on' : ''}"><input type="checkbox" data-bind="legacy" data-v="magnakai" ${leg(c).magnakai ? 'checked' : ''}><span><b>Completé los libros 6–12</b><span class="muted small">Conservas el +1 END por sección sin combate.</span></span></label>`}
  </div>` : ''}

  <h2>Personajes</h2>
  <div class="list">${chars.map(x => `<div class="item"><div class="name">${esc(x.name)}<small>Libro ${x.book} · ${esc(SERIES[x.series].label)}</small></div>
    ${x.id === c.id ? '<span class="badge green">Activo</span>' : `<button class="btn sm" data-act="switch-char" data-arg="${x.id}">Abrir</button>`}
    <button class="icon-btn" data-act="delete-char" data-arg="${x.id}" aria-label="Borrar">✕</button></div>`).join('')}</div>
  <button class="btn block" style="margin-top:10px" data-act="new-char">Nuevo personaje</button>

  <h2>Copia de seguridad</h2>
  <div class="card stack">
    <p class="muted small">Tus datos viven solo en este navegador. Exporta una copia de vez en cuando.</p>
    <div class="grid2"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div>
    <input id="import-file" type="file" accept="application/json,.json" hidden>
  </div>`;
}

function viewWelcome() {
  return `
  <div style="padding-top:12vh;text-align:center" class="stack">
    <div style="width:96px;height:96px;margin:0 auto"><img src="icon.svg" alt="" width="96" height="96" style="border-radius:22px"></div>
    <h1 style="font-size:28px">Hoja de Acción</h1>
    <p class="muted">Lone Wolf · Libros 1 al 32</p>
    <button class="btn primary big block" data-act="new-char" style="margin-top:16px">Crear personaje</button>
    <button class="btn block" data-act="import">Importar copia de seguridad</button>
    <input id="import-file" type="file" accept="application/json,.json" hidden>
  </div>`;
}

/* ---------- wizard ---------- */
function wizInit(book, name) {
  return { book: book || 1, name: name || '', cs: null, end: null, csNote: '', endNote: '', gold: 0, goldNote: '', disc: [], wm: [], picks: [], kaiItem: null, kw: null, legacy: { basic: false, magnakai: false } };
}
const wizSeries = w => SERIES[seriesOfBook(w.book)];
const wizDiscN = w => { const s = wizSeries(w); return Math.min(s.discMax, s.discBase + w.book - s.first); };
const wizWmN = w => { const s = wizSeries(w); return w.disc.some(d => WM_NAMES.includes(d)) ? s.wmBase + (s.wmGrows ? w.book - s.first : 0) : 0; };

function viewWizard() {
  const w = S.wiz, s = wizSeries(w), sk = s.id, start = w.book === s.first;
  const dn = wizDiscN(w), wn = wizWmN(w);
  const weapons = sk === 'kai' ? WEAPONS.filter(x => x !== 'Bow') : WEAPONS;
  const pickCount = w.picks.length, pickWeapons = w.picks.filter(i => START_PICKS[sk][i].kind === 'weapon').length;
  const ready = w.cs != null && w.end != null;
  return `
  <div class="row" style="justify-content:space-between"><h1 style="font-size:24px">Nuevo personaje</h1><button class="btn sm" data-act="w-cancel">Cancelar</button></div>

  <div class="wizard-step"><h2>1 · Datos</h2>
    <div class="stack">
      <label class="field">Nombre<input data-bind="w-name" value="${esc(w.name)}" placeholder="Lone Wolf" autocomplete="off"></label>
      <label class="field">Libro en el que empiezas<select data-bind="w-book">${Object.entries(BOOK_TITLES).map(([n, t]) => `<option value="${n}" ${Number(n) === w.book ? 'selected' : ''}>${n} · ${esc(t)}</option>`).join('')}</select></label>
      ${sk === 'magnakai' ? `<label class="check ${w.legacy.basic ? 'on' : ''}"><input type="checkbox" data-bind="w-legacy" data-v="basic" ${w.legacy.basic ? 'checked' : ''}><span><b>Completé los libros 1–5</b><span class="muted small">Conservas Hunting y Healing de la serie Kai.</span></span></label>` : ''}
      ${sk === 'gm' ? `<label class="check ${w.legacy.magnakai ? 'on' : ''}"><input type="checkbox" data-bind="w-legacy" data-v="magnakai" ${w.legacy.magnakai ? 'checked' : ''}><span><b>Completé los libros 6–12</b><span class="muted small">Conservas el +1 END por sección sin combate.</span></span></label>` : ''}
      <div class="muted small">Serie ${esc(s.label)}. ${start ? 'Es el primer libro de la serie: tiras el personaje desde cero.' : 'Empiezas a mitad de serie: escribe tus valores actuales y elige las disciplinas que tendrías.'}</div>
    </div>
  </div>

  <div class="wizard-step"><h2>2 · Combat Skill y Endurance</h2>
    <div class="stack">
      <div class="rollbox"><label class="field">Combat Skill${w.csNote ? ` <span class="muted">(${w.csNote})</span>` : ''}<input data-bind="w-cs" type="number" inputmode="numeric" value="${w.cs ?? ''}"></label><button class="btn" data-act="w-roll-cs">Tirar (+${s.csAdd})</button></div>
      <div class="rollbox"><label class="field">Endurance${w.endNote ? ` <span class="muted">(${w.endNote})</span>` : ''}<input data-bind="w-end" type="number" inputmode="numeric" value="${w.end ?? ''}"></label><button class="btn" data-act="w-roll-end">Tirar (+${s.endAdd})</button></div>
      ${!start ? '<div class="muted small">Si vienes de libros anteriores, usa tus valores actuales sin bonus de Lore-circles ni de disciplinas extra: la app los suma sola.</div>' : ''}
    </div>
  </div>

  <div class="wizard-step"><h2>3 · Disciplinas <small class="muted">${w.disc.length} de ${dn}</small></h2>
    <div class="list">${s.disciplines.map(d => { const on = w.disc.includes(d.name), lock = !on && w.disc.length >= dn; return `<label class="check ${on ? 'on' : ''} ${lock ? 'locked' : ''}"><input type="checkbox" data-bind="w-disc" data-v="${esc(d.name)}" ${on ? 'checked' : ''}><span><b>${esc(d.name)}</b><span class="muted small">${esc(d.desc)}</span></span></label>`; }).join('')}</div>
    ${wn ? `<h2 style="margin-top:18px">${esc(s.wmName)} <small class="muted">${w.wm.length} de ${wn}</small></h2><div class="row wrap">${weapons.map(x => `<button class="chip ${w.wm.includes(x) ? 'on' : ''}" data-act="w-wm" data-arg="${x}">${x}</button>`).join('')}</div>` : ''}
  </div>

  <div class="wizard-step"><h2>4 · Oro y equipo</h2>
    ${start ? `
    <div class="stack">
      <div class="rollbox"><label class="field">Gold Crowns${w.goldNote ? ` <span class="muted">(${w.goldNote})</span>` : ''}<input data-bind="w-gold" type="number" inputmode="numeric" value="${w.gold}"></label><button class="btn" data-act="w-roll-gold">Tirar${s.goldAdd ? ` (+${s.goldAdd})` : ''}</button></div>
      ${sk === 'kai' ? `
        <div class="card">Empiezas con un <b>Axe</b> y <b>1 Meal</b>.</div>
        <div class="card stack"><div class="row"><div class="grow"><b>Objeto aleatorio</b><div class="muted small">${w.kaiItem ? `Número ${w.kaiItem.rn}: ${esc(KAI_START_ITEMS[w.kaiItem.rn].label)}` : 'Aún sin tirar'}</div></div><button class="btn" data-act="w-roll-item">${w.kaiItem ? 'Repetir' : 'Tirar'}</button></div></div>`
        : `<div class="muted small">Elige 5 objetos (máximo 2 armas). <b>${pickCount}/5</b></div>
        <div class="list">${START_PICKS[sk].map((it, i) => { const on = w.picks.includes(i); const lock = !on && (pickCount >= 5 || (it.kind === 'weapon' && pickWeapons >= 2)); return `<label class="check ${on ? 'on' : ''} ${lock ? 'locked' : ''}"><input type="checkbox" data-bind="w-pick" data-v="${i}" ${on ? 'checked' : ''}><span><b>${esc(it.label)}</b></span></label>`; }).join('')}</div>`}
      ${sk === 'no' ? `
        <div class="card stack"><div class="row"><div class="grow"><b>Kai Weapon</b><div class="muted small">${w.kw != null ? `${esc(KAI_WEAPONS[w.kw].type)} “${esc(KAI_WEAPONS[w.kw].name)}”: +5 CS, +${KAI_WEAPONS[w.kw].alt} ${esc(KAI_WEAPONS[w.kw].prop)}` : 'Elige una o tira'}</div></div><button class="btn" data-act="w-roll-kw">Tirar</button></div>
        <select data-bind="w-kw"><option value="">— elegir —</option>${KAI_WEAPONS.map((k, i) => `<option value="${i}" ${w.kw === i ? 'selected' : ''}>${k.rn} · ${k.type} “${k.name}” (${k.prop} +${k.alt})</option>`).join('')}</select></div>` : ''}
    </div>` : `
    <div class="stack"><label class="field">Gold Crowns<input data-bind="w-gold" type="number" inputmode="numeric" value="${w.gold}"></label>
    <div class="muted small">El resto del equipo lo añades luego en la pestaña Equipo.</div></div>`}
  </div>

  <div class="sticky-foot"><button class="btn primary big block" data-act="w-create" ${ready ? '' : 'disabled'}>Crear personaje</button>${ready ? '' : '<div class="muted small" style="text-align:center;margin-top:6px">Falta Combat Skill y Endurance</div>'}</div>`;
}

/* ---------- modal ---------- */
function openPicker(type) {
  const c = cur(), s = SR(c), edit = type.startsWith('edit');
  if (type.endsWith('disc')) {
    const owned = c.disc.slice();
    S.modal = { type: 'disc', edit, title: edit ? 'Editar disciplinas' : 'Elige disciplinas', limit: edit ? discAllowed(c) : pendDisc(c), sel: edit ? owned : [],
      options: s.disciplines.filter(d => edit || !owned.includes(d.name)).map(d => ({ v: d.name, label: d.name, desc: d.desc })) };
  } else {
    const owned = c.wm.slice(), list = c.series === 'kai' ? WEAPONS.filter(x => x !== 'Bow') : WEAPONS;
    S.modal = { type: 'wm', edit, title: edit ? 'Editar armas' : `Elige armas (${s.wmName})`, limit: edit ? wmAllowed(c) : pendWm(c), sel: edit ? owned : [],
      options: list.filter(x => edit || !owned.includes(x)).map(x => ({ v: x, label: x, desc: '' })) };
  }
  renderModal();
}
function renderModal() {
  const m = S.modal, root = $('#modal-root');
  if (!m) { root.innerHTML = ''; return; }
  root.innerHTML = `<div class="modal-bg" data-act="modal-close"><div class="modal" role="dialog" aria-modal="true">
    <h3>${esc(m.title)}</h3><p class="muted small" style="margin-bottom:12px">${m.sel.length} de ${m.limit} seleccionadas</p>
    <div class="list">${m.options.map(o => { const on = m.sel.includes(o.v), lock = !on && m.sel.length >= m.limit; return `<label class="check ${on ? 'on' : ''} ${lock ? 'locked' : ''}"><input type="checkbox" data-act="modal-toggle" data-arg="${esc(o.v)}" ${on ? 'checked' : ''}><span><b>${esc(o.label)}</b>${o.desc ? `<span class="muted small">${esc(o.desc)}</span>` : ''}</span></label>`; }).join('')}</div>
    <div class="sticky-foot grid2"><button class="btn" data-act="modal-close">Cancelar</button><button class="btn primary" data-act="modal-ok">Aceptar</button></div></div></div>`;
}

/* ---------- render ---------- */
function render(opts) {
  const y = window.scrollY, c = cur(), view = $('#view'), tabs = $('#tabs');
  if (S.wiz) { view.innerHTML = viewWizard(); tabs.style.display = 'none'; }
  else if (!c) { view.innerHTML = viewWelcome(); tabs.style.display = 'none'; }
  else {
    tabs.style.display = '';
    const body = { sheet: viewSheet, gear: viewGear, combat: viewCombat, roll: viewRoll, more: viewMore }[S.tab];
    view.innerHTML = body(c);
    tabs.innerHTML = `<div class="inner">${TABS.map(([k, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${l}</button>`).join('')}</div>`;
  }
  renderModal();
  window.scrollTo(0, opts && opts.top ? 0 : y);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- actions ---------- */
function readNum(id) { const v = parseInt($('#' + id).value, 10); return Number.isFinite(v) ? v : 0; }
function readStr(id) { return $('#' + id).value.trim(); }

function doRound(c, n, evade) {
  const cb = c.combat; if (!cb.started || cb.over) return;
  const calc = combatCalc(c), ratio = calc.cs - cb.ecs;
  const r = resolveRound(ratio, n, cb.e, c.endNow, { evade, cost: calc.cost });
  let eLoss = r.eLoss; const extra = [];
  if (!evade && eLoss > 0) {
    if (calc.dbl && cb.undead && r.e !== 'K') { eLoss *= 2; extra.push('×2'); }
    if (calc.flame && cb.flame) { eLoss += 1; extra.push('+1'); }
  }
  const eAfter = Math.max(0, cb.e - eLoss);
  const entry = { rn: n, ratio, e: r.e, l: r.l, eLoss, lLoss: r.lLoss, cost: calc.cost, eBefore: cb.e, lBefore: c.endNow, evade: !!evade, eAfter, lAfter: r.lwAfter, extra: extra.join(' ') };
  cb.log.push(entry); cb.last = entry; cb.e = eAfter; c.endNow = r.lwAfter;
  cb.over = evade ? 'evade' : c.endNow <= 0 ? 'dead' : cb.e <= 0 ? 'win' : null;
}

const ACT = {
  tab: t => { S.tab = t; render({ top: true }); },
  'new-char': () => { S.wiz = wizInit(1); render({ top: true }); },
  'w-cancel': () => { S.wiz = null; render({ top: true }); },
  'switch-char': id => { S.data.active = id; S.tab = 'sheet'; save(); render({ top: true }); },
  'delete-char': id => {
    const x = S.data.chars[id];
    if (!confirm(`¿Borrar a ${x.name}? No se puede deshacer.`)) return;
    delete S.data.chars[id];
    if (S.data.active === id) S.data.active = Object.keys(S.data.chars)[0] || null;
    save(); render({ top: true });
  },
  end: d => mut(c => { c.endNow += Number(d); }),
  gold: d => mut(c => { c.gold = clamp(c.gold + Number(d), 0, 50); }),
  'heal-section': () => mut(c => { c.endNow += 1; }),
  emergency: () => mut(c => { const em = MODS(c).emergency; if (em) { c.endNow += em.amount; c.usedDel = true; } }),
  'emergency-reset': () => mut(c => { c.usedDel = false; }),
  'go-section': () => {
    const num = parseInt($('#f-section').value, 10);
    if (!(num > 0)) { toast('Escribe un número de sección'); return; }
    mut(c => {
      // Healing / Curing: +1 END for each section passed without combat; that is the section we are leaving
      const healed = !!(c.section && !c.combatHere && hasHeal(c) && c.endNow < maxEnd(c));
      if (healed) { c.endNow += 1; toast(`${healName(c)}: +1 END`); }
      c.trail.push({ s: String(num), from: c.section || '', healed });
      if (c.trail.length > 400) c.trail.shift();
      c.section = String(num); c.combatHere = false;
    });
  },
  'undo-section': () => mut(c => {
    const l = c.trail.pop(); if (!l) return;
    if (l.healed) c.endNow -= 1;
    c.section = l.from; c.combatHere = false;
  }),
  'clear-trail': () => mut(c => { c.trail = []; }),
  'cb-flag': k => mut(c => { c.combat[k] = !c.combat[k]; }),
  'cb-eadj': d => mut(c => {
    const cb = c.combat; cb.e = Math.max(0, cb.e + Number(d));
    cb.over = cb.over === 'dead' ? 'dead' : cb.e <= 0 ? 'win' : null;
  }),
  'roll-bonus-set': v => { S.rollBonus = Number(v); render(); },
  'tbl-ratio': d => { const c = cur(); S.tableRatio = clamp(crtColumn(c).ratio + Number(d), -25, 25); render(); },
  'tbl-auto': () => { S.tableRatio = null; render(); },
  'pick-disc': () => openPicker('disc'), 'pick-wm': () => openPicker('wm'),
  'edit-disc': () => openPicker('edit-disc'), 'edit-wm': () => openPicker('edit-wm'),
  'edit-stats': () => {
    const c = cur(), cs = prompt('Combat Skill base (sin bonus automáticos):', c.cs); if (cs === null) return;
    const en = prompt('Endurance base (sin bonus automáticos):', c.end); if (en === null) return;
    const a = parseInt(cs, 10), b = parseInt(en, 10);
    if (!(a > 0 && b > 0)) { toast('Valores no válidos'); return; }
    mut(x => { x.cs = a; x.end = b; });
  },
  restore: () => mut(c => { c.endNow = maxEnd(c); }),
  'complete-book': completeBook,

  'modal-close': () => { S.modal = null; renderModal(); },
  'modal-toggle': (v, el) => {
    const m = S.modal, i = m.sel.indexOf(v);
    if (i >= 0) m.sel.splice(i, 1);
    else if (m.sel.length < m.limit) m.sel.push(v);
    else toast(`Máximo ${m.limit}`);
    renderModal();
  },
  'modal-ok': () => {
    const m = S.modal; S.modal = null;
    mut(c => {
      if (m.type === 'disc') c.disc = m.edit ? m.sel.slice() : c.disc.concat(m.sel);
      else c.wm = m.edit ? m.sel.slice() : c.wm.concat(m.sel);
    });
  },

  'add-weapon': () => {
    const c = cur(); if (c.weapons.length >= 2) { toast('Máximo 2 armas'); return; }
    const type = $('#f-wtype').value, name = readStr('f-wname') || type, bonus = readNum('f-wcs');
    mut(x => { x.weapons.push({ id: uid(), name, type, cs: bonus }); });
  },
  'del-weapon': id => mut(c => { c.weapons = c.weapons.filter(w => w.id !== id); if (c.combat.weaponId === id) c.combat.weaponId = null; }),
  'add-pack': () => {
    const c = cur(), name = readStr('f-pname'); if (!name) { toast('Escribe el nombre'); return; }
    if (packUsed(c) >= SR(c).pack) { toast('Mochila llena'); return; }
    mut(x => { x.pack.push({ id: uid(), name, heal: Math.max(0, readNum('f-pheal')) }); });
  },
  'quick-potion': () => {
    const c = cur(); if (packUsed(c) >= SR(c).pack) { toast('Mochila llena'); return; }
    mut(x => { x.pack.push({ id: uid(), name: 'Potion of Laumspur', heal: 4 }); });
  },
  'del-pack': id => mut(c => { c.pack = c.pack.filter(i => i.id !== id); }),
  'use-pack': id => mut(c => { const i = c.pack.find(p => p.id === id); if (!i) return; c.endNow += i.heal; c.pack = c.pack.filter(p => p.id !== id); toast(`${i.name}: +${i.heal} END`); }),
  meal: d => {
    const c = cur();
    if (Number(d) > 0 && packUsed(c) >= SR(c).pack) { toast('Mochila llena'); return; }
    mut(x => { x.meals = Math.max(0, x.meals + Number(d)); });
  },
  eat: () => mut(c => {
    if (freeMeals(c)) toast('Tu disciplina de caza te ahorra la comida');
    else if (c.meals > 0) { c.meals--; toast('Has comido'); }
    else { c.endNow -= 3; toast('Sin comida: −3 END'); }
  }),
  'add-special': () => {
    const c = cur(), name = readStr('f-sname'); if (!name) { toast('Escribe el nombre'); return; }
    if (specialMax(c) && c.special.length >= specialMax(c)) { toast(`Máximo ${specialMax(c)} objetos especiales`); return; }
    mut(x => { x.special.push({ id: uid(), name, cs: readNum('f-scs'), end: readNum('f-send'), note: readStr('f-snote') }); });
  },
  'quick-special': i => {
    const c = cur(); if (specialMax(c) && c.special.length >= specialMax(c)) { toast(`Máximo ${specialMax(c)} objetos especiales`); return; }
    const q = PRESET_SPECIALS[Number(i)];
    mut(x => { x.special.push({ id: uid(), name: q.name, cs: q.cs || 0, alt: q.alt, end: q.end || 0, note: q.note || '', qty: q.qty, isWeapon: q.isWeapon, wmOf: q.wmOf, dbl: q.dbl, drain: q.drain }); });
  },
  'del-special': id => mut(c => { c.special = c.special.filter(i => i.id !== id); }),
  qty: arg => { const [id, d] = arg.split(':'); mut(c => { const i = c.special.find(x => x.id === id); if (i) i.qty = Math.max(0, i.qty + Number(d)); }); },

  'cb-ecs': d => mut(c => { c.combat.ecs = clamp(c.combat.ecs + Number(d), 0, 99); }),
  'cb-eend': d => mut(c => { c.combat.eend = clamp(c.combat.eend + Number(d), 1, 199); }),
  'cb-extra': d => mut(c => { c.combat.extra += Number(d); }),
  'cb-psy': v => mut(c => { c.combat.psy = v; }),
  'cb-start': () => mut(c => {
    const cb = c.combat; cb.started = true; cb.e = cb.eend; cb.log = []; cb.last = null; cb.over = null; c.combatHere = true;
    if (!c.weapons.some(w => w.id === cb.weaponId)) { const w = c.weapons.find(x => x.type !== 'Bow'); cb.weaponId = w ? w.id : null; }
  }),
  'cb-round': () => mut(c => doRound(c, rn(), false)),
  'cb-manual': n => mut(c => doRound(c, Number(n), false)),
  'cb-evade': () => mut(c => doRound(c, rn(), true)),
  'cb-undo': () => mut(c => {
    const cb = c.combat, l = cb.log.pop(); if (!l) return;
    cb.e = l.eBefore; c.endNow = l.lBefore; cb.over = null; cb.last = cb.log[cb.log.length - 1] || null;
  }),
  'cb-end': () => mut(c => { const old = c.combat; c.combat = { ...freshCombat(), ecs: old.ecs, eend: old.eend, psy: old.psy, weaponId: old.weaponId, items: old.items }; }),

  roll: () => { const n = rn(); S.roll = n; S.rollHist.unshift(n + S.rollBonus); S.rollHist = S.rollHist.slice(0, 12); render(); },
  'roll-bonus': d => { S.rollBonus = clamp(S.rollBonus + Number(d), -9, 9); render(); },

  export: () => {
    const blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `lone-wolf-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import: () => { const f = $('#import-file'); if (f) f.click(); },

  // wizard
  'w-roll-cs': () => { const s = wizSeries(S.wiz), n = rn(); S.wiz.cs = n + s.csAdd; S.wiz.csNote = `${n} + ${s.csAdd}`; render(); },
  'w-roll-end': () => { const s = wizSeries(S.wiz), n = rn(); S.wiz.end = n + s.endAdd; S.wiz.endNote = `${n} + ${s.endAdd}`; render(); },
  'w-roll-gold': () => { const s = wizSeries(S.wiz), n = rn(); S.wiz.gold = clamp(n + s.goldAdd, 0, 50); S.wiz.goldNote = `${n} + ${s.goldAdd}`; render(); },
  'w-roll-item': () => { S.wiz.kaiItem = { rn: rn() }; render(); },
  'w-roll-kw': () => { S.wiz.kw = rn(); render(); },
  'w-wm': v => {
    const w = S.wiz, i = w.wm.indexOf(v);
    if (i >= 0) w.wm.splice(i, 1); else if (w.wm.length < wizWmN(w)) w.wm.push(v); else toast(`Máximo ${wizWmN(w)}`);
    render();
  },
  'w-create': () => {
    const w = S.wiz; if (w.cs == null || w.end == null) return;
    createChar(w); S.wiz = null; S.tab = 'sheet'; render({ top: true });
    const c = cur(); if (pendDisc(c) || pendWm(c)) toast('Te faltan disciplinas o armas por elegir');
  },
};

const BIND = {
  legacy: (v, el) => mut(c => { c.legacy = { ...leg(c), [el.dataset.v]: el.checked }; }),
  'w-legacy': (v, el) => { S.wiz.legacy[el.dataset.v] = el.checked; render(); },
  notes: v => { cur().notes = v; save(); },
  'cb-name': v => { cur().combat.name = v; save(); },
  'cb-weapon': v => mut(c => { c.combat.weaponId = v || null; }),
  'cb-item': (v, el) => mut(c => { c.combat.items[el.dataset.id] = v; }),
  'w-name': v => { S.wiz.name = v; },
  'w-book': v => { const old = S.wiz; S.wiz = wizInit(Number(v), old.name); render({ top: false }); },
  'w-cs': v => { S.wiz.cs = v === '' ? null : parseInt(v, 10); S.wiz.csNote = ''; render(); },
  'w-end': v => { S.wiz.end = v === '' ? null : parseInt(v, 10); S.wiz.endNote = ''; render(); },
  'w-gold': v => { S.wiz.gold = clamp(parseInt(v, 10) || 0, 0, 50); S.wiz.goldNote = ''; render(); },
  'w-disc': (v, el) => {
    const w = S.wiz, i = w.disc.indexOf(el.dataset.v);
    if (el.checked && w.disc.length < wizDiscN(w)) w.disc.push(el.dataset.v); else if (!el.checked && i >= 0) w.disc.splice(i, 1);
    if (!w.disc.some(d => WM_NAMES.includes(d))) w.wm = [];
    render();
  },
  'w-pick': (v, el) => {
    const w = S.wiz, sk = wizSeries(w).id, idx = Number(el.dataset.v), i = w.picks.indexOf(idx);
    if (i >= 0) w.picks.splice(i, 1);
    else {
      const it = START_PICKS[sk][idx], weapons = w.picks.filter(k => START_PICKS[sk][k].kind === 'weapon').length;
      if (w.picks.length >= 5) toast('Máximo 5 objetos'); else if (it.kind === 'weapon' && weapons >= 2) toast('Máximo 2 armas'); else w.picks.push(idx);
    }
    render();
  },
  'w-kw': v => { S.wiz.kw = v === '' ? null : Number(v); render(); },
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'INPUT') return; // checkboxes act on change
  if (t.classList.contains('modal-bg') && e.target !== t) return; // clicks inside the dialog do not dismiss it
  const fn = ACT[t.dataset.act]; if (fn) fn(t.dataset.arg, t);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'f-section') ACT['go-section'](); });
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then(txt => {
      try {
        const d = JSON.parse(txt); if (!d || !d.chars) throw new Error('formato');
        Object.assign(S.data.chars, d.chars); S.data.active = S.data.active || d.active || Object.keys(d.chars)[0] || null;
        save(); render({ top: true }); toast('Copia importada');
      } catch (err) { toast('Archivo no válido'); }
    });
    return;
  }
  if (t.dataset.act === 'modal-toggle') { ACT['modal-toggle'](t.dataset.arg, t); return; }
  if (t.dataset.bind) { const fn = BIND[t.dataset.bind]; if (fn) fn(t.type === 'checkbox' ? t.checked : t.value, t); }
});

render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
