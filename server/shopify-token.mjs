import {SyncError} from './sync-errors.mjs';
// Same-organization Shopify apps use expiring client-credentials tokens.
export function tokenProvider({domain,clientId,clientSecret,accessToken,fetcher=fetch,now=Date.now}) {
 if(!clientId&&!clientSecret){if(!accessToken)throw new Error('Shopify credentials missing');return async()=>accessToken;}
 if(!clientId||!clientSecret)throw new Error('Set both Shopify client credentials');
 if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain||''))throw new Error('Invalid Shopify domain');
 let token=null,expires=0,pending=null;
 return async()=>{
  if(token&&now()<expires-60000)return token;
  if(pending)return pending;
  pending=(async()=>{
   let response;try{response=await fetcher(`https://${domain}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(30000)});}catch{throw new SyncError('SHOPIFY_TOKEN_NETWORK','Could not reach Shopify’s token endpoint.');}
   if(!response.ok)throw new SyncError('SHOPIFY_TOKEN_AUTH',`Shopify rejected the credential exchange (HTTP ${response.status}). Verify Client ID, Client secret, app installation, and that the app and store belong to the same organization.`);
   let data;try{data=await response.json();}catch{throw new SyncError('SHOPIFY_TOKEN_RESPONSE','Shopify returned an invalid token response.');}
   if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=60)throw new SyncError('SHOPIFY_TOKEN_RESPONSE','Shopify returned an incomplete token response.');
   token=data.access_token;expires=now()+data.expires_in*1000;return token;
  })();
  try{return await pending;}finally{pending=null;}
 };
}
