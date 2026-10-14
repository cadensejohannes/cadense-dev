import {tokenProvider} from './shopify-token.mjs';
const pageInfo='pageInfo { hasNextPage endCursor }';
const fields=`id name createdAt cancelledAt displayFulfillmentStatus customer { displayName }`;
export class Shopify{
 constructor({domain,token,clientId,clientSecret,version='2026-10',fetcher=fetch,requireAllOrdersScope=false}){if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain||''))throw new Error('Invalid Shopify domain');this.url=`https://${domain}/admin/api/${version}/graphql.json`;this.getToken=tokenProvider({domain,accessToken:token,clientId,clientSecret,fetcher});this.fetcher=fetcher;this.requireAllOrdersScope=requireAllOrdersScope;}
 async query(query,variables={}){for(let attempt=0;attempt<5;attempt++){let response,json;try{response=await this.fetcher(this.url,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':await this.getToken()},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)});json=await response.json();}catch{if(attempt===4)throw new Error('Shopify connection failed');await new Promise(r=>setTimeout(r,1000*2**attempt));continue;}
 if(response.status===429||response.status>=500||json.errors?.some(e=>e.extensions?.code==='THROTTLED')){if(attempt===4)throw new Error('Shopify temporarily unavailable');await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(1000*2**attempt,Number(response.headers.get('retry-after')||0)*1000))));continue;}
 if(!response.ok||json.errors?.length||!json.data)throw new Error('Shopify query failed; verify scopes and API configuration');return json.data;}throw new Error('Shopify retry exhausted');}
 async pages(query,variables,pick){let after=null,results=[],seen=new Set();do{const connection=pick(await this.query(query,{...variables,after}));if(!connection||!Array.isArray(connection.nodes)||!connection.pageInfo||connection.nodes.some(n=>!n))throw new Error('Incomplete Shopify response');results.push(...connection.nodes);if(!connection.pageInfo.hasNextPage)break;after=connection.pageInfo.endCursor;if(!after||seen.has(after))throw new Error('Invalid Shopify pagination');seen.add(after);}while(true);return results;}
 async order(id){const data=await this.query(`query($id:ID!){order(id:$id){${fields}}}`,{id});if(!data.order)throw new Error('Tracked order unavailable; queue preserved');const order=data.order;
 if(!order.id||!Number.isFinite(Date.parse(order.createdAt)))throw new Error('Incomplete Shopify order');
 const items=await this.pages(`query($id:ID!,$after:String){order(id:$id){lineItems(first:100,after:$after){nodes{id name sku requiresShipping unfulfilledQuantity} ${pageInfo}}}}`,{id},d=>d.order?.lineItems);
 const locations=await this.pages(`query($id:ID!,$after:String){order(id:$id){fulfillmentOrders(first:100,after:$after){nodes{id assignedLocation{name}} ${pageInfo}}}}`,{id},d=>d.order?.fulfillmentOrders);
 if(items.some(i=>typeof i.requiresShipping!=='boolean'||!Number.isInteger(i.unfulfilledQuantity)||i.unfulfilledQuantity<0))throw new Error('Incomplete Shopify quantities');
 return {...order,customer:order.customer?.displayName||'Customer unavailable',items:items.map(i=>({id:i.id,name:i.name,sku:i.sku,requiresShipping:i.requiresShipping,remaining:i.unfulfilledQuantity})),locations:[...new Set(locations.map(l=>l.assignedLocation?.name).filter(Boolean))]};}
 async snapshots(trackedIds,threshold=7){
 const installation=await this.query('query { currentAppInstallation { accessScopes { handle } } }');
 const scopes=new Set(installation.currentAppInstallation?.accessScopes?.map(s=>s.handle)||[]);
 const required=['read_orders','read_merchant_managed_fulfillment_orders','read_third_party_fulfillment_orders'];
 // Merchant-created apps have historical access through read_orders. Partner apps require separate approval.
 if(this.requireAllOrdersScope)required.push('read_all_orders');
 if(!required.every(s=>scopes.has(s)))throw new Error('Required read-only Shopify permissions are missing');
 const cutoff=new Date(Date.now()-threshold*86400000).toISOString();
 // Scan all older orders, including fulfilled display statuses, to discover reversals reliably.
 const found=await this.pages(`query($search:String!,$after:String){orders(first:100,after:$after,query:$search,sortKey:CREATED_AT){nodes{id} ${pageInfo}}}`,{search:`created_at:<${cutoff} status:any`},d=>d.orders);
 const ids=[...new Set([...found.map(o=>o.id),...trackedIds])];const snapshots=[];for(const id of ids)snapshots.push(await this.order(id));return snapshots;}
}
export async function synchronize(db,shopify,threshold=7){
 const now=Date.now();const lease=db.prepare("INSERT INTO locks(name,expires) VALUES('sync',?) ON CONFLICT(name) DO UPDATE SET expires=excluded.expires WHERE locks.expires<? RETURNING name").get(now+120000,now);if(!lease)return {busy:true};
 const heartbeat=setInterval(()=>db.prepare("UPDATE locks SET expires=? WHERE name='sync'").run(Date.now()+120000),30000);
 const started=new Date().toISOString();const run=db.prepare("INSERT INTO sync_runs(started,status) VALUES(?,'running')").run(started);
 try{const orders=await shopify.snapshots(db.prepare('SELECT id FROM orders').all().map(r=>r.id),threshold);const {applySnapshot}=await import('./store.mjs');applySnapshot(db,orders,new Date().toISOString(),threshold);db.prepare("UPDATE sync_runs SET finished=?,status='success' WHERE id=?").run(new Date().toISOString(),run.lastInsertRowid);db.prepare("DELETE FROM meta WHERE key='sync_error'").run();return {success:true};}
 catch(e){db.prepare("UPDATE sync_runs SET finished=?,status='failed' WHERE id=?").run(new Date().toISOString(),run.lastInsertRowid);db.prepare("INSERT INTO meta(key,value) VALUES('sync_error','Sync failed. Queue preserved; check server configuration or retry.') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();throw e;}
 finally{clearInterval(heartbeat);db.prepare("DELETE FROM locks WHERE name='sync'").run();}
}
