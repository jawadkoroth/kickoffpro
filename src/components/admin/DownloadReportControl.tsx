'use client';

import { useState, useEffect } from 'react';
import {
  downloadBusinessReport,
  downloadOrdersReport,
  type BusinessReportPayload,
  type ReportFormat,
} from '@/lib/admin/reportExporter';

interface DownloadReportControlProps {
  reportType?: 'dashboard' | 'orders';
  defaultFrom?: string;
  defaultTo?: string;
  statusFilter?: string;
  paymentFilter?: string;
}

function isoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DownloadReportControl({
  reportType = 'dashboard',
  defaultFrom,
  defaultTo,
  statusFilter,
  paymentFilter,
}: DownloadReportControlProps) {
  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    if (defaultFrom) return defaultFrom.slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return isoDateOnly(d);
  });
  const [toDate, setToDate] = useState(() =>
    defaultTo ? defaultTo.slice(0, 10) : isoDateOnly(new Date()),
  );
  const [downloading, setDownloading] = useState<ReportFormat | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (defaultFrom) setFromDate(defaultFrom.slice(0, 10));
  }, [defaultFrom]);

  useEffect(() => {
    if (defaultTo) setToDate(defaultTo.slice(0, 10));
  }, [defaultTo]);

  async function handleExport(format: ReportFormat) {
    setError('');
    setDownloading(format);
    try {
      const params = new URLSearchParams();
      params.set('type', reportType);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (statusFilter && statusFilter !== 'stuck') params.set('status', statusFilter);
      if (paymentFilter) params.set('payment', paymentFilter);

      const res = await fetch(`/api/admin/reports?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to generate report');
      }
      if (reportType === 'orders') {
        await downloadOrdersReport(json as BusinessReportPayload, format);
      } else {
        await downloadBusinessReport(json as BusinessReportPayload, format);
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          setError('');
          setOpen((v) => !v);
        }}
        style={{ width: 'auto', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <span>⬇</span>
        <span>Download Report</span>
      </button>

      {open && (
        <div
          className="card"
          role="dialog"
          aria-label="Export Business Report"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 300,
            zIndex: 60,
            padding: 16,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: '0.85rem' }}>
              {reportType === 'orders' ? 'Export Orders Report' : 'Export Business Report'}
            </strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '1rem',
              }}
              aria-label="Close export menu"
            >
              ×
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div className="input-group">
              <label className="input-label" style={{ fontSize: '0.6875rem' }}>From</label>
              <input
                type="date"
                className="input-field"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 8px', colorScheme: 'dark' }}
              />
            </div>
            <div className="input-group">
              <label className="input-label" style={{ fontSize: '0.6875rem' }}>To</label>
              <input
                type="date"
                className="input-field"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{ fontSize: '0.75rem', padding: '6px 8px', colorScheme: 'dark' }}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs" style={{ color: 'var(--error)', marginBottom: 8 }}>
              {error}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(
              [
                { fmt: 'csv', label: 'CSV' },
                { fmt: 'xlsx', label: 'Excel (.xlsx)' },
                { fmt: 'pdf', label: 'PDF' },
                { fmt: 'docx', label: 'Word (.docx)' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.fmt}
                type="button"
                className={`btn btn-primary btn-sm${downloading === opt.fmt ? ' btn-loading' : ''}`}
                disabled={downloading !== null}
                onClick={() => handleExport(opt.fmt)}
                style={{ fontSize: '0.75rem' }}
              >
                {downloading === opt.fmt ? 'Building...' : opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
