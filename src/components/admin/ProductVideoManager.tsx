'use client';

import { useRef, useState } from 'react';
import { getPublicUrl, deleteFile } from '@/lib/media';

interface ProductVideoManagerProps {
  value: string[];
  onChange: (urls: string[]) => void;
  maxVideos?: number;
}

export default function ProductVideoManager({
  value,
  onChange,
  maxVideos = 3,
}: ProductVideoManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const canAddMore = value.length < maxVideos;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!canAddMore) {
      setError(`Maximum ${maxVideos} videos allowed.`);
      return;
    }

    const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowed.includes(file.type)) {
      setError('Unsupported format. Please upload MP4, WebM, or MOV.');
      return;
    }

    if (file.size > 35 * 1024 * 1024) {
      setError('Video file exceeds 35 MB limit.');
      return;
    }

    setError('');
    setUploading(true);
    try {
      const signRes = await fetch('/api/admin/upload/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: file.type,
          fileSize: file.size,
          folder: 'videos',
        }),
      });
      const signData = await signRes.json().catch(() => ({}));
      if (!signRes.ok || !signData.signedUrl || !signData.path) {
        throw new Error(signData.error || 'Failed to prepare upload');
      }

      const putRes = await fetch(signData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!putRes.ok) {
        throw new Error(`Storage upload failed (${putRes.status})`);
      }

      onChange([...value, signData.path]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload video');
    } finally {
      setUploading(false);
    }
  }

  function handleAddUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!canAddMore) {
      setError(`Maximum ${maxVideos} videos allowed.`);
      return;
    }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('/')) {
      setError('Video URL must start with https://, http://, or /');
      return;
    }
    setError('');
    onChange([...value, trimmed]);
    setUrlInput('');
  }

  async function handleRemove(idx: number) {
    const target = value[idx];
    const next = value.filter((_, i) => i !== idx);
    onChange(next);
    if (target && !target.startsWith('http') && !target.startsWith('/')) {
      deleteFile(target).catch(() => {});
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className={`btn btn-secondary btn-sm${uploading ? ' btn-loading' : ''}`}
          disabled={uploading || !canAddMore}
          onClick={() => inputRef.current?.click()}
          style={{ width: 'auto' }}
        >
          {uploading ? 'Uploading Video...' : '+ Upload MP4 / WebM'}
        </button>
        <span className="text-xs text-muted">Max 35 MB · Up to {maxVideos} clips</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          className="input-field"
          placeholder="Or paste external MP4 / WebM URL (https://...)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={!canAddMore}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ width: 'auto', whiteSpace: 'nowrap' }}
          disabled={!canAddMore || !urlInput.trim()}
          onClick={handleAddUrl}
        >
          Add URL
        </button>
      </div>

      {error && (
        <p className="text-xs" style={{ color: 'var(--error, #dc2626)', margin: 0 }}>
          {error}
        </p>
      )}

      {value.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {value.map((src, idx) => (
            <div
              key={`${src}-${idx}`}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: 8,
                background: 'var(--bg-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <video
                src={getPublicUrl(src)}
                controls
                muted
                playsInline
                preload="metadata"
                style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, background: '#000' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Clip #{idx + 1}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ width: 'auto', color: 'var(--error)', padding: '2px 6px' }}
                  onClick={() => handleRemove(idx)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
