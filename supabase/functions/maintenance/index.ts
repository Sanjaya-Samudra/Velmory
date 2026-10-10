import {maintenanceHandler} from '../_shared/maintenance.ts';
Deno.serve(maintenanceHandler({env:name=>Deno.env.get(name),fetch}));
