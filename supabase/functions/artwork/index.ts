import {artworkHandler} from '../_shared/artwork.ts';
Deno.serve(artworkHandler({env:name=>Deno.env.get(name),fetch}));
