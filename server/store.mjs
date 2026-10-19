import {queueStage} from './watchlist.mjs';
import {recordMetricSnapshot} from './metrics.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export const statuses=['Needs Follow-Up','Awaiting 3PL Response','Follow-Up Required','Customer Waiting for Inbound Inventory','Resolved'];
export function openStore(path){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, cx_status TEXT NOT NULL DEFAULT 'Needs Follow-Up', contact TEXT, entered TEXT NOT NULL, closed TEXT, disposition TEXT, checked TEXT);
 CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS team_users(email TEXT PRIMARY KEY,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,password_hash TEXT,session_version INTEGER NOT NULL DEFAULT 0,must_change_password INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS team_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE IF NOT EXISTS locks(name TEXT PRIMARY KEY, expires INTEGER, owner TEXT);
 CREATE TABLE IF NOT EXISTS metric_snapshots(at TEXT NOT NULL, configuration TEXT NOT NULL, overdue INTEGER NOT NULL,needs_followup INTEGER,awaiting_response INTEGER,oldest_days INTEGER, PRIMARY KEY(at,configuration));
 CREATE TABLE IF NOT EXISTS sync_runs(id INTEGER PRIMARY KEY, started TEXT, finished TEXT, status TEXT);`);
 if(!db.prepare('PRAGMA table_info(locks)').all().some(c=>c.name==='owner'))db.exec('ALTER TABLE locks ADD COLUMN owner TEXT');
 const metricColumns=new Set(db.prepare('PRAGMA table_info(metric_snapshots)').all().map(c=>c.name));for(const column of ['needs_followup','awaiting_response','oldest_days'])if(!metricColumns.has(column))db.exec(`ALTER TABLE metric_snapshots ADD COLUMN ${column} INTEGER`);
 if(!db.prepare('PRAGMA table_info(orders)').all().some(c=>c.name==='overdue_entered')){db.exec('BEGIN IMMEDIATE');try{db.exec('ALTER TABLE orders ADD COLUMN overdue_entered TEXT');db.exec('UPDATE orders SET overdue_entered=entered');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 return db;
}
export function eligible(order,now=Date.now(),threshold=7){return !order.cancelledAt && now-Date.parse(order.createdAt)>threshold*86400000 && order.items.some(i=>i.requiresShipping&&i.remaining>0);}
export function applySnapshot(db,orders,now=new Date().toISOString(),threshold=7,guard=()=>{}){
 db.exec('BEGIN IMMEDIATE');try{guard();
 for(const order of orders){
 const old=db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
 const stage=queueStage({...order,closed:null},Date.parse(now),threshold);const active=Boolean(stage);
 if(!old&&!active)continue;
 const outstanding=order.items.some(i=>i.requiresShipping&&i.remaining>0);
 // A display status alone cannot close an order with outstanding physical items.
 const disposition=order.cancelledAt?'Canceled':!outstanding?(order.displayFulfillmentStatus==='FULFILLED'?'Fulfilled':'No outstanding items'):null;
 if(old){db.prepare('UPDATE orders SET snapshot=?,closed=?,disposition=?,checked=? WHERE id=?').run(JSON.stringify(order),active?null:disposition?(old.closed||now):old.closed,active?null:disposition,now,order.id);}
 else db.prepare('INSERT INTO orders(id,snapshot,entered,checked) VALUES(?,?,?,?)').run(order.id,JSON.stringify(order),now,now);
 if(stage==='overdue')db.prepare('UPDATE orders SET overdue_entered=COALESCE(overdue_entered,?) WHERE id=?').run(now,order.id);
 if(old&&Boolean(old.closed)!==!active&& (active||disposition))db.prepare('INSERT INTO activity(order_id,kind,body,actor,at) VALUES(?,?,?,?,?)').run(order.id,'sync',active?'Returned to active queue':`Moved to history · ${disposition}`,'Shopify sync',now);
 }
 recordMetricSnapshot(db,now,threshold);
 db.prepare("INSERT INTO meta(key,value) VALUES('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(now);db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function listOrders(db){return db.prepare('SELECT * FROM orders').all().map(r=>({...JSON.parse(r.snapshot),cxStatus:r.cx_status,contact:r.contact,entered:r.entered,overdueEntered:r.overdue_entered,closed:r.closed,disposition:r.disposition,checked:r.checked}));}
export function recordAction(db,id,{status,contact,note},actor){
 if(!db.prepare('SELECT id FROM orders WHERE id=?').get(id))throw new Error('Order not found');
 if(status!==undefined&&!statuses.includes(status))throw new Error('Invalid status');
 if(contact!==undefined&&contact!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(contact)||!Number.isFinite(Date.parse(contact))||contact>new Date().toISOString().slice(0,10)))throw new Error('Invalid contact date');
 if(note!==undefined&&(typeof note!=='string'||note.trim().length>5000))throw new Error('Invalid note');
 db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT * FROM orders WHERE id=?').get(id);const at=new Date().toISOString();const log=(kind,body)=>db.prepare('INSERT INTO activity(order_id,kind,body,actor,at) VALUES(?,?,?,?,?)').run(id,kind,body,actor,at);
 if(status&&status!==old.cx_status){db.prepare('UPDATE orders SET cx_status=? WHERE id=?').run(status,id);log('status',`${old.cx_status} → ${status}`);}
 if(contact!==undefined&&contact!==old.contact){db.prepare('UPDATE orders SET contact=? WHERE id=?').run(contact||null,id);log('contact',contact?`3PL contacted on ${contact}`:'3PL contact date cleared');}
 if(note?.trim())log('note',note.trim());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
