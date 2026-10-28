'use strict';
// Run: node test-rules.js  — checks the transcribed Combat Results Table and rule helpers against the books' own examples.
const assert = require('assert');
const R = require('./rules.js');

// Column mapping edges
const cols = { '-20': 0, '-11': 0, '-10': 1, '-9': 1, '-8': 2, '-7': 2, '-6': 3, '-5': 3, '-4': 4, '-3': 4, '-2': 5, '-1': 5, 0: 6, 1: 7, 2: 7, 3: 8, 4: 8, 5: 9, 6: 9, 7: 10, 8: 10, 9: 11, 10: 11, 11: 12, 30: 12 };
for (const [r, c] of Object.entries(cols)) assert.strictEqual(R.crtCol(Number(r)), c, `ratio ${r}`);

// Every row has 13 columns, ten rows
assert.strictEqual(R.CRT.length, 10);
R.CRT.forEach((row, i) => assert.strictEqual(row.length, 13, `row ${i}`));

// Book example (Books 1 and 6): Combat Ratio -3, random number 6 -> Lone Wolf loses 3, enemy loses 6
let r = R.resolveRound(-3, 6, 30, 25);
assert.deepStrictEqual([r.eLoss, r.lLoss], [6, 3]);
// Same example with Psi-surge: 2 more END lost
r = R.resolveRound(-3, 6, 30, 25, { cost: 2 });
assert.deepStrictEqual([r.eLoss, r.lLoss, r.lwAfter], [6, 5, 20]);
// Known corner cells
assert.deepStrictEqual(R.CRT[1][0], [0, 'K']);   // ratio <= -11, RN 1: Lone Wolf auto-killed
assert.deepStrictEqual(R.CRT[0][12], ['K', 0]);  // ratio >= 11, RN 0: enemy auto-killed
assert.deepStrictEqual(R.CRT[0][6], [12, 0]);    // ratio 0, RN 0
assert.deepStrictEqual(R.CRT[5][6], [7, 2]);     // ratio 0, RN 5
// Auto-kill handling and evasion
r = R.resolveRound(-15, 1, 20, 17);
assert.strictEqual(r.lwAfter, 0);
r = R.resolveRound(15, 0, 20, 17);
assert.strictEqual(r.enemyAfter, 0);
r = R.resolveRound(15, 0, 20, 17, { evade: true });
assert.deepStrictEqual([r.eLoss, r.enemyAfter], [0, 20]);
// Rows must never get worse for Lone Wolf as the ratio improves (monotonic sanity check on the transcription)
for (let rn = 0; rn < 10; rn++) {
  let prevE = -1, prevL = Infinity;
  R.CRT[rn].forEach(([e, l]) => {
    const ev = e === 'K' ? 99 : e, lv = l === 'K' ? 99 : l;
    assert.ok(ev >= prevE, `enemy loss decreases in RN ${rn}`);
    assert.ok(lv <= prevL, `Lone Wolf loss increases in RN ${rn}`);
    prevE = ev; prevL = lv;
  });
}

// Lore-circle bonuses (Book 6 rules)
assert.deepStrictEqual(R.loreBonus(['Weaponmastery', 'Huntmastery']), { cs: 1, end: 2 });
assert.deepStrictEqual(R.loreBonus(['Huntmastery', 'Invisibility', 'Pathsmanship', 'Weaponmastery']), { cs: 2, end: 5 }); // Fire + Solaris share Huntmastery
assert.deepStrictEqual(R.loreBonus(['Psi-surge', 'Psi-screen', 'Nexus']), { cs: 0, end: 0 });

// Series and ranks
assert.strictEqual(R.seriesOfBook(5), 'kai');
assert.strictEqual(R.seriesOfBook(6), 'magnakai');
assert.strictEqual(R.seriesOfBook(13), 'gm');
assert.strictEqual(R.seriesOfBook(28), 'no');
assert.strictEqual(R.rankOf('kai', 5), 'Initiate');
assert.strictEqual(R.rankOf('magnakai', 3), 'Kai Master Superior');
assert.strictEqual(R.rankOf('gm', 4), 'Kai Grand Defender');
assert.strictEqual(R.rankOf('no', 4), 'Kai Grand Master Senior');
assert.strictEqual(R.rankOf('no', 5), 'Kai Grand Master Superior');

console.log('rules OK');

// Rank-dependent modifiers (Readers' Handbook, Improved Disciplines)
const mag = (n, extra) => ['Weaponmastery', 'Psi-surge', 'Curing', 'Huntmastery', 'Nexus', 'Divination', 'Pathsmanship', 'Invisibility', 'Animal Control'].slice(0, n).concat(extra || []);
let m = R.mods('magnakai', mag(3));
assert.deepStrictEqual([m.wmBonus, m.unarmed], [3, -4]);
assert.deepStrictEqual(m.psy.map(o => [o.id, o.cs, o.cost, o.minEnd]), [['mindblast', 2, 0, 0], ['surge', 4, 2, 6]]);
m = R.mods('magnakai', mag(5));                                    // Tutelary
assert.strictEqual(m.unarmed, -2);
m = R.mods('magnakai', mag(8));                                    // Scion-kai
assert.deepStrictEqual([m.wmBonus, m.unarmed], [4, -1]);
m = R.mods('magnakai', mag(9));                                    // Archmaster
assert.deepStrictEqual(m.psy.map(o => [o.cs, o.cost, o.minEnd]), [[3, 0, 0], [6, 1, 4]]);
assert.deepStrictEqual(m.emergency, { name: 'Curing', threshold: 6, amount: 20, days: 100 });
assert.strictEqual(R.mods('magnakai', ['Psi-surge']).unarmed, -4); // no Weaponmastery: no improvement
m = R.mods('kai', ['Mindblast', 'Healing']);
assert.deepStrictEqual([m.wmBonus, m.psy.length, m.emergency], [2, 1, null]);
m = R.mods('gm', ['Kai-surge', 'Deliverance', 'Grand Weaponmastery', 'a', 'b', 'c', 'd']);
assert.deepStrictEqual([m.wmBonus, m.flame, m.emergency.threshold], [5, true, 8]);
assert.strictEqual(R.mods('gm', ['Grand Weaponmastery']).flame, false);

// Special Item limit and Bow bonus
assert.strictEqual(R.specialMaxFor('kai', 3), null);
assert.strictEqual(R.specialMaxFor('magnakai', 7), null);
assert.strictEqual(R.specialMaxFor('magnakai', 8), 12);
assert.strictEqual(R.specialMaxFor('no', 21), 12);
assert.strictEqual(R.missileBonus('magnakai', mag(7), ['Bow']), 5);            // WM with Bow +3, Mentora +2
assert.strictEqual(R.missileBonus('magnakai', mag(6), ['Bow']), 3);
assert.strictEqual(R.missileBonus('gm', ['Grand Weaponmastery'], ['Bow']), 5);
assert.strictEqual(R.missileBonus('gm', ['Kai-surge'], ['Bow']), 0);
assert.strictEqual(R.SERIES.no.last, 32);

console.log('mods OK');
