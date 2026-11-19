// dotBots Agent-claim kit (BNB Chain). Read-only: it never signs or sends anything.
//   node claim.mjs <wallet>            -> finds the gift assigned to this wallet, checks it, simulates claimGift, prints the exact tx
//   node claim.mjs <wallet> <tokenId>  -> same, for one tokenId
//   node claim.mjs --result <txHash>   -> reads the bot claimed in a tx
// Optional: RPC=<url> (default https://bsc-rpc.publicnode.com)
// The owner sends the printed tx from their own wallet app and confirms it there. Never paste a private key anywhere.
import {ethers} from 'ethers';
const DOTBOTS='0x4123F0f5ca048780C0c91aBC0c7ac12c77a0bF69';
const RPC=process.env.RPC||'https://bsc-rpc.publicnode.com';
const p=new ethers.JsonRpcProvider(RPC);
const ABI=['function giftTo(uint256) view returns(address)','function isTeamBot(uint256) view returns(bool)','function ownerOf(uint256) view returns(address)','function owner() view returns(address)','function registry() view returns(address)','function tokenOfHandle(bytes32) view returns(uint256)','function claimGift(uint256)','function tokenURI(uint256) view returns(string)','event GivenAway(address indexed to,uint256 indexed tokenId,string handle)'];
const c=new ethers.Contract(DOTBOTS,ABI,p);
const die=m=>{console.log('STOP: '+m);process.exit(1)};
async function readBot(id){
  const j=JSON.parse(Buffer.from((await c.tokenURI(id)).split(',')[1],'base64').toString());
  return {tokenId:id.toString(),name:j.name,tier:j.attributes.find(a=>a.trait_type==='Tier').value,bscscan:`https://bscscan.com/nft/${DOTBOTS}/${id}`};
}
const args=process.argv.slice(2);
if(args.includes('--send')||process.env.PRIVATE_KEY) die('this kit never signs. Send the printed tx from your own wallet app.');
if(args[0]==='--result'){
  const r=await p.getTransactionReceipt(args[1]); if(!r) die('tx not found yet'); if(r.status!==1) die('tx failed (status 0)');
  for(const l of r.logs){ if(l.address.toLowerCase()!==DOTBOTS.toLowerCase()) continue;
    try{const e=c.interface.parseLog(l); if(e?.name==='GivenAway'){console.log(JSON.stringify(await readBot(e.args.tokenId),null,1));process.exit(0);}}catch{} }
  die('no claim in this tx');
}
let wallet=args[0]; if(!wallet||!ethers.isAddress(wallet)) die('give a wallet address');
wallet=ethers.getAddress(wallet);
const net=await p.getNetwork(); if(net.chainId!==56n && !process.env.RPC) die('not BNB Chain (56)');
// 1. which team bot is assigned to this wallet? (team bots are ids 1-100)
let ids=args[1]?[BigInt(args[1])]:[...Array(100)].map((_,i)=>BigInt(i+1));
const mine=[]; for(const id of ids){ if((await c.giftTo(id)).toLowerCase()===wallet.toLowerCase()) mine.push(id); }
if(!mine.length) die('no gift is assigned to this wallet right now (not assigned yet, already claimed, or cancelled)');
const id=mine[0];
// 2. still a team bot held by the dotBots owner?
const own=await c.owner();
if(!(await c.isTeamBot(id)) || (await c.ownerOf(id))!==own) die(`bot #${id} is no longer claimable`);
// 3. .ai Agent ID present and unused (fresh)?
const reg=new ethers.Contract(await c.registry(),['function handleOf(address) view returns(string)'],p);
const handle=await reg.handleOf(wallet);
if(!handle) die('this wallet has no .ai Agent ID');
if((await c.tokenOfHandle(ethers.keccak256(ethers.toUtf8Bytes(handle))))!==0n) die(`${handle}.ai already has a dotBot (one bot per Agent ID), so this gift can't be claimed`);
// 4. simulate + gas
const data=c.interface.encodeFunctionData('claimGift',[id]);
try{ await p.call({from:wallet,to:DOTBOTS,data}); }catch(e){ die('simulation reverted: '+(e.shortMessage||e.message)); }
const gas=await p.estimateGas({from:wallet,to:DOTBOTS,data});
const fee=(await p.getFeeData()).gasPrice*gas*12n/10n;
const bal=await p.getBalance(wallet);
if(bal<fee) die(`not enough BNB for gas: have ${ethers.formatEther(bal)} BNB, need about ${ethers.formatEther(fee)} BNB`);
const tx={chainId:56,to:DOTBOTS,data,value:'0',gasLimit:(gas*13n/10n).toString()};
console.log(JSON.stringify({ok:true,wallet,agentId:handle+'.ai',tokenId:id.toString(),gasEstimate:gas.toString(),tx},null,1));
console.log('READY: send this tx (value 0) from the same wallet and confirm it in your wallet app, then run: node claim.mjs --result <txHash>');
