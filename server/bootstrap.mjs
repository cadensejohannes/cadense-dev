import{existsSync,mkdirSync,writeFileSync,renameSync,readFileSync}from'node:fs';import{dirname}from'node:path';import{hashPassword}from'./auth.mjs';
export function bootstrapAdmin({file,email,password,allowlist=[]}){
 if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).length)return false;
 if(!email||!password)return false;
 email=email.trim().toLowerCase();
 if(!allowlist.some(u=>u.email===email&&u.role==='admin'))throw new Error('Initial administrator is not authorized');
 if(typeof password!=='string'||password.length<12)throw new Error('Initial administrator password must have 12 or more characters');
 mkdirSync(dirname(file),{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify([{email,role:'admin',passwordHash:hashPassword(password)}],null,2),{mode:0o600});renameSync(tmp,file);return true;
}
