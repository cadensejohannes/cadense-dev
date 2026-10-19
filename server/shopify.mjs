import {randomUUID} from 'node:crypto';
import {SyncError,safeSyncMessage,graphqlFailure} from './sync-errors.mjs';
import {tokenProvider} from './shopify-token.mjs';
const pageInfo='pageInfo { hasNextPage endCursor }';
const fields=`id name tags createdAt cancelledAt displayFulfillmentStatus customer { displayName }`;
export class Shopify{
 constructor({domain,token,clientId,clientSecret,version='2026-10',fetcher=fetch,requireAllOrdersScope=false}){if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain||''))throw new Error('Invalid Shopify domain');this.url=`https://${domain}/admin/api/${version}/graphql.json`;this.getToken=tokenProvider({domain,accessToken:token,clientId,clientSecret,fetcher});this.fetcher=fetcher;this.requireAllOrdersScope=requireAllOrdersScope;}
 async query(query,variables={},stage='Shopify data'){for(let attempt=0;attempt<5;attempt++){const token=await this.getToken();let response,json;try{response=await this.fetcher(this.url,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});json=await response.json();}catch{if(attempt===4)throw new SyncError('SHOPIFY_API_NETWORK',`${stage}: could not reach Shopify or read its response.`);await new Promise(r=>setTimeout(r,1000*2**attempt));continue;}
 if(response.status===429||response.status>=500||json.errors?.some(e=>e.extensions?.code==='THROTTLED')){if(attempt===4)throw new SyncError('SHOPIFY_API_THROTTLED',`${stage}: Shopify remained rate-limited or temporarily unavailable after retries.`);await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(1000*2**attempt,Number(response.headers.get('retry-after')||0)*1000))));continue;}
 if(!response.ok||json.errors?.length||!json.data)throw graphqlFailure(response,json.errors,stage);return json.data;}throw new SyncError('SHOPIFY_RETRY_EXHAUSTED','Shopify retries were exhausted.');}
 async pages(query,variables,pick,stage='Shopify data',onPage=()=>{}){let after=null,results=[],seen=new Set();do{const connection=pick(await this.query(query,{...variables,after},stage));if(!connection||!Array.isArray(connection.nodes)||!connection.pageInfo||connection.nodes.some(n=>!n))throw new SyncError('SHOPIFY_RESPONSE_INCOMPLETE',`${stage}: Incomplete Shopify response; the queue is preserved.`);results.push(...connection.nodes);onPage(results.length);if(!connection.pageInfo.hasNextPage)break;after=connection.pageInfo.endCursor;if(!after||seen.has(after))throw new SyncError('SHOPIFY_PAGINATION',`${stage}: invalid Shopify pagination; the queue is preserved.`);seen.add(after);}while(true);return results;}
 async order(id){const data=await this.query(`query($id:ID!){order(id:$id){${fields}}}`,{id},'Order and customer information');if(!data.order)throw new SyncError('SHOPIFY_ORDER_UNAVAILABLE','Shopify did not return a requested order. It may have been deleted or become inaccessible; the queue is preserved.');const order=data.order;
 if(!order.id||!Number.isFinite(Date.parse(order.createdAt)))throw new SyncError('SHOPIFY_ORDER_INCOMPLETE','Shopify returned incomplete order identity or creation data; the queue is preserved.');
 const items=await this.pages(`query($id:ID!,$after:String){order(id:$id){lineItems(first:100,after:$after){nodes{id name sku requiresShipping unfulfilledQuantity} ${pageInfo}}}}`,{id},d=>d.order?.lineItems,'Outstanding order items');
 const locations=await this.pages(`query($id:ID!,$after:String){order(id:$id){fulfillmentOrders(first:100,after:$after){nodes{id assignedLocation{name}} ${pageInfo}}}}`,{id},d=>d.order?.fulfillmentOrders,'Fulfillment locations');
 if(items.some(i=>typeof i.requiresShipping!=='boolean'||!Number.isInteger(i.unfulfilledQuantity)||i.unfulfilledQuantity<0))throw new SyncError('SHOPIFY_QUANTITIES_INCOMPLETE','Shopify returned invalid outstanding item quantities; the queue is preserved.');
 return {...order,customer:order.customer?.displayName||'Customer unavailable',items:items.map(i=>({id:i.id,name:i.name,sku:i.sku,requiresShipping:i.requiresShipping,remaining:i.unfulfilledQuantity})),locations:[...new Set(locations.map(l=>l.assignedLocation?.name).filter(Boolean))]};}
 async snapshots(trackedIds,threshold=7,onProgress=()=>{}){
 onProgress({stage:'checking permissions'});
 const installation=await this.query('query { currentAppInstallation { accessScopes { handle } } }',{},'Installed app permissions');
 const scopes=new Set(installation.currentAppInstallation?.accessScopes?.map(s=>s.handle)||[]);
 const required=['read_orders','read_customers','read_merchant_managed_fulfillment_orders','read_third_party_fulfillment_orders'];
 // Merchant-created apps have historical access through read_orders. Partner apps require separate approval.
 if(this.requireAllOrdersScope)required.push('read_all_orders');
 const missing=required.filter(s=>!scopes.has(s));
 if(missing.length)throw new SyncError('SHOPIFY_SCOPES_MISSING',`The installed app is missing: ${missing.join(', ')}. Release the correct scopes and approve them on the store.`);
 const cutoff=new Date(Date.now()-Math.min(threshold,2)*86400000).toISOString();
 // Discover overdue candidates; refresh every tracked ID separately, including archived reversals.
 onProgress({stage:'discovering overdue and watchlist candidates'});
 const found=await this.pages(`query($search:String!,$after:String){orders(first:100,after:$after,query:$search,sortKey:CREATED_AT){nodes{id} ${pageInfo}}}`,{search:`created_at:<'${cutoff}' -fulfillment_status:fulfilled -status:cancelled`},d=>d.orders,'Overdue order discovery',count=>onProgress({stage:'discovering overdue and watchlist candidates',discovered:count}));
 const ids=[...new Set([...found.map(o=>o.id),...trackedIds])];const snapshots=[];onProgress({stage:'fetching order details',processed:0,total:ids.length});for(const id of ids){snapshots.push(await this.order(id));if(snapshots.length%25===0||snapshots.length===ids.length)onProgress({stage:'fetching order details',processed:snapshots.length,total:ids.length});}return snapshots;}
}
export function syncState(db,now=Date.now()){
 const lock=db.prepare("SELECT expires FROM locks WHERE name='sync'").get();
 const raw=db.prepare("SELECT value FROM meta WHERE key='sync_progress'").get()?.value;let progress;try{progress=raw?JSON.parse(raw):null;}catch{progress=null;}
 if(lock?.expires>now)return{...(progress||{}),status:'running'};
 if(progress?.status==='running')return{...progress,status:'interrupted'};
 return progress||{status:'idle'};
}
export async function synchronize(db,shopify,threshold=7){
 const now=Date.now(),owner=randomUUID();const lease=db.prepare("INSERT INTO locks(name,expires,owner) VALUES('sync',?,?) ON CONFLICT(name) DO UPDATE SET expires=excluded.expires,owner=excluded.owner WHERE locks.expires<? RETURNING name").get(now+120000,owner,now);if(!lease)return {busy:true};
 let leaseLost=false;const assertLease=()=>{const lock=db.prepare("SELECT owner,expires FROM locks WHERE name='sync'").get();if(leaseLost||lock?.owner!==owner||lock.expires<Date.now())throw new SyncError('SYNC_LEASE_LOST','Synchronization lost its lock. No fetched records were applied; retry the sync.');};
 const heartbeat=setInterval(()=>{try{const r=db.prepare("UPDATE locks SET expires=? WHERE name='sync' AND owner=?").run(Date.now()+120000,owner);if(!r.changes)leaseLost=true;}catch{leaseLost=true;}},30000);
 const started=new Date().toISOString();db.prepare("UPDATE sync_runs SET status='interrupted',finished=? WHERE status='running'").run(started);
 let stage='starting';const report=progress=>{assertLease();stage=progress.stage;const state={...progress,status:stage==='complete'?'complete':'running',startedAt:started,updatedAt:new Date().toISOString()};db.prepare("INSERT INTO meta(key,value) VALUES('sync_progress',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(state));console.info('Shopify sync progress: '+JSON.stringify(progress));};
 const run=db.prepare("INSERT INTO sync_runs(started,status) VALUES(?,'running')").run(started);
 try{report({stage});const orders=await shopify.snapshots(db.prepare('SELECT id FROM orders').all().map(r=>r.id),threshold,report);report({stage:'saving records',total:orders.length,processed:orders.length});const {applySnapshot}=await import('./store.mjs');applySnapshot(db,orders,new Date().toISOString(),threshold,assertLease);db.prepare("UPDATE sync_runs SET finished=?,status='success' WHERE id=?").run(new Date().toISOString(),run.lastInsertRowid);db.prepare("DELETE FROM meta WHERE key='sync_error'").run();report({stage:'complete',processed:orders.length,total:orders.length});return {success:true};}
 catch(e){db.prepare("UPDATE sync_runs SET finished=?,status='failed' WHERE id=?").run(new Date().toISOString(),run.lastInsertRowid);const detail=safeSyncMessage(e);const current=db.prepare("SELECT owner FROM locks WHERE name='sync'").get();if(current?.owner===owner){db.prepare("INSERT INTO meta(key,value) VALUES('sync_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`Sync failed. Queue preserved. ${detail}`);db.prepare("INSERT INTO meta(key,value) VALUES('sync_progress',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({stage,status:'failed',startedAt:started,updatedAt:new Date().toISOString()}));}console.error(`Shopify synchronization failed at ${stage}: ${detail}`);if(!(e instanceof SyncError)){const frames=String(e.stack||'').split('\n').filter(line=>/^\s+at /.test(line)).map(line=>line.match(/(?:file:\/\/)?[\w/.-]+\.mjs:\d+:\d+/)?.[0]).filter(Boolean);console.error('Sync failure source locations: '+JSON.stringify(frames.slice(0,6)));}throw e;}
 finally{clearInterval(heartbeat);db.prepare("DELETE FROM locks WHERE name='sync' AND owner=?").run(owner);}
}
