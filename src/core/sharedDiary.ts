import {backend, checkError} from './backend';
import {rpc} from './service';
import {encrypt, decrypt, randomContentKey} from './crypto';
import type {CipherEnvelope, Cover, DiaryPage} from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SharedDiaryMember {
  user_id: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'pending' | 'active' | 'removed';
  joined_at: string | null;
}

export interface SharedDiaryRecord {
  id: string;
  title: string;
  cover: Cover;
  owner_id: string;
  milestone_date?: string | null;
  milestone_label?: string | null;
  created_at: string;
  my_role: 'owner' | 'editor' | 'viewer';
  my_wrapped_key: string;
  status: 'pending' | 'active';
  members: SharedDiaryMember[];
}

export interface SharedDiaryPage {
  page_id: string;
  author_id: string;
  envelope: CipherEnvelope;
  revision: number;
  deleted: boolean;
  updated_at: string;
}

export interface DecryptedSharedPage {
  page: DiaryPage;
  authorId: string;
  revision: number;
  updatedAt: string;
}

// Local in-memory key cache (cleared on lock)
const keyCache = new Map<string, Uint8Array>();

export function clearSharedKeyCache() {
  for (const key of keyCache.values()) key.fill(0);
  keyCache.clear();
}

// ── Crypto helpers ───────────────────────────────────────────────────────────

/** Unwrap (decrypt) the shared content key using the user's vault key */
export async function unwrapSharedKey(
  wrappedKey: string,
  vaultKey: Uint8Array
): Promise<Uint8Array> {
  const s = await import('libsodium-wrappers-sumo').then(async m => {
    await m.default.ready;
    return m.default;
  });
  const pair = s.crypto_box_seed_keypair(vaultKey);
  try {
    const key = s.crypto_box_seal_open(s.from_base64(wrappedKey), pair.publicKey, pair.privateKey);
    if (key.length !== 32) throw new Error('Invalid shared key');
    return key;
  } finally {
    s.memzero(pair.privateKey);
  }
}

/** Wrap (encrypt) a content key for a recipient's vault public key */
async function wrapKeyForRecipient(contentKey: Uint8Array, recipientPublicKey: string): Promise<string> {
  const s = await import('libsodium-wrappers-sumo').then(async m => {
    await m.default.ready;
    return m.default;
  });
  return s.to_base64(s.crypto_box_seal(contentKey, s.from_base64(recipientPublicKey)));
}

/** Get (or unwrap and cache) the shared content key for a diary */
export async function getSharedKey(
  diaryId: string,
  wrappedKey: string,
  vaultKey: Uint8Array
): Promise<Uint8Array> {
  const cached = keyCache.get(diaryId);
  if (cached) return cached;
  const key = await unwrapSharedKey(wrappedKey, vaultKey);
  keyCache.set(diaryId, key);
  return key;
}

const sharedPageContext = (diaryId: string, pageId: string) => `shared:${diaryId}:page:${pageId}`;

// ── Page encryption helpers ──────────────────────────────────────────────────

export async function encryptSharedPage(
  page: DiaryPage,
  sharedKey: Uint8Array,
  diaryId: string
): Promise<CipherEnvelope> {
  return encrypt(page, sharedKey, sharedPageContext(diaryId, page.id));
}

export async function decryptSharedPage(
  envelope: CipherEnvelope,
  sharedKey: Uint8Array,
  diaryId: string,
  pageId: string
): Promise<DiaryPage> {
  return decrypt<DiaryPage>(envelope, sharedKey, sharedPageContext(diaryId, pageId));
}

// ── API calls ────────────────────────────────────────────────────────────────

/** List all shared diaries this user is part of */
export async function listSharedDiaries(): Promise<SharedDiaryRecord[]> {
  return rpc<SharedDiaryRecord[]>('list_shared_diaries');
}

/** Create a new shared diary; generates and wraps a fresh content key */
export async function createSharedDiary(
  title: string,
  cover: Cover,
  vaultKey: Uint8Array,
  milestoneDate?: string | null,
  milestoneLabel?: string | null
): Promise<{diaryId: string; contentKey: Uint8Array}> {
  if (!backend) throw new Error('Cloud service required for shared diaries');
  const {data: vaultRow, error: vaultErr} = await backend
    .from('vaults')
    .select('public_key')
    .maybeSingle();
  checkError(vaultErr);
  if (!vaultRow?.public_key) throw new Error('Vault not found');

  const contentKey = await randomContentKey();
  const wrappedKey = await wrapKeyForRecipient(contentKey, vaultRow.public_key);
  const diaryId = await rpc<string>('create_shared_diary', {
    p_title: title,
    p_cover: cover,
    p_wrapped_key: wrappedKey,
    p_recipient_key: vaultRow.public_key,
    p_milestone_date: milestoneDate || null,
    p_milestone_label: milestoneLabel || null,
  });
  return {diaryId, contentKey};
}

/** Update milestone date and label */
export async function updateSharedDiaryMilestone(
  diaryId: string,
  milestoneDate: string | null,
  milestoneLabel: string | null
): Promise<void> {
  await rpc('update_shared_diary_milestone', {
    p_diary_id: diaryId,
    p_milestone_date: milestoneDate,
    p_milestone_label: milestoneLabel,
  });
}

/** Look up any registered user by email to invite them to a shared diary */
export async function lookupUserForSharing(email: string): Promise<{
  found: boolean;
  id?: string;
  email?: string;
  public_key?: string;
  error?: string;
}> {
  return rpc('lookup_user_for_sharing', { p_email: email.trim().toLowerCase() });
}

/** Invite someone to a shared diary directly by their email address */
export async function inviteMemberDirectly(
  diaryId: string,
  email: string,
  contentKey: Uint8Array,
  role: 'editor' | 'viewer' = 'editor'
): Promise<{ email: string; id: string }> {
  const result = await lookupUserForSharing(email);
  if (!result.found || !result.id || !result.public_key) {
    throw new Error(result.error || `No active Velmory account found for "${email}". Ask them to create an account at Velmory first.`);
  }
  await inviteSharedMember(diaryId, result.id, result.public_key, contentKey, role);
  return { email: result.email ?? email, id: result.id };
}

/** Invite a contact to a shared diary */
export async function inviteSharedMember(
  diaryId: string,
  userId: string,
  recipientPublicKey: string,
  contentKey: Uint8Array,
  role:'editor'|'viewer'='editor'
): Promise<void> {
  const wrappedKey = await wrapKeyForRecipient(contentKey, recipientPublicKey);
  await rpc('invite_shared_member_with_role', {
    p_role:role,
    p_diary_id: diaryId,
    p_user_id: userId,
    p_wrapped_key: wrappedKey,
    p_recipient_key: recipientPublicKey,
  });
}

/** Accept a pending shared diary invitation */
export async function acceptSharedInvite(diaryId: string): Promise<void> {
  await rpc('accept_shared_invite', {p_diary_id: diaryId});
}

/** Remove a member (or leave) from a shared diary */
export async function removeSharedMember(diaryId: string, userId: string): Promise<void> {
  await rpc('remove_shared_member', {p_diary_id: diaryId, p_user_id: userId});
}

/** Delete a shared diary (owner only) */
export async function deleteSharedDiary(diaryId: string): Promise<void> {
  await rpc('delete_shared_diary', {p_diary_id: diaryId});
}

/** Save (upsert) a page in the shared diary */
export async function saveSharedPage(
  diaryId: string,
  page: DiaryPage,
  expectedRevision: number,
  sharedKey: Uint8Array
): Promise<number> {
  const envelope = await encryptSharedPage(page, sharedKey, diaryId);
  return rpc<number>('save_shared_page', {
    p_diary_id: diaryId,
    p_page_id: page.id,
    p_expected_revision: expectedRevision,
    p_envelope: envelope,
    p_deleted: false,
  });
}

/** Delete a page in the shared diary */
export async function deleteSharedPage(
  diaryId: string,
  pageId: string,
  expectedRevision: number,
  sharedKey: Uint8Array
): Promise<void> {
  const placeholder = await encrypt({deleted: true}, sharedKey, sharedPageContext(diaryId, pageId));
  await rpc('save_shared_page', {
    p_diary_id: diaryId,
    p_page_id: pageId,
    p_expected_revision: expectedRevision,
    p_envelope: placeholder,
    p_deleted: true,
  });
}

/** Fetch updated pages from server (incremental sync using cursor) */
export async function fetchSharedPages(
  diaryId: string,
  sharedKey: Uint8Array,
  cursor = 0
): Promise<{
  pages: DiaryPage[];
  entries: DecryptedSharedPage[];
  deletedIds: string[];
  cursor: number;
  hasMore: boolean;
}> {
  const result = await rpc<{
    pages: SharedDiaryPage[];
    cursor: number;
    has_more: boolean;
  }>('fetch_shared_pages', {p_diary_id: diaryId, p_cursor: cursor, p_limit: 100});

  const pages: DiaryPage[] = [];
  const entries: DecryptedSharedPage[] = [];
  const deletedIds: string[] = [];

  for (const sp of result.pages) {
    if (sp.deleted) {
      deletedIds.push(sp.page_id);
    } else {
      try {
        const page = await decryptSharedPage(sp.envelope, sharedKey, diaryId, sp.page_id);
        pages.push(page);
        entries.push({
          page,
          authorId: sp.author_id,
          revision: sp.revision,
          updatedAt: sp.updated_at,
        });
      } catch {
        // Skip corrupted or undecryptable pages
      }
    }
  }

  return {pages, entries, deletedIds, cursor: result.cursor, hasMore: result.has_more};
}

export async function setSharedMemberRole(diaryId:string,userId:string,role:'editor'|'viewer') {
 await rpc('set_shared_member_role',{p_diary_id:diaryId,p_user_id:userId,p_role:role});
}
export async function shareExistingDiary(diary:import('./types').Diary,vaultKey:Uint8Array) {
 if(diary.pages.some(p=>p.seal||p.objects.some(o=>o.audio)))throw new Error('Unlock and unseal protected pages and remove private audio attachments from a copy before sharing. Those private media references cannot yet be transferred safely; your original diary has not been changed.');
 const created=await createSharedDiary(diary.title,diary.cover,vaultKey);
 try {
  for(const page of diary.pages)await saveSharedPage(created.diaryId,page,0,created.contentKey);
  return created.diaryId;
 }catch(error){await deleteSharedDiary(created.diaryId);throw error}
 finally{created.contentKey.fill(0)}
}
