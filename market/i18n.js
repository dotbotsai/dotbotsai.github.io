/* dotBots Market: English / 中文. Follows the browser language until the visitor picks one, then remembers it.
   Translates the rendered page in place, so the market logic stays untouched. */
(function () {
  var KEY = "dotbots-lang", root = document.documentElement;
  var TIER = { Common: "普通", Uncommon: "优秀", Rare: "稀有", Epic: "史诗", Legendary: "传说" };
  var tier = function (t) { return TIER[t] || t; };
  var dur = function (n, u) { return n + " " + ({ m: "分钟", h: "小时", d: "天" })[u]; };

  /* whole text, exact */
  var D = {
    "Market": "市场", "Testnet": "测试网", "Market v2": "市场 v2", "Cart": "购物车", "Connect wallet": "连接钱包",
    "Search": "搜索", "Search bots": "搜索机器人", "Search by handle or bot #": "按名号或机器人编号搜索",
    "Reading chain…": "正在读取链上数据…", "Switch to light mode": "切换到浅色模式", "Switch to dark mode": "切换到深色模式",
    "no real value": "无真实价值",
    "Floor price": "地板价", "Top offer": "最高出价", "Total volume": "总成交额", "Sales": "成交", "Listed": "已挂单",
    "Owners": "持有人", "Bots": "机器人", "Market fee": "市场手续费",
    "Items": "藏品", "Collection offers": "系列出价", "Activity": "动态", "Analytics": "数据分析", "My bots": "我的机器人", "My offers": "我的出价",
    "Filters": "筛选", "Done": "完成", "Status": "状态", "All": "全部", "Buy now": "立即购买", "Has offers": "有出价",
    "Price": "价格", "Min": "最低", "Max": "最高", "to": "至", "Show or hide filters": "显示或隐藏筛选",
    "Select the N cheapest listed bots": "选中最便宜的 N 个挂单机器人", "Sweep": "扫货", "Sort": "排序",
    "Price: low to high": "价格：从低到高", "Price: high to low": "价格：从高到低", "Recently listed": "最新挂单",
    "Rarity: rarest first": "稀有度：最稀有优先", "Bot #: low to high": "编号：从小到大", "Bot #: high to low": "编号：从大到小",
    "Compact grid": "紧凑网格", "Large grid": "大网格",
    "Offers for any dotBot. BNB is held by the market contract until filled, cancelled or expired.": "对任意 dotBot 的出价。BNB 由市场合约托管，直到成交、取消或过期。",
    "Make collection offer": "发起系列出价", "Listings": "挂单", "Offers": "出价", "Cancels": "取消",
    "Floor price and sales": "地板价与成交", "Floor price (from listings)": "地板价（来自挂单）", "Sale": "成交", "Summary": "概览",
    "Floor price and sales chart": "地板价与成交图表",
    "Close": "关闭", "Clear": "清空", "Close cart": "关闭购物车", "Dismiss": "关闭", "Remove": "移除",
    "View on BscScan": "在 BscScan 查看", "Confirm in your wallet…": "请在钱包中确认…", "Waiting for confirmation…": "等待确认…",
    "Transaction failed on chain.": "交易在链上失败。",
    "The market is paused.": "市场已暂停。",
    "Buying, listing and new offers are off for now. You can still cancel listings and offers and withdraw any held BNB.": "购买、挂单和新出价暂时关闭。你仍可取消挂单和出价，并提取托管中的 BNB。",
    "Your wallet is on another network. Switch to": "你的钱包在其他网络上。请切换到", "to trade.": "以进行交易。",
    "Switch network": "切换网络", "Network not switched": "未切换网络", "You have": "你有",
    "waiting in the market (a payment your wallet could not take at sale time).": "在市场中待提取（成交时你的钱包未能接收的款项）。",
    "Withdraw": "提取", "Wrong network": "网络错误",
    "Rarity tier": "稀有度等级", "Tier": "稀有度", "Head": "头部", "Eyes": "眼睛", "Antenna": "天线", "Mouth": "嘴巴", "Accessory": "配饰", "Type": "类型",
    "Not listed": "未挂单", "Remove from cart": "移出购物车", "Add to cart": "加入购物车", "Make offer": "出价",
    "In wallet": "在钱包中", "Yours": "你的",
    "No bot of this tier has been minted yet.": "这个等级还没有机器人被铸造。", "No bots match": "没有符合条件的机器人",
    "Try removing a filter or clearing the search.": "试试移除筛选条件或清空搜索。", "Clear all": "全部清除",
    "Price change": "改价", "Listing cancelled": "挂单已取消", "Sale · offer": "成交 · 出价", "Sale · collection offer": "成交 · 系列出价",
    "Offer": "出价", "Offer refunded": "出价已退款", "Offer cancelled": "出价已取消", "Collection offer closed": "系列出价已关闭",
    "Any dotBot": "任意 dotBot", "No activity yet.": "暂无动态。",
    "Event": "事件", "Item": "藏品", "From": "来自", "To": "接收方", "Time": "时间", "View transaction": "查看交易", "just now": "刚刚",
    "No collection offers yet. Be the first to make one.": "还没有系列出价。来发起第一个吧。",
    "Price each": "单价", "Quantity left": "剩余数量", "Total held": "托管总额", "Expires": "到期",
    "Refund": "退款", "Cancel": "取消", "Refund to offerer": "退款给出价人", "Accept with your bot": "用你的机器人接受",
    "Expired": "已过期", "expired": "已过期", "Refund expired collection offer": "退还过期的系列出价", "No market history yet.": "暂无市场记录。",
    "Sales (from events)": "成交数（来自事件）", "Volume (from events)": "成交额（来自事件）", "Average sale": "平均成交价",
    "Highest sale": "最高成交价", "Live single-bot offers": "有效的单个出价", "Live collection offers": "有效的系列出价",
    "BNB/USD used for $ values": "美元价值使用的 BNB/USD",
    "Connect your wallet": "连接你的钱包", "to see your bots.": "以查看你的机器人。", "to see your offers.": "以查看你的出价。",
    "Clear selection": "取消选择", "Select all listed": "全选已挂单", "Disconnect": "断开连接",
    "Offers on your bots": "你的机器人收到的出价", "Bot": "机器人", "Top collection offer:": "最高系列出价：",
    "Accept with one of your bots": "用你的一个机器人接受", "No bots in this wallet yet": "这个钱包还没有机器人",
    "Get a test bot below, or buy one from Items.": "在下方获取测试机器人，或从藏品中购买。", "Buy one from Items.": "从藏品中购买一个。",
    "Get a test bot": "获取测试机器人", "Testnet only. Sets a test handle on the mock Agent ID registry, then mints one bot at the test mint price": "仅限测试网。先在模拟 Agent ID 注册表中设置测试名号，再以测试铸造价",
    "(test BNB). One bot per handle.": "（测试 BNB）铸造一个机器人。每个名号一个机器人。", "test handle, e.g. robo42": "测试名号，例如 robo42",
    "Set handle + mint": "设置名号并铸造",
    "Bots are back in your wallet.": "机器人已回到你的钱包。", "Held by the market for your offers:": "市场为你的出价托管：",
    ". Cancel any time to get it back.": "。随时取消即可取回。", "Offers on single bots": "单个机器人出价", "Your offer": "你的出价",
    "Expired, ready to refund": "已过期，可退款", "Active": "有效",
    "No offers yet. Open any bot and choose “Make offer”.": "还没有出价。打开任意机器人，选择“出价”。",
    "Left": "剩余", "Held": "托管", "No collection offers. Make one from the Collection offers tab.": "没有系列出价。可在“系列出价”标签页发起。",
    "Cancel offer": "取消出价", "Cancel listing": "取消挂单", "Trading paused": "交易已暂停", "Change price": "修改价格",
    "List for sale": "挂单出售", "Your listing": "你的挂单", "Current price": "当前价格", "No offers yet": "暂无出价",
    "Accept": "接受", "No offers on this bot yet.": "这个机器人暂无出价。", "Collection offer (any bot)": "系列出价（任意机器人）",
    "Traits": "属性", "Market history": "市场记录", "Owned by": "持有人", "you": "你",
    "The bot is back in your wallet.": "机器人已回到你的钱包。", "Back": "返回", "This bot is not listed any more.": "这个机器人已不再挂单。",
    "Complete purchase": "完成购买", "You pay": "你支付",
    "Plus network gas. The bot moves to your wallet in the same transaction.": "另需网络 Gas。机器人会在同一笔交易中转入你的钱包。",
    "The bot is in your wallet.": "机器人已在你的钱包中。", "This bot has": "这个机器人有",
    "unclaimed holder share. It moves with the bot to the next owner.": "未领取的持有人分成。它会随机器人转给下一位持有人。",
    "Claim it first": "先领取", "Claim holder share": "领取持有人分成",
    "Only the price changes; the bot stays in escrow.": "只修改价格，机器人仍在托管中。",
    "Your bot moves into the market contract (escrow) in one transaction. No token approval is requested. You can cancel any time, also while the market is paused.": "你的机器人会在一笔交易中转入市场合约托管。无需代币授权。你可以随时取消，市场暂停时也可以。",
    "Update price": "更新价格", "List bot": "挂单", "Listing price": "挂单价格", "You receive": "你将收到",
    "Floor right now:": "当前地板价：", "use floor": "使用地板价",
    "1 hour": "1 小时", "1 day": "1 天", "3 days": "3 天", "7 days": "7 天", "30 days": "30 天",
    "Make an offer": "发起出价", "Expires after": "有效期",
    "Your BNB is held by the market contract until the owner accepts, you cancel, or it expires (then anyone can trigger the refund to you). Cancel any time, also while paused. Minimum offer 0.0001.": "你的 BNB 由市场合约托管，直到持有人接受、你取消或出价过期（过期后任何人都可以触发退款给你）。随时可以取消，暂停期间也可以。最低出价 0.0001。",
    "You send now (held in escrow)": "现在支付（托管）", "Owner receives if accepted": "接受后持有人收到",
    "Offer placed.": "出价成功。", "Offer not found": "未找到出价", "It may have been cancelled.": "可能已被取消。",
    "Accept offer": "接受出价", "Sold.": "已售出。", "Your BNB is back.": "你的 BNB 已退回。",
    "No bots in this wallet": "这个钱包里没有机器人", "You need a dotBot to accept a collection offer.": "你需要一个 dotBot 才能接受系列出价。",
    "Accept collection offer": "接受系列出价", "Bot to sell": "要出售的机器人", "Offer (each)": "出价（每个）",
    "Make a collection offer": "发起系列出价", "Price per bot": "每个机器人价格", "Quantity": "数量",
    "The total is held by the market contract. Cancel any time to get back whatever is not filled yet.": "总额由市场合约托管。随时取消即可取回未成交的部分。",
    "You send now (held)": "现在支付（托管）", "Collection offer": "系列出价", "Collection offer placed.": "系列出价已提交。",
    "Cancel collection offer": "取消系列出价", "Unfilled BNB is back.": "未成交的 BNB 已退回。", "Sent to your wallet.": "已发送到你的钱包。",
    "Enter a test handle": "请输入测试名号", "1 to 32 characters.": "1 到 32 个字符。", "Set test handle": "设置测试名号",
    "Mint test bot": "铸造测试机器人", "Your test bot is in My bots.": "你的测试机器人已在“我的机器人”中。",
    "Your own listing, will be skipped": "你自己的挂单，将被跳过", "No longer listed, will be skipped": "已不再挂单，将被跳过",
    "Your cart is empty": "购物车是空的", "Add listed bots, or use the Sweep slider to pick the cheapest ones.": "添加挂单中的机器人，或用扫货滑块选出最便宜的。",
    "One transaction. Anything sold before it lands is skipped and its BNB comes back in the same transaction.": "一笔交易完成。交易上链前已售出的机器人会被跳过，对应的 BNB 在同一笔交易中退回。",
    "Nothing left to buy": "没有可购买的了", "Every bot in the cart was sold or is yours.": "购物车中的机器人已售出或属于你。",
    "Not connected": "未连接", "No wallet found": "未找到钱包", "No token approvals": "无需代币授权", "Fully on-chain art": "完全链上艺术",
    "market": "市场", "collection": "系列", "Market contract": "市场合约", "· collection": "· 系列", "Held in market escrow while listed": "挂单期间由市场合约托管", "Named": "有名号", "Team": "团队", "Collection contract": "系列合约", "Floor": "地板价",
    "No wallet found. Install a browser wallet (for example MetaMask) to continue.": "未找到钱包。请安装浏览器钱包（例如 MetaMask）后继续。",
    "Wrong network in your wallet.": "你的钱包网络错误。",
    "You rejected the request in your wallet. Nothing was sent.": "你在钱包中拒绝了请求，未发送任何交易。",
    "This bot is not listed any more (it was sold or the listing was cancelled).": "这个机器人已不再挂单（已售出或挂单已取消）。",
    "This is your own listing. You can cancel it instead.": "这是你自己的挂单，你可以取消它。",
    "The price changed. Refresh and try again.": "价格已变动，请刷新后重试。", "Only the seller can do that.": "只有卖家可以这样做。",
    "Enter a valid price (offers start at 0.0001).": "请输入有效价格（出价最低 0.0001）。", "Pick a valid expiry (up to 180 days).": "请选择有效期限（最长 180 天）。",
    "Quantity must be 1 to 100.": "数量必须为 1 到 100。",
    "The market is paused: trading is off. You can still cancel listings and offers and withdraw.": "市场已暂停，交易关闭。你仍可取消挂单和出价并提取资金。",
    "This market only accepts dotBots.": "本市场只接受 dotBots。", "Nothing to withdraw.": "没有可提取的资金。",
    "This offer is no longer active.": "该出价已失效。", "This offer has expired.": "该出价已过期。",
    "Only the person who made this offer can cancel it.": "只有出价人可以取消该出价。", "This offer has not expired yet.": "该出价尚未过期。",
    "You cannot make or accept an offer on your own bot.": "你不能对自己的机器人出价或接受出价。",
    "The offer is lower than expected. Refresh and try again.": "出价低于预期，请刷新后重试。", "That offer is for a different bot.": "该出价针对的是另一个机器人。",
    "Too many items in one transaction (max 50).": "单笔交易的数量过多（最多 50 个）。", "Set a test handle first.": "请先设置测试名号。",
    "This test handle already has a bot. Pick another handle.": "这个测试名号已有机器人，请换一个。", "Test mint is closed.": "测试铸造已关闭。",
    "Mint price changed. Try again.": "铸造价格已变动，请重试。", "Nothing to claim yet.": "暂无可领取的。",
    "Your wallet no longer holds this bot.": "你的钱包已不再持有这个机器人。"
  };
  for (var k in TIER) D[k] = TIER[k];

  /* whole text, pattern */
  var P = [
    [/^(.+) · confirmed$/, function (m) { return (tr(m[1]) || m[1]) + " · 已确认"; }],
    [/^(.+) · not completed$/, function (m) { return (tr(m[1]) || m[1]) + " · 未完成"; }],
    [/^Market v(.+)$/, "市场 v$1"],
    [/^Read-only · (.+)$/, "只读 · $1"],
    [/^(\d+) listed, ([\d.]+)% of bots$/, "已挂单 $1 个，占机器人的 $2%"],
    [/^Rank (\d+) of (\d+)$/, "排名 $1 / $2"],
    [/^Rank (\d+)$/, "排名 $1"],
    [/^Team bot #(\d+)$/, "团队机器人 #$1"],
    [/^Best offer (.+)$/, "最高出价 $1"],
    [/^(\d+) bots?$/, "$1 个机器人"],
    [/^No (.+) bots yet$/, function (m) { return "还没有" + m[1].split(" / ").map(tier).join(" / ") + "机器人"; }],
    [/^Price (.+) – (.+)$/, "价格 $1 – $2"],
    [/^(.+) ✕$/, function (m) { return (tr(m[1]) || m[1]) + " ✕"; }],
    [/^(\w+): (\w[\w ]*)$/, function (m) { return D[m[1]] ? D[m[1]] + "：" + tier(m[2]) : null; }],
    [/^Collection offer ×(\d+)$/, "系列出价 ×$1"],
    [/^(\d+)m ago$/, function (m) { return dur(m[1], "m") + "前"; }],
    [/^(\d+)h ago$/, function (m) { return dur(m[1], "h") + "前"; }],
    [/^(\d+)d ago$/, function (m) { return dur(m[1], "d") + "前"; }],
    [/^in (\d+)([mhd])$/, function (m) { return dur(m[1], m[2]) + "后"; }],
    [/^([\d.]+%) of each sale, paid from the seller's side$/, "每笔成交的 $1，由卖方支付"],
    [/^(.+) \(testnet mock feed\)$/, "$1（测试网模拟喂价）"],
    [/^· (\d+) listed$/, "· 已挂单 $1 个"],
    [/^Cancel (\d+) listings?$/, "取消 $1 个挂单"],
    [/^Cancel (\d+) offers?$/, "取消 $1 个出价"],
    [/^#(\d+) · (\w+) · Rank (\d+)$/, function (m) { return "#" + m[1] + " · " + tier(m[2]) + " · 排名 " + m[3]; }],
    [/^#(\d+) · (\w+)$/, function (m) { return "#" + m[1] + " · " + tier(m[2]); }],
    [/^Market fee ([\d.]+%)$/, "市场手续费 $1"],
    [/^Market fee ([\d.]+%) \(taken from the seller, nothing extra for you\)$/, "市场手续费 $1（从卖方收取，你无需额外支付）"],
    [/^Market fee ([\d.]+%) \(taken from sellers, nothing extra for you\)$/, "市场手续费 $1（从卖方收取，你无需额外支付）"],
    [/^Market fee ([\d.]+%), from the seller's side if accepted$/, "市场手续费 $1，接受时从卖方收取"],
    [/^Seller receives per bot \(after ([\d.]+%)\)$/, "每个机器人卖方收到（扣除 $1 后）"],
    [/^Buy for (.+)$/, "以 $1 购买"],
    [/^Accept (.+)$/, function (m) { return /\d/.test(m[1]) ? "接受 " + m[1] : null; }],
    [/^New price (.+)\.$/, "新价格 $1。"],
    [/^Listed for (.+)\.$/, "挂单价 $1。"],
    [/^Buy (\d+) items?$/, "购买 $1 个"],
    [/^Buy (.+)$/, "购买 $1"],
    [/^List (.+)$/, "挂单 $1"],
    [/^Offer on (.+)$/, "对 $1 出价"],
    [/^(\d+) bots? to buy$/, "购买 $1 个机器人"],
    [/^Bought (\d+), skipped (\d+) \(no longer listed or price changed\); unspent BNB returned\.$/, "已购买 $1 个，跳过 $2 个（已不再挂单或价格变动）；未用的 BNB 已退回。"],
    [/^Bought (\d+)\.$/, "已购买 $1 个。"],
    [/^(\d+)% have this$/, "$1% 拥有此属性"],
    [/^Please switch your wallet to (.+)\.$/, "请把钱包切换到 $1。"],
    [/^Not enough (\S+) for this transaction \(amount \+ gas\)\.$/, "$1 不足以完成这笔交易（金额 + Gas）。"],
    [/^Transaction reverted: (.+)$/, "交易已回滚：$1"],
    [/^(\S+) · listed$/, "$1 · 已挂单"]
  ];

  /* phrases inside longer text (longest first) */
  var F = [
    ["One bot per .ai Agent ID, drawn fully on-chain on BNB Chain. This page reads listings, offers and sales straight from the market contract. Market fee", "每个 .ai Agent ID 一个机器人，图像完全在 BNB 链上生成。本页直接从市场合约读取挂单、出价和成交记录。市场手续费"],
    [", taken from the seller's side of each sale.", "，在每笔成交中从卖方收取。"],
    ["TESTNET · BNB Smart Chain Testnet (chain 97) · test bots and test BNB only,", "测试网 · BNB 智能链测试网（链 ID 97）· 仅限测试机器人和测试 BNB，"],
    ["An offer for any dotBot. Each holder can fill one unit by sending a bot.", "对任意 dotBot 的出价。每位持有人可以发送一个机器人成交一份。"],
    ["Nothing on this page is financial advice.", "本页内容不构成投资建议。"],
    ["Fee is shown before every action.", "每次操作前都会显示手续费。"],
    ["Testnet build.", "测试网版本。"],
    ["dotBots Market v2", "dotBots 市场 v2"],
    ["Could not read the chain right now (", "暂时无法读取链上数据（"],
    ["). Retrying in a moment…", "）。稍后重试…"],
    ["Your listing closes and the bot goes to the buyer.", "你的挂单将关闭，机器人转给买家。"],
    ["One transaction sends the bot from your wallet through the market to the buyer. No token approval is requested.", "一笔交易将机器人从你的钱包经由市场转给买家。无需代币授权。"],
    ["One transaction, no token approval.", "一笔交易，无需代币授权。"],
    ["Cancel any time to get back whatever is not filled yet.", "随时取消即可取回未成交的部分。"],
    ["The total is held by the market contract.", "总额由市场合约托管。"],
    ["comes out of what each seller receives.", "从每位卖方收到的金额中扣除。"],
    ["is paid by the seller out of this price. You pay the price + network gas.", "由卖方从该价格中支付。你只需支付价格 + 网络 Gas。"],
    ["applies to every sale, taken from the seller's side.", "适用于每笔成交，从卖方收取。"],
    ["each for any dotBot (", "每个，适用于任意 dotBot（剩余 "],
    [" left).", " 个）。"],
    [" left in this offer · expires ", " 个剩余 · 到期 "],
    ["Top collection offer", "最高系列出价"],
    ["Could not load the page config:", "无法加载页面配置："],
    ["Market fee", "市场手续费"],
    [": you receive", "：成交后你将收到"],
    [" when it sells.", "。"],
    [", expires ", "，到期 "],
    ["Floor ", "地板价 "],
    [" · collection", " · 系列"]
  ];

  function tr(s) {
    if (Object.prototype.hasOwnProperty.call(D, s)) return D[s];
    for (var i = 0; i < P.length; i++) {
      var m = s.match(P[i][0]);
      if (m) { var r = typeof P[i][1] === "function" ? P[i][1](m) : s.replace(P[i][0], P[i][1]); if (r != null) return r; }
    }
    var out = s, hit = false;
    for (var j = 0; j < F.length; j++) if (out.indexOf(F[j][0]) >= 0) { out = out.split(F[j][0]).join(F[j][1]); hit = true; }
    if (hit) out = out.replace(/\bin (\d+)([mhd])\b/g, function (_, n, u) { return dur(n, u) + "后"; }).replace(/\bexpired\b/g, "已过期");
    return hit ? out : null;
  }
  function trFull(full) {
    var m = full.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2] || !/[A-Za-z]/.test(m[2])) return null;
    var t = tr(m[2]);
    return t == null ? null : m[1] + t + m[3];
  }

  var lang = "en", txt = new WeakMap(), att = new WeakMap(), ATTRS = ["placeholder", "title", "aria-label"];
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1 };
  function skip(el) { return !el || SKIP[el.nodeName] || (el.closest && el.closest(".mono, [data-noi18n], svg")); }

  function doText(n) {
    var p = n.parentNode; if (skip(p)) return;
    var o = txt.get(n), en = o && n.data === o.zh ? o.en : n.data;
    if (lang === "zh") { var z = trFull(en); if (z != null && z !== n.data) { txt.set(n, { en: en, zh: z }); n.data = z; } }
    else if (o && n.data === o.zh) { n.data = o.en; txt.delete(n); }
  }
  function doAttrs(el) {
    if (el.nodeType !== 1 || (el.closest && el.closest("[data-noi18n]"))) return;
    var store = att.get(el) || {};
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a); if (v == null) continue;
      var o = store[a], en = o && v === o.zh ? o.en : v;
      if (lang === "zh") { var z = trFull(en); if (z != null && z !== v) { store[a] = { en: en, zh: z }; el.setAttribute(a, z); } }
      else if (o && v === o.zh) { el.setAttribute(a, o.en); delete store[a]; }
    }
    att.set(el, store);
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1 || SKIP[node.nodeName]) return;
    doAttrs(node);
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (w.nextNode()) { var c = w.currentNode; if (c.nodeType === 3) doText(c); else doAttrs(c); }
  }

  var TITLE_EN = null;
  function apply(l) {
    lang = l === "zh" ? "zh" : "en";
    root.lang = lang === "zh" ? "zh-CN" : "en";
    root.setAttribute("data-lang", lang);
    if (TITLE_EN == null) TITLE_EN = document.title;
    document.title = lang === "zh" ? TITLE_EN.replace("dotBots Market", "dotBots 市场").replace("Testnet", "测试网") : TITLE_EN;
    if (document.body) walk(document.body);
    var b = document.getElementById("langBtn");
    if (b) { b.textContent = lang === "zh" ? "EN" : "中"; b.setAttribute("aria-label", lang === "zh" ? "Switch to English" : "切换到中文"); b.title = b.getAttribute("aria-label"); }
  }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function guess() { var n = (navigator.languages && navigator.languages[0]) || navigator.language || ""; return /^zh/i.test(n) ? "zh" : "en"; }
  lang = saved() || guess();
  root.lang = lang === "zh" ? "zh-CN" : "en";

  document.addEventListener("DOMContentLoaded", function () {
    apply(lang);
    new MutationObserver(function (list) {
      if (lang !== "zh") return;
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === "childList") for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
        else if (r.type === "characterData") doText(r.target);
        else if (r.type === "attributes" && r.target.id !== "langBtn") doAttrs(r.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    var b = document.getElementById("langBtn");
    if (b) b.addEventListener("click", function () {
      var l = lang === "zh" ? "en" : "zh";
      try { localStorage.setItem(KEY, l); } catch (e) {}
      apply(l);
    });
  });
})();
