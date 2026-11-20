export type SortKey='order'|'date'|'customer'|'age'|'fulfillment'|'location'|'cx'|'contact'|'checked'|'closed'|'business'|'until'|'items';
export type SortSelection=`${SortKey}-${'asc'|'desc'}`;
type SortableOrder={items?:{name:string;sku?:string;requiresShipping:boolean;remaining:number}[];businessDaysWaiting?:number;daysUntilOverdue?:number;id:string;name:string;createdAt:string;customer:string;displayFulfillmentStatus:string;locations:string[];cxStatus:string;contact:string|null;checked:string;closed:string|null;disposition:string|null};
const text=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
const timestamp=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function toggleOrderSort(current:SortSelection,key:SortKey):SortSelection{return current===`${key}-asc`?`${key}-desc`:`${key}-asc`;}
export function compareOrders(a:SortableOrder,b:SortableOrder,selection:SortSelection,history=false,now=Date.now()):number{
 const [field,direction]=selection.split('-') as [SortKey,'asc'|'desc'];
 const value=(o:SortableOrder):string|number|null=>{switch(field){
 case 'items':return o.items?.filter(i=>i.requiresShipping&&i.remaining>0).map(i=>`${i.name} ${i.sku||''}`).join(', ')||null;case 'business':return o.businessDaysWaiting??null;case 'until':return o.daysUntilOverdue??null;case 'order':return o.name;case 'date':return timestamp(o.createdAt);case 'customer':return o.customer||null;
 case 'age':return Math.floor(((o.closed?Date.parse(o.closed):now)-Date.parse(o.createdAt))/86400000);
 case 'fulfillment':return history?o.disposition:o.displayFulfillmentStatus.replaceAll('_',' ');
 case 'location':return o.locations.join(', ')||null;case 'cx':return o.cxStatus||null;
 case 'contact':return timestamp(o.contact);case 'closed':return timestamp(o.closed);case 'checked':return timestamp(o.checked);
 }};
 const av=value(a),bv=value(b);
 // Missing values remain at the bottom in both directions.
 if(av===null&&bv!==null)return 1;if(bv===null&&av!==null)return -1;
 const compared=av===null||bv===null?0:typeof av==='number'&&typeof bv==='number'?av-bv:text.compare(String(av),String(bv));
 return compared?(direction==='asc'?compared:-compared):text.compare(a.name,b.name)||text.compare(a.id,b.id);
}
export const sortLabels:Record<SortKey,string>={items:'Outstanding items',business:'Business days waiting',until:'Days until overdue',order:'Order number',date:'Order date',customer:'Customer',age:'Days outstanding',fulfillment:'Fulfillment',location:'3PL / Location',cx:'CX status',contact:'Last 3PL contact',checked:'Last checked',closed:'Closed date'};
