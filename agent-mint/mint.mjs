// dotBots Agent-mint kit (BNB Chain). Usage:
//   node mint.mjs <wallet>                 -> checks + simulate, prints the exact tx (no send)
//   PRIVATE_KEY=0x.. node mint.mjs --send  -> checks + simulate + send + read your bot
//   node mint.mjs --result <txHash>        -> read the bot minted in a tx
// Optional: RPC=<url> (default https://bsc-rpc.publicnode.com)
import {ethers} from 'ethers';
const DOTBOTS='0x4123F0f5ca048780C0c91aBC0c7ac12c77a0bF69';
const RPC=process.env.RPC||'https://bsc-rpc.publicnode.com';
const p=new ethers.JsonRpcProvider(RPC,undefined,{staticNetwork:false});
const ABI=['function mintOpen() view returns(bool)','function canMint(address) view returns(uint256)','function unitPrice() view returns(uint256)','function registry() view returns(address)','function tokenOfHandle(bytes32) view returns(uint256)','function publicMinted() view returns(uint256)','function PUBLIC_SUPPLY() view returns(uint256)','function mint(address) payable returns(uint256)','function tokenURI(uint256) view returns(string)','event Minted(address indexed to,uint256 indexed tokenId,string,uint256,address)'];
const c=new ethers.Contract(DOTBOTS,ABI,p);
const fmt=w=>ethers.formatEther(w)+' BNB';
const die=m=>{console.log('STOP: '+m);process.exit(1)};

async function readBot(id){
  const uri=await c.tokenURI(id);
  const j=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
  const tier=j.attributes.find(a=>a.trait_type==='Tier').value;
  return {tokenId:id.toString(),name:j.name,tier,bscscan:`https://bscscan.com/nft/${DOTBOTS}/${id}`};
}
async function result(hash){
  const r=await p.getTransactionReceipt(hash); if(!r) die('tx not found yet');
  if(r.status!==1) die('tx failed (status 0)');
  for(const l of r.logs){ if(l.address.toLowerCase()!==DOTBOTS.toLowerCase()) continue;
    try{const e=c.interface.parseLog(l); if(e?.name==='Minted') return readBot(e.args.tokenId);}catch{} }
  die('no Minted event in this tx');
}

const args=process.argv.slice(2);
if(args[0]==='--result'){ console.log(JSON.stringify(await result(args[1]),null,1)); process.exit(0); }
const send=args.includes('--send');
let signer=null, wallet=args.find(a=>a.startsWith('0x'));
if(send){ if(!process.env.PRIVATE_KEY) die('--send needs PRIVATE_KEY'); signer=new ethers.Wallet(process.env.PRIVATE_KEY,p); wallet=signer.address; }
if(!wallet||!ethers.isAddress(wallet)) die('give a wallet address');
wallet=ethers.getAddress(wallet);

const net=await p.getNetwork(); if(net.chainId!==56n && !process.env.RPC) die('not BNB Chain (56)');
// 1. mint open?
if(!(await c.mintOpen())) die('mint is not open yet');
if((await c.publicMinted())>=(await c.PUBLIC_SUPPLY())) die('sold out');
// 2. normal wallet (EOA)? contracts are rejected by dotBots (OnlyWallets)
const code=await p.getCode(wallet);
if(code!=='0x' && !code.startsWith('0xef0100')) die('this address is a smart contract wallet; use a normal wallet (EOA)');
// 3. .ai Agent ID present and unused?
const reg=new ethers.Contract(await c.registry(),['function handleOf(address) view returns(string)'],p);
const handle=await reg.handleOf(wallet);
if(!handle) die('this wallet has no .ai Agent ID');
if((await c.tokenOfHandle(ethers.keccak256(ethers.toUtf8Bytes(handle))))!==0n) die(`${handle}.ai already has a dotBot (one bot per Agent ID)`);
if((await c.canMint(wallet))!==1n) die('canMint = 0');
// 4. price: $10 in BNB (Chainlink) + 2% buffer, overpay refunded in the same tx
const price=await c.unitPrice(); const value=price*102n/100n;
const data=c.interface.encodeFunctionData('mint',[ethers.ZeroAddress]);
const bal0=await p.getBalance(wallet);
if(bal0<value) die(`not enough BNB: have ${fmt(bal0)}, need ${fmt(value)} + gas`);
// 5. simulate
try{ await p.call({from:wallet,to:DOTBOTS,data,value}); }catch(e){ die('simulation reverted: '+(e.shortMessage||e.message)); }
const gas=await p.estimateGas({from:wallet,to:DOTBOTS,data,value});
const fee=(await p.getFeeData()).gasPrice*gas*12n/10n;
const bal=await p.getBalance(wallet);
if(bal<value+fee) die(`not enough BNB: have ${fmt(bal)}, need about ${fmt(value+fee)}`);
const tx={chainId:56,to:DOTBOTS,data,value:value.toString(),gasLimit:(gas*13n/10n).toString()};
console.log(JSON.stringify({ok:true,wallet,agentId:handle+'.ai',price:fmt(price),send:fmt(value)+' (extra refunded)',gasEstimate:gas.toString(),tx},null,1));
if(!send){ console.log('READY: send this tx from the same wallet, then run: node mint.mjs --result <txHash>'); process.exit(0); }
// 6. send + read the bot
const s=await signer.sendTransaction({to:DOTBOTS,data,value,gasLimit:gas*13n/10n});
console.log('SENT '+s.hash); await s.wait();
console.log(JSON.stringify(await result(s.hash),null,1));
