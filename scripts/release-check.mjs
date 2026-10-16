const required=['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_SITE_URL'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length){console.error('Missing release variables: '+missing.join(', '));process.exit(1)}
const urls=[new URL('/auth/v1/health',process.env.VITE_SUPABASE_URL),new URL('/',process.env.VITE_PUBLIC_SITE_URL)];
for(const url of urls){const response=await fetch(url,{redirect:'manual'}).catch(error=>{throw new Error(`${url.origin} is unreachable: ${error.message}`)});if(response.status>=500)throw new Error(`${url.href} returned ${response.status}`);console.log(`${url.href} responded ${response.status}`)}
console.log('Endpoints respond. Continue with docs/LAUNCH.md manual Auth, SMTP, letter, backup, restore, RLS, and rollback checks.');
