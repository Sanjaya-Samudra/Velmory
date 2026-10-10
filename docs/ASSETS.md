# Asset inventory

Original files remain unchanged in ../Design. Optimized WebP copies are in public/assets. Fonts are served locally to avoid third-party font requests from private screens.

Included: homepage room, transparent diary, crest, four memory-card scenes, the supplied background MP4, Cormorant Garamond and Manrope font files.

The MP4 is preserved but not autoplayed until playback, contrast, motion, and loading behaviour are reviewed. Existing ambient motion uses the room, light effects, drifting highlights, diary movement, and transitions.

Optional assets for a richer subsequent visual pass:

- Seamless room loop: 1920x1080 desktop and 1080x1920 mobile, 8-12 seconds, MP4 H.264 plus WebM, no baked text, no camera shake, subtle candle and curtain motion, target below 4 MB per loop.
- Diary texture set: front cover, back cover, spine and paper, consistent lighting, 2048px or larger, no baked user-specific title. Needed for a true deforming 3D book.
- Transparent keepsakes: wax seals, paper tape, dried flowers and photo corners, 512-1024px, clean alpha edges, consistent warm light.
- Sound pack, if desired: short page turn, cover closing and pen sounds with explicit usage rights. Sound remains off unless the user enables it.

The supplied screenshots use several different logo variants and sidebar arrangements. The current implementation standardizes on the ornate crest and one navigation structure.
