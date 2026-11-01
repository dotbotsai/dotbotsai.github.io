/* dotBots testnet - shared wallet / chain helpers for market.html and battle.html.
 * Needs vendor/ethers.umd.min.js (window.ethers) loaded first.
 * Config: config.json next to the page (override with ?config=other.json). Swap addresses there, not in code.
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
    97: {
      chainName: "BNB Smart Chain Testnet",
      nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://bsc-testnet-rpc.publicnode.com", "https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
      blockExplorerUrls: ["https://testnet.bscscan.com"],
    },
  };

  const DB = {
    ethers, TRAIT_NAMES, cfg: null, abi: null, read: null, browser: null, signer: null, account: null, walletChainId: null,
    listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit(kind) { for (const fn of this.listeners) { try { fn(kind); } catch (e) { console.warn(e); } } },

    async init() {
      const q = new URLSearchParams(location.search);
      const cfgFile = q.get("config") || "config.json";
      if (!/^[\w.-]+\.json$/.test(cfgFile)) throw new Error("bad config file name");
      const [cfg, abi] = await Promise.all([fetch(cfgFile, { cache: "no-store" }).then(r => r.json()), fetch("abi.json").then(r => r.json())]);
      this.cfg = cfg; this.abi = abi;
      this.deployed = !!(cfg.addresses && ethers.isAddress(cfg.addresses.collection || "") && ethers.isAddress(cfg.addresses.market || ""));
      this.read = new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId, { staticNetwork: true, cacheTimeout: -1 });
      if (window.ethereum && window.ethereum.on) {
        window.ethereum.on("accountsChanged", (a) => { this.account = a && a[0] ? ethers.getAddress(a[0]) : null; this.signer = null; this.emit("account"); });
        window.ethereum.on("chainChanged", (c) => { this.walletChainId = Number(c); this.signer = null; this.emit("chain"); });
      }
      return cfg;
    },

    contract(name, write) {
      const addr = name === "DotBotsMarket" ? this.cfg.addresses.market : name === "DotBots" ? this.cfg.addresses.collection : name === "MockRegistry" ? this.cfg.addresses.registry : this.cfg.addresses.feed;
      return new ethers.Contract(addr, this.abi[name], write ? this.signer : this.read);
    },
    bots(w) { return this.contract("DotBots", w); },
    market(w) { return this.contract("DotBotsMarket", w); },
    registry(w) { return this.contract("MockRegistry", w); },

    hasWallet() { return !!window.ethereum; },
    onRightChain() { return this.walletChainId === Number(this.cfg.chainId); },

    async connect() {
      if (!window.ethereum) throw Object.assign(new Error("No wallet found. Install a browser wallet (e.g. MetaMask) to continue."), { code: "NO_WALLET" });
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      this.account = accs && accs[0] ? ethers.getAddress(accs[0]) : null;
      this.walletChainId = Number(await window.ethereum.request({ method: "eth_chainId" }));
      if (!this.onRightChain()) await this.switchChain();
      this.emit("account");
      return this.account;
    },

    /* switch the wallet to the configured chain; add it first if the wallet does not know it (4902) */
    async switchChain() {
      const hex = "0x" + Number(this.cfg.chainId).toString(16);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (e) {
        const code = e && (e.code ?? (e.data && e.data.originalError && e.data.originalError.code));
        if (code === 4902 || /Unrecognized chain|not been added/i.test(String(e && e.message))) {
          const known = KNOWN_CHAINS[this.cfg.chainId] || {};
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
            chainId: hex,
            chainName: known.chainName || this.cfg.network,
            nativeCurrency: known.nativeCurrency || { name: this.cfg.nativeSymbol, symbol: this.cfg.nativeSymbol, decimals: 18 },
            rpcUrls: [this.cfg.rpc],
            blockExplorerUrls: this.cfg.explorer ? [this.cfg.explorer] : (known.blockExplorerUrls || []),
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
      if (!this.signer) { this.browser = new ethers.BrowserProvider(window.ethereum, "any"); this.signer = await this.browser.getSigner(this.account); }
      return this.signer;
    },

    /* human message for any wallet / contract error */
    explain(e) {
      const code = e && (e.code ?? (e.info && e.info.error && e.info.error.code));
      if (code === 4001 || code === "ACTION_REJECTED" || /user rejected|user denied/i.test(String(e && e.message))) return "You rejected the request in your wallet. Nothing was sent.";
      if (code === "NO_WALLET") return e.message;
      if (code === "WRONG_CHAIN") return "Please switch your wallet to " + this.cfg.network + ".";
      if (code === "INSUFFICIENT_FUNDS" || /insufficient funds/i.test(String(e && e.message))) return "Not enough " + this.cfg.nativeSymbol + " for this transaction (price + gas).";
      const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
      let name = e && e.revert && e.revert.name;
      if (!name && data && typeof data === "string") {
        for (const c of ["DotBotsMarket", "DotBots", "MockRegistry"]) { try { const p = new ethers.Interface(this.abi[c]).parseError(data); if (p) { name = p.name; break; } } catch (_) {} }
      }
      const MAP = {
        NotListed: "This bot is not listed any more (it was sold or cancelled).",
        OwnListing: "This is your own listing. You can cancel it instead.",
        WrongPayment: "The price changed. Refresh and try again.",
        NotSeller: "Only the seller can do that.",
        BadPrice: "Enter a price above 0.",
        EnforcedPause: "The market is paused: buying and listing are off. You can still cancel your listings.",
        WrongCollection: "This market only accepts dotBots from the configured collection.",
        NothingToWithdraw: "Nothing to withdraw.",
        NoAgentId: "Set a test handle first.",
        HandleAlreadyUsed: "This test handle already minted a bot. Set another handle.",
        MintClosed: "Test mint is closed.",
        Underpaid: "Mint price changed. Try again.",
        OnlyWallets: "Mint must come from a normal wallet, not a contract.",
        NothingToClaim: "Nothing to claim yet.",
      };
      if (name && MAP[name]) return MAP[name];
      if (name) return "Transaction reverted: " + name;
      return (e && (e.shortMessage || e.message)) || String(e);
    },

    short(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; },
    fmt(wei, dp) { const s = ethers.formatEther(wei); const [i, f = ""] = s.split("."); const t = f.slice(0, dp == null ? 6 : dp).replace(/0+$/, ""); return t ? i + "." + t : i; },
    txUrl(h) { return this.cfg.explorer ? this.cfg.explorer.replace(/\/$/, "") + "/tx/" + h : null; },
    addrUrl(a) { return this.cfg.explorer ? this.cfg.explorer.replace(/\/$/, "") + "/address/" + a : null; },

    /* decode on-chain tokenURI (data:application/json;base64) -> {name, image, attributes, traits} */
    decodeUri(uri) {
      const b64 = uri.split(",", 2)[1];
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const j = JSON.parse(new TextDecoder().decode(bytes));
      j.traits = {}; (j.attributes || []).forEach(a => { j.traits[a.trait_type] = a.value; });
      return j;
    },

    /* traitsOf(id) struct -> names used by the battle engine */
    traitsFromStruct(t) {
      const N = TRAIT_NAMES;
      return { Tier: N.Tier[Number(t.tier ?? t[0])], Head: N.Head[Number(t.head ?? t[3])], Eyes: N.Eyes[Number(t.eyes ?? t[4])], Antenna: N.Antenna[Number(t.antenna ?? t[5])], Mouth: N.Mouth[Number(t.mouth ?? t[6])], Accessory: N.Accessory[Number(t.accessory ?? t[7])] };
    },

    async botCard(id) {
      const [uri, tr] = await Promise.all([this.bots().tokenURI(id), this.bots().traitsOf(id)]);
      const meta = this.decodeUri(uri);
      return { id: Number(id), name: meta.name, image: meta.image, traits: this.traitsFromStruct(tr), meta };
    },

    /* ids currently owned by `who`. V3.2 is not enumerable, so on testnet we scan ownerOf(1..maxId) in batches
       (ids are sequential: public + team + fusions). Fine for a testnet; mainnet would use an indexer. */
    async idsOwnedBy(who) {
      const b = this.bots();
      const [pub, team, fus] = await Promise.all([b.publicMinted(), b.teamMinted(), b.fusions()]);
      const maxId = Number(pub) + Number(team) + Number(fus);
      const out = [];
      const ids = Array.from({ length: maxId }, (_, i) => i + 1);
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const owners = await Promise.all(chunk.map(id => b.ownerOf(id).then(o => o, () => null)));
        chunk.forEach((id, k) => { if (owners[k] && owners[k].toLowerCase() === who.toLowerCase()) out.push(id); });
      }
      return out;
    },
  };
  window.DB = DB;
})();
