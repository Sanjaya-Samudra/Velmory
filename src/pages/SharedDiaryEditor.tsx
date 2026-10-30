import BookPagePreview from '../components/BookPagePreview';
import {useEffect, useState, useCallback, useRef} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {ArrowLeft, RefreshCw, Users, X, Printer, LockKeyhole, Sparkles, Heart} from 'lucide-react';
import {useSession} from '../core/Session';
import {backend} from '../core/backend';
import {
  listSharedDiaries,
  fetchSharedPages,
  saveSharedPage,
  deleteSharedPage,
  getSharedKey,
  type SharedDiaryRecord,
} from '../core/sharedDiary';
import {newPage, type Diary, type DiaryPage} from '../core/types';
import {Loading, Message} from '../components/Status';
import {preparePrint} from '../core/print';
import Editor from './Editor';

interface OnlineUser {
  userId: string;
  email: string;
  activePageId?: string;
  onlineAt: string;
}

function buildDiary(record: SharedDiaryRecord, pages: DiaryPage[]): Diary {
  return {
    id: record.id,
    title: record.title,
    cover: record.cover,
    createdAt: record.created_at,
    archived: false,
    pages: pages.length > 0 ? pages : [newPage()],
  };
}

function formatMilestone(dateStr: string, label?: string | null): string {
  const target = new Date(dateStr);
  const now = new Date();
  const diffTime = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const passedDays = Math.abs(diffDays);
    return `💖 ${passedDays} ${passedDays === 1 ? 'day' : 'days'} ${label || 'together'}`;
  } else if (diffDays === 0) {
    return `🎉 Today is ${label || 'your milestone'}!`;
  } else {
    return `🗓️ ${diffDays} ${diffDays === 1 ? 'day' : 'days'} until ${label || 'our milestone'}`;
  }
}

export default function SharedDiaryEditor() {
  const {diaryId:routeId} = useParams<{diaryId: string}>();
 const diaryId=routeId??location.pathname.split('/')[3];
  const {account, key} = useSession();
  const navigate = useNavigate();

  const [record, setRecord] = useState<SharedDiaryRecord | null>(null);
  const [pages, setPages] = useState<DiaryPage[]>([]);
  const [authorMap, setAuthorMap] = useState<Map<string, string>>(new Map());
  const [sharedKey, setSharedKey] = useState<Uint8Array | null>(null);
  const [pageRevisions, setPageRevisions] = useState<Map<string, number>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Loading…');
  const [showMembers, setShowMembers] = useState(false);
 const [readIndex,setReadIndex]=useState(0);
  const [onlineMembers, setOnlineMembers] = useState<OnlineUser[]>([]);

  // Time capsule modal
  const [capsulePage, setCapsulePage] = useState<DiaryPage | null>(null);
  const [capsuleDate, setCapsuleDate] = useState('');

  const syncCursor = useRef(0);
  const mounted = useRef(true);
  const channelRef = useRef<any>(null);

  const pagesRef = useRef<DiaryPage[]>([]);
  const revisionsRef = useRef<Map<string, number>>(new Map());
  pagesRef.current = pages;
  revisionsRef.current = pageRevisions;

  const load = useCallback(async () => {
    if (!key || !diaryId || account?.local) return;
    const all = await listSharedDiaries();
    const found = all.find(d => d.id === diaryId);
    if (!found) {
      setError('Shared diary not found or you are not a member.');
      setLoaded(true);
      return;
    }
    if (found.status !== 'active') {
      setError('You have a pending invitation. Accept it first from the Shared Diaries page.');
      setLoaded(true);
      return;
    }
    setRecord(found);
    const sk = await getSharedKey(found.id, found.my_wrapped_key, key);
    setSharedKey(sk);
    return {found, sk};
  }, [key, diaryId, account?.id]);

  const sync = useCallback(
    async (rec?: SharedDiaryRecord, sk?: Uint8Array) => {
      const r = rec ?? record;
      const k = sk ?? sharedKey;
      if (!r || !k || syncing) return;
      setSyncing(true);
      setSyncStatus('Syncing…');
      try {
        const membership=(await listSharedDiaries()).find(d=>d.id===r.id&&d.status==='active');
        if(!membership){setPages([]);setSharedKey(null);setError('Your access to this diary has been removed.');setLoaded(true);return}
        setRecord(membership);
        let cursor = syncCursor.current;
        let hasMore = true;
        const nextPages = new Map(pagesRef.current.map(p => [p.id, p]));
        const nextRevisions = new Map(revisionsRef.current);
        const nextAuthors = new Map(authorMap);

        while (hasMore) {
          const result = await fetchSharedPages(r.id, k, cursor);
          for (const entry of result.entries) {
            nextPages.set(entry.page.id, entry.page);
            nextRevisions.set(entry.page.id, entry.revision);
            if (entry.authorId) {
              const member = r.members.find(m => m.user_id === entry.authorId);
              nextAuthors.set(entry.page.id, member?.email ?? 'Collaborator');
            }
          }
          for (const id of result.deletedIds) {
            nextPages.delete(id);
            nextRevisions.delete(id);
            nextAuthors.delete(id);
          }
          cursor = result.cursor;
          hasMore = result.hasMore;
        }
        syncCursor.current = cursor;
        if (mounted.current) {
          const sorted = [...nextPages.values()].sort((a, b) =>
            a.date.localeCompare(b.date)
          );
          setPages(sorted);
          setPageRevisions(nextRevisions);
          setAuthorMap(nextAuthors);
          setSyncStatus('Synced securely');
          setLoaded(true);
        }
      } catch {
        if (mounted.current){setSyncStatus('Sync failed');setLoaded(true);setError('Unable to synchronize this shared diary. Reopen it to retry.');}
      } finally {
        if (mounted.current) setSyncing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [record, sharedKey, syncing, authorMap]
  );

  useEffect(() => {
    mounted.current = true;
    void load()
      .then(result => result && sync(result.found, result.sk))
      .catch(e => setError((e as Error).message));
    return () => {
      mounted.current = false;
    };
  }, [key, diaryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll through authorized RPCs; do not broadcast membership on public channels.
  // Polling fallback every 30s
  useEffect(() => {
    if (!loaded) return;
    const timer = setInterval(() => void sync().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [loaded, sync]);

  const handleChange = async (updated: Diary) => {
    if (!sharedKey || !record) return;
    if(record.my_role==='viewer')throw new Error('This diary is read-only.');
    const newRevisions = new Map(pageRevisions);

    for (const page of updated.pages) {
      const rev = pageRevisions.get(page.id) ?? 0;
      if(JSON.stringify(pagesRef.current.find(p=>p.id===page.id))===JSON.stringify(page))continue;
      try {
        // Stamp author if not set
        if (!page.authorName && account?.email) {
          page.authorName = account.email.split('@')[0];
        }
        const newRev = await saveSharedPage(record.id, page, rev, sharedKey);
        newRevisions.set(page.id, newRev);

        // Notify active collaborators via Realtime broadcast
        channelRef.current?.send({
          type: 'broadcast',
          event: 'page-updated',
          payload: {pageId: page.id},
        });
      } catch (e) {
        if ((e as Error).message.includes('revision_conflict')) {
          setSyncStatus('Sync conflict — refreshing…');
          void sync();
        } else {
          setError('Save failed: ' + (e as Error).message);
        }
        throw e;
      }
    }

    // Handle deleted pages
    for (const [pageId, rev] of pageRevisions) {
      if (!updated.pages.some(p => p.id === pageId)) {
        try {
          await deleteSharedPage(record.id, pageId, rev, sharedKey);
          channelRef.current?.send({
            type: 'broadcast',
            event: 'page-updated',
            payload: {pageId, deleted: true},
          });
        } catch(e) {
          setError('Page deletion failed. Please retry.');
          throw e;
        }
        newRevisions.delete(pageId);
      }
    }

    setPages(updated.pages);
    setPageRevisions(newRevisions);
    setSyncStatus('Saved securely');
  };

  const handleExportPrint = () => {
    if (!record) return;
    const diary = buildDiary(record, pages);
    preparePrint([diary]);
  };

  const handleSealTimeCapsule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!capsulePage) return;
    const updated = pages.map(p =>
      p.id === capsulePage.id ? {...p, timeCapsuleDate: capsuleDate} : p
    );
    void handleChange(buildDiary(record!, updated));
    setCapsulePage(null);
    setCapsuleDate('');
  };

  if (account?.local) {
    return (
      <div className="empty-state">
        <Users size={32} />
        <h2>Cloud account required</h2>
        <p>Shared diaries are only available with a cloud account.</p>
      </div>
    );
  }

  if (!loaded) return <Loading />;

  if (error) {
    return (
      <div className="empty-state">
        <Message error>{error}</Message>
        <button
          className="button glass"
          onClick={() => navigate('/app/shared-diaries')}
        >
          <ArrowLeft size={16} /> Back to shared diaries
        </button>
      </div>
    );
  }

  if (!record || !sharedKey) return <Loading />;

  const diary = buildDiary(record, pages);

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      {/* Collaboration Top Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.65rem 1.25rem',
          borderBottom: '1px solid var(--border,rgba(255,255,255,0.08))',
          background: 'rgba(0,0,0,0.15)',
          flexWrap: 'wrap',
        }}
      >
        <button
          className="icon-button"
          onClick={() => navigate('/app/shared-diaries')}
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </button>
        <span style={{fontWeight: 600, fontSize: '0.95rem'}}>{record.title}</span>

        {/* Milestone Indicator */}
        {record.milestone_date && (
          <span
            style={{
              fontSize: '0.78rem',
              color: 'var(--gold,#d4af37)',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(212,175,55,0.1)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Heart size={12} /> {formatMilestone(record.milestone_date, record.milestone_label)}
          </span>
        )}

        <div style={{flex: 1}} />

        {/* Live presence indicator */}
        {onlineMembers.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.78rem',
              color: '#4ade80',
            }}
            title={onlineMembers.map(u => u.email).join(', ')}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#4ade80',
                boxShadow: '0 0 8px #4ade80',
              }}
            />
            <span>{onlineMembers[0].email.split('@')[0]} is co-writing</span>
          </div>
        )}

        <span className="sync-status" style={{fontSize: '0.75rem', opacity: 0.7}}>
          {syncStatus}
        </span>

        {/* Print / Keepsake Export */}
        <button
          className="icon-button"
          onClick={handleExportPrint}
          aria-label="Export keepsake book"
          title="Print or export keepsake book"
        >
          <Printer size={16} />
        </button>

        {/* Sync button */}
        <button
          className="icon-button"
          onClick={() => void sync()}
          aria-label="Sync"
          disabled={syncing}
        >
          <RefreshCw size={16} />
        </button>

        {/* Members toggle */}
        <button
          className="icon-button"
          onClick={() => setShowMembers(m => !m)}
          aria-label="Members"
          title="Diary members"
        >
          <Users size={16} />
        </button>
      </div>

      {error && (
        <Message error>
          {error}
          <button className="dismiss" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </Message>
      )}

      {/* Members panel */}
      {showMembers && (
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border,rgba(255,255,255,0.08))',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <p className="eyebrow" style={{marginBottom: '0.5rem'}}>
            CO-AUTHORS & MEMBERS ({record.members.filter(m => m.status === 'active').length})
          </p>
          <div style={{display: 'flex', gap: '1rem', flexWrap: 'wrap'}}>
            {record.members
              .filter(m => m.status === 'active')
              .map(m => {
                const isOnline = onlineMembers.some(o => o.userId === m.user_id);
                return (
                  <div
                    key={m.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '4px 10px',
                      background: 'rgba(255,255,255,0.04)',
                      borderRadius: '16px',
                    }}
                  >
                    <span
                      className="avatar"
                      style={{
                        width: 22,
                        height: 22,
                        fontSize: '0.65rem',
                        position: 'relative',
                      }}
                    >
                      {m.email[0].toUpperCase()}
                      {isOnline && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: -1,
                            right: -1,
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#4ade80',
                          }}
                        />
                      )}
                    </span>
                    <span style={{fontSize: '0.85rem'}}>{m.email}</span>
                    <small style={{opacity: 0.5}}>· {m.role}</small>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Editor Body */}
      <div style={{flex: 1, overflow: 'hidden'}}>
        {record.my_role==='viewer'?(
          <div className="shared-reading" style={{padding:'20px',textAlign:'center'}}>
            <p style={{marginBottom:'1rem',color:'#d2bd91',fontSize:'0.85rem'}}>You have view-only access to this keepsake diary.</p>
            <div style={{display:'flex',justifyContent:'center',alignItems:'center',margin:'auto'}}>
              <div style={{width:500*Math.min(1.2,Math.max(0.65,innerWidth<700?(innerWidth-32)/500:0.95)),height:700*Math.min(1.2,Math.max(0.65,innerWidth<700?(innerWidth-32)/500:0.95)),position:'relative'}}>
                <BookPagePreview
                  page={pages[Math.min(readIndex,Math.max(0,pages.length-1))]}
                  number={readIndex+1}
                  title={record.title}
                  scale={Math.min(1.2,Math.max(0.65,innerWidth<700?(innerWidth-32)/500:0.95))}
                  side="left"
                />
              </div>
            </div>
            <nav aria-label="Reading pages" style={{display:'flex',justifyContent:'center',alignItems:'center',gap:'1rem',marginTop:'1.5rem'}}>
              <button className="button glass" disabled={readIndex===0} onClick={()=>setReadIndex(i=>i-1)}>Previous</button>
              <span style={{fontSize:'0.85rem',color:'#eed8ae'}}>Page {readIndex+1} of {pages.length}</span>
              <button className="button glass" disabled={readIndex>=pages.length-1} onClick={()=>setReadIndex(i=>i+1)}>Next</button>
            </nav>
          </div>
        ):(
          <Editor diary={diary} onChange={handleChange} />
        )}
      </div>

      {/* Time Capsule Modal */}
      {capsulePage && (
        <div className="modal-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) setCapsulePage(null);}}>
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="dialog-close icon-button" aria-label="Close" onClick={() => setCapsulePage(null)}>
              <X />
            </button>
            <p className="eyebrow">A MEMORY SEALED IN TIME</p>
            <h2>Seal as Time Capsule</h2>
            <p>
              Seal "{capsulePage.title}" until a future date (such as an anniversary or Valentine's Day). Both of you can view that it is sealed, and unlock it together when the day arrives.
            </p>
            <form onSubmit={handleSealTimeCapsule}>
              <label>Unlock Date
                <input
                  type="date"
                  required
                  min={new Date().toISOString().slice(0, 10)}
                  value={capsuleDate}
                  onChange={e => setCapsuleDate(e.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="button glass" type="button" onClick={() => setCapsulePage(null)}>
                  Cancel
                </button>
                <button className="button gold" type="submit">
                  <LockKeyhole size={16} /> Seal time capsule
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
