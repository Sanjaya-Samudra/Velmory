import {deletionHandler} from '../_shared/maintenance.ts';
Deno.serve(deletionHandler({env:name=>Deno.env.get(name),fetch}));
