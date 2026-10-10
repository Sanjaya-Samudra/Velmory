# Velmory frontend redesign

Implemented in the existing Project directory, using the supplied Desktop references. Original materials are preserved. Your actual diaries populate each screen; the application does not seed demonstration memories into your vault.

## How to check the UI

Run START-VELMORY.cmd, open the local application, and unlock your vault.

- **My library**: Create a diary, open a leather cover, archive/restore, or choose Delete. The confirmation shows the diary and page count; Keep diary cancels. Deletion is queued as an encrypted synchronization tombstone. Export first if you need a backup.
- **Memories**: Each diary has a collapsible group. Six pages appear per group; Previous/Next lets long diaries stay compact. Use full date ranges, page order, newest/oldest, title/place sorting, bookmarks or media filters. Select a memory for a parchment reader and its metadata, or Open to edit.
- **Search memories**: Search text and titles, plus independent people, place and mood filters. Collection insights use actual unsealed pages.
- **Life timeline**: Date-range filters and chapter cards show diaries together. Each card filters to that book. Start a new chapter leads to the library; individual memories can also have chapter labels in the editor.
- **Memory Time Machine**: Travel by year using arrows or the custom year menu, select a month, and enter a matching memory from its parchment preview.
- **On this day**: Choose a date to discover that month/day across your years, grouped by diary.
- **Future letters**: Search, filter Upcoming/Ready/Cancelled, and sort. Compose uses the custom recipient menu. Existing hosted contact acceptance and delivery controls remain. Device letters are a local ritual, not a tamperproof timer.
- **Print & export**: Choose a book and year, prepare a browser print preview, download a PDF, or create/import an encrypted archive. Archive actions share consistent widths and spacing. The archive contains the whole encrypted collection, regardless of the readable-export filters. Import limit is 512 MB.
- **Privacy & settings**: Storage includes encrypted audio; select an inactivity lock interval, change the vault passphrase and download the replacement recovery key, choose motion/email preferences, or delete the account.
- **My profile**: Edit name, biography and quote. Real statistics, diary covers, milestones, self-selected writing-style sliders and recent memories replace fabricated counts.
- **Reflection companion**: Give session consent, select diaries and a question, gather local passages, edit/copy/save the reflection. This tool is explicitly not external AI. Saved reflections are included in your encrypted archive.

## Inside a diary

Write with bold, italic, underline, strike, headings, lists and quotes. Adjust text font, size, ink and alignment in the inspector. Draw, insert optimized photos, choose from 48 categorized stickers, insert audio, move/resize/rotate/layer/duplicate objects, undo/redo, bookmark and fill mood/chapter/place/people/tags. Wide screens have a facing-page preview; phones retain the same page composition with zoom and scroll. Reading mode gives a linear alternative.

**Seal page** protects the entire page with a separate Argon2id-derived password and authenticated encryption, including its title, metadata and media keys. Unlocking is confined to the editor session. Edits are re-encrypted before entering the ordinary vault persistence pipeline. Lock seals, leave the editor, or lock the vault to close it. Sealed pages are excluded from search, date discovery, reflections and readable exports. There is no password reset or vault-key bypass for these page passwords. Keep them safely.

Audio accepts up to **100 MiB** (104,857,600 bytes), in encrypted 2 MiB source pieces. Playback reconstructs a temporary browser Blob on request; these Blob URLs are revoked when the player closes. Larger audio can use substantial browser memory. The cloud quota includes encoding/encryption overhead and stays at its configured allowance. A failed upload retains the local encrypted copy and surfaces an error. Retry using Synchronize memories. Encrypted media caches may remain after diary deletion, especially for sealed or copied records; clearing/deleting the device vault removes them. Exported backups are not recalled by deletion.

## Verification

Final verification: backend TypeScript checks passed; all 38 automated tests passed; production build passed; all three browser journeys passed. All ten interior destinations were checked at 360, 390, 768, 1024 and 1440 pixels. Automated accessibility scans found no critical or serious WCAG A/AA violations on the ten new screens at desktop width. Print preview, keyboard dropdown operation, encrypted archive download and same-vault import were exercised. Browser checks cover 360, 390, 768, 1024 and 1440 pixel widths, deletion confirmation, grouping/pagination, dropdown selection, page sealing/wrong-password/edited resealing, a recording above the former 3 MB limit, and route navigation. Unit checks exercise a real 100 MiB recording round-trip, ciphertext tampering and deletion tombstones. Desktop and phone screenshots are saved under test-results.

## Deliberate boundaries

Live Supabase/Auth/Storage/SMTP/Edge behavior still requires operator credentials and live verification. External AI, device biometric unlock, paid physical printing/delivery, and complete admin artwork authoring are not connected. No subscription or purchase was made. Browser print and local reflection are working alternatives with accurate labels. Encryption has automated checks, not an independent security audit. This is not a claim that every feature in the concept images is complete or that the application is bug-free.


## Latest visual corrections

- The supplied Desktop/Logo-V.png is now used by Brand and the favicon; the original asset is preserved.
- A content-sized inner sidebar frame includes the entire navigation, including Print & export, Privacy & settings and My profile.
- Sticker categories and selected-object sticker controls adapt to their available width without exceeding the panel margins.
- Diary archive/delete controls sit together below each book with consistent styling and a separate deletion confirmation.
- Shared calendar popovers replace native date/datetime dropdowns in the editor, memory filters, On This Day and future-letter composer. Dates appear in a readable format. Manual ISO date entry is available by replacing the selected field text; invalid dates remain invalid and do not modify the saved/filter date. Calendar month/year and letter hour/minute selectors match the existing gold/navy controls. Day selection supports arrows, Home/End, Page Up/Down, and Escape.
- Diary, Sort pages, Show, From date and To date share one row at desktop and tablet widths. Phones use a deliberate two-column arrangement.
- Sealed pages show parchment, decorative blurred ink and an embossed red wax stamp on the page edge. No private content is rendered while locked. Memory thumbnails use the same wax-stamp motif.
- Verification: production build passed; all three browser journeys passed, including five viewport widths, sticker boundaries, sidebar frame containment, filter alignment, invalid-date rejection, keyboard calendar selection, exact letter date/time preservation and calendar accessibility checks. Existing encrypted saving, page-password, deletion and archive journeys still pass.

Date regressions are checked against the saved ISO values and their readable display. The mobile editor toolbar stays above the paper and scrolls horizontally, without obscuring the title. Final visual review confirmed the wax stamp stays within memory thumbnails and that memory dates remain correct after navigation.


## Single library entry
Sanctuary has been removed as a separate screen and navigation item. Login and legacy /app or /app/sanctuary URLs lead to /app/library. The library owns diary creation, opening, archiving, restoration and deletion. Duplicate promotional cards have been removed. There was no Sanctuary-specific database table, endpoint or service; shared encrypted diary storage remains in use. Existing diaries are preserved.


## Reading room redesign — October 8, 2026

The application frame stays within the viewport. The content pane may scroll for smaller windows, browser zoom and mobile controls, but collection height does not increase with the size of a vault. No backend schema, encryption format or service API was changed.

- Library: four books per desktop shelf, two on phones; next/previous shelves; search; active/archive collections. Covers show the diary name and year, with leather grain, inset tooling, page edges, clasps and ribbons. Velmory branding is confined to the application navigation.
- Memories: horizontal diary chooser; only the selected diary is rendered, in batches of six on desktop or two on phones. Paper keepsakes open a reading preview.
- Search: a darker catalogue with people/place/mood refinements in a disclosure.
- Timeline: horizontal diary chapters and dated memory cards; swipe or use a trackpad across the card tray, and use Next/Previous for the next batch.
- On This Day: a paper almanac alongside memories for the selected month/day across years.
- Time Machine: brass year dial, month rail, and a single emerging memory; Next/Previous moves between matching moments.
- Letters: folded envelopes and wax seals; four per desktop batch, two on phones. Contact management and received letters use disclosures.
- Editor: detached rounded control bars, leather-backed pages, paper gutter, leaf-turn animation, viewport-aware scale, five nearby page markers and Jump to page for any page. Text controls float outside the paper instead of crossing titles. Long titles wrap. Phone pages keep the same composition with zoom/pan; reading mode offers linear content.
- Settings: Vault & keys, Storage, Experience, Consent and Account stations.
- Export: Paper & print and Encrypted archive stations.
- Profile: Portrait, Books, Milestones & style, Recent moments.
- Reflection: a quiet desk with a separate writing sheet.

Motion respects the system preference and Velmory's Ambient motion setting. Library hover and page-leaf effects remain decorative; writing and navigation stay usable during animation.

Browser tests include an isolated synthetic vault with 12 diaries, 960 pages and seven letters. Sample content is never inserted into the user's vault. The test checks collection bounds, long cover titles, navigation to page 80, separation of editor bars, responsive layouts, privacy flows, import/export and accessibility.

Final verification: production build passed; all four browser journeys passed on the final reading-room version. Layouts were checked at 360, 390, 768, 1024 and 1440 pixels. Accessibility scans reported no serious or critical violations on the tested routes. Existing bundle-size warnings remain. Hosted-service readiness is unchanged by this frontend work.

The final compact desktop tray and envelope-centering refinements also passed the large-collection browser journey and production build.
