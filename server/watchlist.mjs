const day=86400000;
const pacificDate=value=>new Date(value).toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'});
// Count weekdays after placement through the current Pacific calendar date.
export function businessDaysWaiting(createdAt,now=Date.now()){
 const start=Date.parse(pacificDate(createdAt)+'T00:00:00Z'),end=Date.parse(pacificDate(now)+'T00:00:00Z');
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 0;
 const days=Math.floor((end-start)/day),weeks=Math.floor(days/7);let count=weeks*5;
 for(let i=weeks*7+1;i<=days;i++){const weekday=new Date(start+i*day).getUTCDay();if(weekday!==0&&weekday!==6)count++;}return count;
}
export function queueStage(order,now=Date.now(),threshold=7){
 if(order.closed||order.cancelledAt||!order.items.some(i=>i.requiresShipping&&i.remaining>0))return null;
 if(now-Date.parse(order.createdAt)>threshold*day)return 'overdue';
 return businessDaysWaiting(order.createdAt,now)>=3?'watchlist':null;
}
export function annotateQueue(order,now=Date.now(),threshold=7){return{...order,queueStage:queueStage(order,now,threshold),businessDaysWaiting:businessDaysWaiting(order.createdAt,now),daysUntilOverdue:Math.max(0,(Date.parse(order.createdAt)+threshold*day-now)/day)};}
