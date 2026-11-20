import {getAllowlist} from './allowlist.mjs';
import {hashPassword} from './auth.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const [inputEmail,role='member']=process.argv.slice(2);const email=inputEmail?.toLowerCase();if(!email||!['member','admin'].includes(role))throw new Error('Usage: node server/create-user.mjs email admin|member < password-file');
const allowlist=getAllowlist();if(!allowlist.some(u=>u.email===email&&u.role===role))throw new Error('Email and role must be authorized');
let password='';for await(const chunk of process.stdin)password+=chunk;password=password.trim();if(password.length<12)throw new Error('Use a password of at least 12 characters');const file=process.env.USERS_FILE||'users.json';const users=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];if(users.some(u=>u.email===email))throw new Error('User already exists');users.push({email,role,passwordHash:hashPassword(password)});writeFileSync(file,JSON.stringify(users,null,2),{mode:0o600});console.log('User added');
