/* dotBots Market v2 - wallet + chain helpers. Needs vendor/ethers.umd.min.js (window.ethers) first.
 * Config: config.json next to the page (?config=other.json for alternates). Addresses live there, not in code.
 * Everything is read straight from the chain through the public RPC in config; there is no server.
 */
(function () {
  const { ethers } = window;
  const TRAIT_NAMES = {
    Tier: ["Common", "Uncommon", "Rare", "Epic", "Legendary"],
    Head: ["Box", "Dome", "Tall"],
    Eyes: ["Dots", "Visor", "Big", "Laser", "Sleepy", "Heart"],
    Antenna: ["None", "Single", "Double", "Dish"],
    Mouth: ["Grill", "Smile", "Flat", "Open"],
    Accessory: ["None", "Headphones", "Bow Tie", "Monocle", "Cap"],
  };
  const KNOWN_CHAINS = {
    97: { chainName: "BNB Smart Chain Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://bsc-testnet-rpc.publicnode.com", "https://data-seed-prebsc-1-s1.bnbchain.org:8545"], blockExplorerUrls: ["https://testnet.bscscan.com"] },
    56: { chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.bnbchain.org"], blockExplorerUrls: ["https://bscscan.com"] },
  };
  /* RPC_RETRY_BEGIN: public BSC nodes rate-limit bursts (code -32005, HTTP 429/403, dropped batch items).
     Retry only the failed items, rotating through the configured URLs, so one busy node never blanks the page. */
  const LIMIT_RE = /rate limit|limit exceeded|too many|triggered rate|capacity|busy|header not found|missing trie node|timeout|timed out|unavailable|internal error/i;
  class RetryProvider extends ethers.JsonRpcProvider {
    constructor(urls, chainId, opts) { super(urls[0], chainId, opts); this.urls = urls; this.turn = 0; }
    async _send(payload) {
      const list = Array.isArray(payload) ? payload : [payload];
      const done = new Map(); let todo = list; let last = null;
      for (let t = 0; t < 7 && todo.length; t++) {
        if (t) await new Promise(r => setTimeout(r, Math.min(4000, 350 * 2 ** (t - 1)) + Math.random() * 250));
        const url = this.urls[(this.turn + t) % this.urls.length];
        try {
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(todo.length === 1 ? todo[0] : todo) });
          if (!res.ok) { last = new Error("HTTP " + res.status); continue; }
          let body = await res.json(); if (!Array.isArray(body)) body = [body];
          const byId = new Map(body.filter(r => r && r.id != null).map(r => [r.id, r]));
          const lone = todo.length === 1 && body.length === 1 && body[0] && body[0].id == null ? body[0] : null;
          const next = [];
          for (const p of todo) {
            const r = byId.get(p.id) || lone;
            const lim = !r || (r.error && (r.error.code === -32005 || r.error.code === -32029 || LIMIT_RE.test(String(r.error.message || ""))));
            if (lim) { next.push(p); last = r && r.error ? r.error : last; } else done.set(p.id, r);
          }
          todo = next;
        } catch (e) { last = e; }
      }
      this.turn = (this.turn + 1) % this.urls.length;
      return list.map(p => done.get(p.id)).filter(Boolean); // anything still missing surfaces as an error to its own caller only
    }
  }
  /* RPC_RETRY_END */
  const coder = ethers.AbiCoder.defaultAbiCoder();

  const DB = {
    ethers, TRAIT_NAMES, cfg: null, abi: null, read: null, signer: null, account: null, walletChainId: null, listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit(kind) { for (const fn of this.listeners) { try { fn(kind); } catch (e) { console.warn(e); } } },

    async init() {
      const q = new URLSearchParams(location.search);
      const cfgFile = q.get("config") || "config.json";
      if (!/^[\w.-]+\.json$/.test(cfgFile)) throw new Error("bad config file name");
      const [cfg, abi] = await Promise.all([fetch(cfgFile, { cache: "no-store" }).then(r => r.json()), fetch("abi.json").then(r => r.json())]);
      this.cfg = cfg; this.abi = abi;
      const rpcs = cfg.rpcs && cfg.rpcs.length ? cfg.rpcs : [cfg.rpc];
      this.read = new RetryProvider(rpcs, cfg.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: Number(cfg.batchMax || 10) });
      this.logs = new RetryProvider(cfg.logRpcs && cfg.logRpcs.length ? cfg.logRpcs : rpcs, cfg.chainId, { staticNetwork: true, batchMaxCount: 1 });
      if (window.ethereum && window.ethereum.on) {
        window.ethereum.on("accountsChanged", (a) => { this.account = a && a[0] ? ethers.getAddress(a[0]) : null; this.signer = null; this.emit("account"); });
        window.ethereum.on("chainChanged", (c) => { this.walletChainId = Number(c); this.signer = null; this.emit("chain"); });
        // silent reconnect if the site was already allowed
        try {
          const accs = await window.ethereum.request({ method: "eth_accounts" });
          if (accs && accs[0] && localStorage.getItem("dbm2.connected") === "1") {
            this.account = ethers.getAddress(accs[0]);
            this.walletChainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
          }
        } catch (_) {}
      }
      return cfg;
    },

    contract(name, write) {
      const A = this.cfg.addresses;
      const addr = { DotBotsMarketV2: A.market, DotBots: A.collection, MockRegistry: A.registry, MockFeed: A.feed }[name];
      return new ethers.Contract(addr, this.abi[name], write ? this.signer : this.read);
    },
    bots(w) { return this.contract("DotBots", w); },
    market(w) { return this.contract("DotBotsMarketV2", w); },
    registry(w) { return this.contract("MockRegistry", w); },

    hasWallet() { return !!window.ethereum; },
    onRightChain() { return this.walletChainId === Number(this.cfg.chainId); },

    async connect() {
      if (!window.ethereum) throw Object.assign(new Error("No wallet found. Install a browser wallet (for example MetaMask) to continue."), { code: "NO_WALLET" });
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      this.account = accs && accs[0] ? ethers.getAddress(accs[0]) : null;
      this.walletChainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
      localStorage.setItem("dbm2.connected", "1");
      this.emit("account");
      if (!this.onRightChain()) await this.switchChain();
      return this.account;
    },
    disconnect() { this.account = null; this.signer = null; localStorage.removeItem("dbm2.connected"); this.emit("account"); },

    async switchChain() {
      const hex = "0x" + Number(this.cfg.chainId).toString(16);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        const code = e && (e.code ?? (e.data && e.data.originalError && e.data.originalError.code));
        if (code === 4902 || /Unrecognized chain|not been added/i.test(String(e && e.message))) {
          const known = KNOWN_CHAINS[this.cfg.chainId] || {};
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
            chainId: hex, chainName: known.chainName || this.cfg.network,
            nativeCurrency: known.nativeCurrency || { name: this.cfg.nativeSymbol, symbol: this.cfg.nativeSymbol, decimals: 18 },
            rpcUrls: [this.cfg.rpc], blockExplorerUrls: this.cfg.explorer ? [this.cfg.explorer] : (known.blockExplorerUrls || []),
          }] });
        } else throw e;
      }
      this.walletChainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
      this.signer = null;
      this.emit("chain");
    },

    async getSigner() {
      if (!this.account) await this.connect();
      if (!this.onRightChain()) await this.switchChain();
      if (!this.onRightChain()) throw Object.assign(new Error("Wrong network in your wallet."), { code: "WRONG_CHAIN" });
      if (!this.signer) { const bp = new ethers.BrowserProvider(window.ethereum, "any"); this.signer = await bp.getSigner(this.account); }
      return this.signer;
    },

    explain(e) {
      const code = e && (e.code ?? (e.info && e.info.error && e.info.error.code));
      if (code === 4001 || code === "ACTION_REJECTED" || /user rejected|user denied/i.test(String(e && e.message))) return "You rejected the request in your wallet. Nothing was sent.";
      if (code === "NO_WALLET") return e.message;
      if (code === "WRONG_CHAIN") return "Please switch your wallet to " + this.cfg.network + ".";
      if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(String(e && e.message))) return "Not enough " + this.cfg.nativeSymbol + " for this transaction (amount + gas).";
      const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
      let name = e && e.revert && e.revert.name;
      if (!name && data && typeof data === "string") {
        for (const c of ["DotBotsMarketV2", "DotBots", "MockRegistry"]) { try { const p = new ethers.Interface(this.abi[c]).parseError(data); if (p) { name = p.name; break; } } catch (_) {} }
      }
      const MAP = {
        NotListed: "This bot is not listed any more (it was sold or the listing was cancelled).",
        OwnListing: "This is your own listing. You can cancel it instead.",
        WrongPayment: "The price changed. Refresh and try again.",
        NotSeller: "Only the seller can do that.",
        BadPrice: "Enter a valid price (offers start at 0.0001).",
        BadExpiry: "Pick a valid expiry (up to 180 days).",
        BadQuantity: "Quantity must be 1 to 100.",
        EnforcedPause: "The market is paused: trading is off. You can still cancel listings and offers and withdraw.",
        WrongCollection: "This market only accepts dotBots.",
        NothingToWithdraw: "Nothing to withdraw.",
        OfferNotActive: "This offer is no longer active.",
        OfferExpired: "This offer has expired.",
        NotOfferer: "Only the person who made this offer can cancel it.",
        NotExpired: "This offer has not expired yet.",
        OwnOffer: "You cannot make or accept an offer on your own bot.",
        PriceBelowMin: "The offer is lower than expected. Refresh and try again.",
        WrongToken: "That offer is for a different bot.",
        TooMany: "Too many items in one transaction (max 50).",
        NoAgentId: "Set a test handle first.",
        HandleAlreadyUsed: "This test handle already has a bot. Pick another handle.",
        MintClosed: "Test mint is closed.",
        Underpaid: "Mint price changed. Try again.",
        NothingToClaim: "Nothing to claim yet.",
        ERC721InsufficientApproval: "Your wallet no longer holds this bot.",
        ERC721IncorrectOwner: "Your wallet no longer holds this bot.",
      };
      if (name && MAP[name]) return MAP[name];
      if (name) return "Transaction reverted: " + name;
      return (e && (e.shortMessage || e.message)) || String(e);
    },

    short(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; },
    same(a, b) { return !!a && !!b && a.toLowerCase() === b.toLowerCase(); },
    /* compact BNB amount: up to 4 significant decimals, never scientific */
    fmt(wei, maxDp) {
      if (wei == null) return "—";
      const s = ethers.formatEther(wei); let [i, f = ""] = s.split(".");
      let dp = maxDp == null ? 6 : maxDp;
      if (i === "0") { const lead = (f.match(/^0*/) || [""])[0].length; dp = Math.max(dp, Math.min(lead + 2, 8)); }
      const t = f.slice(0, dp).replace(/0+$/, "");
      const ig = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      return t ? ig + "." + t : ig;
    },
    usd(wei, bnbUsd) {
      if (wei == null || !bnbUsd) return "";
      const v = Number(ethers.formatEther(wei)) * bnbUsd;
      if (v === 0) return "$0";
      if (v < 0.01) return "<$0.01";
      return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
    },
    txUrl(h) { return this.cfg.explorer ? this.cfg.explorer.replace(/\/$/, "") + "/tx/" + h : null; },
    addrUrl(a) { return this.cfg.explorer ? this.cfg.explorer.replace(/\/$/, "") + "/address/" + a : null; },
    encList(price) { return coder.encode(["uint256"], [price]); },
    encOp(op, a, b) { return coder.encode(["uint8", "uint256", "uint256"], [op, a, b]); },

    decodeUri(uri) {
      const b64 = uri.split(",", 2)[1];
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const j = JSON.parse(new TextDecoder().decode(bytes));
      j.traits = {}; (j.attributes || []).forEach(a => { j.traits[a.trait_type] = a.value; });
      return j;
    },
    traitsFromStruct(t) {
      const N = TRAIT_NAMES;
      return { Tier: N.Tier[Number(t.tier ?? t[0])], Head: N.Head[Number(t.head ?? t[3])], Eyes: N.Eyes[Number(t.eyes ?? t[4])],
        Antenna: N.Antenna[Number(t.antenna ?? t[5])], Mouth: N.Mouth[Number(t.mouth ?? t[6])], Accessory: N.Accessory[Number(t.accessory ?? t[7])] };
    },

    /* run async fns with limited concurrency */
    async pool(items, n, fn) {
      const out = new Array(items.length); let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
      return out;
    },

    /* market logs from deployBlock to latest, in chunks */
    async marketLogs(fromBlock, toBlock) {
      const step = Number(this.cfg.logChunk || 5000);
      const ranges = []; for (let b = fromBlock; b <= toBlock; b += step) ranges.push([b, Math.min(b + step - 1, toBlock)]);
      const iface = new ethers.Interface(this.abi.DotBotsMarketV2);
      const chunks = await this.pool(ranges, 3, async ([a, b]) => {
        for (let t = 0; t < 3; t++) {
          try { return await this.logs.getLogs({ address: this.cfg.addresses.market, fromBlock: a, toBlock: b }); }
          catch (e) { await new Promise(r => setTimeout(r, 600 * (t + 1))); if (t === 2) throw e; }
        }
      });
      const out = [];
      for (const l of chunks.flat()) { try { const p = iface.parseLog(l); if (p) out.push({ name: p.name, args: p.args, block: l.blockNumber, tx: l.transactionHash, idx: l.index }); } catch (_) {} }
      return out.sort((x, y) => x.block - y.block || x.idx - y.idx);
    },
  };
  window.DB = DB;
})();
