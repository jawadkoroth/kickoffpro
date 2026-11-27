'use client';

import { useState, useRef, useEffect, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { uploadFile, deleteFile, getPublicUrl } from '@/lib/media';
import styles from './MediaUploader.module.css';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface MediaUploaderProps {
  /** Current image URLs/paths (supports both absolute URLs and storage paths). */
  value: string[];
  /** Called whenever the image list changes. */
  onChange: (urls: string[]) => void;
  /** Optional hook called immediately with selected File objects (before upload finishes). */
  onFilesSelected?: (files: File[]) => void;
  /** Storage subfolder for new uploads (default: 'misc'). */
  folder?: string;
  /** Maximum number of images allowed (default: 10). */
  maxFiles?: number;
}

interface UploadingEntry {
  id: string;
  previewUrl: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Returns true if a path looks like an external URL (not a Supabase
 * storage relative path). External URLs cannot be deleted via our API.
 */
function isExternalUrl(path: string): boolean {
  return path.startsWith('http') || path.startsWith('/');
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function MediaUploader({
  value,
  onChange,
  onFilesSelected,
  folder = 'misc',
  maxFiles = 10,
}: MediaUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState<UploadingEntry[]>([]);
  const [error, setError] = useState('');

  // Always-fresh snapshot of `value` so concurrent upload batches
  // (e.g. user drops a second batch while the first is still in
  // flight) merge correctly instead of overwriting each other via
  // a stale `useCallback` closure.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Revoke any in-flight preview Object URLs if the component
  // unmounts mid-upload — otherwise the underlying File blob is
  // pinned in memory until the tab closes.
  useEffect(() => {
    return () => {
      setUploading((prev) => {
        prev.forEach((e) => URL.revokeObjectURL(e.previewUrl));
        return prev;
      });
    };
  }, []);

  const remaining = maxFiles - value.length - uploading.length;
  const isMaxed = remaining <= 0;

  /* ---------------------------------------------------------------- */
  /* File handling                                                     */
  /* ---------------------------------------------------------------- */

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setError('');
      const fileArray = Array.from(files).slice(0, Math.max(0, remaining));

      if (fileArray.length === 0) {
        if (isMaxed) setError(`Maximum ${maxFiles} images allowed`);
        return;
      }

      if (onFilesSelected) {
        onFilesSelected(fileArray);
      }

      // Create preview entries for immediate visual feedback
      const entries: UploadingEntry[] = fileArray.map((file) => ({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
      }));
      setUploading((prev) => [...prev, ...entries]);

      // Upload each file concurrently
      const results = await Promise.allSettled(
        fileArray.map(async (file, idx) => {
          const result = await uploadFile(file, folder);
          // Clean up the object URL
          URL.revokeObjectURL(entries[idx].previewUrl);
          return { entryId: entries[idx].id, path: result.path };
        }),
      );

      // Collect successful paths
      const newPaths: string[] = [];
      const failedIds: string[] = [];
      const errors: string[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          newPaths.push(result.value.path);
          // Remove from uploading list by ID
          failedIds.push(result.value.entryId); // not really "failed" — just done
        } else {
          errors.push(
            result.reason instanceof Error
              ? result.reason.message
              : 'Upload failed',
          );
        }
      }

      // Remove completed entries from uploading list
      const completedIds = new Set(
        results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => (r as PromiseFulfilledResult<{ entryId: string; path: string }>).value.entryId),
      );
      const failedEntryIds = new Set(
        entries
          .filter((e) => !completedIds.has(e.id))
          .map((e) => e.id),
      );

      setUploading((prev) =>
        prev.filter((entry) => !completedIds.has(entry.id) && !failedEntryIds.has(entry.id)),
      );

      // Clean up previews for failed uploads
      for (const entry of entries) {
        if (failedEntryIds.has(entry.id)) {
          URL.revokeObjectURL(entry.previewUrl);
        }
      }

      if (newPaths.length > 0) {
        // Read latest value via ref to avoid clobbering a parallel
        // batch that resolved between this batch's start and end.
        onChange([...valueRef.current, ...newPaths]);
      }

      if (errors.length > 0) {
        setError(errors.join('; '));
      }
    },
    [value, onChange, onFilesSelected, folder, remaining, isMaxed, maxFiles],
  );

  /* ---------------------------------------------------------------- */
  /* Drag & drop                                                       */
  /* ---------------------------------------------------------------- */

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files?.length) {
      processFiles(e.dataTransfer.files);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Click-to-upload                                                   */
  /* ---------------------------------------------------------------- */

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      processFiles(e.target.files);
      // Reset so the same file can be re-selected
      e.target.value = '';
    }
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  async function handleRemove(index: number) {
    const path = value[index];
    const next = value.filter((_, i) => i !== index);
    onChange(next);

    // Attempt storage deletion for non-external paths (best effort)
    if (!isExternalUrl(path)) {
      try {
        await deleteFile(path);
      } catch (err) {
        console.error('[MEDIA_DELETE_FAILED]', err);
        // Don't re-add: the image is already removed from the list.
        // Orphaned storage files can be cleaned up later.
      }
    }
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const next = [...value];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function handleMoveDown(index: number) {
    if (index >= value.length - 1) return;
    const next = [...value];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className={styles.uploader}>
      {/* Image grid */}
      {(value.length > 0 || uploading.length > 0) && (
        <div className={styles.imageGrid}>
          {/* Existing images */}
          {value.map((path, idx) => (
            <div key={`${path}-${idx}`} className={styles.imageCard}>
              <img
                src={getPublicUrl(path)}
                alt={`Product image ${idx + 1}`}
                className={styles.imagePreview}
                loading="lazy"
              />
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => handleMoveUp(idx)}
                  disabled={idx === 0}
                  title="Move up"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnRemove}`}
                  onClick={() => handleRemove(idx)}
                  title="Remove"
                >
                  ✕
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => handleMoveDown(idx)}
                  disabled={idx === value.length - 1}
                  title="Move down"
                >
                  ▶
                </button>
              </div>
            </div>
          ))}

          {/* Uploading placeholders */}
          {uploading.map((entry) => (
            <div key={entry.id} className={styles.imageCard}>
              <img
                src={entry.previewUrl}
                alt="Uploading..."
                className={styles.imagePreview}
              />
              <div className={styles.uploadingOverlay}>
                <div className={styles.spinner} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      <div
        className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''} ${isMaxed ? styles.dropZoneDisabled : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => !isMaxed && fileInputRef.current?.click()}
      >
        <div className={styles.dropIcon}>📸</div>
        <p className={styles.dropText}>
          {isMaxed
            ? `Maximum ${maxFiles} images reached`
            : 'Drag & drop images here or click to browse'}
        </p>
        <p className={styles.dropHint}>JPG, PNG, WebP · Max 4MB each</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className={styles.fileInput}
          onChange={handleFileChange}
        />
      </div>

      {/* Error */}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
