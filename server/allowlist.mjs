import{readFileSync,existsSync}from'node:fs';
export function getAllowlist(){
 const raw=process.env.AUTHORIZED_USERS_JSON||(existsSync('authorized-users.json')?readFileSync('authorized-users.json','utf8'):null);
 if(!raw)return [];
 const data=JSON.parse(raw);
 if(!Array.isArray(data)||data.some(u=>typeof u.email!=='string'||!/^\S+@\S+\.\S+$/.test(u.email)||!['admin','member'].includes(u.role)))throw new Error('Invalid authorized user configuration');
 return data.map(u=>({email:u.email.trim().toLowerCase(),role:u.role}));
}
