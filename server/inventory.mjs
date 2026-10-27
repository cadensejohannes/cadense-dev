export const inventoryScopes=['read_products','read_inventory','read_locations'];
export function stockSummary(item,levels){
 if(!item)return{state:'unknown',reason:'Product variant or inventory item unavailable'};
 if(typeof item.tracked!=='boolean')return{state:'unknown',reason:'Inventory tracking status unavailable'};
 if(item.tracked===false)return{state:'untracked',reason:'Shopify does not track inventory for this item'};
 if(levels.some(l=>!l.location||typeof l.location.isActive!=='boolean'||typeof l.location.fulfillsOnlineOrders!=='boolean'))return{state:'unknown',reason:'Location eligibility unavailable'};
 const active=levels.filter(l=>l.location?.isActive&&l.location?.fulfillsOnlineOrders);
 if(!active.length)return{state:'unknown',reason:'No active online fulfillment location found'};
 const locations=active.map(l=>{const quantities=Object.fromEntries((l.quantities||[]).map(q=>[q.name,q.quantity]));return{id:l.location.id,name:l.location.name,shippable:Number.isInteger(quantities.available)&&Number.isInteger(quantities.committed)?Math.max(0,quantities.available+quantities.committed):null,onHand:quantities.on_hand??null};});
 if(locations.some(l=>l.shippable===null))return{state:'unknown',reason:'Inventory quantities incomplete'};
 const shippable=locations.reduce((n,l)=>n+l.shippable,0);return{state:shippable===0?'out_of_stock':'in_stock',shippable,locations};
}
export function inventoryOverview(order){const pending=order.items.filter(i=>i.requiresShipping&&i.remaining>0);return{shortages:pending.filter(i=>i.inventory?.state==='out_of_stock'),unknown:pending.filter(i=>!i.inventory||i.inventory.state==='unknown')};}
export function isVip(order){return(order.tags||[]).some(t=>t.trim().toLowerCase()==='vip');}
export function isUnshipped(order){return !order.closed&&!order.cancelledAt&&order.items.some(i=>i.requiresShipping&&i.remaining>0);}
