import {dispatchHandler} from '../_shared/dispatch.ts';
Deno.serve(dispatchHandler({env:name=>Deno.env.get(name),fetch}));
