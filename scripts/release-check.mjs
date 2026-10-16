const required=['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_PUBLIC_SITE_URL'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length)fail('Missing release variables: '+missing.join(', '));
if(process.env.VITE_EMAIL_AUTH_READY!=='true')fail('VITE_EMAIL_AUTH_READY must be true only after confirmation and reset email delivery has passed.');
if(process.env.VELMORY_LIVE_TESTS_PASSED!=='yes')fail('Run the disposable hosted integration suite, then set VELMORY_LIVE_TESTS_PASSED=yes for this release check.');
if(process.env.VELMORY_BACKUP_RESTORE_PASSED!=='yes')fail('Complete an isolated backup restoration, then set VELMORY_BACKUP_RESTORE_PASSED=yes for this release check.');

const supabase=secureUrl('VITE_SUPABASE_URL'),site=secureUrl('VITE_PUBLIC_SITE_URL'),anon=process.env.VITE_SUPABASE_ANON_KEY;
if(/service[_-]?role/i.test(anon)||anon.length<20)fail('VITE_SUPABASE_ANON_KEY is not a valid public anonymous/publishable key. Never use a service-role key in the frontend.');
const request=async(url,options={})=>{const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15_000),...options}).catch(error=>fail(`${url.origin} is unreachable: ${error.message}`));if(response.status>=400)fail(`${url.href} returned ${response.status}`);return response};
await request(new URL('/auth/v1/health',supabase),{headers:{apikey:anon}});
const home=await request(new URL('/',site));
for(const name of ['content-security-policy','strict-transport-security','x-content-type-options','referrer-policy','permissions-policy'])if(!home.headers.get(name))fail(`Deployed site is missing the ${name} header.`);
for(const path of ['/sw.js','/manifest.webmanifest','/robots.txt','/auth/login'])await request(new URL(path,site));
console.log('Production endpoints, email gate, security headers, PWA files, hosted tests, and restoration evidence are ready. Complete the final human smoke test in docs/LAUNCH.md before opening registration.');

function secureUrl(name){let url;try{url=new URL(process.env[name])}catch{fail(`${name} must be an absolute URL.`)}if(url.protocol!=='https:'||url.username||url.password||['localhost','127.0.0.1'].includes(url.hostname))fail(`${name} must be a credential-free public HTTPS URL.`);return url}
function fail(message){console.error(message);process.exit(1)}
