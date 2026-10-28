'use strict';
/* Lone Wolf rules data, transcribed from the Project Aon editions (Books 1, 6, 13 and 21 rules sections).
   Classic script (no modules) so the app also opens from file://. */

// Combat Results Table. CRT[randomNumber][column] = [enemy END lost, Lone Wolf END lost]; 'K' = automatically killed.
// Columns (Combat Ratio): 0: <=-11, 1: -10/-9, 2: -8/-7, 3: -6/-5, 4: -4/-3, 5: -2/-1, 6: 0, 7: 1/2, 8: 3/4, 9: 5/6, 10: 7/8, 11: 9/10, 12: >=11
const CRT = [
  /* 0 */ [[6,0],[7,0],[8,0],[9,0],[10,0],[11,0],[12,0],[14,0],[16,0],[18,0],['K',0],['K',0],['K',0]],
  /* 1 */ [[0,'K'],[0,'K'],[0,8],[0,6],[1,6],[2,5],[3,5],[4,5],[5,4],[6,4],[7,4],[8,3],[9,3]],
  /* 2 */ [[0,'K'],[0,8],[0,7],[1,6],[2,5],[3,5],[4,4],[5,4],[6,3],[7,3],[8,3],[9,3],[10,2]],
  /* 3 */ [[0,8],[0,7],[1,6],[2,5],[3,5],[4,4],[5,4],[6,3],[7,3],[8,3],[9,2],[10,2],[11,2]],
  /* 4 */ [[0,8],[1,7],[2,6],[3,5],[4,4],[5,4],[6,3],[7,3],[8,2],[9,2],[10,2],[11,2],[12,2]],
  /* 5 */ [[1,7],[2,6],[3,5],[4,4],[5,4],[6,3],[7,2],[8,2],[9,2],[10,2],[11,2],[12,2],[14,2]],
  /* 6 */ [[2,6],[3,6],[4,5],[5,4],[6,3],[7,2],[8,2],[9,2],[10,2],[11,1],[12,1],[14,1],[16,1]],
  /* 7 */ [[3,5],[4,5],[5,4],[6,3],[7,2],[8,2],[9,1],[10,1],[11,1],[12,0],[14,0],[16,0],[18,0]],
  /* 8 */ [[4,4],[5,4],[6,3],[7,2],[8,1],[9,1],[10,0],[11,0],[12,0],[14,0],[16,0],[18,0],['K',0]],
  /* 9 */ [[5,3],[6,3],[7,2],[8,0],[9,0],[10,0],[11,0],[12,0],[14,0],[16,0],[18,0],['K',0],['K',0]],
];

function crtCol(ratio) {
  if (ratio <= -11) return 0;
  if (ratio >= 11) return 12;
  if (ratio === 0) return 6;
  return ratio > 0 ? 6 + Math.ceil(ratio / 2) : 6 - Math.ceil(-ratio / 2);
}

/* One combat round. opts.evade: enemy losses ignored. opts.cost: extra END Lone Wolf pays (Psi-surge / Kai-surge). */
function resolveRound(ratio, rn, enemyEnd, lwEnd, opts) {
  const o = opts || {};
  const [e, l] = CRT[rn][crtCol(ratio)];
  const eLoss = o.evade ? 0 : (e === 'K' ? enemyEnd : e);
  const lLoss = (l === 'K' ? lwEnd : l) + (o.cost || 0);
  return {
    e, l, eLoss, lLoss,
    enemyAfter: Math.max(0, enemyEnd - eLoss),
    lwAfter: Math.max(0, lwEnd - lLoss),
  };
}

const WEAPONS = ['Dagger', 'Spear', 'Mace', 'Short Sword', 'Warhammer', 'Sword', 'Axe', 'Quarterstaff', 'Broadsword', 'Bow'];

const KAI_DISCIPLINES = [
  { name: 'Camouflage', desc: 'Te mimetizas con el entorno; en ciudades pasas por nativo.' },
  { name: 'Hunting', desc: 'Nunca pasas hambre salvo en desierto o yermo: no gastas Meal cuando te mandan comer.', tags: ['meals'] },
  { name: 'Sixth Sense', desc: 'Avisa de peligro inminente y revela el propósito de extraños u objetos.' },
  { name: 'Tracking', desc: 'Elegir el camino correcto, localizar personas u objetos y leer huellas.' },
  { name: 'Healing', desc: '+1 END por cada sección sin combate (solo si tu END está por debajo del máximo).', tags: ['heal'] },
  { name: 'Weaponskill', desc: '+2 CS con el arma elegida.', tags: ['wm'] },
  { name: 'Mindshield', desc: 'No pierdes END por ataques de Mindforce / Mindblast enemigos.' },
  { name: 'Mindblast', desc: '+2 CS en combate. Algunas criaturas son inmunes.' },
  { name: 'Animal Kinship', desc: 'Comunicarte con algunos animales e intuir las intenciones de otros.' },
  { name: 'Mind Over Matter', desc: 'Mover objetos pequeños con la concentración.' },
];

const MAGNAKAI_DISCIPLINES = [
  { name: 'Weaponmastery', desc: '+3 CS con un arma dominada. Con Bow suma 3 al número aleatorio.', tags: ['wm'] },
  { name: 'Animal Control', desc: 'Comunicarte con la mayoría de animales y luchar a caballo con ventaja.' },
  { name: 'Curing', desc: '+1 END por cada sección sin combate (solo bajo el máximo). Además cura enfermedades y venenos.', tags: ['heal'] },
  { name: 'Invisibility', desc: 'Pasas desapercibido incluso en terreno abierto; imitas dialecto y modales locales.' },
  { name: 'Huntmastery', desc: 'Nunca pasas hambre, ni en el desierto: no gastas Meal. Ignora el CS perdido en emboscadas.', tags: ['meals'] },
  { name: 'Pathsmanship', desc: 'Leer idiomas y símbolos, detectar trampas, saber siempre dónde está el norte.' },
  { name: 'Psi-surge', desc: '+4 CS pero -2 END por asalto. No se puede usar con END 6 o menos. Incluye Mindblast (+2 CS, sin coste).' },
  { name: 'Psi-screen', desc: 'No pierdes END por ataques de Mindforce.' },
  { name: 'Nexus', desc: 'Resistes calor y frío extremos sin perder END y mueves objetos con la mente.' },
  { name: 'Divination', desc: 'Detecta peligros ocultos, enemigos invisibles y las intenciones de extraños.' },
];

const GM_DISCIPLINES = [
  { name: 'Grand Weaponmastery', desc: '+5 CS con un arma dominada. Con Bow suma 5 al número aleatorio.', tags: ['wm'] },
  { name: 'Animal Mastery', desc: 'Controlas criaturas hostiles no sapientes y hablas con aves y peces.' },
  { name: 'Deliverance', desc: 'Si en combate tu END baja a 8 o menos, recuperas 20 END. Una vez cada 20 días.', tags: ['deliverance'] },
  { name: 'Assimilance', desc: 'Cambias tu aspecto durante días y te camuflas casi sin ser detectado.' },
  { name: 'Grand Huntmastery', desc: 'Ves en total oscuridad. No gastas Meal cuando te mandan comer.', tags: ['meals'] },
  { name: 'Grand Pathsmanship', desc: 'Resistes plantas hostiles y detectas emboscadas en bosques.' },
  { name: 'Kai-surge', desc: '+8 CS con -1 END por asalto. No se puede usar con END 6 o menos. Incluye Mindblast (+4 CS, sin coste).' },
  { name: 'Kai-screen', desc: 'Fortalezas mentales que te protegen a ti y a otros en combate psíquico.' },
  { name: 'Grand Nexus', desc: 'Resistes llamas y ácidos durante más de una hora.' },
  { name: 'Telegnosis', desc: 'Viaje espiritual mucho más largo y con menos efectos secundarios.' },
  { name: 'Magi-magic', desc: 'Hechizos básicos del Viejo Reino: Shield, Power Word, Invisible Fist.' },
  { name: 'Kai-alchemy', desc: 'Hechizos de la Hermandad: Lightning Hand, Levitation, Mind Charm.' },
];

const NO_DISCIPLINES = GM_DISCIPLINES.concat([
  { name: 'Astrology', desc: 'Predices el futuro estudiando el cielo; más aciertos al subir de rango.' },
  { name: 'Herbmastery', desc: 'Identificas cualquier sustancia orgánica y liberas sus propiedades medicinales o mágicas.' },
  { name: 'Elementalism', desc: 'Manipulas Tierra, Aire, Fuego y Agua (muros, rocas, arena, fuego).' },
  { name: 'Bardsmanship', desc: 'Dominas instrumentos, canto, relatos e imitación; provocas emociones.' },
]);

const KAI_RANKS = ['Novice', 'Intuite', 'Doan', 'Acolyte', 'Initiate', 'Aspirant', 'Guardian', 'Warmarn / Journeyman', 'Savant', 'Master'];
const MAGNAKAI_RANKS = ['Kai Master', 'Kai Master Senior', 'Kai Master Superior', 'Primate', 'Tutelary', 'Principalin', 'Mentora', 'Scion-kai', 'Archmaster', 'Kai Grand Master'];
const GM_RANKS = ['Kai Grand Master Senior', 'Kai Grand Master Superior', 'Kai Grand Sentinel', 'Kai Grand Defender', 'Kai Grand Guardian', 'Sun Knight', 'Sun Lord', 'Sun Thane', 'Grand Thane', 'Grand Crown', 'Sun Prince', 'Kai Supreme Master'];

const SERIES = {
  kai: {
    id: 'kai', label: 'Kai', first: 1, last: 5, csAdd: 10, endAdd: 20, pack: 8, specialMax: null,
    discBase: 5, discMax: 10, wmBase: 1, wmGrows: false, wmBonus: 2, wmName: 'Weaponskill', goldAdd: 0,
    disciplines: KAI_DISCIPLINES, ranks: KAI_RANKS, rankBase: 1,
  },
  magnakai: {
    id: 'magnakai', label: 'Magnakai', first: 6, last: 12, csAdd: 10, endAdd: 20, pack: 8, specialMax: null,
    discBase: 3, discMax: 10, wmBase: 3, wmGrows: true, wmBonus: 3, wmName: 'Weaponmastery', goldAdd: 10,
    disciplines: MAGNAKAI_DISCIPLINES, ranks: MAGNAKAI_RANKS, rankBase: 1,
  },
  gm: {
    id: 'gm', label: 'Grand Master', first: 13, last: 20, csAdd: 25, endAdd: 30, pack: 10, specialMax: 12,
    discBase: 4, discMax: 12, wmBase: 2, wmGrows: true, wmBonus: 5, wmName: 'Grand Weaponmastery', goldAdd: 20,
    disciplines: GM_DISCIPLINES, ranks: GM_RANKS, rankBase: 1,
  },
  no: {
    id: 'no', label: 'New Order', first: 21, last: 32, csAdd: 25, endAdd: 30, pack: 10, specialMax: 12,
    discBase: 4, discMax: 16, wmBase: 1, wmGrows: true, wmBonus: 5, wmName: 'Grand Weaponmastery', goldAdd: 20,
    disciplines: NO_DISCIPLINES, ranks: GM_RANKS, rankBase: 4,
  },
};

const SERIES_ORDER = ['kai', 'magnakai', 'gm', 'no'];
function seriesOfBook(book) { return SERIES_ORDER.find(k => book >= SERIES[k].first && book <= SERIES[k].last); }

const BOOK_TITLES = {
  1: 'Flight from the Dark', 2: 'Fire on the Water', 3: 'The Caverns of Kalte', 4: 'The Chasm of Doom', 5: 'Shadow on the Sand',
  6: 'The Kingdoms of Terror', 7: 'Castle Death', 8: 'The Jungle of Horrors', 9: 'The Cauldron of Fear', 10: 'The Dungeons of Torgar',
  11: 'The Prisoners of Time', 12: 'The Masters of Darkness', 13: 'The Plague Lords of Ruel', 14: 'The Captives of Kaag', 15: 'The Darke Crusade',
  16: 'The Legacy of Vashna', 17: 'The Deathlord of Ixia', 18: 'Dawn of the Dragons', 19: "Wolf's Bane", 20: 'The Curse of Naar',
  21: 'Voyage of the Moonstone', 22: 'The Buccaneers of Shadaki', 23: "Mydnight's Hero", 24: 'Rune War', 25: 'Trail of the Wolf',
  26: 'The Fall of Blood Mountain', 27: 'Vampirium', 28: 'The Hunger of Sejanoz',
  29: 'The Storms of Chai', 30: 'Dead in the Deep', 31: 'The Dusk of Eternal Night', 32: 'Light of the Kai',
};

const LORE_CIRCLES = [
  { name: 'Circle of Fire', needs: ['Weaponmastery', 'Huntmastery'], cs: 1, end: 2 },
  { name: 'Circle of Light', needs: ['Animal Control', 'Curing'], cs: 0, end: 3 },
  { name: 'Circle of Solaris', needs: ['Invisibility', 'Huntmastery', 'Pathsmanship'], cs: 1, end: 3 },
  { name: 'Circle of the Spirit', needs: ['Psi-surge', 'Psi-screen', 'Nexus', 'Divination'], cs: 3, end: 3 },
];

// Rank is the number of Disciplines mastered (the New Order list starts at Grand Master Senior with four).
function rankOf(seriesKey, discCount) {
  const s = SERIES[seriesKey];
  return s.ranks[Math.min(s.ranks.length - 1, Math.max(0, discCount - s.rankBase))];
}

function loreStatus(disc) {
  return LORE_CIRCLES.map(c => ({ ...c, have: c.needs.filter(n => disc.includes(n)).length, done: c.needs.every(n => disc.includes(n)) }));
}
function loreBonus(disc) {
  return loreStatus(disc).filter(c => c.done).reduce((a, c) => ({ cs: a.cs + c.cs, end: a.end + c.end }), { cs: 0, end: 0 });
}

// Special Items that survive the jump into the Grand Master series (Book 13 rules).
const GM_CARRYOVER = ['Crystal Star Pendant', 'Sommerswerd', 'Silver Helm', 'Dagger of Vashna', 'Silver Bracers', 'Jewelled Mace', 'Silver Bow of Duadon', 'Helshezag', 'Kagonite Chainmail', 'Korlinium Scabbard'];

// Book 1 random item table (random number -> item)
const KAI_START_ITEMS = {
  1: { kind: 'weapon', type: 'Sword', label: 'Sword' },
  2: { kind: 'special', name: 'Helmet', end: 2, label: 'Helmet (+2 END)' },
  3: { kind: 'meals', n: 2, label: 'Two Meals' },
  4: { kind: 'special', name: 'Chainmail Waistcoat', end: 4, label: 'Chainmail Waistcoat (+4 END)' },
  5: { kind: 'weapon', type: 'Mace', label: 'Mace' },
  6: { kind: 'pack', name: 'Healing Potion', heal: 4, label: 'Healing Potion (+4 END)' },
  7: { kind: 'weapon', type: 'Quarterstaff', label: 'Quarterstaff' },
  8: { kind: 'weapon', type: 'Spear', label: 'Spear' },
  9: { kind: 'gold', n: 12, label: '12 Gold Crowns' },
  0: { kind: 'weapon', type: 'Broadsword', label: 'Broadsword' },
};

// "Choose five" starting equipment lists for Books 6, 13 and 21.
const START_PICKS = {
  magnakai: [
    { kind: 'weapon', type: 'Sword', label: 'Sword' },
    { kind: 'pack', name: 'Potion of Laumspur', heal: 4, label: 'Potion of Laumspur (+4 END)' },
    { kind: 'weapon', type: 'Warhammer', label: 'Warhammer' },
    { kind: 'weapon', type: 'Bow', label: 'Bow' },
    { kind: 'special', name: 'Quiver', qty: 6, label: 'Quiver (6 Arrows)' },
    { kind: 'meals', n: 4, label: '4 Special Rations' },
    { kind: 'weapon', type: 'Quarterstaff', label: 'Quarterstaff' },
    { kind: 'special', name: 'Padded Leather Waistcoat', end: 2, label: 'Padded Leather Waistcoat (+2 END)' },
    { kind: 'pack', name: 'Rope', label: 'Rope' },
    { kind: 'weapon', type: 'Dagger', label: 'Dagger' },
    { kind: 'pack', name: 'Tinderbox', label: 'Tinderbox' },
    { kind: 'weapon', type: 'Axe', label: 'Axe' },
  ],
  gm: [
    { kind: 'weapon', type: 'Sword', label: 'Sword' },
    { kind: 'weapon', type: 'Bow', label: 'Bow' },
    { kind: 'special', name: 'Quiver', qty: 6, label: 'Quiver (6 Arrows)' },
    { kind: 'weapon', type: 'Axe', label: 'Axe' },
    { kind: 'meals', n: 4, label: '4 Meals' },
    { kind: 'pack', name: 'Rope', label: 'Rope' },
    { kind: 'pack', name: 'Potion of Laumspur', heal: 4, label: 'Potion of Laumspur (+4 END)' },
    { kind: 'weapon', type: 'Spear', label: 'Spear' },
    { kind: 'weapon', type: 'Dagger', label: 'Dagger' },
  ],
  no: [
    { kind: 'weapon', type: 'Quarterstaff', label: 'Quarterstaff' },
    { kind: 'weapon', type: 'Bow', label: 'Bow' },
    { kind: 'special', name: 'Quiver', qty: 6, label: 'Quiver (6 Arrows)' },
    { kind: 'pack', name: 'Flute', label: 'Flute' },
    { kind: 'weapon', type: 'Dagger', label: 'Dagger' },
    { kind: 'weapon', type: 'Sword', label: 'Sword' },
    { kind: 'meals', n: 2, label: '2 Meals' },
    { kind: 'pack', name: 'Rope', label: 'Rope' },
    { kind: 'pack', name: 'Potion of Laumspur', heal: 4, label: 'Potion of Laumspur (+4 END)' },
    { kind: 'weapon', type: 'Axe', label: 'Axe' },
  ],
};

// New Order Kai Weapons (Book 21): base +5 CS, higher bonus under the unique property.
const KAI_WEAPONS = [
  { rn: 0, type: 'Axe', name: 'Spawnsmite', prop: 'vs. reptilian enemies', alt: 6 },
  { rn: 1, type: 'Axe', name: 'Alema', prop: 'vs. undead enemies', alt: 7 },
  { rn: 2, type: 'Axe', name: 'Magnara', prop: 'vs. rock or stone', alt: 8 },
  { rn: 3, type: 'Sword', name: 'Sunstrike', prop: 'in daylight', alt: 6 },
  { rn: 4, type: 'Sword', name: 'Kaistar', prop: 'at night', alt: 7 },
  { rn: 5, type: 'Sword', name: 'Valiance', prop: 'vs. magicians', alt: 8 },
  { rn: 6, type: 'Sword', name: 'Ulnarias', prop: 'underwater', alt: 9 },
  { rn: 7, type: 'Broadsword', name: 'Raumas', prop: 'vs. winged enemies', alt: 6 },
  { rn: 8, type: 'Broadsword', name: 'Illuminatus', prop: 'underground', alt: 7 },
  { rn: 9, type: 'Broadsword', name: 'Firefall', prop: 'vs. fire-emitting enemies', alt: 8 },
];


// Special Item limit: none in Books 1-7, twelve from Book 8 on (Newsletter #7 / Readers' Handbook).
function specialMaxFor(seriesKey, book) {
  if (seriesKey === 'kai') return null;
  if (seriesKey === 'magnakai') return book >= 8 ? 12 : null;
  return 12;
}

/* Rank-dependent combat modifiers (Readers' Handbook "Improved Disciplines"). n = number of Disciplines held.
   psy[].minEnd: the attack cannot be used while END is at or below this value. */
function mods(seriesKey, disc) {
  const n = disc.length, has = d => disc.includes(d);
  const m = { wmBonus: SERIES[seriesKey].wmBonus, unarmed: -4, psy: [], emergency: null, flame: false };
  if (seriesKey === 'kai') {
    if (has('Mindblast')) m.psy.push({ id: 'mindblast', label: 'Mindblast', cs: 2, cost: 0, minEnd: 0 });
  } else if (seriesKey === 'magnakai') {
    if (has('Weaponmastery')) {
      if (n >= 8) m.wmBonus = 4;                                  // Scion-kai
      m.unarmed = n >= 8 ? -1 : n >= 5 ? -2 : -4;                 // Scion-kai: -1, Tutelary: -2
    }
    if (has('Psi-surge')) {
      const arch = n >= 9;                                        // Archmaster
      m.psy.push({ id: 'mindblast', label: 'Mindblast', cs: arch ? 3 : 2, cost: 0, minEnd: 0 });
      m.psy.push({ id: 'surge', label: 'Psi-surge', cs: arch ? 6 : 4, cost: arch ? 1 : 2, minEnd: arch ? 4 : 6 });
    }
    if (has('Curing') && n >= 9) m.emergency = { name: 'Curing', threshold: 6, amount: 20, days: 100 };
  } else {
    if (has('Kai-surge')) {
      m.psy.push({ id: 'mindblast', label: 'Mindblast', cs: 4, cost: 0, minEnd: 0 });
      m.psy.push({ id: 'surge', label: 'Kai-surge', cs: 8, cost: 1, minEnd: 6 });
    }
    if (has('Deliverance')) m.emergency = { name: 'Deliverance', threshold: 8, amount: 20, days: 20 };
    if (seriesKey === 'gm' && has('Grand Weaponmastery') && n >= 7) m.flame = true; // Sun Lord
  }
  return m;
}

// Bonus added to numbers picked for the Bow (Weaponmastery +3, Mentora +2, Grand Weaponmastery +5).
function missileBonus(seriesKey, disc, wm) {
  const n = disc.length;
  if (seriesKey === 'magnakai' && disc.includes('Weaponmastery')) return (wm.includes('Bow') ? 3 : 0) + (n >= 7 ? 2 : 0);
  if ((seriesKey === 'gm' || seriesKey === 'no') && disc.includes('Grand Weaponmastery')) return wm.includes('Bow') ? 5 : 0;
  return 0;
}

// Rank improvements the app applies by itself, and the ones the player must apply by hand.
function rankNotes(seriesKey, disc) {
  const n = disc.length, has = d => disc.includes(d), auto = [], manual = [];
  if (seriesKey === 'magnakai') {
    if (has('Weaponmastery') && n >= 5 && n < 8) auto.push('Tutelary: sin arma pierdes 2 CS en vez de 4.');
    if (has('Weaponmastery') && n >= 8) auto.push('Scion-kai: Weaponmastery da +4 CS y sin arma solo pierdes 1.');
    if (has('Weaponmastery') && n >= 7) auto.push('Mentora: +2 al número aleatorio con arco o armas arrojadizas (atajo en Dado).');
    if (has('Psi-surge') && n >= 9) auto.push('Archmaster: Psi-surge +6 CS con -1 END por asalto (no se usa con END 4 o menos); Mindblast +3.');
    if (has('Curing') && n >= 9) auto.push('Archmaster: Curing recupera 20 END si tu END baja a 6 o menos (una vez cada 100 días).');
  }
  if (seriesKey === 'gm') {
    if (has('Grand Weaponmastery') && n >= 7) auto.push('Sun Lord: arma en llamas, el enemigo pierde 1 END extra por asalto con daño (opción en combate).');
    if (has('Kai-surge') && n >= 7) manual.push('Sun Lord: Kai-blast. El enemigo pierde 2-18 END (suma dos números aleatorios, el 0 vale 1). Te cuesta 4 END y no se combina con otro ataque psíquico.');
    if (has('Grand Weaponmastery') && n >= 10) manual.push('Grand Crown: Grand Weaponmastery da +3 CS al luchar sin armas.');
    if (has('Kai-surge') && n >= 11) manual.push('Sun Prince: Kai-ray. Una vez por combate el enemigo pierde 15 END y tú 4. No con END 10 o menos ni junto a otro ataque psíquico.');
  }
  if (seriesKey === 'gm' || seriesKey === 'no') {
    if (has('Deliverance')) auto.push('Deliverance: con END 8 o menos en combate recuperas 20 END (una vez cada 20 días).');
  }
  return { auto, manual };
}

const CRT_LABELS = ['≤ −11', '−10 / −9', '−8 / −7', '−6 / −5', '−4 / −3', '−2 / −1', '0', '+1 / +2', '+3 / +4', '+5 / +6', '+7 / +8', '+9 / +10', '≥ +11'];

// Special Items with a known effect (Readers' Handbook, Topical Guide). cs: bonus while used in combat.
const PRESET_SPECIALS = [
  { name: 'Helmet', end: 2 },
  { name: 'Chainmail Waistcoat', end: 4 },
  { name: 'Padded Leather Waistcoat', end: 2 },
  { name: 'Silver Helm', cs: 2 },
  { name: 'Silver Bracers', cs: 2, end: 1 },
  { name: 'Shield', cs: 2 },
  { name: 'Sommerswerd', cs: 8, isWeapon: true, wmOf: ['Sword', 'Short Sword', 'Broadsword'], dbl: true, note: 'Daño x2 contra no-muertos' },
  { name: 'Helshezag', cs: 5, alt: 7, isWeapon: true, drain: 1, note: '+7 vs Darklord de Helgedad (+12 dentro de Helgedad). -1 END desde el 2.º asalto' },
  { name: 'Quiver', qty: 6, note: 'Flechas' },
];

if (typeof module !== 'undefined') {
  module.exports = { mods, missileBonus, rankNotes, specialMaxFor, rankOf, CRT, crtCol, resolveRound, SERIES, SERIES_ORDER, seriesOfBook, loreBonus, loreStatus, KAI_START_ITEMS, GM_CARRYOVER };
}
