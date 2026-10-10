import {mediaHandler} from '../_shared/media.ts';
Deno.serve(mediaHandler({env:name=>Deno.env.get(name),fetch}));
