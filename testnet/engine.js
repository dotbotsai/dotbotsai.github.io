/* dotBots Battle - rules engine, data-driven.
 * Same logic as the offline demo engine (game/demo/engine.js), but every balance number comes from a
 * versioned rules file (rules_v1.json, rules_v2.json, ...). Changing balance = shipping a new rules file;
 * nothing on-chain changes. Pure logic, no DOM. Works in the browser (window.DBEngine) and in Node.
 *
 *   const E = DBEngine.create(rules)   // rules = parsed rules_vN.json, validated first
 *   E.makeFighter(bot, itemKey) / E.applyUnderdog(S) / E.resolveTurn(S, [k0, k1], rng) / E.aiPick(S, side, rng, noise)
 *
 * Trait -> stat mapping (names are the contract's arrays in DotBots.sol):
 *   Tier -> dmg bonus (tierDmgBonusPerTier x tier index), HP the same for all tiers
 *   Head -> type triangle (typeTriangle.beats, +typeTriangle.bonus dmg vs the type you beat)
 *   Eyes -> signature skill, Antenna -> speed (double-KO tie-break), Mouth -> armor
 *   Accessory -> ultimate; no accessory -> Overclock
 * Total dmg bonus (tier + head + item) is capped at bonusCap.
 */
(function () {
  const REQUIRED = ["rulesVersion", "match", "tiers", "tierDmgBonusPerTier", "bonusCap", "typeTriangle", "speedByAntenna",
    "armorByMouth", "underdogSpark", "moves", "interactions", "signatureCooldown", "ultimateCooldown", "signatures",
    "effects", "ultimates", "overclock", "practiceItems"];

  function validate(R) {
    const errs = [];
    if (!R || typeof R !== "object") return ["rules file is not an object"];
    for (const k of REQUIRED) if (!(k in R)) errs.push("missing key: " + k);
    if (errs.length) return errs;
    const num = (v, p) => { if (typeof v !== "number" || !isFinite(v)) errs.push("not a number: " + p); };
    ["hp", "energyMax", "energyStart", "energyRegen", "turnLimit", "turnTimerSec", "minDamage"].forEach(k => num(R.match[k], "match." + k));
    num(R.tierDmgBonusPerTier, "tierDmgBonusPerTier"); num(R.bonusCap, "bonusCap"); num(R.typeTriangle.bonus, "typeTriangle.bonus");
    if (R.tiers.length !== 5) errs.push("tiers must list 5 tiers");
    ["Box", "Dome", "Tall"].forEach(h => { if (!R.typeTriangle.beats[h]) errs.push("typeTriangle.beats." + h); });
    ["None", "Single", "Double", "Dish"].forEach(a => num(R.speedByAntenna[a], "speedByAntenna." + a));
    ["Open", "Smile", "Flat", "Grill"].forEach(m => num(R.armorByMouth[m], "armorByMouth." + m));
    ["punch", "kick", "block", "jump", "press", "rest"].forEach(m => { const v = R.moves[m]; if (!v) errs.push("moves." + m); else { num(v.cost, "moves." + m + ".cost"); num(v.dmg, "moves." + m + ".dmg"); } });
    ["Dots", "Visor", "Big", "Laser", "Sleepy", "Heart"].forEach(e => { const v = R.signatures[e]; if (!v) errs.push("signatures." + e); else { num(v.cost, "signatures." + e + ".cost"); num(v.dmg, "signatures." + e + ".dmg"); } });
    ["Headphones", "Bow Tie", "Monocle", "Cap"].forEach(a => { const v = R.ultimates[a]; if (!v) errs.push("ultimates." + a); else { num(v.cost, "ultimates." + a + ".cost"); num(v.dmg, "ultimates." + a + ".dmg"); } });
    if (!Array.isArray(R.underdogSpark.energyByTierGap) || R.underdogSpark.energyByTierGap.length !== 5) errs.push("underdogSpark.energyByTierGap must have 5 entries");
    ["kickThroughBlock", "pressVsBlock", "skillVsBlock", "punchVsPress", "blockCounterDmg", "restEnergyBonus", "restDmgTaken"].forEach(k => num(R.interactions[k], "interactions." + k));
    ["slowRegenMinus", "smokeFailChance", "lifestealRatio", "burnDmg", "burnTurns", "counterReflectRatio"].forEach(k => num(R.effects[k], "effects." + k));
    ["regenBonus", "sigCostMinus", "sigCooldown", "sigDmgMult"].forEach(k => num(R.overclock[k], "overclock." + k));
    return errs;
  }

  function create(R) {
    const errs = validate(R);
    if (errs.length) throw new Error("Invalid rules file: " + errs.join("; "));
    const M = R.match, IX = R.interactions, FX = R.effects, OC = R.overclock;
    const TIERS = R.tiers.slice();
    const HEAD_BEATS = R.typeTriangle.beats;
    const SPEED = R.speedByAntenna, ARMOR = R.armorByMouth;
    const E_MAX = M.energyMax, E_START = M.energyStart, E_REGEN = M.energyRegen, BONUS_CAP = R.bonusCap;
    const SIGS = R.signatures, ULTS = R.ultimates, BASE_MOVES = R.moves, ITEMS = R.practiceItems;
    const SIG_CD = R.signatureCooldown, ULT_CD = R.ultimateCooldown;

    function attr(bot, k) { return bot.traits[k]; }

    function makeFighter(bot, itemKey) {
      const tier = TIERS.indexOf(attr(bot, "Tier"));
      const item = itemKey ? ITEMS[itemKey] : null;
      const acc = attr(bot, "Accessory");
      const baseSig = SIGS[attr(bot, "Eyes")];
      const over = acc === "None";
      return {
        bot, itemKey: itemKey || null, tier,
        head: attr(bot, "Head"),
        hp: M.hp, maxHp: M.hp, energy: E_START,
        armor: ARMOR[attr(bot, "Mouth")] + (item && item.armor ? item.armor : 0),
        speed: SPEED[attr(bot, "Antenna")],
        regen: E_REGEN + (over ? OC.regenBonus : 0) + (item && item.regen ? item.regen : 0),
        sig: over ? Object.assign({}, baseSig, { cost: baseSig.cost - OC.sigCostMinus, cd: OC.sigCooldown, dmg: Math.round(baseSig.dmg * OC.sigDmgMult) }) : baseSig,
        ult: ULTS[acc] || null, overclock: over,
        itemDmg: item && item.dmg ? item.dmg : 0,
        cd: { sig: 0, ult: 0 },
        status: {},
        history: [],
      };
    }

    function dmgBonus(a, d) {
      let b = a.tier * R.tierDmgBonusPerTier + a.itemDmg;
      if (HEAD_BEATS[a.head] === d.head) b += R.typeTriangle.bonus;
      return Math.min(BONUS_CAP, b);
    }

    function applyUnderdog(S) {
      const [a, b] = S.p, gap = Math.abs(a.tier - b.tier);
      if (!gap) return null;
      const lo = a.tier < b.tier ? 0 : 1, bonus = R.underdogSpark.energyByTierGap[gap];
      S.p[lo].energy = Math.min(E_MAX, S.p[lo].energy + bonus); S.p[lo].underdog = bonus;
      return { side: lo, bonus };
    }

    function moveInfo(f, key) {
      if (key === "sig") return { name: f.sig.name, cost: f.sig.cost, dmg: f.sig.dmg * (f.sig.hits || 1), kind: "sig", desc: f.sig.desc, cd: f.sig.cd || SIG_CD };
      if (key === "ult") return f.ult ? { name: f.ult.name, cost: f.ult.cost, dmg: f.ult.dmg, kind: "ult", desc: f.ult.desc, cd: ULT_CD } : null;
      if (key === "stunned") return { name: "Stunned", cost: 0, dmg: 0, kind: "none" };
      if (key === "fumble") return { name: "Fumble", cost: 0, dmg: 0, kind: "none" };
      return Object.assign({ cd: 0 }, BASE_MOVES[key]);
    }

    function moveKeys(f) { return ["punch", "kick", "block", "jump", "press", "sig"].concat(f.ult ? ["ult"] : []).concat(["rest"]); }

    function canUse(f, key) {
      const m = moveInfo(f, key);
      if (!m) return false;
      if (key === "sig" && f.cd.sig > 0) return false;
      if (key === "ult" && f.cd.ult > 0) return false;
      return f.energy >= m.cost;
    }
    function legalMoves(f) { return moveKeys(f).filter(k => canUse(f, k)); }

    function computeHit(a, d, ak, dk) {
      const m = moveInfo(a, ak);
      if (!m || m.dmg <= 0) return { dmg: 0, back: 0 };
      const lock = !!a.status.lock && m.kind !== "none";
      const pierce = ak === "ult" && a.ult && a.ult.fx === "pierce";
      let dmg = m.dmg * (1 + dmgBonus(a, d));
      let back = 0; const note = [];
      const skill = m.kind === "sig" || m.kind === "ult";
      if (dk === "block" && !lock && !pierce) {
        if (ak === "punch") { dmg = IX.punchIntoBlockDmg; back = IX.blockCounterDmg; note.push("BLOCKED + counter"); }
        else if (ak === "kick") { dmg *= IX.kickThroughBlock; note.push("kick breaks block"); }
        else if (ak === "press") { dmg *= IX.pressVsBlock; note.push("PRESS breaks guard"); }
        else if (skill) { dmg *= IX.skillVsBlock; note.push("blocked half"); }
      }
      if (IX.jumpDodgesSkills && dk === "jump" && skill && !lock) { dmg = 0; note.push("DODGED"); }
      if (IX.pressInterruptedByPunch && ak === "press" && dk === "punch" && !lock) { dmg = 0; note.push("press interrupted"); }
      if (ak === "punch" && dk === "press") { dmg *= IX.punchVsPress; note.push("punch beats press"); }
      if (dk === "rest") { dmg *= IX.restDmgTaken; note.push("caught resting"); }
      if (dmg > 0 && !pierce) dmg = Math.max(M.minDamage, dmg - d.armor);
      dmg = Math.round(dmg);
      if (lock) note.push("LOCKED ON");
      return { dmg, back, note: note.join(", "), lockUsed: lock };
    }

    function rngOr(r) { return r || Math.random; }

    function resolveTurn(S, picks, rng) {
      rng = rngOr(rng);
      const F = S.p, ev = [];
      const mv = picks.slice();
      for (let i = 0; i < 2; i++) {
        const f = F[i];
        if (f.status.stun) { mv[i] = "stunned"; delete f.status.stun; ev.push({ t: "status", side: i, text: "is stunned and skips the turn" }); continue; }
        if (!canUse(f, mv[i])) mv[i] = canUse(f, "block") ? "block" : "rest";
        const m = moveInfo(f, mv[i]);
        f.energy -= m.cost;
        if (mv[i] === "sig") f.cd.sig = (f.sig.cd || SIG_CD) + 1;
        if (mv[i] === "ult") f.cd.ult = ULT_CD + 1;
        if (f.status.smoke) {
          delete f.status.smoke;
          if (!f.status.lock && rng() < FX.smokeFailChance) { ev.push({ t: "status", side: i, text: "chokes in smoke - " + m.name + " fails" }); mv[i] = "fumble"; }
        }
      }
      for (let i = 0; i < 2; i++) { F[i].history.push(mv[i]); ev.push({ t: "move", side: i, key: mv[i], name: moveInfo(F[i], mv[i]).name }); }
      const hits = [0, 1].map(i => computeHit(F[i], F[1 - i], mv[i], mv[1 - i]));
      for (let i = 0; i < 2; i++) {
        if (mv[i] === "ult" && F[i].ult && F[i].ult.fx === "counter" && hits[1 - i].dmg > 0) {
          const r = Math.round(hits[1 - i].dmg * FX.counterReflectRatio); hits[1 - i].dmg -= r; hits[1 - i].note = (hits[1 - i].note ? hits[1 - i].note + ", " : "") + "REFLECTED";
          hits[i].back += r;
        }
      }
      for (let i = 0; i < 2; i++) {
        const a = F[i], d = F[1 - i], h = hits[i], k = mv[i];
        if (h.dmg > 0) {
          d.hp -= h.dmg;
          ev.push({ t: "hit", side: i, dmg: h.dmg, note: h.note, fx: k === "sig" ? a.sig.fx : k === "ult" ? a.ult.fx : k, hits: k === "sig" && a.sig.hits ? a.sig.hits : 1 });
          if (h.lockUsed) delete a.status.lock;
          if (k === "sig") {
            const fx = a.sig.fx;
            if (fx === "lock") { a.status.lock = 1; ev.push({ t: "status", side: i, text: "locks on - next hit can't miss" }); }
            if (fx === "water") { d.status.slow = 1; ev.push({ t: "status", side: 1 - i, text: "is slowed (-" + FX.slowRegenMinus + " regen)" }); }
            if (fx === "smoke") { d.status.smoke = 1; ev.push({ t: "status", side: 1 - i, text: "is in smoke (next move " + Math.round(FX.smokeFailChance * 100) + "% fail)" }); }
            if (fx === "heart") { const heal = Math.round(h.dmg * FX.lifestealRatio); a.hp = Math.min(a.maxHp, a.hp + heal); ev.push({ t: "heal", side: i, amt: heal }); }
          }
          if (k === "ult") {
            const fx = a.ult.fx;
            if (fx === "sound") { d.status.stun = 1; ev.push({ t: "status", side: 1 - i, text: "is stunned!" }); }
            if (fx === "fire") { d.status.burn = { turns: FX.burnTurns, dmg: FX.burnDmg }; ev.push({ t: "status", side: 1 - i, text: "is burning (" + FX.burnDmg + " x " + FX.burnTurns + ")" }); }
          }
        } else if (h.note) ev.push({ t: "miss", side: i, note: h.note });
      }
      for (let i = 0; i < 2; i++) {
        const h = hits[i];
        if (h.back > 0 && mv[i] === "punch" && mv[1 - i] === "block") { F[i].hp -= h.back; ev.push({ t: "hit", side: 1 - i, dmg: h.back, note: "block counter", fx: "block" }); }
        if (h.back > 0 && mv[i] === "ult" && F[i].ult && F[i].ult.fx === "counter") { F[1 - i].hp -= h.back; ev.push({ t: "hit", side: i, dmg: h.back, note: "counter reflect", fx: "counter" }); }
      }
      for (let i = 0; i < 2; i++) {
        const f = F[i];
        if (f.status.burn) {
          f.hp -= f.status.burn.dmg; ev.push({ t: "burn", side: i, dmg: f.status.burn.dmg });
          if (--f.status.burn.turns <= 0) delete f.status.burn;
        }
        let rg = f.regen + (mv[i] === "rest" ? IX.restEnergyBonus : 0);
        if (f.status.slow) { rg -= FX.slowRegenMinus; delete f.status.slow; }
        f.energy = Math.min(E_MAX, f.energy + rg);
        if (f.cd.sig > 0) f.cd.sig--;
        if (f.cd.ult > 0) f.cd.ult--;
      }
      S.turn = (S.turn || 1) + 1;
      const dead = F.map(f => f.hp <= 0);
      if (dead[0] || dead[1]) {
        if (dead[0] && dead[1]) {
          S.winner = F[0].speed > F[1].speed ? 0 : F[1].speed > F[0].speed ? 1 : (F[0].hp > F[1].hp ? 0 : F[1].hp > F[0].hp ? 1 : -1);
          if (S.winner >= 0) F[S.winner].hp = 1;
          ev.push({ t: "ko", text: S.winner < 0 ? "Double KO - draw" : "Double KO - faster bot survives" });
        } else S.winner = dead[0] ? 1 : 0;
      }
      if (!S.winner && S.winner !== 0 && S.turn > M.turnLimit) { S.winner = F[0].hp >= F[1].hp ? 0 : 1; ev.push({ t: "ko", text: "Turn limit - higher HP wins" }); }
      F.forEach(f => { if (f.hp < 0) f.hp = 0; });
      return ev;
    }

    /* heuristic AI (behaviour, not balance): reads energy, cooldowns and the opponent's recent moves */
    function aiPick(S, side, rng, noise) {
      rng = rngOr(rng); noise = noise == null ? 1 : noise;
      const me = S.p[side], op = S.p[1 - side];
      if (me.status.stun) return "block";
      const legal = legalMoves(me);
      const last = op.history.slice(-3);
      const freq = k => last.filter(x => x === k).length;
      const score = {};
      const opCanUlt = op.ult && op.cd.ult === 0 && op.energy >= op.ult.cost;
      const opCanSig = op.cd.sig === 0 && op.energy >= op.sig.cost;
      for (const k of legal) {
        const m = moveInfo(me, k);
        let s = m.dmg * 0.12;
        if (k === "punch") s += 0.6 + freq("press") * 0.9;
        if (k === "kick") s += 0.7 + freq("block") * 0.4;
        if (k === "press") s += 0.4 + freq("block") * 1.1 - freq("punch") * 0.6;
        if (k === "block") s += 0.3 + freq("punch") * 0.9 + (opCanSig ? 0.4 : 0) - freq("press") * 0.5;
        if (k === "jump") s += (opCanUlt ? 1.6 : 0) + (opCanSig && op.sig.fx !== "lock" ? 0.6 : -0.6) - (op.status.lock ? 2 : 0);
        if (k === "rest") s += me.energy <= 2 ? 1.2 : -1.5 + (op.energy <= 1 ? 1 : 0);
        if (k === "sig") s += 1.2 - (op.energy >= 2 && freq("jump") ? 0.4 : 0);
        if (k === "ult") s += 2.2 + (op.energy < 2 ? 1 : 0);
        if (me.ult && me.cd.ult <= 1 && me.energy >= 4 && me.energy < 7 && m.cost > 1 && k !== "ult") s -= 0.8;
        if (op.hp <= m.dmg * 1.1 && m.dmg > 0) s += 1.5;
        score[k] = s + (rng() - 0.5) * 1.6 * noise;
      }
      return legal.reduce((b, k) => score[k] > score[b] ? k : b, legal[0]);
    }
    function randomPick(S, side, rng) { const l = legalMoves(S.p[side]); return l[Math.floor(rngOr(rng)() * l.length)]; }

    return {
      RULES: R, RULES_VERSION: R.rulesVersion, TIERS, HEAD_BEATS, SPEED, ARMOR, SIGS, ULTS, ITEMS, BASE_MOVES, E_MAX, BONUS_CAP, SIG_CD, ULT_CD,
      HP: M.hp, TURN_TIMER: M.turnTimerSec, TIMEOUT_MOVE: M.timeoutMove,
      makeFighter, applyUnderdog, moveInfo, moveKeys, canUse, legalMoves, resolveTurn, aiPick, randomPick, dmgBonus,
    };
  }

  const DBEngine = { create, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = DBEngine; else window.DBEngine = DBEngine;
})();
