/* dotBots Market v2 - page logic. Reads everything from the chain (config.json → RPC), writes through the user's wallet. */
(function () {
  "use strict";
  const { ethers } = window;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
  const TIER_CLASS = { Common: "", Uncommon: "green", Rare: "blue", Epic: "purple", Legendary: "orange" };
  const TRAIT_KEYS = ["Tier", "Head", "Eyes", "Antenna", "Mouth", "Accessory", "Type"];
  const OP_ACCEPT = 2, OP_COLL = 3;
  const EXPIRY = [["1 hour", 3600], ["1 day", 86400], ["3 days", 3 * 86400], ["7 days", 7 * 86400], ["30 days", 30 * 86400]];

  const S = {
    bots: new Map(), ids: [], listings: new Map(), offers: [], coll: [], events: [], usd: 0, fee: 500n, paused: false,
    stats: {}, pending: 0n, filters: { status: "all", min: "", max: "", traits: {} }, sort: "price_asc", search: "",
    cart: new Set(), view: "items", blockTimes: new Map(), lastBlock: 0, listedAt: new Map(), loaded: false, eventsLoaded: false,
    actFilter: "all", sel: new Set(), offerSel: new Set(), grid: "",
  };
  window.__S = S; // for tests / debugging

  // ================================================================== small UI helpers
  const sym = () => DB.cfg.nativeSymbol;
  const feePct = () => (Number(S.fee) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%";
  const feeOf = p => (p * S.fee) / 10000n;
  const amt = (wei, cls = "") => `<span class="mono ${cls}">${DB.fmt(wei)} ${esc(sym())}</span>`;
  const usd = wei => S.usd ? DB.usd(wei, S.usd) : "";
  const nameOf = b => b ? (b.handle ? b.handle + ".ai" : "Team bot #" + b.id) : "";
  const isMe = a => DB.account && DB.same(a, DB.account);
  const holderOf = id => { const b = S.bots.get(id); if (!b) return null; const l = S.listings.get(id); return l ? l.seller : b.owner; };
  const nowSec = () => Math.floor(Date.now() / 1000 + (S.skew || 0)); // chain time (block timestamp), not the device clock
  const ago = t => { if (!t) return ""; const d = nowSec() - t; if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago"; if (d < 86400) return Math.floor(d / 3600) + "h ago"; return Math.floor(d / 86400) + "d ago"; };
  const until = t => { const d = Number(t) - nowSec(); if (d <= 0) return "expired"; if (d < 3600) return "in " + Math.max(1, Math.floor(d / 60)) + "m"; if (d < 86400) return "in " + Math.floor(d / 3600) + "h"; return "in " + Math.floor(d / 86400) + "d"; };
  const tierChip = t => `<span class="chip tier-chip" style="${tierStyle(t)}">${esc(t)}</span>`;
  function tierStyle(t) {
    const c = { Common: ["#e4e5ea", "rgba(255,255,255,.22)"], Uncommon: ["#7fe8b6", "rgba(34,194,122,.55)"], Rare: ["#a9ccff", "rgba(80,150,255,.6)"], Epic: ["#d6bcff", "rgba(170,110,255,.65)"], Legendary: ["#ffb48f", "rgba(255,77,0,.75)"] }[t] || ["#e4e5ea", "rgba(255,255,255,.22)"];
    return `background:rgba(14,15,19,.82);color:${c[0]};border-color:${c[1]}`;
  }
  function parseAmt(str) {
    const s = String(str || "").trim().replace(",", ".");
    if (!/^\d*\.?\d+$/.test(s)) return null;
    try { const v = ethers.parseEther(s); return v > 0n ? v : null; } catch (_) { return null; }
  }
  const icon = {
    ok: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>',
    err: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    ext: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    cart: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><path d="M12 9v4M10 11h4"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>',
  };

  // ------------------------------------------------------------------ toasts
  function toast(kind, title, desc, ms) {
    const el = document.createElement("div");
    const set = (k, t, d) => {
      el.className = "toast " + k;
      el.innerHTML = `<div class="ic">${k === "wait" ? '<div class="spinner"></div>' : icon[k] || ""}</div><div class="grow"><div class="tt">${esc(t)}</div>${d ? `<div class="td">${d}</div>` : ""}</div><button class="close" aria-label="Dismiss">×</button>`;
      el.querySelector(".close").onclick = () => close();
    };
    let timer;
    const close = () => { clearTimeout(timer); el.classList.add("out"); setTimeout(() => el.remove(), 200); };
    set(kind, title, desc);
    $("#toasts").appendChild(el);
    if (ms) timer = setTimeout(close, ms);
    return { update(k, t, d, m) { clearTimeout(timer); set(k, t, d); if (m) timer = setTimeout(close, m); }, close, el };
  }
  const txLink = h => DB.txUrl(h) ? `<a href="${esc(DB.txUrl(h))}" target="_blank" rel="noopener">View on BscScan ${icon.ext}</a>` : `<span class="mono">${esc(h.slice(0, 12))}…</span>`;

  /* send one transaction with toast lifecycle; returns receipt or null */
  async function runTx(label, build, after) {
    const t = toast("wait", label, "Confirm in your wallet…");
    try {
      await DB.getSigner();
      const sent = await build();
      t.update("wait", label, "Waiting for confirmation… " + txLink(sent.hash));
      const r = await sent.wait();
      if (!r || r.status !== 1) throw new Error("Transaction failed on chain.");
      t.update("ok", label + " · confirmed", (after ? after(r) + " " : "") + txLink(r.hash), 9000);
      await refresh();
      return r;
    } catch (e) {
      console.warn(e);
      t.update("err", label + " · not completed", esc(DB.explain(e)), 12000);
      return null;
    }
  }

  // ------------------------------------------------------------------ modal
  function openModal(html, small) {
    $("#mcontent").innerHTML = html;
    $("#modal").classList.toggle("small", !!small);
    $("#scrim").classList.add("on");
    document.body.classList.add("lock");
    $("#modal").scrollTop = 0;
  }
  function closeModal() {
    S.openId = null;
    $("#scrim").classList.remove("on");
    document.body.classList.remove("lock");
    if (location.hash.startsWith("#bot/")) history.replaceState(null, "", location.pathname + location.search);
  }

  // ================================================================== images (tokenURI, cached)
  const imgMem = new Map(); const imgWait = new Map();
  function cacheKey(id) { return `dbm2:${DB.cfg.chainId}:${DB.cfg.addresses.collection.toLowerCase()}:${id}`; }
  function getImg(id) {
    if (imgMem.has(id)) return Promise.resolve(imgMem.get(id));
    if (imgWait.has(id)) return imgWait.get(id);
    const p = (async () => {
      try { const c = sessionStorage.getItem(cacheKey(id)); if (c) { imgMem.set(id, c); return c; } } catch (_) {}
      const uri = await DB.bots().tokenURI(id);
      const meta = DB.decodeUri(uri);
      imgMem.set(id, meta.image);
      try { sessionStorage.setItem(cacheKey(id), meta.image); } catch (_) {}
      return meta.image;
    })().catch(e => { imgWait.delete(id); throw e; });
    imgWait.set(id, p);
    return p;
  }
  const io = "IntersectionObserver" in window ? new IntersectionObserver(ents => {
    for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); fillImg(e.target); }
  }, { rootMargin: "300px" }) : null;
  function fillImg(el) {
    const id = Number(el.dataset.img);
    getImg(id).then(src => { el.src = src; el.classList.remove("skel"); }).catch(() => {});
  }
  function watchImgs(root) {
    $$("img[data-img]", root).forEach(el => {
      const id = Number(el.dataset.img);
      if (imgMem.has(id)) { el.src = imgMem.get(id); el.classList.remove("skel"); }
      else if (io) io.observe(el); else fillImg(el);
    });
  }
  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  const imgTag = (id, cls = "") => `<img data-img="${id}" src="${BLANK}" class="skel ${cls}" alt="${esc(nameOf(S.bots.get(id)) || "bot #" + id)}" loading="lazy">`;

  // ================================================================== loading from chain
  async function loadCore() {
    const m = DB.market(), b = DB.bots();
    const [pub, team, fus, live, feeBps, paused, vol, sales, ver] = await Promise.all([
      b.publicMinted(), b.teamMinted(), b.fusions(), b.liveSupply(), m.feeBps(), m.paused(), m.totalVolume(), m.totalSales(), m.version()]);
    S.fee = feeBps; S.paused = paused; S.stats = { vol, sales, live: Number(live), ver };
    const maxId = Number(pub + team + fus);
    const [lp, op, cp, blk] = await Promise.all([m.listingsPage(0, 2000), m.offersPage(0, 2000), m.collectionOffersPage(0, 500), DB.read.getBlock("latest")]);
    if (blk) S.skew = blk.timestamp - Date.now() / 1000;
    S.listings = new Map(); lp[0].forEach((id, i) => S.listings.set(Number(id), { seller: lp[1][i], price: lp[2][i], fee: lp[3][i] }));
    S.offers = op[0].map((id, i) => ({ id: Number(id), buyer: op[1][i].buyer, expiry: Number(op[1][i].expiry), tokenId: Number(op[1][i].tokenId), price: op[1][i].price }));
    S.coll = cp[0].map((id, i) => ({ id: Number(id), buyer: cp[1][i].buyer, expiry: Number(cp[1][i].expiry), each: cp[1][i].priceEach, remaining: Number(cp[1][i].remaining) }));
    if (!S.usd) {
      try {
        const feed = new ethers.Contract(await b.bnbUsdFeed(), ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], DB.read);
        const r = await feed.latestRoundData(); S.usd = Number(r[1]) / 1e8;
      } catch (_) { S.usd = 0; }
    }
    // bots: owner (every refresh), traits + handle (once)
    const ids = Array.from({ length: maxId }, (_, i) => i + 1);
    await DB.pool(ids, 10, async id => {
      let rec = S.bots.get(id);
      let owner = null;
      try { owner = await b.ownerOf(id); } catch (_) { owner = null; }
      if (!owner) { if (rec) rec.burned = true; return; }
      if (!rec) {
        const [tr, h] = await Promise.all([b.traitsOf(id), b.handleOfToken(id).catch(() => "")]);
        rec = { id, traits: DB.traitsFromStruct(tr), handle: h };
        rec.traits.Type = h ? "Named" : "Team";
        S.bots.set(id, rec);
      }
      rec.owner = owner; rec.burned = false;
    });
    S.ids = ids.filter(id => S.bots.has(id) && !S.bots.get(id).burned);
    computeRarity();
    if (DB.account) {
      try { S.pending = await m.pendingWithdrawals(DB.account); } catch (_) { S.pending = 0n; }
    } else S.pending = 0n;
    S.loaded = true;
  }

  function computeRarity() {
    const N = S.ids.length; const cnt = {};
    for (const k of TRAIT_KEYS) cnt[k] = {};
    for (const id of S.ids) { const t = S.bots.get(id).traits; for (const k of TRAIT_KEYS) cnt[k][t[k]] = (cnt[k][t[k]] || 0) + 1; }
    S.traitCounts = cnt;
    for (const id of S.ids) {
      const t = S.bots.get(id).traits; let s = 0;
      for (const k of TRAIT_KEYS) if (k !== "Type") s += N / cnt[k][t[k]];
      s += (TIERS.indexOf(t.Tier)) * N * 0.5; // tier weighs in, so a Legendary always sorts above a Common
      S.bots.get(id).score = s;
    }
    const ranked = [...S.ids].sort((a, b) => S.bots.get(b).score - S.bots.get(a).score || a - b);
    ranked.forEach((id, i) => { S.bots.get(id).rank = i + 1; });
  }

  async function blockTime(bn) {
    if (S.blockTimes.has(bn)) return S.blockTimes.get(bn);
    const blk = await DB.read.getBlock(bn); const t = blk ? blk.timestamp : 0; S.blockTimes.set(bn, t); return t;
  }
  async function loadEvents() {
    const latest = await DB.read.getBlockNumber();
    const from = S.lastBlock ? S.lastBlock + 1 : Number(DB.cfg.deployBlock || 0);
    if (from > latest) return;
    const evs = await DB.marketLogs(from, latest);
    const blocks = [...new Set(evs.map(e => e.block))].filter(b => !S.blockTimes.has(b));
    if (blocks.length <= 400) await DB.pool(blocks, 8, blockTime);
    else { // many blocks: interpolate between two anchors
      const [a, z] = await Promise.all([blockTime(from), blockTime(latest)]);
      for (const bn of blocks) S.blockTimes.set(bn, Math.round(a + (z - a) * (bn - from) / Math.max(1, latest - from)));
    }
    for (const e of evs) e.time = S.blockTimes.get(e.block) || 0;
    S.events = S.events.concat(evs);
    S.lastBlock = latest;
    for (const e of evs) if (e.name === "Listed") S.listedAt.set(Number(e.args.tokenId), e.time * 1e6 + e.idx);
    S.eventsLoaded = true;
  }

  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try { await loadCore(); } catch (e) { console.warn(e); showNotice("err", "Could not read the chain right now (" + esc(DB.explain(e)) + "). Retrying in a moment…"); setTimeout(refresh, 5000); return; }
      renderAll();
      try { await loadEvents(); } catch (e) { console.warn("events", e); }
      renderAll();
    })();
    try { await refreshing; } finally { refreshing = null; }
  }

  // ================================================================== render: header + stats
  function floor() { let f = null; for (const l of S.listings.values()) if (f === null || l.price < f) f = l.price; return f; }
  function bestColl() { let best = null; for (const c of S.coll) if (c.expiry > nowSec() && (!best || c.each > best.each)) best = c; return best; }
  function owners() { const s = new Set(); for (const id of S.ids) { const h = holderOf(id); if (h) s.add(h.toLowerCase()); } return s.size; }
  function renderStats() {
    const f = floor(), bc = bestColl();
    const v = (w) => w == null ? "—" : `${DB.fmt(w)}<small>${esc(sym())}</small>`;
    $("#stFloor").innerHTML = v(f);
    $("#stBest").innerHTML = bc ? v(bc.each) : "—";
    $("#stVol").innerHTML = v(S.stats.vol);
    $("#stSales").textContent = S.stats.sales != null ? String(S.stats.sales) : "—";
    const live = S.ids.length; const listed = S.listings.size;
    const lp = live ? ((listed / live) * 100).toFixed(1) : "0"; const stl = $("#stListed"); stl.innerHTML = `${listed}<small> · ${lp}%</small>`; stl.setAttribute("aria-label", `${listed} listed, ${lp}% of bots`);
    $("#stOwners").textContent = String(owners());
    $("#stSupply").textContent = String(live);
    $("#stFee").textContent = feePct();
    $("#feeHero").textContent = feePct();
    $("#verChip").textContent = "Market v" + (S.stats.ver || "2");
    $("#cItems").textContent = live || "";
    $("#cColl").textContent = S.coll.length || "";
    if (f != null) $("#stFloor").title = usd(f);
    // avatar + banner mosaic from real bots
    // collection avatar = dotBots logo (avatar.png), same as X; banner = mosaic of real bots.
    // Rebuild on each refresh until at least one bot image has loaded (retry if RPC was slow).
    if (S.ids.length && !S.mosaicOk) {
      const ms = S.ids.slice(0, 36);
      $("#mosaic").innerHTML = Array.from({ length: 40 }, (_, i) => `<img data-img="${ms[i % ms.length]}" src="${BLANK}" alt="">`).join("");
      $$("img[data-img]", $("#mosaic")).forEach(fillImg);
      getImg(ms[0]).then(() => { S.mosaicOk = true; }).catch(() => {});
    }
  }
  function showNotice(kind, html, id) {
    const box = $("#notices");
    if (id) { const old = $("#n-" + id); if (old) old.remove(); }
    const d = document.createElement("div"); d.className = "notice " + kind; if (id) d.id = "n-" + id; d.innerHTML = html; box.appendChild(d); return d;
  }
  function renderNotices() {
    $("#notices").innerHTML = "";
    if (S.paused) showNotice("warn", "<b>The market is paused.</b> Buying, listing and new offers are off for now. You can still cancel listings and offers and withdraw any held BNB.", "paused");
    if (DB.account && !DB.onRightChain()) {
      const n = showNotice("warn", `<span class="grow">Your wallet is on another network. Switch to <b>${esc(DB.cfg.network)}</b> to trade.</span><button class="btn sm primary" id="switchBtn">Switch network</button>`, "wrongchain");
      $("#switchBtn", n).onclick = () => DB.switchChain().then(renderAll).catch(e => toast("err", "Network not switched", esc(DB.explain(e)), 8000));
    }
    if (DB.account && S.pending > 0n) {
      const n = showNotice("ok", `<span class="grow">You have <b class="mono">${DB.fmt(S.pending)} ${esc(sym())}</b> waiting in the market (a payment your wallet could not take at sale time).</span><button class="btn sm primary" id="withdrawBtn">Withdraw</button>`, "pending");
      $("#withdrawBtn", n).onclick = withdraw;
    }
  }
  function renderWallet() {
    const c = $("#connect"), pill = $("#netPill");
    if (DB.account) {
      c.textContent = DB.short(DB.account); c.classList.remove("primary"); c.classList.add("ghost");
      pill.className = "pill net " + (DB.onRightChain() ? "ok" : "bad");
      $("#netTxt").textContent = DB.onRightChain() ? DB.cfg.network : "Wrong network";
    } else {
      c.textContent = "Connect wallet"; c.classList.add("primary"); c.classList.remove("ghost");
      pill.className = "pill net"; $("#netTxt").textContent = "Read-only · " + DB.cfg.network;
    }
  }

  // ================================================================== render: filters + grid
  function renderFilters() {
    if (!S.traitCounts) return;
    const open = new Set($$("#traitFilters .fgroup.open").map(g => g.dataset.k));
    const first = !$("#traitFilters").children.length;
    const order = ["Tier", "Type", "Head", "Eyes", "Antenna", "Mouth", "Accessory"];
    $("#traitFilters").innerHTML = order.map(k => {
      const vals = (k === "Tier" ? TIERS.slice() : Object.keys(S.traitCounts[k] || {})).sort((a, b) => k === "Tier" ? TIERS.indexOf(a) - TIERS.indexOf(b) : (S.traitCounts[k][b] - S.traitCounts[k][a]) || a.localeCompare(b));
      const sel = S.filters.traits[k] || new Set();
      const isOpen = first ? k === "Tier" : open.has(k);
      return `<div class="fgroup ${isOpen ? "open" : ""}" data-k="${k}"><button>${k === "Tier" ? "Rarity tier" : esc(k)} <span style="margin-left:auto;margin-right:8px" class="dim mono">${sel.size ? sel.size : ""}</span><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button><div class="fbody">${vals.map(v => `<label class="opt"><input type="checkbox" data-k="${k}" data-v="${esc(v)}" ${sel.has(v) ? "checked" : ""}><span>${esc(v)}</span><span class="n">${(S.traitCounts[k] || {})[v] || 0}</span></label>`).join("")}</div></div>`;
    }).join("");
    $$("#traitFilters input").forEach(i => i.onchange = () => {
      const k = i.dataset.k, v = i.dataset.v; const s = S.filters.traits[k] = S.filters.traits[k] || new Set();
      i.checked ? s.add(v) : s.delete(v); if (!s.size) delete S.filters.traits[k];
      renderGrid(); renderFilterBadges();
    });
    $$("#traitFilters .fgroup > button").forEach(b => b.onclick = () => b.parentElement.classList.toggle("open"));
  }
  function filtered() {
    const F = S.filters; const q = S.search.trim().toLowerCase().replace(/^#/, "");
    const min = parseAmt(F.min), max = parseAmt(F.max);
    const offerTokens = new Set(S.offers.filter(o => o.expiry > nowSec()).map(o => o.tokenId));
    let list = S.ids.filter(id => {
      const b = S.bots.get(id), l = S.listings.get(id);
      if (F.status === "listed" && !l) return false;
      if (F.status === "offers" && !offerTokens.has(id)) return false;
      if ((min || max) && !l) return false;
      if (min && l.price < min) return false;
      if (max && l.price > max) return false;
      for (const k in F.traits) if (!F.traits[k].has(b.traits[k])) return false;
      if (q) { if (/^\d+$/.test(q)) { if (String(id) !== q && !(b.handle || "").toLowerCase().includes(q)) return false; } else if (!(b.handle || "").toLowerCase().includes(q) && !nameOf(b).toLowerCase().includes(q)) return false; }
      return true;
    });
    const P = id => S.listings.get(id) ? S.listings.get(id).price : null;
    const cmpBig = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const sorters = {
      price_asc: (a, b) => (P(a) == null) - (P(b) == null) || (P(a) != null && P(b) != null ? cmpBig(P(a), P(b)) : 0) || a - b,
      price_desc: (a, b) => (P(a) == null) - (P(b) == null) || (P(a) != null && P(b) != null ? cmpBig(P(b), P(a)) : 0) || a - b,
      recent: (a, b) => (P(a) == null) - (P(b) == null) || (S.listedAt.get(b) || 0) - (S.listedAt.get(a) || 0) || b - a,
      rarity: (a, b) => S.bots.get(a).rank - S.bots.get(b).rank,
      id_asc: (a, b) => a - b, id_desc: (a, b) => b - a,
    };
    return list.sort(sorters[S.sort] || sorters.price_asc);
  }
  function bestOfferFor(id) { let best = null; for (const o of S.offers) if (o.tokenId === id && o.expiry > nowSec() && (!best || o.price > best.price)) best = o; return best; }
  function card(id, opts = {}) {
    const b = S.bots.get(id), l = S.listings.get(id), bo = bestOfferFor(id), mine = isMe(holderOf(id));
    const inCart = S.cart.has(id), sel = opts.select ? S.sel.has(id) : inCart;
    const price = l ? `<span class="v">${DB.fmt(l.price)} ${esc(sym())}</span><span class="u">${esc(usd(l.price))}</span>` : `<span class="none">Not listed</span>`;
    const bar = l && !mine && !opts.select ? `<div class="hover-bar"><button data-act="buy" data-id="${id}">Buy now</button><button class="alt" data-act="cart" data-id="${id}" title="${inCart ? "Remove from cart" : "Add to cart"}" aria-label="${inCart ? "Remove from cart" : "Add to cart"}">${inCart ? "−" : icon.cart}</button></div>`
      : !l && !mine && !opts.select ? `<div class="hover-bar"><button data-act="offer" data-id="${id}">Make offer</button></div>` : "";
    const tag = opts.mine ? `<span class="chip owned-tag ${l ? "orange" : ""}">${l ? "Listed" : "In wallet"}</span>` : mine ? `<span class="chip owned-tag">Yours</span>` : "";
    return `<div class="card ${sel ? "sel" : ""}" tabindex="0" data-id="${id}" data-test="card-${id}">
      <div class="media">${imgTag(id)}<span class="tier">${tierChip(b.traits.Tier)}</span>${(l && !mine) || opts.select ? `<span class="check" data-act="${opts.select ? "select" : "cart"}" data-id="${id}">${sel ? icon.check : ""}</span>` : ""}${tag}</div>
      <div class="body"><div class="name" title="${esc(nameOf(b))}">${esc(nameOf(b))}</div><div class="sub"><span>#${id}</span><span>Rank ${b.rank}</span></div>
      <div class="price">${price}</div><div class="offer">${bo ? "Best offer " + DB.fmt(bo.price) + " " + esc(sym()) : ""}</div></div>${bar}</div>`;
  }
  function skeletons(n) { return Array.from({ length: n }, () => `<div class="card skeleton"><div class="media"><div class="skel"></div></div><div class="body"><div class="skel line" style="width:70%"></div><div class="skel line" style="width:40%"></div><div class="skel line" style="width:55%;height:16px;margin-top:14px"></div></div></div>`).join(""); }
  function renderGrid() {
    const g = $("#grid");
    if (!S.loaded) { g.innerHTML = skeletons(12); return; }
    const list = filtered();
    $("#resultCount").textContent = `${list.length} ${list.length === 1 ? "bot" : "bots"}`;
    if (!list.length) { const zt = [...(S.filters.traits.Tier || [])].filter(v => !((S.traitCounts && S.traitCounts.Tier) || {})[v]); g.innerHTML = zt.length ? `<div class="empty" style="grid-column:1/-1"><h3>No ${esc(zt.join(" / "))} bots yet</h3>No bot of this tier has been minted yet.</div>` : `<div class="empty" style="grid-column:1/-1"><h3>No bots match</h3>Try removing a filter or clearing the search.</div>`; return; }
    g.innerHTML = list.map(id => card(id)).join("");
    watchImgs(g);
    const buyable = [...S.listings.entries()].filter(([, l]) => !isMe(l.seller)).length;
    const r = $("#sweepRange"); r.max = String(Math.min(buyable, 50)); r.value = String(Math.min(S.cart.size, Number(r.max))); $("#sweepN").textContent = r.value;
  }
  function renderFilterBadges() {
    const chips = [];
    if (S.filters.status !== "all") chips.push(["status", "", S.filters.status === "listed" ? "Buy now" : "Has offers"]);
    if (S.filters.min || S.filters.max) chips.push(["price", "", `Price ${S.filters.min || "0"} – ${S.filters.max || "∞"}`]);
    for (const k in S.filters.traits) for (const v of S.filters.traits[k]) chips.push(["trait", k + "|" + v, `${k}: ${v}`]);
    $("#activeFilters").innerHTML = chips.map(([t, d, l]) => `<span class="chip" data-t="${t}" data-d="${esc(d)}">${esc(l)} ✕</span>`).join("") + (chips.length > 1 ? `<span class="chip" data-t="clear">Clear all</span>` : "");
    $("#fCount").textContent = chips.length ? `(${chips.length})` : "";
    $$("#activeFilters .chip").forEach(c => c.onclick = () => {
      const t = c.dataset.t;
      if (t === "status" || t === "clear") { S.filters.status = "all"; $$("#statusSeg button").forEach(b => b.classList.toggle("on", b.dataset.s === "all")); }
      if (t === "price" || t === "clear") { S.filters.min = S.filters.max = ""; $("#pMin").value = $("#pMax").value = ""; }
      if (t === "trait") { const [k, v] = c.dataset.d.split("|"); S.filters.traits[k].delete(v); if (!S.filters.traits[k].size) delete S.filters.traits[k]; }
      if (t === "clear") S.filters.traits = {};
      renderFilters(); renderGrid(); renderFilterBadges();
    });
  }

  // ================================================================== render: activity, collection offers, analytics
  function evRow(e) {
    const a = e.args; const n = e.name;
    let kind, label, id = null, price = null, from = null, to = null;
    if (n === "Listed") { kind = "list"; label = "Listed"; id = a.tokenId; price = a.price; from = a.seller; }
    else if (n === "PriceUpdated") { kind = "price"; label = "Price change"; id = a.tokenId; price = a.newPrice; from = a.seller; }
    else if (n === "Cancelled") { kind = "cancel"; label = "Listing cancelled"; id = a.tokenId; from = a.seller; }
    else if (n === "Sold") { kind = "sale"; label = ["Sale", "Sale · offer", "Sale · collection offer"][Number(a.kind)] || "Sale"; id = a.tokenId; price = a.price; from = a.seller; to = a.buyer; }
    else if (n === "OfferMade") { kind = "offer"; label = "Offer"; id = a.tokenId; price = a.price; from = a.buyer; }
    else if (n === "OfferCancelled") { kind = "cancel"; label = a.expired ? "Offer refunded" : "Offer cancelled"; id = a.tokenId; price = a.refund; from = a.buyer; }
    else if (n === "CollectionOfferMade") { kind = "coll"; label = `Collection offer ×${a.quantity}`; price = a.priceEach; from = a.buyer; }
    else if (n === "CollectionOfferCancelled") { kind = "cancel"; label = "Collection offer closed"; price = a.refund; from = a.buyer; }
    else return null;
    return { kind, label, id: id == null ? null : Number(id), price, from, to, e };
  }
  const who = a => a ? (isMe(a) ? "You" : DB.short(a)) : "";
  function itemCell(id) {
    if (id == null) return `<div class="item"><div class="ph" style="display:grid;place-items:center;color:var(--text-3)">∗</div><span>Any dotBot</span></div>`;
    const b = S.bots.get(id);
    return `<div class="item" data-open="${id}">${imgTag(id)}<span>${esc(b ? nameOf(b) : "#" + id)}</span></div>`;
  }
  function renderActivity() {
    const t = $("#actTable");
    if (!S.eventsLoaded) { t.innerHTML = `<tr><td><div class="skel line" style="width:60%"></div><div class="skel line" style="width:80%"></div><div class="skel line" style="width:40%"></div></td></tr>`; return; }
    const F = S.actFilter;
    const rows = S.events.slice().reverse().map(evRow).filter(r => r && (F === "all" || r.kind === F || (F === "offer" && r.kind === "coll") || (F === "list" && r.kind === "price"))).slice(0, 300);
    if (!rows.length) { t.innerHTML = `<tr><td class="muted" style="padding:30px;text-align:center">No activity yet.</td></tr>`; return; }
    t.innerHTML = `<thead><tr><th>Event</th><th>Item</th><th>Price</th><th class="hide-m">From</th><th class="hide-m">To</th><th>Time</th></tr></thead><tbody>` + rows.map(r => `<tr data-test="act-row">
      <td><span class="ev ${r.kind}"><i></i>${esc(r.label)}</span></td><td>${itemCell(r.id)}</td>
      <td class="num">${r.price != null ? DB.fmt(r.price) + " " + esc(sym()) : "—"}</td>
      <td class="hide-m mono">${r.from ? `<a class="tx" href="${esc(DB.addrUrl(r.from) || "#")}" target="_blank" rel="noopener">${esc(who(r.from))}</a>` : ""}</td>
      <td class="hide-m mono">${r.to ? `<a class="tx" href="${esc(DB.addrUrl(r.to) || "#")}" target="_blank" rel="noopener">${esc(who(r.to))}</a>` : ""}</td>
      <td>${DB.txUrl(r.e.tx) ? `<a class="tx" href="${esc(DB.txUrl(r.e.tx))}" target="_blank" rel="noopener" title="View transaction">${ago(r.e.time)} ${icon.ext}</a>` : ago(r.e.time)}</td></tr>`).join("") + "</tbody>";
    watchImgs(t);
  }
  function renderColl() {
    const t = $("#collTable");
    if (!S.loaded) { t.innerHTML = `<tr><td><div class="skel line"></div><div class="skel line" style="width:60%"></div></td></tr>`; return; }
    const list = S.coll.slice().sort((a, b) => (b.each > a.each ? 1 : b.each < a.each ? -1 : 0));
    if (!list.length) { t.innerHTML = `<tr><td class="muted" style="padding:30px;text-align:center">No collection offers yet. Be the first to make one.</td></tr>`; return; }
    const myBots = DB.account ? S.ids.filter(id => isMe(holderOf(id))) : [];
    t.innerHTML = `<thead><tr><th>Price each</th><th>Quantity left</th><th class="hide-m">Total held</th><th>Expires</th><th class="hide-m">From</th><th></th></tr></thead><tbody>` + list.map(c => {
      const exp = c.expiry <= nowSec(); const mine = isMe(c.buyer);
      const act = mine ? `<button class="btn xs ghost" data-cancel-coll="${c.id}">${exp ? "Refund" : "Cancel"}</button>` : exp ? `<button class="btn xs ghost" data-refund-coll="${c.id}">Refund to offerer</button>` : myBots.length ? `<button class="btn xs primary" data-fill-coll="${c.id}">Accept with your bot</button>` : "";
      return `<tr data-test="coll-row"><td class="num"><b>${DB.fmt(c.each)} ${esc(sym())}</b> <span class="dim">${esc(usd(c.each))}</span></td><td class="num">${c.remaining}</td><td class="num hide-m">${DB.fmt(c.each * BigInt(c.remaining))}</td><td>${exp ? '<span class="chip red">Expired</span>' : until(c.expiry)}</td><td class="hide-m mono">${esc(who(c.buyer))}</td><td style="text-align:right">${act}</td></tr>`;
    }).join("") + "</tbody>";
    $$("[data-cancel-coll]", t).forEach(b => b.onclick = () => cancelColl(Number(b.dataset.cancelColl)));
    $$("[data-refund-coll]", t).forEach(b => b.onclick = () => runTx("Refund expired collection offer", async () => DB.market(true).refundExpiredCollectionOffers([Number(b.dataset.refundColl)])));
    $$("[data-fill-coll]", t).forEach(b => b.onclick = () => openFillColl(Number(b.dataset.fillColl)));
  }
  function floorSeries() {
    const live = new Map(); const pts = []; const sales = [];
    for (const e of S.events) {
      const id = e.args && e.args.tokenId != null ? Number(e.args.tokenId) : null;
      if (e.name === "Listed") live.set(id, e.args.price);
      else if (e.name === "PriceUpdated") live.set(id, e.args.newPrice);
      else if (e.name === "Cancelled") live.delete(id);
      else if (e.name === "Sold") { live.delete(id); sales.push({ t: e.time, p: e.args.price, id }); }
      else continue;
      let f = null; for (const v of live.values()) if (f === null || v < f) f = v;
      pts.push({ t: e.time, f });
    }
    return { pts, sales };
  }
  function renderChart() {
    const box = $("#chart");
    if (!S.eventsLoaded) { box.innerHTML = `<div class="skel" style="height:260px"></div>`; return; }
    const { pts, sales } = floorSeries();
    if (!pts.length) { box.innerHTML = `<div class="empty">No market history yet.</div>`; return; }
    const W = 1000, H = 260, L = 64, R = 16, T = 14, B = 30;
    const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(nowSec(), ...pts.map(p => p.t));
    const ys = pts.filter(p => p.f != null).map(p => Number(ethers.formatEther(p.f))).concat(sales.map(s => Number(ethers.formatEther(s.p))));
    const ymax = Math.max(...ys, 0.000001) * 1.18;
    const X = t => L + (W - L - R) * ((t - t0) / Math.max(1, t1 - t0));
    const Y = v => T + (H - T - B) * (1 - v / ymax);
    let d = ""; let prev = null;
    for (const p of pts) {
      const x = X(p.t);
      if (prev && prev.f != null) d += ` H${x.toFixed(1)}`;
      if (p.f != null) { const y = Y(Number(ethers.formatEther(p.f))); d += (prev && prev.f != null ? ` V${y.toFixed(1)}` : ` M${x.toFixed(1)},${y.toFixed(1)}`); }
      prev = p;
    }
    if (prev && prev.f != null) d += ` H${X(t1).toFixed(1)}`;
    const grid = [0, .25, .5, .75, 1].map(k => { const v = ymax * k; const y = Y(v); return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" style="fill:var(--text-3)" font-size="11" font-family="Geist Mono, monospace">${v.toPrecision(2)}</text>`; }).join("");
    const fmtT = t => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    const xl = [t0, (t0 + t1) / 2, t1].map((t, i) => `<text x="${X(t)}" y="${H - 8}" text-anchor="${["start", "middle", "end"][i]}" style="fill:var(--text-3)" font-size="11">${esc(fmtT(t))}</text>`).join("");
    const dots = sales.map(s => `<circle cx="${X(s.t).toFixed(1)}" cy="${Y(Number(ethers.formatEther(s.p))).toFixed(1)}" r="5" fill="#22c27a" style="stroke:var(--bg)" stroke-width="2" data-tip="${esc(`Sale · ${nameOf(S.bots.get(s.id)) || "#" + s.id} · ${DB.fmt(s.p)} ${sym()} · ${fmtT(s.t)}`)}"></circle>`).join("");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Floor price and sales chart">${grid}<text x="${L}" y="${T - 2}" style="fill:var(--text-3)" font-size="11">${esc(sym())}</text><path d="${d}" fill="none" stroke="#ff4d00" stroke-width="2.5" vector-effect="non-scaling-stroke"/>${dots}${xl}</svg><div class="chart-tip" id="chartTip"></div>`;
    const tip = $("#chartTip");
    $$("circle[data-tip]", box).forEach(c => {
      c.onmouseenter = () => { tip.textContent = c.dataset.tip; tip.style.opacity = 1; const r = c.getBoundingClientRect(), br = box.getBoundingClientRect(); tip.style.left = Math.min(br.width - 240, Math.max(0, r.left - br.left - 60)) + "px"; tip.style.top = (r.top - br.top - 36) + "px"; };
      c.onmouseleave = () => { tip.style.opacity = 0; };
    });
    const vols = sales.reduce((s, x) => s + x.p, 0n);
    const avg = sales.length ? vols / BigInt(sales.length) : null;
    const hi = sales.reduce((m, x) => (m == null || x.p > m ? x.p : m), null);
    const rows = [["Sales (from events)", String(sales.length)], ["Volume (from events)", DB.fmt(vols) + " " + sym()], ["Average sale", avg != null ? DB.fmt(avg) + " " + sym() : "—"], ["Highest sale", hi != null ? DB.fmt(hi) + " " + sym() : "—"],
      ["Live single-bot offers", String(S.offers.filter(o => o.expiry > nowSec()).length)], ["Live collection offers", String(S.coll.filter(c => c.expiry > nowSec()).length)], ["Market fee", feePct() + " of each sale, paid from the seller's side"], ["BNB/USD used for $ values", S.usd ? "$" + S.usd.toFixed(2) + (DB.cfg.chainId === 97 ? " (testnet mock feed)" : "") : "—"]];
    $("#summary").innerHTML = rows.map(([k, v]) => `<div class="row"><span class="grow muted">${esc(k)}</span><span class="mono">${esc(v)}</span></div>`).join("");
  }

  // ================================================================== render: my bots / my offers
  function needWallet(box, what) {
    box.innerHTML = `<div class="empty"><h3>Connect your wallet</h3>to see ${esc(what)}.<div style="margin-top:14px"><button class="btn primary" data-connect>Connect wallet</button></div></div>`;
    $("[data-connect]", box).onclick = connect;
  }
  function renderMine() {
    const box = $("#mineBody");
    if (!DB.account) { needWallet(box, "your bots"); $("#cMine").textContent = ""; return; }
    if (!S.loaded) { box.innerHTML = `<div class="grid">${skeletons(4)}</div>`; return; }
    const mine = S.ids.filter(id => isMe(holderOf(id)));
    const listed = mine.filter(id => S.listings.has(id));
    $("#cMine").textContent = mine.length || "";
    const recv = S.offers.filter(o => mine.includes(o.tokenId) && !isMe(o.buyer)).sort((a, b) => (b.price > a.price ? 1 : -1));
    const bc = bestColl();
    let h = `<div class="toolbar"><div><b style="font-size:18px">My bots</b> <span class="dim mono">${mine.length}</span><div class="muted" style="font-size:13px">${esc(DB.short(DB.account))} · ${listed.length} listed</div></div><span class="grow"></span>
      ${listed.length ? `<button class="btn sm ghost" id="selAll">${S.sel.size ? "Clear selection" : "Select all listed"}</button><button class="btn sm danger" id="batchCancel" ${S.sel.size ? "" : "disabled"}>Cancel selected (${S.sel.size})</button>` : ""}
      <button class="btn sm ghost" id="disc">Disconnect</button></div>`;
    if (recv.length) {
      h += `<div class="panel" style="margin-bottom:16px"><h3>Offers on your bots</h3><div class="scroll-x"><table class="table"><thead><tr><th>Bot</th><th>Offer</th><th class="hide-m">From</th><th>Expires</th><th></th></tr></thead><tbody>` +
        recv.map(o => { const exp = o.expiry <= nowSec(); return `<tr data-test="recv-offer"><td>${itemCell(o.tokenId)}</td><td class="num"><b>${DB.fmt(o.price)} ${esc(sym())}</b> <span class="dim">${esc(usd(o.price))}</span></td><td class="hide-m mono">${esc(who(o.buyer))}</td><td>${exp ? '<span class="chip red">Expired</span>' : until(o.expiry)}</td><td style="text-align:right">${exp ? "" : `<button class="btn xs primary" data-accept="${o.id}">Accept</button>`}</td></tr>`; }).join("") + `</tbody></table></div></div>`;
    }
    if (bc && mine.length && !isMe(bc.buyer)) h += `<div class="notice"><span class="grow">Top collection offer: <b class="mono">${DB.fmt(bc.each)} ${esc(sym())}</b> each for any dotBot (${bc.remaining} left).</span><button class="btn sm primary" data-fill-coll="${bc.id}">Accept with one of your bots</button></div>`;
    h += mine.length ? `<div class="grid">${mine.map(id => card(id, { mine: true, select: S.listings.has(id) && S.selectMode })).join("")}</div>` : `<div class="empty"><h3>No bots in this wallet yet</h3>${DB.cfg.mintHelper ? "Get a test bot below, or buy one from Items." : "Buy one from Items."}</div>`;
    if (DB.cfg.mintHelper) h += `<div class="panel" style="margin-top:18px"><h3>Get a test bot</h3><div class="muted" style="font-size:14px;margin-bottom:12px">Testnet only. Sets a test handle on the mock Agent ID registry, then mints one bot at the test mint price <b class="mono" id="mintPrice">…</b> (test BNB). One bot per handle.</div><div class="range" style="max-width:520px"><input class="input" id="handleIn" placeholder="test handle, e.g. robo42" maxlength="32"><button class="btn primary" id="mintBtn">Set handle + mint</button></div></div>`;
    box.innerHTML = h;
    watchImgs(box);
    $("#disc").onclick = () => { DB.disconnect(); };
    if ($("#selAll")) $("#selAll").onclick = () => { if (S.sel.size) S.sel.clear(); else listed.forEach(id => S.sel.add(id)); S.selectMode = S.sel.size > 0; renderMine(); };
    if ($("#batchCancel")) $("#batchCancel").onclick = () => { const ids = [...S.sel]; runTx(`Cancel ${ids.length} listing${ids.length > 1 ? "s" : ""}`, async () => DB.market(true).cancelMany(ids), () => "Bots are back in your wallet.").then(r => { if (r) { S.sel.clear(); S.selectMode = false; renderMine(); } }); };
    $$("[data-accept]", box).forEach(b => b.onclick = () => openAccept(Number(b.dataset.accept)));
    $$("[data-fill-coll]", box).forEach(b => b.onclick = () => openFillColl(Number(b.dataset.fillColl)));
    if (DB.cfg.mintHelper) {
      DB.bots().unitPrice().then(p => { const el = $("#mintPrice"); if (el) el.textContent = DB.fmt(p) + " " + sym(); }).catch(() => {});
      $("#mintBtn").onclick = mintTestBot;
    }
  }
  function renderMyOffers() {
    const box = $("#myOffersBody");
    if (!DB.account) { needWallet(box, "your offers"); $("#cMyOffers").textContent = ""; return; }
    const mine = S.offers.filter(o => isMe(o.buyer)), mc = S.coll.filter(c => isMe(c.buyer));
    $("#cMyOffers").textContent = (mine.length + mc.length) || "";
    for (const id of [...S.offerSel]) if (!mine.some(o => o.id === id)) S.offerSel.delete(id);
    const held = mine.reduce((s, o) => s + o.price, 0n) + mc.reduce((s, c) => s + c.each * BigInt(c.remaining), 0n);
    let h = `<div class="toolbar"><div><b style="font-size:18px">My offers</b><div class="muted" style="font-size:13px">Held by the market for your offers: <b class="mono">${DB.fmt(held)} ${esc(sym())}</b>. Cancel any time to get it back.</div></div><span class="grow"></span>${mine.length ? `<button class="btn sm danger" id="batchOffers" ${S.offerSel.size ? "" : "disabled"}>Cancel selected (${S.offerSel.size})</button>` : ""}</div>`;
    h += `<div class="panel" style="margin-bottom:16px"><h3>Offers on single bots</h3>` + (mine.length ? `<div class="scroll-x"><table class="table"><thead><tr><th style="width:30px"></th><th>Bot</th><th>Your offer</th><th>Expires</th><th class="hide-m">Status</th><th></th></tr></thead><tbody>` +
      mine.map(o => { const exp = o.expiry <= nowSec(); return `<tr data-test="my-offer"><td><input type="checkbox" data-osel="${o.id}" ${S.offerSel.has(o.id) ? "checked" : ""} style="accent-color:var(--accent);width:16px;height:16px"></td><td>${itemCell(o.tokenId)}</td><td class="num"><b>${DB.fmt(o.price)} ${esc(sym())}</b></td><td>${exp ? '<span class="chip red">Expired</span>' : until(o.expiry)}</td><td class="hide-m">${exp ? "Expired, ready to refund" : '<span class="chip green">Active</span>'}</td><td style="text-align:right"><button class="btn xs ghost" data-ocancel="${o.id}">${exp ? "Refund" : "Cancel"}</button></td></tr>`; }).join("") + `</tbody></table></div>` : `<div class="muted">No offers yet. Open any bot and choose “Make offer”.</div>`) + `</div>`;
    h += `<div class="panel"><h3>Collection offers</h3>` + (mc.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Price each</th><th>Left</th><th>Held</th><th>Expires</th><th></th></tr></thead><tbody>` +
      mc.map(c => { const exp = c.expiry <= nowSec(); return `<tr data-test="my-coll"><td class="num"><b>${DB.fmt(c.each)} ${esc(sym())}</b></td><td class="num">${c.remaining}</td><td class="num">${DB.fmt(c.each * BigInt(c.remaining))}</td><td>${exp ? '<span class="chip red">Expired</span>' : until(c.expiry)}</td><td style="text-align:right"><button class="btn xs ghost" data-cancel-coll="${c.id}">${exp ? "Refund" : "Cancel"}</button></td></tr>`; }).join("") + `</tbody></table></div>` : `<div class="muted">No collection offers. Make one from the Collection offers tab.</div>`) + `</div>`;
    box.innerHTML = h; watchImgs(box);
    $$("[data-osel]", box).forEach(c => c.onchange = () => { const id = Number(c.dataset.osel); c.checked ? S.offerSel.add(id) : S.offerSel.delete(id); renderMyOffers(); });
    $$("[data-ocancel]", box).forEach(b => b.onclick = () => runTx("Cancel offer", async () => DB.market(true).cancelOffer(Number(b.dataset.ocancel)), () => "Your BNB is back."));
    $$("[data-cancel-coll]", box).forEach(b => b.onclick = () => cancelColl(Number(b.dataset.cancelColl)));
    if ($("#batchOffers")) $("#batchOffers").onclick = () => { const ids = [...S.offerSel]; runTx(`Cancel ${ids.length} offer${ids.length > 1 ? "s" : ""}`, async () => DB.market(true).cancelOffers(ids), () => "Your BNB is back.").then(r => { if (r) { S.offerSel.clear(); renderMyOffers(); } }); };
    bindItemOpen(box);
  }

  function renderAll() {
    renderWallet(); renderNotices(); renderStats();
    if (S.loaded && !$("#traitFilters").children.length) renderFilters();
    renderGrid(); renderCart();
    if (S.view === "activity") renderActivity();
    if (S.view === "offers") renderColl();
    if (S.view === "analytics") renderChart();
    if (S.view === "mine") renderMine();
    if (S.view === "myoffers") renderMyOffers();
    if (!$("#scrim").classList.contains("on")) routeFromHash();
    else if (S.openId != null && $('#mcontent [data-test="detail"]')) openDetail(S.openId, true);
  }

  // ================================================================== bot detail
  function openDetail(id, keep) {
    const b = S.bots.get(id); if (!b) return;
    S.openId = id;
    if (!keep) history.replaceState(null, "", "#bot/" + id);
    const l = S.listings.get(id), holder = holderOf(id), mine = isMe(holder), N = S.ids.length;
    const offers = S.offers.filter(o => o.tokenId === id).sort((a, c) => (c.price > a.price ? 1 : -1));
    const bc = bestColl();
    let actions;
    if (S.paused) actions = mine && l ? `<button class="btn danger" data-d="cancel">Cancel listing</button>` : `<button class="btn" disabled>Trading paused</button>`;
    else if (mine && l) actions = `<button class="btn primary" data-d="reprice">Change price</button><button class="btn danger" data-d="cancel">Cancel listing</button>`;
    else if (mine) actions = `<button class="btn primary" data-d="list">List for sale</button>`;
    else if (l) actions = `<button class="btn primary" data-d="buy">Buy now</button><button class="btn ghost" data-d="cart">${S.cart.has(id) ? "Remove from cart" : "Add to cart"}</button><button class="btn ghost" data-d="offer">Make offer</button>`;
    else actions = `<button class="btn primary" data-d="offer">Make offer</button>`;
    const priceBlock = l ? `<div class="lbl">${mine ? "Your listing" : "Current price"}</div><div class="big-price">${DB.fmt(l.price)} ${esc(sym())} <small>${esc(usd(l.price))}</small></div>`
      : `<div class="lbl">Not listed</div><div class="big-price" style="font-size:20px">${offers.length ? "Best offer " + DB.fmt(offers.find(o => o.expiry > nowSec())?.price ?? offers[0].price) + " " + esc(sym()) : "No offers yet"}</div>`;
    const feeLine = l ? (mine ? `Market fee <b>${feePct()}</b>: you receive <b class="mono">${DB.fmt(l.price - (l.price * l.fee) / 10000n)} ${esc(sym())}</b> when it sells.` : `Market fee <b>${feePct()}</b> is paid by the seller out of this price. You pay the price + network gas.`)
      : `Market fee <b>${feePct()}</b> applies to every sale, taken from the seller's side.`;
    const offerRows = offers.length ? offers.map(o => {
      const exp = o.expiry <= nowSec(); let btn = "";
      if (isMe(o.buyer)) btn = `<button class="btn xs ghost" data-cancel-offer="${o.id}">${exp ? "Refund" : "Cancel"}</button>`;
      else if (mine && !exp && !S.paused) btn = `<button class="btn xs primary" data-accept="${o.id}">Accept</button>`;
      return `<div class="row" data-test="offer-row"><span class="price">${DB.fmt(o.price)} ${esc(sym())}</span><span class="dim hide-m">${esc(usd(o.price))}</span><span class="grow mono dim">${esc(who(o.buyer))}</span><span class="${exp ? "" : "dim"}">${exp ? '<span class="chip red">Expired</span>' : until(o.expiry)}</span>${btn}</div>`;
    }).join("") : `<div class="muted" style="padding:6px 0">No offers on this bot yet.</div>`;
    const collRow = bc && mine && !isMe(bc.buyer) && !S.paused ? `<div class="row"><span class="price">${DB.fmt(bc.each)} ${esc(sym())}</span><span class="grow dim">Collection offer (any bot)</span><button class="btn xs primary" data-fillc="${bc.id}">Accept</button></div>` : "";
    const hist = S.events.filter(e => e.args && e.args.tokenId != null && Number(e.args.tokenId) === id).slice().reverse().map(evRow).filter(Boolean);
    const histRows = !S.eventsLoaded ? `<div class="skel line"></div><div class="skel line" style="width:60%"></div>` : hist.length ? hist.map(r => `<div class="row"><span class="ev ${r.kind}"><i></i>${esc(r.label)}</span><span class="grow mono dim">${esc(who(r.from))}${r.to ? " → " + esc(who(r.to)) : ""}</span><span class="price">${r.price != null ? DB.fmt(r.price) : ""}</span>${DB.txUrl(r.e.tx) ? `<a class="dim" href="${esc(DB.txUrl(r.e.tx))}" target="_blank" rel="noopener" style="white-space:nowrap;text-decoration:none">${ago(r.e.time)} ${icon.ext}</a>` : `<span class="dim">${ago(r.e.time)}</span>`}</div>`).join("") : `<div class="muted">No market history yet.</div>`;
    const traits = ["Tier", "Head", "Eyes", "Antenna", "Mouth", "Accessory", "Type"].map(k => { const v = b.traits[k], c = (S.traitCounts[k] || {})[v] || 0; return `<div class="trait"><div class="t">${esc(k)}</div><div class="v" title="${esc(v)}">${esc(v)}</div><div class="p">${N ? Math.round((c / N) * 100) : 0}% have this</div></div>`; }).join("");
    openModal(`<div class="detail" data-test="detail">
      <div class="dleft"><div class="big">${imgTag(id)}</div>
        <div class="dtraits"><div class="section-h">Traits</div><div class="traits">${traits}</div></div></div>
      <div class="dinfo">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${tierChip(b.traits.Tier)}<span class="chip">Rank ${b.rank} of ${N}</span><span class="chip">#${id}</span></div>
        <h2>${esc(nameOf(b))}</h2>
        <div class="owner-line"><span>Owned by <a href="${esc(DB.addrUrl(holder) || "#")}" target="_blank" rel="noopener">${esc(mine ? "you" : DB.short(holder))}</a></span>${l ? `<span>Held in market escrow while listed</span>` : ""}</div>
        <div class="pricebox">${priceBlock}<div class="actions">${actions}</div><div class="feeline">${feeLine}</div></div>
        <div class="section-h">Offers</div><div class="rows">${collRow}${offerRows}</div>
        <div class="section-h">Market history</div><div class="rows hist-scroll">${histRows}</div>
      </div></div>`);
    watchImgs($("#mcontent"));
    const on = (sel, fn) => { const el = $(sel, $("#mcontent")); if (el) el.onclick = fn; };
    on('[data-d="buy"]', () => openBuy(id));
    on('[data-d="cart"]', () => { toggleCart(id); openDetail(id, true); });
    on('[data-d="offer"]', () => openOffer(id));
    on('[data-d="list"]', () => openList(id));
    on('[data-d="reprice"]', () => openList(id, true));
    on('[data-d="cancel"]', () => runTx("Cancel listing", async () => DB.market(true).cancel(id), () => "The bot is back in your wallet."));
    $$("[data-accept]", $("#mcontent")).forEach(bt => bt.onclick = () => openAccept(Number(bt.dataset.accept)));
    $$("[data-cancel-offer]", $("#mcontent")).forEach(bt => bt.onclick = () => runTx("Cancel offer", async () => DB.market(true).cancelOffer(Number(bt.dataset.cancelOffer)), () => "Your BNB is back."));
    on("[data-fillc]", () => openFillColl(bc.id, id));
  }

  // ------------------------------------------------------------------ action dialogs
  const backTo = id => `<button class="btn ghost" data-back="${id}">Back</button>`;
  function wireBack() { const b = $("[data-back]", $("#mcontent")); if (b) b.onclick = () => openDetail(Number(b.dataset.back), true); }
  function miniHead(id, title) { const b = S.bots.get(id); return `<div class="mhead"><h2>${esc(title)}</h2></div><div class="mbody"><div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">${imgTag(id, "").replace("<img", '<img style="width:56px;height:56px;border-radius:10px"')}<div style="min-width:0"><div style="font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nameOf(b))}</div><div class="dim" style="font-size:13px">#${id} · ${esc(b.traits.Tier)} · Rank ${b.rank}</div></div></div>`; }

  function openBuy(id) {
    const l = S.listings.get(id); if (!l) return toast("err", "Not listed", "This bot is not listed any more.", 6000);
    if (!DB.account) return connect().then(() => DB.account && openBuy(id));
    openModal(miniHead(id, "Complete purchase") + `<div class="breakdown"><div><span>Price</span><span>${DB.fmt(l.price)} ${esc(sym())}</span></div><div><span class="dim">Market fee ${feePct()} (taken from the seller, nothing extra for you)</span><span class="dim">${DB.fmt((l.price * l.fee) / 10000n)}</span></div><div class="tot"><span>You pay</span><span>${DB.fmt(l.price)} ${esc(sym())} <span class="dim" style="font-weight:500">${esc(usd(l.price))}</span></span></div></div>
      <div class="feeline">Plus network gas. The bot moves to your wallet in the same transaction.</div><div class="actions" style="display:flex;gap:10px;margin-top:16px">${backTo(id)}<button class="btn primary" style="flex:1" id="confirmBuy">Buy for ${DB.fmt(l.price)} ${esc(sym())}</button></div></div>`, true);
    watchImgs($("#mcontent")); wireBack();
    $("#confirmBuy").onclick = async () => { closeModal(); await runTx("Buy " + nameOf(S.bots.get(id)), async () => DB.market(true).buy(id, { value: l.price }), () => "The bot is in your wallet."); };
  }

  async function openList(id, reprice) {
    const l = S.listings.get(id);
    const fl = floor();
    openModal(miniHead(id, reprice ? "Change price" : "List for sale") + `<div class="form">
      <label>Price<div class="input-suffix"><input class="input mono" id="priceIn" inputmode="decimal" placeholder="0.00" value="${reprice && l ? esc(ethers.formatEther(l.price)) : ""}"><span>${esc(sym())}</span></div></label>
      ${fl != null ? `<div class="dim" style="font-size:13px">Floor right now: <span class="mono">${DB.fmt(fl)} ${esc(sym())}</span> · <a href="#" id="useFloor" style="color:var(--link-warm)">use floor</a></div>` : ""}
      <div class="breakdown" id="lbd"></div>
      <div class="feeline">${reprice ? "Only the price changes; the bot stays in escrow." : "Your bot moves into the market contract (escrow) in one transaction. No token approval is requested. You can cancel any time, also while the market is paused."}</div>
      <div style="display:flex;gap:10px">${backTo(id)}<button class="btn primary" style="flex:1" id="doList" disabled>${reprice ? "Update price" : "List bot"}</button></div></div></div>`, true);
    watchImgs($("#mcontent")); wireBack();
    const inp = $("#priceIn"), bd = $("#lbd"), go = $("#doList");
    const upd = () => {
      const p = parseAmt(inp.value);
      go.disabled = !p;
      bd.innerHTML = `<div><span>Listing price</span><span>${p ? DB.fmt(p) + " " + esc(sym()) : "—"}</span></div><div><span class="dim">Market fee ${feePct()}</span><span class="dim">${p ? "−" + DB.fmt(feeOf(p)) : "—"}</span></div><div class="tot"><span>You receive</span><span>${p ? DB.fmt(p - feeOf(p)) + " " + esc(sym()) : "—"}</span></div>`;
    };
    inp.oninput = upd; upd(); inp.focus();
    if ($("#useFloor")) $("#useFloor").onclick = e => { e.preventDefault(); inp.value = ethers.formatEther(fl); upd(); };
    go.onclick = async () => {
      const p = parseAmt(inp.value); if (!p) return;
      closeModal();
      if (reprice) await runTx("Update price", async () => DB.market(true).updatePrice(id, p), () => "New price " + DB.fmt(p) + " " + sym() + ".");
      else await runTx("List " + nameOf(S.bots.get(id)), async () => { const s = await DB.getSigner(); return DB.bots(true).connect(s)["safeTransferFrom(address,address,uint256,bytes)"](DB.account, DB.cfg.addresses.market, id, DB.encList(p)); }, () => "Listed for " + DB.fmt(p) + " " + sym() + ".");
    };
  }

  function expirySelect(def = 3) { return `<select class="input" id="expIn">${EXPIRY.map(([l, s], i) => `<option value="${s}" ${i === def ? "selected" : ""}>${l}</option>`).join("")}</select>`; }
  function openOffer(id) {
    if (!DB.account) return connect().then(() => DB.account && openOffer(id));
    const l = S.listings.get(id), bo = bestOfferFor(id);
    openModal(miniHead(id, "Make an offer") + `<div class="form">
      <div class="dim" style="font-size:13px">${l ? `Listed at <span class="mono">${DB.fmt(l.price)} ${esc(sym())}</span> · ` : ""}${bo ? `Best offer <span class="mono">${DB.fmt(bo.price)} ${esc(sym())}</span>` : "No offers yet"}</div>
      <label>Your offer<div class="input-suffix"><input class="input mono" id="offIn" inputmode="decimal" placeholder="0.00"><span>${esc(sym())}</span></div></label>
      <label>Expires after${expirySelect(3)}</label>
      <div class="breakdown" id="obd"></div>
      <div class="feeline">Your BNB is held by the market contract until the owner accepts, you cancel, or it expires (then anyone can trigger the refund to you). Cancel any time, also while paused. Minimum offer 0.0001.</div>
      <div style="display:flex;gap:10px">${backTo(id)}<button class="btn primary" style="flex:1" id="doOffer" disabled>Make offer</button></div></div></div>`, true);
    watchImgs($("#mcontent")); wireBack();
    const inp = $("#offIn"), bd = $("#obd"), go = $("#doOffer");
    const upd = () => { const p = parseAmt(inp.value); go.disabled = !p || p < 10n ** 14n; bd.innerHTML = `<div><span>You send now (held in escrow)</span><span>${p ? DB.fmt(p) + " " + esc(sym()) : "—"}</span></div><div><span class="dim">Market fee ${feePct()}, from the seller's side if accepted</span><span class="dim">${p ? DB.fmt(feeOf(p)) : "—"}</span></div><div class="tot"><span>Owner receives if accepted</span><span>${p ? DB.fmt(p - feeOf(p)) + " " + esc(sym()) : "—"}</span></div>`; };
    inp.oninput = upd; upd(); inp.focus();
    go.onclick = async () => {
      const p = parseAmt(inp.value); if (!p) return;
      const exp = BigInt(nowSec() + Number($("#expIn").value));
      closeModal();
      await runTx("Offer on " + nameOf(S.bots.get(id)), async () => DB.market(true).makeOffer(id, exp, { value: p }), () => "Offer placed.");
    };
  }

  function openAccept(offerId) {
    const o = S.offers.find(x => x.id === offerId); if (!o) return toast("err", "Offer not found", "It may have been cancelled.", 6000);
    const id = o.tokenId, l = S.listings.get(id);
    openModal(miniHead(id, "Accept offer") + `<div class="breakdown"><div><span>Offer</span><span>${DB.fmt(o.price)} ${esc(sym())}</span></div><div><span class="dim">Market fee ${feePct()}</span><span class="dim">−${DB.fmt(feeOf(o.price))}</span></div><div class="tot"><span>You receive</span><span>${DB.fmt(o.price - feeOf(o.price))} ${esc(sym())}</span></div></div>
      <div class="feeline" style="margin-top:10px">From <span class="mono">${esc(DB.short(o.buyer))}</span>, expires ${until(o.expiry)}. ${l ? "Your listing closes and the bot goes to the buyer." : "One transaction sends the bot from your wallet through the market to the buyer. No token approval is requested."}</div>
      <div style="display:flex;gap:10px;margin-top:16px">${backTo(id)}<button class="btn primary" style="flex:1" id="doAccept">Accept ${DB.fmt(o.price)} ${esc(sym())}</button></div></div>`, true);
    watchImgs($("#mcontent")); wireBack();
    $("#doAccept").onclick = async () => {
      closeModal();
      if (l) await runTx("Accept offer", async () => DB.market(true).acceptOfferForListed(offerId, o.price), () => "Sold.");
      else await runTx("Accept offer", async () => { const s = await DB.getSigner(); return DB.bots(true).connect(s)["safeTransferFrom(address,address,uint256,bytes)"](DB.account, DB.cfg.addresses.market, id, DB.encOp(OP_ACCEPT, offerId, o.price)); }, () => "Sold.");
    };
  }

  function openFillColl(cid, preset) {
    const c = S.coll.find(x => x.id === cid); if (!c) return;
    if (!DB.account) return connect().then(() => DB.account && openFillColl(cid, preset));
    const mine = S.ids.filter(id => isMe(holderOf(id)));
    if (!mine.length) return toast("err", "No bots in this wallet", "You need a dotBot to accept a collection offer.", 6000);
    const pick = preset && mine.includes(preset) ? preset : [...mine].sort((a, b) => S.bots.get(b).rank - S.bots.get(a).rank)[0];
    openModal(`<div class="mhead"><h2>Accept collection offer</h2></div><div class="mbody"><div class="form">
      <label>Bot to sell<select class="input" id="fillPick">${mine.map(id => `<option value="${id}" ${id === pick ? "selected" : ""}>#${id} · ${esc(nameOf(S.bots.get(id)))} · ${esc(S.bots.get(id).traits.Tier)}${S.listings.has(id) ? " · listed" : ""}</option>`).join("")}</select></label>
      <div class="breakdown"><div><span>Offer (each)</span><span>${DB.fmt(c.each)} ${esc(sym())}</span></div><div><span class="dim">Market fee ${feePct()}</span><span class="dim">−${DB.fmt(feeOf(c.each))}</span></div><div class="tot"><span>You receive</span><span>${DB.fmt(c.each - feeOf(c.each))} ${esc(sym())}</span></div></div>
      <div class="feeline">${c.remaining} left in this offer · expires ${until(c.expiry)}. One transaction, no token approval.</div>
      <div style="display:flex;gap:10px"><button class="btn ghost" id="fillCancel">Close</button><button class="btn primary" style="flex:1" id="doFill">Accept ${DB.fmt(c.each)} ${esc(sym())}</button></div></div></div>`, true);
    $("#fillCancel").onclick = closeModal;
    $("#doFill").onclick = async () => {
      const id = Number($("#fillPick").value); closeModal();
      if (S.listings.has(id)) await runTx("Accept collection offer", async () => DB.market(true).acceptCollectionOfferForListed(cid, id, c.each), () => "Sold.");
      else await runTx("Accept collection offer", async () => { const s = await DB.getSigner(); return DB.bots(true).connect(s)["safeTransferFrom(address,address,uint256,bytes)"](DB.account, DB.cfg.addresses.market, id, DB.encOp(OP_COLL, cid, c.each)); }, () => "Sold.");
    };
  }

  function openCollOffer() {
    if (!DB.account) return connect().then(() => DB.account && openCollOffer());
    const fl = floor(), bc = bestColl();
    openModal(`<div class="mhead"><h2>Make a collection offer</h2></div><div class="mbody"><div class="form">
      <div class="dim" style="font-size:13px">An offer for any dotBot. Each holder can fill one unit by sending a bot. ${fl != null ? `Floor <span class="mono">${DB.fmt(fl)} ${esc(sym())}</span>` : ""}${bc ? ` · Top collection offer <span class="mono">${DB.fmt(bc.each)} ${esc(sym())}</span>` : ""}</div>
      <label>Price per bot<div class="input-suffix"><input class="input mono" id="ceIn" inputmode="decimal" placeholder="0.00"><span>${esc(sym())}</span></div></label>
      <label>Quantity<input class="input mono" id="cqIn" inputmode="numeric" value="1"></label>
      <label>Expires after${expirySelect(3)}</label>
      <div class="breakdown" id="cbd"></div>
      <div class="feeline">The total is held by the market contract. Cancel any time to get back whatever is not filled yet. Market fee ${feePct()} comes out of what each seller receives.</div>
      <div style="display:flex;gap:10px"><button class="btn ghost" id="cClose">Close</button><button class="btn primary" style="flex:1" id="doColl" disabled>Make collection offer</button></div></div></div>`, true);
    $("#cClose").onclick = closeModal;
    const e = $("#ceIn"), q = $("#cqIn"), bd = $("#cbd"), go = $("#doColl");
    const val = () => { const p = parseAmt(e.value), n = /^\d+$/.test(q.value) ? Number(q.value) : 0; return [p, n]; };
    const upd = () => { const [p, n] = val(); const ok = p && p >= 10n ** 14n && n >= 1 && n <= 100; go.disabled = !ok; bd.innerHTML = `<div><span>Price per bot</span><span>${p ? DB.fmt(p) : "—"}</span></div><div><span>Quantity</span><span>${n || "—"}</span></div><div><span class="dim">Seller receives per bot (after ${feePct()})</span><span class="dim">${p ? DB.fmt(p - feeOf(p)) : "—"}</span></div><div class="tot"><span>You send now (held)</span><span>${ok ? DB.fmt(p * BigInt(n)) + " " + esc(sym()) : "—"}</span></div>`; };
    e.oninput = q.oninput = upd; upd(); e.focus();
    go.onclick = async () => {
      const [p, n] = val(); const exp = BigInt(nowSec() + Number($("#expIn").value)); closeModal();
      await runTx("Collection offer", async () => DB.market(true).makeCollectionOffer(p, n, exp, { value: p * BigInt(n) }), () => "Collection offer placed.");
    };
  }
  const cancelColl = cid => runTx("Cancel collection offer", async () => DB.market(true).cancelCollectionOffer(cid), () => "Unfilled BNB is back.");
  const withdraw = () => runTx("Withdraw", async () => DB.market(true).withdraw(), () => "Sent to your wallet.");

  async function mintTestBot() {
    const h = ($("#handleIn").value || "").trim();
    if (!h || h.length > 32) return toast("err", "Enter a test handle", "1 to 32 characters.", 5000);
    const a = await runTx("Set test handle", async () => DB.registry(true).setHandle(h));
    if (!a) return;
    const price = await DB.bots().unitPrice();
    await runTx("Mint test bot", async () => DB.bots(true).mint(ethers.ZeroAddress, { value: price }), () => "Your test bot is in My bots.");
  }

  // ================================================================== cart / sweep
  function toggleCart(id) { S.cart.has(id) ? S.cart.delete(id) : S.cart.add(id); renderCart(); renderGrid(); }
  function renderCart() {
    const n = S.cart.size; const bd = $("#cartBadge");
    bd.textContent = String(n); bd.classList.toggle("hidden", !n);
    $("#cartN").textContent = n ? `(${n})` : "";
    const ids = [...S.cart];
    const live = ids.filter(id => S.listings.has(id) && !isMe(S.listings.get(id).seller));
    const total = live.reduce((s, id) => s + S.listings.get(id).price, 0n);
    $("#cartBody").innerHTML = n ? ids.map(id => { const l = S.listings.get(id), b = S.bots.get(id); const gone = !l || isMe(l.seller);
      return `<div class="cart-item ${gone ? "gone" : ""}" data-test="cart-item">${imgTag(id)}<div class="grow"><div class="nm">${esc(nameOf(b))}</div><div class="dim" style="font-size:12px">#${id} · ${esc(b.traits.Tier)}</div>${gone ? `<div style="font-size:12px;color:var(--red-text)">${l ? "Your own listing, will be skipped" : "No longer listed, will be skipped"}</div>` : ""}</div><div class="mono" style="text-align:right;font-weight:650">${l ? DB.fmt(l.price) : "—"}</div><button class="btn xs ghost" data-rm="${id}" aria-label="Remove">✕</button></div>`; }).join("")
      : `<div class="empty" style="margin-top:20px"><h3>Your cart is empty</h3>Add listed bots, or use the Sweep slider to pick the cheapest ones.</div>`;
    $("#cartFoot").innerHTML = n ? `<div class="breakdown"><div><span>${live.length} bot${live.length === 1 ? "" : "s"} to buy</span><span>${DB.fmt(total)} ${esc(sym())}</span></div><div><span class="dim">Market fee ${feePct()} (taken from sellers, nothing extra for you)</span><span class="dim">${DB.fmt(feeOf(total))}</span></div><div class="tot"><span>You pay</span><span>${DB.fmt(total)} ${esc(sym())} <span class="dim" style="font-weight:500">${esc(usd(total))}</span></span></div></div>
      <div class="feeline">One transaction. Anything sold before it lands is skipped and its BNB comes back in the same transaction.</div><button class="btn primary block" style="margin-top:12px" id="sweepGo" ${live.length && !S.paused ? "" : "disabled"}>${S.paused ? "Trading paused" : `Buy ${live.length} item${live.length === 1 ? "" : "s"}`}</button>` : "";
    watchImgs($("#cartBody"));
    $$("[data-rm]", $("#cartBody")).forEach(b => b.onclick = () => toggleCart(Number(b.dataset.rm)));
    if ($("#sweepGo")) $("#sweepGo").onclick = sweep;
  }
  async function sweep() {
    if (!DB.account) { await connect(); if (!DB.account) return; }
    await loadCore().catch(() => {});
    const ids = [...S.cart].slice(0, 50);
    const live = ids.filter(id => S.listings.has(id) && !isMe(S.listings.get(id).seller));
    if (!live.length) { renderCart(); return toast("err", "Nothing left to buy", "Every bot in the cart was sold or is yours.", 7000); }
    // send all cart ids; the contract skips what is gone. Max price per id = the price we show (never pay more).
    const maxes = ids.map(id => S.listings.has(id) ? S.listings.get(id).price : 0n);
    const value = live.reduce((s, id) => s + S.listings.get(id).price, 0n);
    const iface = new ethers.Interface(DB.abi.DotBotsMarketV2);
    const r = await runTx(`Buy ${live.length} item${live.length === 1 ? "" : "s"}`, async () => DB.market(true).buyMany(ids, maxes, { value }), (rc) => {
      let bought = 0, skipped = 0;
      for (const lg of rc.logs) { try { const p = iface.parseLog(lg); if (p && p.name === "Sold") bought++; if (p && p.name === "SweepSkipped") skipped++; } catch (_) {} }
      return `Bought ${bought}${skipped ? `, skipped ${skipped} (no longer listed or price changed); unspent BNB returned` : ""}.`;
    });
    if (r) { S.cart.clear(); renderCart(); renderGrid(); }
  }

  // ================================================================== wiring
  async function connect() {
    try { await DB.connect(); }
    catch (e) { toast("err", DB.hasWallet() ? "Not connected" : "No wallet found", esc(DB.explain(e)), 9000); }
    renderAll();
  }
  function bindItemOpen(root) { $$("[data-open]", root).forEach(el => el.onclick = () => openDetail(Number(el.dataset.open))); }
  function bindCards(root) {
    root.addEventListener("click", ev => {
      const act = ev.target.closest("[data-act]");
      if (act) {
        ev.stopPropagation(); const id = Number(act.dataset.id);
        if (act.dataset.act === "buy") openBuy(id);
        else if (act.dataset.act === "cart") toggleCart(id);
        else if (act.dataset.act === "offer") openOffer(id);
        else if (act.dataset.act === "select") { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.selectMode = true; renderMine(); }
        return;
      }
      const c = ev.target.closest(".card[data-id]");
      if (c) { if (root.id === "mineBody" && S.selectMode && S.listings.has(Number(c.dataset.id))) { const id = Number(c.dataset.id); S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); renderMine(); } else openDetail(Number(c.dataset.id)); return; }
      const o = ev.target.closest("[data-open]"); if (o) openDetail(Number(o.dataset.open));
    });
    root.addEventListener("keydown", ev => { if (ev.key === "Enter") { const c = ev.target.closest(".card[data-id]"); if (c) openDetail(Number(c.dataset.id)); } });
  }
  function setView(v) {
    S.view = v;
    $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.t === v));
    $$("[data-view]").forEach(s => s.classList.toggle("hidden", s.dataset.view !== v));
    renderAll();
  }
  function routeFromHash() {
    const m = /^#bot\/(\d+)$/.exec(location.hash);
    if (m && S.loaded && S.bots.has(Number(m[1]))) openDetail(Number(m[1]), true);
  }

  async function main() {
    renderGrid();
    try { await DB.init(); } catch (e) { showNotice("err", "Could not load the page config: " + esc(e.message)); return; }
    const C = DB.cfg;
    $("#tnBanner").classList.toggle("hidden", !C.testnet);
    $("#pUnit").textContent = C.nativeSymbol;
    $("#footAddr").innerHTML = DB.addrUrl(C.addresses.market) ? `market <a href="${esc(DB.addrUrl(C.addresses.market))}" target="_blank" rel="noopener" class="mono">${esc(DB.short(C.addresses.market))}</a> · collection <a href="${esc(DB.addrUrl(C.addresses.collection))}" target="_blank" rel="noopener" class="mono">${esc(DB.short(C.addresses.collection))}</a>` : `market <span class="mono">${esc(DB.short(C.addresses.market))}</span>`;
    $("#heroLinks").innerHTML = `${DB.addrUrl(C.addresses.market) ? `<a class="chip" href="${esc(DB.addrUrl(C.addresses.market))}" target="_blank" rel="noopener">Market contract ${icon.ext}</a><a class="chip" href="${esc(DB.addrUrl(C.addresses.collection))}" target="_blank" rel="noopener">Collection contract ${icon.ext}</a>` : ""}<span class="chip">No token approvals</span><span class="chip">Fully on-chain art</span>`;
    DB.on(() => { S.sel.clear(); S.offerSel.clear(); refresh(); });
    $("#connect").onclick = () => DB.account ? setView("mine") : connect();
    $$(".tab").forEach(t => t.onclick = () => setView(t.dataset.t));
    $("#mclose").onclick = closeModal;
    $("#scrim").addEventListener("mousedown", e => { if (e.target.id === "scrim") closeModal(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); cartOpen(false); $("#sidebar").classList.remove("on"); } });
    const cartOpen = on => { $("#cart").classList.toggle("on", on); $("#cartScrim").classList.toggle("on", on); };
    $("#cartBtn").onclick = () => cartOpen(true);
    $("#cartClose").onclick = () => cartOpen(false);
    $("#cartScrim").onclick = () => cartOpen(false);
    $("#cartClear").onclick = () => { S.cart.clear(); renderCart(); renderGrid(); };
    $("#search").oninput = e => { S.search = e.target.value; if (S.view !== "items") setView("items"); renderGrid(); };
    $("#searchToggle").onclick = () => { $("#searchBox").classList.toggle("mobile-on"); $("#search").focus(); };
    $("#search").onblur = () => { if (!S.search) $("#searchBox").classList.remove("mobile-on"); };
    $("#sort").onchange = e => { S.sort = e.target.value; renderGrid(); };
    $$("#statusSeg button").forEach(b => b.onclick = () => { S.filters.status = b.dataset.s; $$("#statusSeg button").forEach(x => x.classList.toggle("on", x === b)); renderGrid(); renderFilterBadges(); });
    $("#pMin").oninput = e => { S.filters.min = e.target.value; renderGrid(); renderFilterBadges(); };
    $("#pMax").oninput = e => { S.filters.max = e.target.value; renderGrid(); renderFilterBadges(); };
    $("#toggleFilters").onclick = () => $("#itemsLayout").classList.toggle("nofilters");
    $("#openFilters").onclick = () => $("#sidebar").classList.add("on");
    $("#closeFilters").onclick = () => $("#sidebar").classList.remove("on");
    $$("#sizeSeg button").forEach(b => b.onclick = () => { $("#grid").className = "grid " + b.dataset.g; $$("#sizeSeg button").forEach(x => x.classList.toggle("on", x === b)); });
    $("#sweepRange").oninput = e => {
      const n = Number(e.target.value); $("#sweepN").textContent = String(n);
      const cheapest = [...S.listings.entries()].filter(([, l]) => !isMe(l.seller)).sort((a, b) => (a[1].price < b[1].price ? -1 : a[1].price > b[1].price ? 1 : a[0] - b[0])).slice(0, n).map(([id]) => id);
      S.cart = new Set(cheapest); renderCart(); renderGrid(); $("#sweepRange").value = String(n); $("#sweepN").textContent = String(n);
    };
    $("#makeCollBtn").onclick = openCollOffer;
    $("#home").onclick = e => { e.preventDefault(); setView("items"); window.scrollTo({ top: 0, behavior: "smooth" }); };
    bindCards($("#grid")); bindCards($("#mineBody"));
    bindItemOpen($("#actTable")); $("#actTable").addEventListener("click", e => { const o = e.target.closest("[data-open]"); if (o) openDetail(Number(o.dataset.open)); });
    $$("#actChips button").forEach(b => b.onclick = () => { S.actFilter = b.dataset.a; $$("#actChips button").forEach(x => x.classList.toggle("on", x === b)); renderActivity(); });
    window.addEventListener("hashchange", routeFromHash);
    const sb = $("#statsbar");
    const obs = () => sb.classList.toggle("stuck", sb.getBoundingClientRect().top <= parseInt(getComputedStyle(document.documentElement).getPropertyValue("--top-h")) + 1);
    window.addEventListener("scroll", obs, { passive: true });
    renderWallet();
    await refresh();
    setInterval(() => { if (!document.hidden && !$("#scrim").classList.contains("on")) refresh(); }, Number(C.pollSeconds || 30) * 1000);
  }
  main();
})();
