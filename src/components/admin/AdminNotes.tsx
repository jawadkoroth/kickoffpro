'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/useToast';

interface AdminNote {
  id: string;
  order_id: string;
  admin_id: string;
  admin_email: string;
  admin_name?: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface AdminNotesProps {
  orderId: string;
}

const MAX_NOTE_LENGTH = 1000;
const GRACE_PERIOD_MINUTES = 5;

export default function AdminNotes({ orderId }: AdminNotesProps) {
  const [notes, setNotes] = useState<AdminNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const { showToast } = useToast();

  const fetchNotes = useCallback(async () => {
    if (!orderId) return;
    setIsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('admin_notes')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setNotes(data || []);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const canEdit = (note: AdminNote): boolean => {
    const createdAt = new Date(note.created_at).getTime();
    const now = Date.now();
    const diffMinutes = (now - createdAt) / (1000 * 60);
    return diffMinutes <= GRACE_PERIOD_MINUTES;
  };

  const getInitials = (email: string): string => {
    const name = email.split('@')[0];
    const parts = name.split(/[._-]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        showToast('Authentication required', 'error');
        return;
      }

      const { error } = await supabase.from('admin_notes').insert({
        order_id: orderId,
        admin_id: user.id,
        admin_email: user.email || 'unknown',
        content: newNote.trim(),
      });

      if (error) throw error;

      setNewNote('');
      await fetchNotes();
      showToast('Note added', 'success');
    } catch (err) {
      console.error('Failed to add note:', err);
      showToast('Failed to add note', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = async (noteId: string) => {
    if (!editContent.trim()) return;
    
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('admin_notes')
        .update({ content: editContent.trim() })
        .eq('id', noteId);

      if (error) throw error;

      setEditingId(null);
      setEditContent('');
      await fetchNotes();
      showToast('Note updated', 'success');
    } catch (err) {
      console.error('Failed to update note:', err);
      showToast('Failed to update note', 'error');
    }
  };

  const startEdit = (note: AdminNote) => {
    if (!canEdit(note)) {
      showToast('Edit window expired (5 minutes)', 'error');
      return;
    }
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const formatTime = (date: string): string => {
    const d = new Date(date);
    const now = new Date();
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 1) {
      const mins = Math.floor(diffHours * 60);
      return mins < 1 ? 'Just now' : `${mins}m ago`;
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)}h ago`;
    } else {
      return d.toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Loading notes…
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--bg-secondary, #0A244D)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      overflow: 'visible',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ 
            fontSize: '0.6875rem', 
            fontWeight: 600, 
            letterSpacing: '0.12em',
            color: 'var(--text-muted, #9A9A9A)',
            textTransform: 'uppercase',
          }}>
            Internal Notes
          </span>
          <span style={{
            fontSize: '0.625rem',
            padding: '2px 8px',
            background: 'rgba(212,175,55,0.15)',
            color: 'var(--gold, #D4AF37)',
            borderRadius: '4px',
            fontWeight: 500,
            letterSpacing: '0.05em',
          }}>
            ADMIN ONLY
          </span>
        </div>
        <span style={{ 
          fontSize: '0.75rem', 
          color: 'var(--text-muted, #9A9A9A)',
          fontFamily: 'var(--font-mono, ui-monospace), monospace',
        }}>
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>

      {/* Notes Thread */}
      <div style={{ 
        maxHeight: '600px', 
        overflowY: 'auto',
        padding: notes.length === 0 ? '32px 20px' : '16px 0',
      }}>
        {notes.length === 0 ? (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted, #9A9A9A)',
            fontSize: '0.875rem',
          }}>
            <div style={{ 
              fontSize: '1.5rem', 
              marginBottom: '12px',
              opacity: 0.5,
            }}>
              📝
            </div>
            <div>No internal notes yet</div>
            <div style={{ 
              fontSize: '0.75rem', 
              marginTop: '4px',
              opacity: 0.6,
            }}>
              Add operational details, customer context, or fulfillment notes
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {notes.map((note, index) => {
              const isEditing = editingId === note.id;
              const editable = canEdit(note);
              const isLast = index === notes.length - 1;
              
              return (
                <div 
                  key={note.id}
                  style={{
                    padding: '14px 20px',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-color)',
                    background: index % 2 === 0 ? 'transparent' : 'var(--hover-wash)',
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Avatar */}
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'var(--gold, #D4AF37)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: '#000',
                      flexShrink: 0,
                      letterSpacing: '0.02em',
                    }}>
                      {getInitials(note.admin_email)}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Meta */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '6px',
                        flexWrap: 'wrap',
                      }}>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          letterSpacing: '-0.01em',
                        }}>
                          {note.admin_email.split('@')[0]}
                        </span>
                        <span style={{
                          fontSize: '0.625rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono, ui-monospace), monospace',
                        }}>
                          {formatTime(note.created_at)}
                        </span>
                        {editable && !isEditing && (
                          <button
                            onClick={() => startEdit(note)}
                            style={{
                              fontSize: '0.625rem',
                              color: 'var(--gold, #D4AF37)',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '2px 6px',
                              marginLeft: 'auto',
                              opacity: 0.7,
                              transition: 'opacity 150ms ease',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                          >
                            EDIT
                          </button>
                        )}
                      </div>

                      {/* Note Content */}
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            style={{
                              width: '100%',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '8px',
                              padding: '10px 12px',
                              fontSize: '0.8125rem',
                              color: 'var(--text-primary)',
                              fontFamily: 'inherit',
                              lineHeight: 1.5,
                              resize: 'vertical',
                              minHeight: '60px',
                            }}
                            autoFocus
                          />
                          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditContent('');
                              }}
                              style={{
                                fontSize: '0.6875rem',
                                padding: '6px 12px',
                                background: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                color: 'var(--text-muted)',
                                cursor: 'pointer',
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleEdit(note.id)}
                              style={{
                                fontSize: '0.6875rem',
                                padding: '6px 12px',
                                background: 'var(--gold, #D4AF37)',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#000',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          fontSize: '0.8125rem',
                          lineHeight: 1.6,
                          color: 'var(--text-primary)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {note.content}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Note Form */}
      <form 
        onSubmit={handleSubmit}
        style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-color)',
          background: 'rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', gap: '12px' }}>
          <textarea
            value={newNote}
            onChange={(e) => {
              if (e.target.value.length <= MAX_NOTE_LENGTH) {
                setNewNote(e.target.value);
              }
            }}
            placeholder="Add an internal note..."
            style={{
              flex: 1,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              padding: '12px 14px',
              fontSize: '0.8125rem',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              resize: 'vertical',
              minHeight: '48px',
              maxHeight: '120px',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.metaKey) {
                handleSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!newNote.trim() || isSubmitting}
            style={{
              padding: '12px 20px',
              background: newNote.trim() ? 'var(--gold, #D4AF37)' : 'rgba(212,175,55,0.3)',
              border: 'none',
              borderRadius: '10px',
              color: '#000',
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              cursor: newNote.trim() && !isSubmitting ? 'pointer' : 'not-allowed',
              alignSelf: 'flex-end',
              transition: 'all 150ms ease',
              height: 'fit-content',
            }}
          >
            {isSubmitting ? 'ADDING…' : 'ADD NOTE'}
          </button>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '10px',
          fontSize: '0.6875rem',
          color: 'var(--text-muted)',
        }}>
          <span>Cmd+Enter to submit quickly • {newNote.length}/{MAX_NOTE_LENGTH}</span>
          <span style={{ opacity: 0.6 }}>Visible to admins only</span>
        </div>
      </form>
    </div>
  );
}
