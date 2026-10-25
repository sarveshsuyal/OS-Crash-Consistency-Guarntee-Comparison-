import React, { useState } from 'react';
import {
  CrashIcon,
  ShieldCheckIcon,
  DatabaseIcon,
  CpuIcon,
  DownloadIcon,
  RefreshCwIcon,
  PlayIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  FileTextIcon,
  XIcon,
} from './Icons';
import { api } from '../api';
import { kernelLogger } from '../utils/kernelEvents';

// Circular SVG Progress Ring (WhatsApp-style)
function CircularProgress({ percent, size = 48, strokeWidth = 3.5, color = '#00d2ff', isStreaming = false, children }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          transform: 'rotate(-90deg)',
          overflow: 'visible',
        }}
      >
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Active Progress Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.25s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.25s ease',
            filter: `drop-shadow(0 0 6px ${color}80)`,
          }}
        />
      </svg>
      {/* Center Content Slot */}
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Helper to determine file badge styling matching WhatsApp document bubbles
function getFileBadgeMeta(filename = '', mimeType = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt') || mimeType.includes('presentation')) {
    return { ext: 'PPTX', letter: 'P', bg: '#d9381e', color: '#ffffff' }; // PowerPoint Orange-Red
  }
  if (lower.endsWith('.pdf') || mimeType.includes('pdf')) {
    return { ext: 'PDF', letter: 'PDF', bg: '#ef4444', color: '#ffffff' }; // PDF Crimson Red
  }
  if (lower.endsWith('.docx') || lower.endsWith('.doc') || mimeType.includes('word')) {
    return { ext: 'DOCX', letter: 'W', bg: '#2563eb', color: '#ffffff' }; // Word Royal Blue
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || mimeType.includes('sheet')) {
    return { ext: 'XLSX', letter: 'X', bg: '#10b981', color: '#ffffff' }; // Excel Emerald Green
  }
  if (lower.endsWith('.sqlite') || lower.endsWith('.db') || lower.endsWith('.sql')) {
    return { ext: 'DB', letter: 'DB', bg: '#7c3aed', color: '#ffffff' }; // Database Violet
  }
  if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz')) {
    return { ext: 'ZIP', letter: 'ZIP', bg: '#f59e0b', color: '#ffffff' }; // Archive Amber
  }
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(lower)) {
    return { ext: 'IMG', letter: 'IMG', bg: '#06b6d4', color: '#ffffff' }; // Image Cyan
  }
  return { ext: 'FILE', letter: 'DOC', bg: '#6366f1', color: '#ffffff' }; // Default Indigo
}

export default function TransmissionCard({
  transfer,
  currentUser,
  onSimulateCrash,
  onInterruptTransfer,
  onCrashWorker,
  onRecoverTransfer,
  onResumeTransfer,
  onDownloadFile,
}) {
  const [inspectOpen, setInspectOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState(null);

  const isSender = transfer.sender === currentUser?.id;
  const isRam = transfer.protocol_mode === 'RAM_VOLATILE';
  const totalChunks = transfer.total_chunks || 1;
  const transferredChunks = transfer.transferred_chunks || 0;
  const actualBytes = transfer.actual_bytes_persisted || 0;
  const expectedBytes = transfer.file_size || 1;
  const percent = Math.min(100, Math.round((actualBytes / expectedBytes) * 100)) ||
    Math.min(100, Math.round((transferredChunks / totalChunks) * 100));

  const isImage = Boolean(
    transfer.mime_type?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg)$/i.test(transfer.filename || '')
  );

  const isComplete = ['COMMITTED', 'COMPLETED'].includes(transfer.status);
  const isStreaming = ['IN_PROGRESS', 'RECEIVING'].includes(transfer.status);
  const isCrashed = transfer.status === 'CRASHED';
  const isPartialAvailable = ['INTERRUPTED', 'CRASHED', 'RECOVERED', 'FAILED'].includes(transfer.status) && actualBytes > 0;

  const downloadUrl = api.transfers.getDownloadUrl(transfer.transfer_id, false);
  const partialDownloadUrl = api.transfers.getDownloadUrl(transfer.transfer_id, true);

  const badgeMeta = getFileBadgeMeta(transfer.filename, transfer.mime_type);

  // Status color mapping
  const getStatusColor = () => {
    switch (transfer.status) {
      case 'COMMITTED':
      case 'COMPLETED':
        return '#00ff88'; // Emerald
      case 'CRASHED':
        return '#f59e0b'; // Amber
      case 'INTERRUPTED':
        return '#eab308'; // Yellow
      case 'CORRUPTED_LOST':
      case 'FAILED':
        return '#ff3366'; // Crimson
      case 'RECOVERED':
        return '#00d2ff'; // Cyan
      case 'IN_PROGRESS':
      case 'RECEIVING':
        return isRam ? '#f59e0b' : '#00d2ff';
      default:
        return '#a4abd1';
    }
  };

  const statusColor = getStatusColor();

  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatTime = (ts) => {
    try {
      const d = ts ? new Date(ts) : new Date();
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
    } catch {
      return '';
    }
  };

  // Determine block state for each chunk
  const chunkBlocks = Array.from({ length: totalChunks }, (_, idx) => {
    let state = 'PENDING';

    if (transfer.status === 'CORRUPTED_LOST') {
      state = idx < transferredChunks ? 'CRASHED_LOST' : 'PENDING';
    } else if (transfer.status === 'RECOVERED') {
      const verified = transfer.recovery_details?.verified_chunk_indices || [];
      state = verified.length > 0
        ? (verified.includes(idx) ? 'RECOVERED' : 'PENDING')
        : (idx < transferredChunks ? 'RECOVERED' : 'PENDING');
    } else if (idx < transferredChunks || (isComplete && idx < totalChunks)) {
      state = isRam ? 'RAM_VOLATILE' : 'WAL_COMMITTED';
    }

    const isInFlight = idx === transferredChunks && isStreaming;

    return {
      index: idx,
      state,
      isInFlight,
      offset: idx * (transfer.chunk_size || 65536),
    };
  });

  // OS Inode & Kernel Diagnostics fallback calculations
  const vfsInode = transfer.vfs_inode || (480000 + (parseInt(transfer.transfer_id?.replace(/[^0-9]/g, '')?.slice(0, 5) || '1234', 10)));
  const dirtyPagesCount = isRam ? (isComplete ? 0 : totalChunks - transferredChunks) : 0;
  const fsyncExecuted = Boolean(transfer.fsync_barrier_executed || isComplete);

  const handleTriggerFsync = () => {
    kernelLogger.log('vfs', `sys_fsync(fd=3, ino=${vfsInode}) executed: flushed ${transferredChunks} dirty buffer pages to block storage extent.`);
  };

  const handleTriggerCrash = () => {
    kernelLogger.log('panic', `KERNEL CRASH SIMULATED: SIGKILL dispatched to PID ${transfer.worker_pid || 'Worker'}. Dirty RAM pages lost!`, 'ERROR');
    if (onCrashWorker) {
      onCrashWorker(transfer.transfer_id);
    } else if (onSimulateCrash) {
      onSimulateCrash(transfer.transfer_id);
    }
  };

  const handleTriggerRecovery = () => {
    kernelLogger.log('jbd2', `WAL Recovery Initiated: scanning journal log for Inode ${vfsInode}, verifying chunk checksums...`);
    if (onRecoverTransfer) {
      onRecoverTransfer(transfer.transfer_id);
    }
  };

  const styles = {
    // Authentic WhatsApp Document Bubble styling with dark purple / emerald tints
    card: {
      backgroundColor: isSender
        ? 'rgba(6, 78, 59, 0.45)' // WhatsApp sent bubble dark emerald tint
        : 'rgba(24, 27, 45, 0.88)', // WhatsApp received bubble dark slate
      backdropFilter: 'blur(16px)',
      borderRadius: isSender ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
      border: isSender
        ? '1px solid rgba(16, 185, 129, 0.35)'
        : '1px solid rgba(99, 67, 224, 0.35)',
      padding: '12px 14px',
      margin: '6px 0',
      maxWidth: '480px',
      width: '100%',
      boxShadow: isSender
        ? '0 6px 20px rgba(0, 0, 0, 0.4), 0 0 12px rgba(16, 185, 129, 0.15)'
        : '0 6px 20px rgba(0, 0, 0, 0.4), 0 0 12px rgba(99, 67, 224, 0.15)',
      color: 'var(--color-text-primary, #f8f9fd)',
      position: 'relative',
      boxSizing: 'border-box',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      animation: 'slideIn 0.2s ease-out',
    },
    // Top Sender Bar (like WhatsApp quote or sender label)
    senderHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: '8px',
      marginBottom: '8px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      fontSize: '11.5px',
      fontWeight: '600',
    },
    senderTag: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      color: isSender ? '#34d399' : '#00d2ff',
    },
    protocolPill: {
      fontSize: '10px',
      padding: '2px 8px',
      borderRadius: '12px',
      backgroundColor: isRam ? 'rgba(245, 158, 11, 0.15)' : 'rgba(99, 67, 224, 0.2)',
      color: isRam ? '#f59e0b' : '#a78bfa',
      border: `1px solid ${isRam ? 'rgba(245, 158, 11, 0.3)' : 'rgba(99, 67, 224, 0.4)'}`,
      fontWeight: '700',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      letterSpacing: '0.3px',
    },
    // Document Card Body (matching reference image)
    docBody: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      backgroundColor: 'rgba(10, 10, 22, 0.5)',
      padding: '10px 12px',
      borderRadius: '12px',
      border: '1px solid rgba(255, 255, 255, 0.06)',
    },
    badgeContainer: {
      position: 'relative',
      width: '48px',
      height: '48px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    fileIconBadge: {
      width: '40px',
      height: '40px',
      borderRadius: '10px',
      backgroundColor: badgeMeta.bg,
      color: badgeMeta.color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '900',
      fontSize: badgeMeta.letter.length > 2 ? '11px' : '17px',
      boxShadow: `0 4px 12px ${badgeMeta.bg}66`,
      letterSpacing: '-0.5px',
      userSelect: 'none',
    },
    docDetails: {
      flex: 1,
      minWidth: 0,
    },
    fileName: {
      fontSize: '13.5px',
      fontWeight: '700',
      color: 'var(--color-text-primary, #f8f9fd)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      lineHeight: '1.3',
    },
    docSub: {
      fontSize: '11px',
      color: 'rgba(255, 255, 255, 0.7)',
      marginTop: '4px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
    },
    checkMarks: {
      color: isComplete ? '#00d2ff' : (isCrashed ? '#f59e0b' : '#34d399'),
      fontSize: '12px',
      fontWeight: 'bold',
      letterSpacing: '-1px',
      marginLeft: '2px',
    },
    // Split Action Footer (Open | Save as... | OS Trace)
    actionFooter: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '6px',
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    },
    actionBtn: (highlight = false, danger = false) => ({
      padding: '7px 8px',
      borderRadius: '8px',
      fontSize: '11px',
      fontWeight: '700',
      border: danger
        ? '1px solid rgba(255, 51, 102, 0.4)'
        : (highlight ? '1px solid rgba(0, 210, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)'),
      backgroundColor: danger
        ? 'rgba(255, 51, 102, 0.15)'
        : (highlight ? 'rgba(0, 210, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)'),
      color: danger ? '#ff3366' : (highlight ? '#00d2ff' : 'var(--color-text-primary, #f8f9fd)'),
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '5px',
      textAlign: 'center',
      transition: 'all 0.15s ease',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
    }),
    // Image Preview Box
    imagePreviewBox: {
      margin: '10px 0 6px 0',
      borderRadius: '10px',
      overflow: 'hidden',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      maxHeight: '200px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(9, 9, 19, 0.95)',
      position: 'relative',
      cursor: 'pointer',
    },
    previewImg: {
      maxWidth: '100%',
      maxHeight: '200px',
      objectFit: 'contain',
    },
    // OS Trace Drawer
    kernelDrawer: {
      marginTop: '10px',
      padding: '12px',
      backgroundColor: 'rgba(8, 8, 18, 0.96)',
      borderRadius: '10px',
      border: '1px solid rgba(99, 67, 224, 0.4)',
      boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.6)',
      fontSize: '11px',
      animation: 'fadeIn 0.2s ease',
    },
    tierBox: {
      backgroundColor: 'rgba(18, 18, 36, 0.8)',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      marginBottom: '8px',
    },
    tierTitle: {
      fontSize: '11px',
      fontWeight: '800',
      color: '#00d2ff',
      marginBottom: '4px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    chunkGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(22px, 1fr))',
      gap: '3px',
      marginTop: '6px',
    },
    chunkBlock: (state, isInFlight) => {
      let bg = 'rgba(255, 255, 255, 0.08)';
      let shadow = 'none';
      let border = 'none';

      if (state === 'RAM_VOLATILE') {
        bg = '#f59e0b';
        shadow = '0 0 6px rgba(245, 158, 11, 0.4)';
      } else if (state === 'WAL_COMMITTED') {
        bg = '#00ff88';
        shadow = '0 0 6px rgba(0, 255, 136, 0.4)';
      } else if (state === 'CRASHED_LOST') {
        bg = '#ff3366';
        shadow = '0 0 6px rgba(255, 51, 102, 0.5)';
      } else if (state === 'RECOVERED') {
        bg = '#00d2ff';
        shadow = '0 0 6px rgba(0, 210, 255, 0.5)';
      }

      if (isInFlight) {
        border = '2px solid #00d2ff';
        shadow = '0 0 10px #00d2ff';
      }

      return {
        height: '22px',
        borderRadius: '4px',
        backgroundColor: bg,
        boxShadow: shadow,
        border: border,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '9px',
        fontWeight: '700',
        color: state === 'PENDING' ? '#8696a0' : '#090913',
        cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.2s',
      };
    },
  };

  return (
    <div style={styles.card}>
      {/* 1. Sender Header (WhatsApp quote / peer identifier) */}
      <div style={styles.senderHeader}>
        <div style={styles.senderTag}>
          <span style={{ fontSize: '13px' }}>{isSender ? '📤' : '📥'}</span>
          <span>
            {isSender
              ? `You ➔ ${transfer.receiver_name || transfer.receiver_phone || 'Peer'}`
              : `${transfer.sender_name || transfer.sender_phone || 'Peer'}`}
          </span>
        </div>
        <div style={styles.protocolPill}>
          {isRam ? <CpuIcon size={11} color="#f59e0b" /> : <DatabaseIcon size={11} color="#a78bfa" />}
          {isRam ? 'RAM Buffer' : 'SQLite WAL'}
        </div>
      </div>

      {/* 2. Document Bubble Body (matches user reference image) */}
      <div style={styles.docBody}>
        {/* Document Badge with Circular Progress Ring around it */}
        <div style={styles.badgeContainer}>
          {isStreaming ? (
            <CircularProgress
              percent={percent}
              size={48}
              strokeWidth={3.5}
              color={statusColor}
              isStreaming={isStreaming}
            >
              <div
                style={{
                  ...styles.fileIconBadge,
                  width: '32px',
                  height: '32px',
                  fontSize: '10px',
                }}
              >
                {badgeMeta.letter}
              </div>
            </CircularProgress>
          ) : (
            <div style={styles.fileIconBadge}>
              {badgeMeta.letter}
            </div>
          )}
        </div>

        {/* Filename, Meta and WhatsApp Checkmarks */}
        <div style={styles.docDetails}>
          <div style={styles.fileName} title={transfer.filename}>
            {transfer.filename}
          </div>
          <div style={styles.docSub}>
            <span>{badgeMeta.ext}</span>
            <span>•</span>
            <span>{formatBytes(actualBytes > 0 ? actualBytes : expectedBytes)}</span>
            <span>•</span>
            <span>{formatTime(transfer.created_at)}</span>
            {isSender && (
              <span style={styles.checkMarks} title={transfer.status}>
                {isComplete ? '✓✓' : (isStreaming ? '🕒' : '✓✓')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Image Preview (if image format) */}
      {isImage && (isComplete || isPartialAvailable) && (
        <div
          style={styles.imagePreviewBox}
          onClick={() => setImagePreviewOpen(true)}
          title="Click to view full preview"
        >
          <img
            src={downloadUrl}
            alt={transfer.filename}
            style={styles.previewImg}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '6px',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              color: '#00d2ff',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '9.5px',
              fontWeight: '600',
            }}
          >
            🔍 Enlarge
          </div>
        </div>
      )}

      {/* 4. Streaming Progress Bar */}
      {isStreaming && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#a4abd1', marginBottom: '3px' }}>
            <span>Streaming Chunk #{transferredChunks + 1} of {totalChunks}</span>
            <strong style={{ color: statusColor }}>{percent}%</strong>
          </div>
          <div style={{ height: '4px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${percent}%`,
                backgroundColor: statusColor,
                transition: 'width 0.2s ease',
                boxShadow: `0 0 8px ${statusColor}`,
              }}
            />
          </div>
        </div>
      )}

      {/* 5. Status Notice (if crashed, interrupted or recovered) */}
      {isCrashed && (
        <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: 'rgba(245, 158, 11, 0.15)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.3)', fontSize: '11px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangleIcon size={14} color="#f59e0b" />
          <span>Worker process killed (SIGKILL). {formatBytes(actualBytes)} preserved on NVMe.</span>
        </div>
      )}

      {transfer.status === 'CORRUPTED_LOST' && (
        <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: 'rgba(255, 51, 102, 0.15)', borderRadius: '6px', border: '1px solid rgba(255, 51, 102, 0.3)', fontSize: '11px', color: '#ff3366', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <AlertTriangleIcon size={14} color="#ff3366" />
          <span>Power cut wiped volatile RAM buffer cache (0% guarantee). File lost.</span>
        </div>
      )}

      {transfer.status === 'RECOVERED' && (
        <div style={{ marginTop: '8px', padding: '6px 10px', backgroundColor: 'rgba(0, 210, 255, 0.15)', borderRadius: '6px', border: '1px solid rgba(0, 210, 255, 0.3)', fontSize: '11px', color: '#00d2ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <CheckCircleIcon size={14} color="#00d2ff" />
          <span>WAL Replay succeeded! All committed blocks restored.</span>
        </div>
      )}

      {/* 6. WhatsApp Split Action Buttons: [ Open ] | [ Save as... ] | [ OS Trace ] */}
      <div style={styles.actionFooter}>
        {/* Button 1: Primary Action (Open, Resume, Lost Alert, Cancel, or Preview) */}
        {isComplete ? (
          <button
            style={styles.actionBtn(true)}
            onClick={() => {
              if (isImage) {
                setImagePreviewOpen(true);
              } else {
                window.open(downloadUrl, '_blank');
              }
            }}
            title="Open or preview document"
          >
            <FileTextIcon size={13} color="#00d2ff" />
            <span>Open</span>
          </button>
        ) : (transfer.status === 'RECOVERED' || (transfer.status === 'CRASHED' && transfer.protocol_mode === 'JOURNAL_WAL')) ? (
          <button
            style={{
              ...styles.actionBtn(true),
              backgroundColor: 'rgba(0, 210, 255, 0.25)',
              border: '1px solid #00d2ff',
              color: '#00d2ff',
              boxShadow: '0 0 12px rgba(0, 210, 255, 0.45)',
              fontWeight: '800',
            }}
            onClick={() => onResumeTransfer && onResumeTransfer(transfer)}
            title="Resume stream from last verified chunk"
          >
            <PlayIcon size={13} color="#00d2ff" />
            <span>Resume #{transferredChunks}</span>
          </button>
        ) : transfer.status === 'CORRUPTED_LOST' ? (
          <div
            style={{
              ...styles.actionBtn(false, true),
              opacity: 0.9,
              cursor: 'not-allowed',
              color: '#ff3366',
              fontWeight: '700',
            }}
            title="Data permanently lost. Volatile RAM cleared upon crash."
          >
            <CrashIcon size={13} color="#ff3366" />
            <span>100% Lost (RAM)</span>
          </div>
        ) : isStreaming ? (
          <button
            style={styles.actionBtn(false, true)}
            onClick={() => onInterruptTransfer && onInterruptTransfer(transfer.transfer_id)}
            title="Cancel stream"
          >
            <XIcon size={13} color="#ff3366" />
            <span>Cancel</span>
          </button>
        ) : (
          <button
            style={styles.actionBtn(false)}
            onClick={() => onDownloadFile ? onDownloadFile(transfer.transfer_id, true) : window.open(partialDownloadUrl, '_blank')}
            title="Inspect partial document"
          >
            <FileTextIcon size={13} color="currentColor" />
            <span>Preview</span>
          </button>
        )}

        {/* Button 2: Save as... / Download */}
        <button
          style={styles.actionBtn(false)}
          onClick={() => {
            const url = isComplete ? downloadUrl : partialDownloadUrl;
            if (onDownloadFile) {
              onDownloadFile(transfer.transfer_id, !isComplete);
            } else {
              window.open(url, '_blank');
            }
          }}
          title={isComplete ? 'Save verified file' : 'Save partial bytes'}
        >
          <DownloadIcon size={13} color="currentColor" />
          <span>Save as...</span>
        </button>

        {/* Button 3: OS Kernel Trace Drawer Toggle */}
        <button
          style={styles.actionBtn(inspectOpen)}
          onClick={() => setInspectOpen(!inspectOpen)}
          title="Inspect OS Virtual File System & Page Cache Hierarchy"
        >
          <span>⚙️ OS Trace</span>
          <span style={{ fontSize: '9px' }}>{inspectOpen ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* 7. Deep Operating System Kernel Inspector Drawer */}
      {inspectOpen && (
        <div style={styles.kernelDrawer}>
          {/* OS Tier 1: User Space Process */}
          <div style={styles.tierBox}>
            <div style={styles.tierTitle}>
              <span>1. User Process Space</span>
              <span style={{ color: '#a78bfa' }}>PID {transfer.worker_pid || 'Worker'}</span>
            </div>
            <div style={{ color: '#a4abd1', fontSize: '10.5px' }}>
              • Syscall in action: <code style={{ color: '#00d2ff' }}>sys_write(fd=3, buf, count={transfer.chunk_size})</code><br />
              • File Descriptor: <code style={{ color: '#00d2ff' }}>fd 3 (O_WRONLY | O_CREAT | O_APPEND)</code>
            </div>
          </div>

          {/* OS Tier 2: Kernel Page Cache (Volatile RAM) */}
          <div style={styles.tierBox}>
            <div style={styles.tierTitle}>
              <span>2. Kernel Page Cache (Volatile RAM)</span>
              <span style={{ color: isRam ? '#f59e0b' : '#34d399' }}>
                {isRam ? 'Unflushed / Volatile' : 'Ordered Barrier'}
              </span>
            </div>
            <div style={{ color: '#a4abd1', fontSize: '10.5px' }}>
              • Dirty Pages in RAM: <strong style={{ color: isRam ? '#f59e0b' : '#34d399' }}>{dirtyPagesCount} pages</strong> ({formatBytes(dirtyPagesCount * 4096)})<br />
              • Fsync Barrier: <strong style={{ color: fsyncExecuted ? '#34d399' : '#f59e0b' }}>
                {fsyncExecuted ? 'COMPLETED (Disk Extent Committed)' : 'PENDING (Dirty in RAM)'}
              </strong>
            </div>
          </div>

          {/* OS Tier 3: VFS & Inode Layer */}
          <div style={styles.tierBox}>
            <div style={styles.tierTitle}>
              <span>3. VFS Inode & Extents</span>
              <span style={{ color: '#34d399' }}>ino #{vfsInode}</span>
            </div>
            <div style={{ color: '#a4abd1', fontSize: '10.5px' }}>
              • Persisted to NVMe: <strong>{formatBytes(actualBytes)}</strong> / {formatBytes(expectedBytes)}<br />
              • SHA-256 Digest: <span style={{ fontFamily: 'monospace', color: '#00d2ff' }}>
                {transfer.final_file_hash ? `${transfer.final_file_hash.slice(0, 16)}...` : (transfer.expected_hash ? `${transfer.expected_hash.slice(0, 16)}...` : 'In-flight')}
              </span>
            </div>
          </div>

          {/* Block Allocation Matrix */}
          <div style={{ margin: '8px 0 4px 0', fontSize: '10px', color: '#a4abd1', display: 'flex', justifyContent: 'space-between' }}>
            <span>Block Storage Allocation ({totalChunks} blocks):</span>
            <span style={{ color: isRam ? '#f59e0b' : '#00ff88' }}>
              {isRam ? 'Volatile Heap Blocks' : 'Journal Extent Blocks'}
            </span>
          </div>

          <div style={styles.chunkGrid}>
            {chunkBlocks.map((blk) => (
              <div
                key={blk.index}
                style={styles.chunkBlock(blk.state, blk.isInFlight)}
                onClick={() => setSelectedBlock(blk)}
                title={`Block #${blk.index} @ offset ${blk.offset}: ${blk.state}`}
              >
                {blk.index}
              </div>
            ))}
          </div>

          {selectedBlock && (
            <div style={{ marginTop: '6px', padding: '6px', backgroundColor: 'rgba(0, 0, 0, 0.5)', borderRadius: '6px', fontSize: '10px', color: '#00d2ff' }}>
              Block #{selectedBlock.index}: State=<strong>{selectedBlock.state}</strong> | Byte Offset={selectedBlock.offset} | Inode={vfsInode}
            </div>
          )}

          {/* Interactive OS Simulation Control Buttons */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
            {/* 1. Simulate Power Loss / SIGKILL Crash */}
            {(isStreaming || (!isComplete && actualBytes > 0)) && (
              <button
                style={{
                  ...styles.actionBtn(false, true),
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '10.5px',
                }}
                onClick={handleTriggerCrash}
                title="Kill worker process with SIGKILL or cut power"
              >
                <CrashIcon size={12} color="#ff3366" />
                <span>Simulate Kernel Panic / SIGKILL</span>
              </button>
            )}

            {/* 2. Flush Barrier sys_fsync() */}
            {isStreaming && (
              <button
                style={{
                  ...styles.actionBtn(true),
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '10.5px',
                }}
                onClick={handleTriggerFsync}
                title="Force kernel dirty page cache to flush to disk"
              >
                <ShieldCheckIcon size={12} color="#00d2ff" />
                <span>sys_fsync() Barrier</span>
              </button>
            )}

            {/* 3. Run OS Recovery */}
            {(isCrashed || transfer.status === 'INTERRUPTED') && (
              <button
                style={{
                  ...styles.actionBtn(true),
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '10.5px',
                }}
                onClick={handleTriggerRecovery}
                title="Execute WAL crash recovery algorithm"
              >
                <RefreshCwIcon size={12} color="#00d2ff" />
                <span>Run WAL Recovery</span>
              </button>
            )}

            {/* 4. Resume Stream */}
            {['INTERRUPTED', 'CRASHED', 'RECOVERED'].includes(transfer.status) && actualBytes < expectedBytes && (
              <button
                style={{
                  ...styles.actionBtn(false),
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: '10.5px',
                  backgroundColor: 'rgba(167, 139, 250, 0.2)',
                  borderColor: 'rgba(167, 139, 250, 0.4)',
                  color: '#a78bfa',
                }}
                onClick={() => onResumeTransfer && onResumeTransfer(transfer)}
                title="Resume stream from last verified byte"
              >
                <PlayIcon size={12} color="#a78bfa" />
                <span>Resume from Byte {actualBytes}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* 8. Lightbox Modal for Images */}
      {imagePreviewOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(5, 5, 12, 0.92)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
          onClick={() => setImagePreviewOpen(false)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              backgroundColor: 'var(--color-surface, #14142a)',
              borderRadius: '16px',
              border: '1px solid rgba(0, 210, 255, 0.4)',
              boxShadow: '0 16px 48px rgba(0, 0, 0, 0.8), 0 0 32px rgba(0, 210, 255, 0.25)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(20, 20, 42, 0.95)',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#f8f9fd' }}>
                  {transfer.filename}
                </div>
                <div style={{ fontSize: '11px', color: '#00d2ff' }}>
                  {formatBytes(actualBytes)} • Inode #{vfsInode}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <a
                  href={downloadUrl}
                  download={transfer.filename}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    backgroundColor: '#00d2ff',
                    color: '#090913',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <DownloadIcon size={13} color="#090913" />
                  Save Image
                </a>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#a4abd1',
                    cursor: 'pointer',
                    padding: '4px',
                  }}
                  onClick={() => setImagePreviewOpen(false)}
                >
                  <XIcon size={20} color="#a4abd1" />
                </button>
              </div>
            </div>

            <div
              style={{
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto',
                maxHeight: 'calc(90vh - 80px)',
              }}
            >
              <img
                src={downloadUrl}
                alt={transfer.filename}
                style={{
                  maxWidth: '100%',
                  maxHeight: '75vh',
                  objectFit: 'contain',
                  borderRadius: '8px',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
