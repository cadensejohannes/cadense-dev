export class SyncError extends Error{constructor(code,message){super(message);this.code=code;}}
export function safeSyncMessage(error){return error instanceof SyncError?`${error.message} [${error.code}]`:'Unexpected synchronization error. Check server logs. [SYNC_INTERNAL]';}
export function graphqlFailure(response,errors=[],stage='Shopify data'){
 const messages=errors.map(e=>typeof e.message==='string'?e.message:'').join(' ');
 // Inspect messages only to categorize; never expose or log raw Shopify payloads.
 if(/protected customer|not approved to access|customer data/i.test(messages))return new SyncError('SHOPIFY_CUSTOMER_DATA',`${stage}: Shopify denied protected customer data access. Check the app’s customer-data permissions.`);
 if(response.status===401)return new SyncError('SHOPIFY_API_AUTH',`${stage}: Shopify rejected the access token. Verify the app is installed on the configured store.`);
 if(response.status===403||errors.some(e=>e.extensions?.code==='ACCESS_DENIED')||/access denied|access scope|permission/i.test(messages))return new SyncError('SHOPIFY_API_PERMISSION',`${stage}: Shopify denied API access. Check granted scopes and customer-data permissions.`);
 if(errors.some(e=>e.extensions?.code==='GRAPHQL_VALIDATION_FAILED')||/doesn't exist|not defined|undefinedField|invalid.*argument/i.test(messages))return new SyncError('SHOPIFY_QUERY_SCHEMA',`${stage}: Shopify rejected a query field or argument. The backend query needs correction.`);
 return new SyncError('SHOPIFY_API_RESPONSE',`${stage}: Shopify returned an unsuccessful API response (HTTP ${response.status}).`);
}
