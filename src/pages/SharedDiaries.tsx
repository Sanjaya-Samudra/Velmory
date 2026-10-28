import {useEffect, useState, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {Users, Plus, UserPlus, Trash2, LogOut, Check, X, Calendar, Heart} from 'lucide-react';
import {useSession} from '../core/Session';
import {backend, checkError} from '../core/backend';
import {
  listSharedDiaries,
  createSharedDiary,
  inviteSharedMember,
  acceptSharedInvite,
  removeSharedMember,
  deleteSharedDiary,
  updateSharedDiaryMilestone,
  getSharedKey,
  type SharedDiaryRecord,
} from '../core/sharedDiary';
import {Message, Loading} from '../components/Status';
import type {Cover} from '../core/types';
import PublishedCovers from '../components/PublishedCovers';

interface Contact {
  id: string;
  email: string;
  public_key: string;
  status: string;
  direction: string;
  invitation_id: string;
}

const covers: Cover[] = ['navy', 'forest', 'burgundy', 'charcoal', 'rose'];

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

export default function SharedDiaries() {
  const {account, key} = useSession();
  const navigate = useNavigate();

  const [diaries, setDiaries] = useState<SharedDiaryRecord[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Create modal state
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCover, setNewCover] = useState<Cover>('navy');
  const [newCoverArt, setNewCoverArt] = useState('');
  const [newMilestoneDate, setNewMilestoneDate] = useState('');
  const [newMilestoneLabel, setNewMilestoneLabel] = useState('');

  // Milestone edit state
  const [editingMilestone, setEditingMilestone] = useState<SharedDiaryRecord | null>(null);
  const [editMilestoneDate, setEditMilestoneDate] = useState('');
  const [editMilestoneLabel, setEditMilestoneLabel] = useState('');

  // Invite modal state
  const [inviting, setInviting] = useState<SharedDiaryRecord | null>(null);
  const [inviteContact, setInviteContact] = useState('');

  // Delete confirm state
  const [confirmDelete, setConfirmDelete] = useState<SharedDiaryRecord | null>(null);

  const load = useCallback(async () => {
    if (!backend || account?.local) return;
    const data = await listSharedDiaries();
    setDiaries(data);
    const b = await backend.rpc('list_contacts');
    checkError(b.error);
    setContacts(((b.data ?? []) as Contact[]).filter((c: Contact) => c.status === 'accepted'));
    setLoaded(true);
  }, [account?.id]);

  useEffect(() => {
    if (account?.local) {
      setLoaded(true);
      return;
    }
    void load().catch(e => setError((e as Error).message));
  }, [load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      if (!key) throw new Error('Vault locked');
      await createSharedDiary(
        newTitle.trim(),
        newCover,
        key,
        newMilestoneDate || null,
        newMilestoneLabel.trim() || null
      );
      setCreating(false);
      setNewTitle('');
      setNewCoverArt('');
      setNewMilestoneDate('');
      setNewMilestoneLabel('');
      setNotice('Shared diary created! Invite a contact to start writing together.');
    });
  };

  const handleSaveMilestone = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      if (!editingMilestone) return;
      await updateSharedDiaryMilestone(
        editingMilestone.id,
        editMilestoneDate || null,
        editMilestoneLabel.trim() || null
      );
      setEditingMilestone(null);
      setNotice('Relationship milestone updated!');
    });
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    void act(async () => {
      if (!inviting || !key) return;
      const contact = contacts.find(c => c.id === inviteContact);
      if (!contact) throw new Error('Choose a contact');
      const sharedKey = await getSharedKey(inviting.id, inviting.my_wrapped_key, key);
      await inviteSharedMember(inviting.id, contact.id, contact.public_key, sharedKey);
      setInviting(null);
      setNotice(`Invitation sent to ${contact.email}. They can accept from their Shared Diaries page.`);
    });
  };

  const handleAccept = (diary: SharedDiaryRecord) => {
    void act(async () => {
      await acceptSharedInvite(diary.id);
      setNotice('You joined the shared diary!');
    });
  };

  const handleDecline = (diary: SharedDiaryRecord) => {
    void act(async () => {
      await removeSharedMember(diary.id, account!.id);
      setNotice('Invitation declined.');
    });
  };

  const handleLeave = (diary: SharedDiaryRecord) => {
    void act(async () => {
      await removeSharedMember(diary.id, account!.id);
      setNotice('You left the shared diary.');
    });
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    const d = confirmDelete;
    setConfirmDelete(null);
    void act(async () => {
      await deleteSharedDiary(d.id);
      setNotice('Shared diary deleted.');
    });
  };

  const handleOpen = (diary: SharedDiaryRecord) => {
    navigate('/app/shared-diary/' + diary.id);
  };

  if (!loaded) return <Loading />;

  const pending = diaries.filter(d => d.status === 'pending');
  const active = diaries.filter(d => d.status === 'active');

  return (
    <div className="library-room">
      <section className="room-heading">
        <div>
          <p className="eyebrow">TOGETHER, WE REMEMBER</p>
          <h1>Shared diaries.</h1>
          <p>A space where two hearts can write the same story.</p>
        </div>
        {!account?.local && (
          <button className="button gold" onClick={() => setCreating(true)}>
            <Plus size={16} /> New shared diary
          </button>
        )}
      </section>

      {error && <Message error>{error}<button className="dismiss" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></Message>}
      {notice && <Message>{notice}</Message>}

      {account?.local && (
        <Message>Shared diaries require a cloud account. Sign in to start writing together with someone you love.</Message>
      )}

      {!account?.local && pending.length > 0 && (
        <section style={{marginBottom: '2rem'}}>
          <p className="eyebrow" style={{marginBottom: '1rem'}}>PENDING INVITATIONS</p>
          <div className="letter-grid">
            {pending.map(d => (
              <article className="letter-card" key={d.id}>
                <div className="envelope-art">
                  <div className={`cover-swatch ${d.cover}`} aria-hidden="true" style={{width:48,height:64,borderRadius:4,margin:'0 auto 8px'}}><span>V</span></div>
                </div>
                <div className="letter-info">
                  <p className="eyebrow">INVITATION</p>
                  <h2>{d.title}</h2>
                  <p>{d.members.find(m => m.role === 'owner')?.email ?? 'A friend'} invited you</p>
                  <div className="letter-actions">
                    <button className="button gold small" disabled={busy} onClick={() => handleAccept(d)}><Check size={14}/> Accept</button>
                    <button className="text-link" disabled={busy} onClick={() => handleDecline(d)}>Decline</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {!account?.local && active.length > 0 && (
        <section>
          <div className="library-shelf" aria-label="Shared diary shelf">
            <div className="shelf-light" />
            <div className="book-collection">
              {active.map(d => {
                const activeCount = d.members.filter(m => m.status === 'active').length;
                return (
                  <div className="shelf-item" key={d.id}>
                    <button
                      className={`book-cover cover-${d.cover}`}
                      onClick={() => handleOpen(d)}
                      aria-label={`Open ${d.title}`}
                      style={{cursor:'pointer',border:'none',background:'none',padding:0}}
                    >
                      <div className={`cover-swatch ${d.cover}`} style={{width:80,height:110,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.5rem',color:'white',boxShadow:'0 4px 16px rgba(0,0,0,0.18)'}}>V</div>
                    </button>
                    <p><strong>{d.title}</strong></p>
                    <p><Users size={13}/> {activeCount} {activeCount === 1 ? 'person' : 'people'} · <small>{d.my_role === 'owner' ? 'Your diary' : 'Editor'}</small></p>
                    {d.milestone_date && (
                      <p style={{fontSize:'0.82rem',color:'var(--gold,#d4af37)',margin:'4px 0'}}>
                        {formatMilestone(d.milestone_date, d.milestone_label)}
                      </p>
                    )}
                    <div className="diary-actions">
                      <button className="diary-action" onClick={() => handleOpen(d)}>Open</button>
                      <button
                        className="diary-action"
                        onClick={() => {
                          setEditingMilestone(d);
                          setEditMilestoneDate(d.milestone_date || '');
                          setEditMilestoneLabel(d.milestone_label || '');
                        }}
                        title="Set relationship date or countdown"
                      >
                        <Heart size={13}/> Milestone
                      </button>
                      {d.my_role === 'owner' && (
                        <>
                          <button className="diary-action" onClick={() => {setInviting(d); setInviteContact(contacts[0]?.id ?? '');}}>
                            <UserPlus size={13}/> Invite
                          </button>
                          <button className="diary-action delete-diary" onClick={() => setConfirmDelete(d)}>
                            <Trash2 size={13}/> Delete
                          </button>
                        </>
                      )}
                      {d.my_role === 'editor' && (
                        <button className="diary-action" onClick={() => handleLeave(d)}>
                          <LogOut size={13}/> Leave
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {!account?.local && active.length === 0 && pending.length === 0 && (
        <div className="empty-state">
          <Users size={32}/>
          <h2>No shared diaries yet.</h2>
          <p>Create a shared diary and invite someone you love to write together.</p>
          <button className="button gold" onClick={() => setCreating(true)}><Plus size={16}/> Create a shared diary</button>
        </div>
      )}

      {/* Create modal */}
      {creating && (
        <div className="modal-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) setCreating(false);}}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-shared-title">
            <button className="dialog-close icon-button" aria-label="Close" onClick={() => setCreating(false)}><X /></button>
            <p className="eyebrow">A NEW SHARED CHAPTER</p>
            <h2 id="create-shared-title">Start writing together.</h2>
            <form onSubmit={handleCreate}>
              <label>Diary name
                <input autoFocus required maxLength={65} value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Our story, 2026" />
              </label>

              <fieldset className="cover-picker">
                <legend>Choose a cover</legend>
                {covers.map(c => (
                  <button type="button" key={c} className={`cover-swatch ${c} ${newCover === c ? 'selected' : ''}`}
                    onClick={() => {setNewCover(c); setNewCoverArt('');}} aria-label={c + ' cover'} aria-pressed={newCover === c}>
                    <span>V</span>
                  </button>
                ))}
              </fieldset>
              <PublishedCovers selected={newCoverArt} onChoose={setNewCoverArt} />

              <div style={{marginTop:'1rem',padding:'0.75rem',background:'rgba(255,255,255,0.03)',borderRadius:'8px'}}>
                <p className="eyebrow" style={{marginBottom:'0.5rem'}}>RELATIONSHIP MILESTONE (OPTIONAL)</p>
                <label>Special Date (anniversary or start date)
                  <input type="date" value={newMilestoneDate} onChange={e => setNewMilestoneDate(e.target.value)} />
                </label>
                <label>Label
                  <input maxLength={40} value={newMilestoneLabel} onChange={e => setNewMilestoneLabel(e.target.value)} placeholder="together, wedding anniversary…" />
                </label>
              </div>

              <button className="button gold full" style={{marginTop:'1rem'}} type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create shared diary'}</button>
            </form>
          </section>
        </div>
      )}

      {/* Milestone edit modal */}
      {editingMilestone && (
        <div className="modal-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) setEditingMilestone(null);}}>
          <section className="dialog" role="dialog" aria-modal="true">
            <button className="dialog-close icon-button" aria-label="Close" onClick={() => setEditingMilestone(null)}><X /></button>
            <p className="eyebrow">RELATIONSHIP COUNTDOWN</p>
            <h2>Milestone for "{editingMilestone.title}"</h2>
            <form onSubmit={handleSaveMilestone}>
              <label>Special Date
                <input type="date" required value={editMilestoneDate} onChange={e => setEditMilestoneDate(e.target.value)} />
              </label>
              <label>Milestone Label
                <input maxLength={40} value={editMilestoneLabel} onChange={e => setNewMilestoneLabel(e.target.value)} placeholder="together, wedding anniversary…" />
              </label>
              <div className="dialog-actions">
                <button className="button glass" type="button" onClick={() => setEditingMilestone(null)}>Cancel</button>
                <button className="button gold" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save milestone'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Invite modal */}
      {inviting && (
        <div className="modal-backdrop" onMouseDown={e => {if (e.target === e.currentTarget) setInviting(null);}}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
            <button className="dialog-close icon-button" aria-label="Close" onClick={() => setInviting(null)}><X /></button>
            <p className="eyebrow">INVITE SOMEONE SPECIAL</p>
            <h2 id="invite-title">Invite to "{inviting.title}"</h2>
            {contacts.length === 0 ? (
              <p>You need an accepted contact first. Go to <strong>Future Letters</strong> to invite someone by email.</p>
            ) : (
              <form onSubmit={handleInvite}>
                <label>Choose a contact
                  <select value={inviteContact} onChange={e => setInviteContact(e.target.value)} required>
                    <option value="">— select —</option>
                    {contacts
                      .filter(c => !inviting.members.some(m => m.user_id === c.id && m.status !== 'removed'))
                      .map(c => <option key={c.id} value={c.id}>{c.email}</option>)}
                  </select>
                </label>
                <p className="security-note">They will receive an invitation. Only accepted contacts can be invited. The shared diary content key is wrapped with their vault public key — only they can decrypt it.</p>
                <button className="button gold full" type="submit" disabled={busy}>{busy ? 'Inviting…' : 'Send invitation'}</button>
              </form>
            )}
          </section>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">YOUR CHOICE</p>
            <h2>Delete "{confirmDelete.title}"?</h2>
            <p>This permanently deletes the shared diary and all its pages for all members. This cannot be undone.</p>
            <div className="dialog-actions">
              <button className="button glass" onClick={() => setConfirmDelete(null)}>Keep diary</button>
              <button className="button danger" disabled={busy} onClick={handleDelete}>{busy ? 'Deleting…' : 'Delete shared diary'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
