import {existsSync,readFileSync} from 'node:fs';
import {hashPassword,verifyPassword} from './auth.mjs';
export class TeamError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const normalize=email=>String(email||'').trim().toLowerCase();
const passwordValid=password=>typeof password==='string'&&password.length>=12&&password.length<=256;
export function initializeTeam(db,allowlist,usersFile){
 if(db.prepare("SELECT value FROM meta WHERE key='team_initialized'").get())return;
 const existing=existsSync(usersFile)?JSON.parse(readFileSync(usersFile,'utf8')):[];
 db.exec('BEGIN IMMEDIATE');try{
 for(const entry of allowlist){const old=existing.find(u=>normalize(u.email)===entry.email&&u.role===entry.role);db.prepare('INSERT OR IGNORE INTO team_users(email,role,enabled,password_hash,session_version,must_change_password) VALUES(?,?,1,?,0,0)').run(entry.email,entry.role,old?.passwordHash||null);}
 if(!db.prepare("SELECT email FROM team_users WHERE role='admin' AND enabled=1 AND password_hash IS NOT NULL").get())throw new TeamError('An administrator account must be configured before migration');
 db.prepare("INSERT INTO meta(key,value) VALUES('team_initialized','1')").run();db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function teamAccount(db,email){return db.prepare('SELECT * FROM team_users WHERE email=?').get(normalize(email));}
export function teamList(db){return db.prepare('SELECT email,role,enabled,password_hash IS NOT NULL AS hasPassword,must_change_password AS mustChangePassword FROM team_users ORDER BY email').all().map(u=>({...u,enabled:Boolean(u.enabled),hasPassword:Boolean(u.hasPassword),mustChangePassword:Boolean(u.mustChangePassword)}));}
export function manageTeam(db,actor,input,domain='cadense.com'){
 const admin=teamAccount(db,actor);if(!admin?.enabled||!admin.password_hash||admin.must_change_password||admin.role!=='admin')throw new TeamError('Administrator access required',403);
 const email=normalize(input.email);const action=input.action;
 if(!/^\S+@\S+\.\S+$/.test(email))throw new TeamError('Enter a valid work email');
 const target=teamAccount(db,email);
 if(!['create','role','activate','deactivate','password'].includes(action))throw new TeamError('Invalid account action');
 if(action==='create'&&(!domain||email.split('@')[1]!==domain.toLowerCase()))throw new TeamError(`New accounts must use @${domain}`);
 if(['create','role'].includes(action)&&!['admin','member'].includes(input.role))throw new TeamError('Choose member or admin');
 if(action==='create'&&target)throw new TeamError('An account with this email already exists');
 if(action!=='create'&&!target)throw new TeamError('Account not found',404);
 if(['create','password'].includes(action)&&!passwordValid(input.password))throw new TeamError('Use a password of 12–256 characters');
 if(target?.role==='admin'&&target.enabled&&target.password_hash&&(action==='deactivate'||(action==='role'&&input.role!=='admin'))){const count=db.prepare("SELECT COUNT(*) AS n FROM team_users WHERE role='admin' AND enabled=1 AND password_hash IS NOT NULL").get().n;if(count<=1)throw new TeamError('The last active administrator cannot be deactivated or demoted');}
 db.exec('BEGIN IMMEDIATE');try{
 if(action==='create')db.prepare('INSERT INTO team_users(email,role,enabled,password_hash,session_version,must_change_password) VALUES(?,?,1,?,0,1)').run(email,input.role,hashPassword(input.password));
 if(action==='role')db.prepare('UPDATE team_users SET role=?,session_version=session_version+1 WHERE email=?').run(input.role,email);
 if(action==='activate'||action==='deactivate')db.prepare('UPDATE team_users SET enabled=?,session_version=session_version+1 WHERE email=?').run(action==='activate'?1:0,email);
 if(action==='password')db.prepare('UPDATE team_users SET password_hash=?,session_version=session_version+1,must_change_password=1 WHERE email=?').run(hashPassword(input.password),email);
 db.prepare('INSERT INTO team_audit(actor,target,action,at) VALUES(?,?,?,?)').run(actor,email,action,new Date().toISOString());db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return teamList(db);
}
export function changeOwnPassword(db,email,currentPassword,newPassword){const account=teamAccount(db,email);if(!account?.enabled||!verifyPassword(String(currentPassword||''),account.password_hash||''))throw new TeamError('Current password is incorrect');if(!passwordValid(newPassword))throw new TeamError('Use a new password of 12–256 characters');if(verifyPassword(newPassword,account.password_hash))throw new TeamError('Choose a different password');db.prepare('UPDATE team_users SET password_hash=?,session_version=session_version+1,must_change_password=0 WHERE email=?').run(hashPassword(newPassword),email);return teamAccount(db,email);}
