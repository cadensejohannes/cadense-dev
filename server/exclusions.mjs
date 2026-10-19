const key='excluded_order_tags';
export function excludedTags(db){const saved=db.prepare('SELECT value FROM meta WHERE key=?').get(key);return saved?JSON.parse(saved.value):['FWCOL26PRE'];}
export function saveExcludedTags(db,tags){
 if(!Array.isArray(tags)||tags.length>50||tags.some(t=>typeof t!=='string'||!t.trim()||t.trim().length>255))throw new Error('Provide up to 50 nonempty order tags (255 characters maximum each).');
 const unique=[...new Map(tags.map(t=>[t.trim().toLowerCase(),t.trim()])).values()];
 db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(unique));return unique;
}
export function matchingExcludedTags(order,tags){const present=new Set((order.tags||[]).map(t=>t.trim().toLowerCase()));return tags.filter(t=>present.has(t.toLowerCase()));}
export function ordersWithExclusions(orders,tags){return orders.map(o=>({...o,excludedTags:matchingExcludedTags(o,tags)}));}
