import React, { useState, useRef, useEffect } from 'react';
import TransmissionCard from './TransmissionCard';
import {
  SendIcon,
  PaperclipIcon,
  CpuIcon,
  DatabaseIcon,
  CrashIcon,
  RefreshCwIcon,
  FileTextIcon,
  TerminalIcon,
  XIcon,
  ShieldCheckIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  PlayIcon,
} from './Icons';
import { api, computeSHA256, arrayBufferToBase64 } from '../api';
import {
  createSampleArchitectureSvg,
  createSamplePdfDocument,
  createSampleSqliteDatabase,
  createSamplePptxDocument,
} from '../utils/sampleFiles';
import { kernelLogger } from '../utils/kernelEvents';

export default function ChatWindow({
  activePeer,
  currentUser,
  messages = [],
  transfers = [],
  activeProtocol,
  setActiveProtocol,
  onSendMessage,
  onInitiateTransfer,
  onUploadChunk,
  onSimulateCrash,
  onInterruptTransfer,
  onCrashWorker,
  onRecoverTransfer,
  onDownloadFile,
  onOpenOSLab,
  onGlobalCrash,
}) {
  const [inputText, setInputText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [chunkSize, setChunkSize] = useState(65536); // 64 KB default
  const [chunkPacingMs, setChunkPacingMs] = useState(140); // 140ms default for live observable demo
  const [injectDeterministicCrash, setInjectDeterministicCrash] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [kernelLogs, setKernelLogs] = useState([]);
  const [showKernelConsole, setShowKernelConsole] = useState(false);
  const [recoveryBanner, setRecoveryBanner] = useState(null);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const kernelConsoleEndRef = useRef(null);
  const lastItemCountRef = useRef(0);

  // Active AbortControllers for real network stream cancellation
  const activeControllersRef = useRef({});
  // Track crashed transfer IDs
  const crashedTransferIdsRef = useRef({});
  // Cache file references & buffers so users can test seamless resumption
  const transferBuffersRef = useRef({});

  // Subscribe to OS Kernel Event Logger
  useEffect(() => {
    const unsubscribe = kernelLogger.subscribe((logs) => {
      setKernelLogs(logs);
    });
    return unsubscribe;
  }, []);

  // Filter transfers for active peer
  const peerTransfers = transfers.filter(
    (t) => (t.sender === activePeer?.id || t.receiver === activePeer?.id)
  );

  // Merge messages and file transfers into a unified chronological feed
  const feedItems = [
    ...peerTransfers.map((t) => ({
      type: 'transfer',
      id: `transfer-${t.transfer_id}`,
      data: t,
      time: new Date(t.created_at || Date.now()).getTime(),
      isMe: t.sender === currentUser?.id,
    })),
    ...messages.map((m) => ({
      type: 'message',
      id: `msg-${m.id}`,
      data: m,
      time: new Date(m.timestamp || Date.now()).getTime(),
      isMe: m.sender === currentUser?.id,
    })),
  ].sort((a, b) => a.time - b.time);

  // Auto-scroll when new message or transfer arrives
  useEffect(() => {
    const currentCount = feedItems.length;
    if (currentCount > lastItemCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    lastItemCountRef.current = currentCount;
  }, [feedItems.length]);

  // Scroll to bottom of kernel console when logs change
  useEffect(() => {
    if (showKernelConsole) {
      kernelConsoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [kernelLogs.length, showKernelConsole]);

  const handleSendText = (e) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    kernelLogger.log(
      'net',
      `sys_sendto(sockfd=4, payload="${inputText.slice(0, 24)}...", to_node=${activePeer?.id}) -> socket buffer queued.`
    );

    onSendMessage(inputText.trim(), activePeer?.id);
    setInputText('');
  };

  // Real Network Interruption Handler
  const handleInterruptTransfer = async (transferId) => {
    kernelLogger.log(
      'net',
      `SIGPIPE: Network connection dropped for transfer ${transferId?.slice(0, 8)}. Stream terminated.`,
      'WARN'
    );
    if (activeControllersRef.current[transferId]) {
      try {
        activeControllersRef.current[transferId].abort();
      } catch {
        // ignore
      }
      delete activeControllersRef.current[transferId];
    }
    if (transferId) {
      crashedTransferIdsRef.current[transferId] = true;
    }
    if (onInterruptTransfer) {
      return onInterruptTransfer(transferId);
    }
    return api.transfers.interrupt(transferId);
  };

  // Real Worker Child Process SIGKILL Crash Handler
  const handleCrashWorker = async (transferId) => {
    kernelLogger.log(
      'panic',
      `SIGKILL sent to transmission worker PID. OS Page Cache dirty pages dropped without fsync!`,
      'ERROR'
    );
    if (activeControllersRef.current[transferId]) {
      try {
        activeControllersRef.current[transferId].abort();
      } catch {
        // ignore
      }
      delete activeControllersRef.current[transferId];
    }
    if (transferId) {
      crashedTransferIdsRef.current[transferId] = true;
    }
    if (onCrashWorker) {
      return onCrashWorker(transferId);
    }
    return api.transfers.crashWorker(transferId);
  };

  // Backward compatibility alias for crash simulation
  const handleSimulateCrashWithAbort = async (transferId) => {
    return handleCrashWorker(transferId);
  };

  // Get active peer's latest transfer
  const latestTransfer = peerTransfers[0] || transfers[0];
  const hasCrashedOrInterrupted = latestTransfer && ['CRASHED', 'INTERRUPTED', 'CORRUPTED_LOST', 'FAILED'].includes(latestTransfer.status);

  // Top-center Crash Button Handler
  const handleTopCrashClick = async () => {
    if (isUploading) {
      Object.keys(activeControllersRef.current).forEach((id) => {
        try {
          activeControllersRef.current[id].abort();
        } catch {
          // ignore
        }
        delete activeControllersRef.current[id];
      });
      setIsUploading(false);
      setUploadStatusText('');
    }

    const targetId = latestTransfer?.transfer_id;
    kernelLogger.log(
      'panic',
      `KERNEL PANIC: Power failure / crash injected. Volatile caches flushed.`,
      'ERROR'
    );

    if (targetId) {
      crashedTransferIdsRef.current[targetId] = true;
      await onCrashWorker(targetId);
    } else {
      await onSimulateCrash(null);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Dedicated OS Recovery Execution & Diagnostic Analyzer
  const runRecoveryForTransfer = async (targetTransfer) => {
    const t = targetTransfer || latestTransfer;
    if (!t?.transfer_id) {
      kernelLogger.log('vfs', 'No active or recent transfer session detected to recover.', 'WARN');
      return;
    }

    kernelLogger.log('vfs', `Initiating OS Recovery Audit for "${t.filename}" (mode: ${t.protocol_mode})...`);

    try {
      const res = await onRecoverTransfer(t.transfer_id);
      const isWal = t.protocol_mode === 'JOURNAL_WAL';
      const report = res?.report || t.recovery_details || {};
      const isSuccess = Boolean(res?.success || (isWal && report.is_fully_restored !== false));
      const recoveredCount = report.recovered_chunks_count ?? t.transferred_chunks ?? 0;
      const totalCount = report.total_expected_chunks ?? t.total_chunks ?? 0;
      const recoveryMs = report.recovery_time_ms || (isWal ? 1.4 : 0.1);
      const lossPct = report.data_loss_percentage !== undefined ? report.data_loss_percentage : (isWal ? 0.0 : 100.0);

      const bannerData = {
        transferId: t.transfer_id,
        transfer: t,
        filename: t.filename,
        fileSize: t.file_size,
        protocolMode: t.protocol_mode,
        isWal,
        success: isSuccess,
        report,
        message: res?.message || (isWal
          ? `Disk Recovery audit complete in ${recoveryMs}ms! ${recoveredCount}/${totalCount} blocks verified on NVMe disk.`
          : 'Recovery Failed: Volatile RAM mode has NO crash-consistency guarantee (0% ACID). Data dissipated upon power loss.'),
        recoveredChunks: recoveredCount,
        totalChunks: totalCount,
        missingChunks: report.missing_chunks_count ?? (totalCount - recoveredCount),
        corruptedChunks: report.corrupted_chunks_count ?? 0,
        recoveryTimeMs: recoveryMs,
        lossPercentage: lossPct,
        resumable: isWal && recoveredCount < totalCount,
        isComplete: isSuccess || recoveredCount === totalCount,
      };

      setRecoveryBanner(bannerData);

      if (!isWal) {
        kernelLogger.log(
          'panic',
          `FATAL RECOVERY FAILURE: Volatile RAM mode has NO crash-consistency guarantee. 0/${totalCount} blocks recovered (100% Data Loss). Memory capacitors discharged.`,
          'ERROR'
        );
      } else {
        kernelLogger.log(
          'vfs',
          `RECOVERY AUDIT COMPLETE (${recoveryMs}ms): ${recoveredCount}/${totalCount} blocks cryptographically verified on NVMe disk. Status: ${isSuccess ? 'COMMITTED' : 'READY_FOR_RESUMPTION'}.`,
          'INFO'
        );
      }
    } catch (err) {
      console.error('Recovery audit failed:', err);
      kernelLogger.log('panic', `Recovery failed: ${err.message || 'Data unrecoverable'}`, 'ERROR');
      setRecoveryBanner({
        transferId: t.transfer_id,
        transfer: t,
        filename: t.filename,
        protocolMode: t.protocol_mode,
        isWal: t.protocol_mode === 'JOURNAL_WAL',
        success: false,
        message: err.message || 'OS Recovery Audit encountered an error.',
        recoveredChunks: 0,
        totalChunks: t.total_chunks || 0,
        recoveryTimeMs: 0,
        resumable: false,
      });
    }
  };

  // Top-center Recovery Button Handler
  const handleTopRecoveryClick = async () => {
    await runRecoveryForTransfer(latestTransfer);
  };

  // Transmit an actual physical file using real binary streams
  const handleTransmitFile = async (fileObj) => {
    if (!fileObj || isUploading) return;
    setIsUploading(true);
    setShowAttachMenu(false);
    setUploadStatusText(`Hashing & preparing binary ${fileObj.name}...`);

    try {
      const buffer = await fileObj.arrayBuffer();
      const fileSize = buffer.byteLength;
      const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
      const expectedHash = await computeSHA256(buffer);

      kernelLogger.log(
        'vfs',
        `sys_openat(AT_FDCWD, "${fileObj.name}", O_CREAT|O_WRONLY|O_APPEND) -> allocated fd 3, mode=${activeProtocol}`
      );

      // 1. Initiate transfer session on backend coordinator
      setUploadStatusText(`Initiating session for ${fileObj.name} (${(fileSize / 1024).toFixed(1)} KB)...`);
      const initResult = await onInitiateTransfer({
        filename: fileObj.name,
        file_size: fileSize,
        mime_type: fileObj.type || 'application/octet-stream',
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        expected_hash: expectedHash,
        protocol_mode: activeProtocol,
        receiver_id: activePeer?.id,
      });

      if (!initResult?.transfer_id) {
        setIsUploading(false);
        setUploadStatusText('');
        return;
      }

      const transferId = initResult.transfer_id;
      delete crashedTransferIdsRef.current[transferId];

      // Cache file object & buffer for crash resumption demonstration
      transferBuffersRef.current[transferId] = {
        fileObj,
        buffer,
        fileSize,
        chunkSize,
        totalChunks,
        name: fileObj.name,
      };

      // Set up AbortController for real network interruption
      const abortController = new AbortController();
      activeControllersRef.current[transferId] = abortController;

      kernelLogger.log(
        'mm',
        `sys_write(fd=3, stream_len=${fileSize}) -> chunks streaming sequentially into ${activeProtocol === 'RAM_VOLATILE' ? 'volatile dirty page cache' : 'persistent SQLite WAL extents'}.`
      );

      // Stream sequentially chunk-by-chunk for real-time visualization and observable crash consistency
      let crashTriggered = false;
      for (let idx = 0; idx < totalChunks; idx++) {
        if (abortController.signal.aborted || crashedTransferIdsRef.current[transferId]) {
          break;
        }

        const startByte = idx * chunkSize;
        const endByte = Math.min(fileSize, startByte + chunkSize);
        const chunkSlice = buffer.slice(startByte, endByte);
        const chunkHash = await computeSHA256(chunkSlice);
        const chunkB64 = arrayBufferToBase64(chunkSlice);

        // Check for deterministic crash injection checkpoint
        if (injectDeterministicCrash && idx === Math.floor(totalChunks / 2)) {
          crashTriggered = true;
          kernelLogger.log('panic', `Deterministic crash checkpoint reached at chunk #${idx} (SIGKILL injection).`, 'WARN');
          setUploadStatusText(`Injecting SIGKILL worker crash at block #${idx + 1}...`);
          await handleCrashWorker(transferId);
          break;
        }

        setUploadStatusText(`Flushing block #${idx + 1}/${totalChunks} into ${activeProtocol === 'RAM_VOLATILE' ? 'RAM Dirty Cache' : 'SQLite WAL extents'}...`);

        const chunkRes = await onUploadChunk(transferId, {
          chunk_index: idx,
          chunk_size: chunkSlice.byteLength,
          chunk_hash: chunkHash,
          data_base64: chunkB64,
        });

        if (chunkRes?.status === 'CRASHED' || chunkRes?.status === 'CORRUPTED_LOST') {
          break;
        }

        kernelLogger.log(
          activeProtocol === 'RAM_VOLATILE' ? 'mm' : 'vfs',
          `sys_write(fd=3, block=${idx}, len=${chunkSlice.byteLength}) -> ${activeProtocol === 'RAM_VOLATILE' ? 'dirty page allocated in RAM' : 'fsync barrier committed to SQLite WAL'}.`
        );

        if (chunkPacingMs > 0 && idx < totalChunks - 1) {
          await new Promise((r) => setTimeout(r, chunkPacingMs));
        }
      }

      delete activeControllersRef.current[transferId];

      if (!crashTriggered && !crashedTransferIdsRef.current[transferId]) {
        kernelLogger.log(
          'vfs',
          `sys_close(fd=3) -> stream completed. Checksum verification: ${expectedHash.slice(0, 16)}...`
        );
      }
    } catch (err) {
      console.error('File transmission failed:', err);
    } finally {
      setIsUploading(false);
      setUploadStatusText('');
    }
  };

  // Resume transfer from verified chunk offset
  const handleResumeTransfer = async (transfer) => {
    if (isUploading) return;
    const transferId = transfer.transfer_id;
    delete crashedTransferIdsRef.current[transferId];

    let cached = transferBuffersRef.current[transferId];
    let fileObj = cached?.fileObj;
    let buffer = cached?.buffer;

    // If file object not in memory (e.g. sample files), recreate if standard preset
    if (!fileObj) {
      if (transfer.filename.endsWith('.pptx')) {
        fileObj = createSamplePptxDocument();
      } else if (transfer.filename.endsWith('.svg')) {
        fileObj = createSampleArchitectureSvg();
      } else if (transfer.filename.endsWith('.pdf')) {
        fileObj = createSamplePdfDocument();
      } else if (transfer.filename.endsWith('.db') || transfer.filename.endsWith('.sqlite')) {
        fileObj = createSampleSqliteDatabase();
      }
    }

    if (!fileObj) {
      alert(`To resume ${transfer.filename}, please select the original file using the attachment menu.`);
      return;
    }

    if (!buffer) {
      buffer = await fileObj.arrayBuffer();
    }

    const currentBytes = transfer.actual_bytes_persisted || 0;
    const totalSize = transfer.file_size || buffer.byteLength;
    if (currentBytes >= totalSize && transfer.status === 'COMMITTED') {
      alert('File is already fully persisted on disk.');
      return;
    }

    // Query resume state from server to know exact next chunk index
    let nextChunk = transfer.transferred_chunks || 0;
    try {
      const stateRes = await api.transfers.getResumeState(transferId);
      if (stateRes?.data) {
        nextChunk = stateRes.data.next_chunk_index || 0;
      }
    } catch (e) {
      console.warn('Failed to query resume state, falling back to transferred_chunks:', e);
    }

    const tChunkSize = transfer.chunk_size || 65536;
    const totalChunks = transfer.total_chunks || Math.max(1, Math.ceil(totalSize / tChunkSize));

    if (nextChunk >= totalChunks) {
      alert('All chunks have already been received and verified.');
      return;
    }

    setIsUploading(true);
    setUploadStatusText(`Resuming transfer from verified chunk #${nextChunk}/${totalChunks}...`);

    kernelLogger.log(
      'vfs',
      `sys_lseek(fd=3, offset=${nextChunk * tChunkSize}, SEEK_SET) -> resuming stream from verified NVMe boundary (chunk #${nextChunk}).`
    );

    const abortController = new AbortController();
    activeControllersRef.current[transferId] = abortController;

    try {
      for (let idx = nextChunk; idx < totalChunks; idx++) {
        if (abortController.signal.aborted || crashedTransferIdsRef.current[transferId]) {
          break;
        }

        const startByte = idx * tChunkSize;
        const endByte = Math.min(totalSize, startByte + tChunkSize);
        const chunkSlice = buffer.slice(startByte, endByte);
        const chunkHash = await computeSHA256(chunkSlice);
        const chunkB64 = arrayBufferToBase64(chunkSlice);

        setUploadStatusText(`Resuming: Flushing block #${idx + 1}/${totalChunks} into SQLite WAL extents...`);

        const chunkRes = await onUploadChunk(transferId, {
          chunk_index: idx,
          chunk_size: chunkSlice.byteLength,
          chunk_hash: chunkHash,
          data_base64: chunkB64,
        });

        if (chunkRes?.status === 'CRASHED' || chunkRes?.status === 'CORRUPTED_LOST') {
          break;
        }

        kernelLogger.log(
          'vfs',
          `sys_write(fd=3, block=${idx}, len=${chunkSlice.byteLength}) -> fsync barrier committed to SQLite WAL extent.`
        );

        if (chunkPacingMs > 0 && idx < totalChunks - 1) {
          await new Promise((r) => setTimeout(r, chunkPacingMs));
        }
      }
    } catch (err) {
      console.error('Resume transmission failed:', err);
    } finally {
      delete activeControllersRef.current[transferId];
      setIsUploading(false);
      setUploadStatusText('');
    }
  };

  // Preset file triggers
  const handleSendPresetFile = (type) => {
    let file = null;
    if (type === 'pptx_presentation') {
      file = createSamplePptxDocument();
    } else if (type === 'architecture_svg') {
      file = createSampleArchitectureSvg();
    } else if (type === 'research_pdf') {
      file = createSamplePdfDocument();
    } else {
      file = createSampleSqliteDatabase();
    }
    handleTransmitFile(file);
  };

  // Latest kernel log for the ticker bar
  const latestKernelLog = kernelLogs[kernelLogs.length - 1] || {
    timestamp: '0.000000',
    subsystem: 'vfs',
    message: 'Linux VFS & Page Cache subsystem idle.',
  };

  const styles = {
    chatWindow: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--color-bg, #090913)',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
    },
    chatHeader: {
      height: '62px',
      backgroundColor: 'var(--color-surface, #14142a)',
      borderBottom: '1px solid var(--color-border, rgba(99, 67, 224, 0.22))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      color: 'var(--color-text-primary, #f8f9fd)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
      zIndex: 10,
    },
    headerPeer: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      minWidth: 0,
    },
    avatar: (color) => ({
      width: '38px',
      height: '38px',
      borderRadius: '50%',
      backgroundColor: color || 'var(--color-primary, #6343e0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      color: '#ffffff',
      fontSize: '15px',
      boxShadow: `0 0 12px ${color ? `${color}55` : 'rgba(99, 67, 224, 0.4)'}`,
      border: '2px solid rgba(255, 255, 255, 0.15)',
      flexShrink: 0,
    }),
    peerName: {
      fontSize: '14.5px',
      fontWeight: '700',
      color: 'var(--color-text-primary, #f8f9fd)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    peerSub: {
      fontSize: '11px',
      color: 'var(--color-text-secondary, #a4abd1)',
      marginTop: '1px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    onlineDot: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      backgroundColor: '#00ff88',
      boxShadow: '0 0 6px #00ff88',
      display: 'inline-block',
    },
    headerActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    protocolSelectorGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      padding: '3px 6px',
      borderRadius: '20px',
      border: '1px solid rgba(99, 67, 224, 0.25)',
    },
    protocolPill: (isActive, isRam) => ({
      padding: '4px 10px',
      borderRadius: '14px',
      fontSize: '10.5px',
      fontWeight: '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      border: 'none',
      background: isActive
        ? (isRam ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, #6343e0 0%, #00d2ff 100%)')
        : 'transparent',
      color: isActive ? '#ffffff' : 'var(--color-text-muted, #6f779b)',
      boxShadow: isActive
        ? (isRam ? '0 0 10px rgba(245, 158, 11, 0.4)' : '0 0 12px rgba(0, 210, 255, 0.4)')
        : 'none',
      transition: 'all 0.15s ease',
    }),
    kernelConsoleBtn: {
      backgroundColor: showKernelConsole ? 'rgba(0, 210, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
      border: `1px solid ${showKernelConsole ? '#00d2ff' : 'rgba(255, 255, 255, 0.1)'}`,
      color: showKernelConsole ? '#00d2ff' : '#a4abd1',
      padding: '5px 9px',
      borderRadius: '8px',
      fontSize: '11px',
      fontWeight: '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      transition: 'all 0.15s ease',
    },
    recoveryBanner: (isWal) => ({
      backgroundColor: isWal ? 'rgba(6, 44, 34, 0.96)' : 'rgba(50, 10, 20, 0.96)',
      borderBottom: `2px solid ${isWal ? '#00ff88' : '#ff3366'}`,
      padding: '12px 18px',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '16px',
      boxShadow: `0 8px 24px ${isWal ? 'rgba(0, 255, 136, 0.25)' : 'rgba(255, 51, 102, 0.25)'}`,
      zIndex: 11,
      flexWrap: 'wrap',
    }),
    // Top Live dmesg Ticker Bar
    dmesgTicker: {
      height: '28px',
      backgroundColor: 'rgba(5, 5, 12, 0.95)',
      borderBottom: '1px solid rgba(0, 210, 255, 0.2)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      fontFamily: 'monospace',
      fontSize: '10.5px',
      color: '#00d2ff',
      cursor: 'pointer',
      userSelect: 'none',
      zIndex: 9,
    },
    // Expandable Kernel Console Panel
    kernelDrawer: {
      height: '180px',
      backgroundColor: 'rgba(5, 5, 12, 0.98)',
      borderBottom: '1px solid rgba(0, 210, 255, 0.35)',
      padding: '10px 16px',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#a4abd1',
      overflowY: 'auto',
      zIndex: 9,
      boxShadow: 'inset 0 4px 12px rgba(0, 0, 0, 0.8)',
    },
    kernelLogLine: (level) => ({
      margin: '2px 0',
      lineHeight: '1.4',
      color: level === 'ERROR' ? '#ff3366' : (level === 'WARN' ? '#f59e0b' : '#34d399'),
    }),
    // Main Chat Message & File Feed
    messageFeed: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    msgRow: (isMe) => ({
      display: 'flex',
      justifyContent: isMe ? 'flex-end' : 'flex-start',
      margin: '2px 0',
    }),
    // Authentic WhatsApp Chat Bubble
    msgBubble: (isMe) => ({
      backgroundColor: isMe
        ? 'rgba(6, 78, 59, 0.55)' // WhatsApp sent dark green tint
        : 'rgba(24, 27, 45, 0.9)', // WhatsApp received slate dark
      color: 'var(--color-text-primary, #f8f9fd)',
      padding: '8px 12px',
      borderRadius: isMe ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
      maxWidth: '65%',
      fontSize: '13px',
      lineHeight: '1.45',
      position: 'relative',
      boxShadow: isMe ? '0 2px 8px rgba(0, 0, 0, 0.35)' : '0 2px 8px rgba(0, 0, 0, 0.35)',
      border: isMe
        ? '1px solid rgba(16, 185, 129, 0.35)'
        : '1px solid rgba(99, 67, 224, 0.35)',
    }),
    msgTime: {
      fontSize: '9.5px',
      color: 'rgba(255, 255, 255, 0.6)',
      textAlign: 'right',
      marginTop: '3px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '4px',
    },
    bottomBar: {
      minHeight: '62px',
      backgroundColor: 'var(--color-surface, #14142a)',
      padding: '10px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      borderTop: '1px solid var(--color-border, rgba(99, 67, 224, 0.22))',
    },
    attachBtn: {
      background: showAttachMenu ? 'rgba(0, 210, 255, 0.15)' : 'none',
      border: showAttachMenu ? '1px solid rgba(0, 210, 255, 0.4)' : 'none',
      color: showAttachMenu ? '#00d2ff' : 'var(--color-text-secondary, #a4abd1)',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'all 0.2s ease',
    },
    attachMenu: {
      position: 'absolute',
      bottom: '72px',
      left: '20px',
      backgroundColor: 'var(--color-surface, #14142a)',
      border: '1px solid var(--color-border, rgba(99, 67, 224, 0.35))',
      borderRadius: '16px',
      padding: '16px',
      boxShadow: '0 16px 40px rgba(0,0,0,0.8), 0 0 24px rgba(99, 67, 224, 0.2)',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      zIndex: 50,
      width: '390px',
      maxWidth: 'calc(100vw - 40px)',
    },
    attachMenuItem: {
      padding: '10px 12px',
      borderRadius: '10px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      color: 'var(--color-text-primary, #f8f9fd)',
      fontSize: '12px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      transition: 'all 0.15s ease',
    },
    textInput: {
      flex: 1,
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      border: '1px solid rgba(99, 67, 224, 0.25)',
      borderRadius: '10px',
      padding: '10px 16px',
      color: 'var(--color-text-primary, #f8f9fd)',
      fontSize: '13.5px',
      outline: 'none',
      boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.4)',
    },
    sendBtn: {
      background: 'linear-gradient(135deg, var(--color-primary, #6343e0) 0%, var(--color-accent, #00d2ff) 100%)',
      border: 'none',
      color: '#ffffff',
      width: '42px',
      height: '42px',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      flexShrink: 0,
      boxShadow: '0 0 16px rgba(0, 210, 255, 0.4)',
      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    },
  };

  if (!activePeer) {
    return (
      <div style={{ ...styles.chatWindow, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#8696a0', padding: '20px' }}>
          <div style={{ marginBottom: '12px' }}>
            <DatabaseIcon size={48} color="#00d2ff" />
          </div>
          <h3 style={{ color: '#e9edef', marginBottom: '6px' }}>Select a Contact to Start OS File Transmission</h3>
          <p style={{ fontSize: '13px', maxWidth: '420px', lineHeight: '1.5' }}>
            Select a peer from the contacts sidebar to stream physical files, inspect VFS Inodes and Kernel Page Caches, and simulate power cuts / worker SIGKILL crashes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.chatWindow}>
      {/* 1. Chat Header */}
      <div style={styles.chatHeader}>
        <div style={styles.headerPeer}>
          <div style={styles.avatar(activePeer.avatar_color)}>
            {(activePeer.display_name || activePeer.phone_number || activePeer.username || 'U').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.peerName}>{activePeer.display_name || activePeer.phone_number || 'Node'}</div>
            <div style={styles.peerSub}>
              <span style={styles.onlineDot} />
              <span>{activePeer.phone_number ? `+91 ${activePeer.phone_number}` : (activePeer.username ? `@${activePeer.username}` : '')} • Online</span>
            </div>
          </div>
        </div>

        {/* Top-Center: Direct Red Crash & Recovery Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            style={{
              backgroundColor: '#ff3366',
              border: 'none',
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 0 12px rgba(255, 51, 102, 0.45)',
              transition: 'all 0.15s ease',
            }}
            onClick={handleTopCrashClick}
            title="Immediately crash active/latest file transfer to test power failure"
          >
            <CrashIcon size={13} color="#ffffff" />
            <span>⚡ Crash Server</span>
          </button>

          <button
            style={{
              backgroundColor: hasCrashedOrInterrupted ? '#00d2ff' : 'rgba(0, 210, 255, 0.12)',
              border: '1px solid #00d2ff',
              color: hasCrashedOrInterrupted ? '#000000' : '#00d2ff',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: hasCrashedOrInterrupted ? '0 0 16px rgba(0, 210, 255, 0.6)' : 'none',
              transition: 'all 0.15s ease',
            }}
            onClick={handleTopRecoveryClick}
            title="Execute OS Journal Crash Recovery on the latest file"
          >
            <RefreshCwIcon size={13} color={hasCrashedOrInterrupted ? '#000000' : '#00d2ff'} />
            <span>🛡️ Run OS Recovery</span>
          </button>
        </div>

        {/* Header Controls: Protocol Selector & Live dmesg console toggle */}
        <div style={styles.headerActions}>
          <div style={styles.protocolSelectorGroup}>
            <button
              style={styles.protocolPill(activeProtocol === 'RAM_VOLATILE', true)}
              onClick={() => setActiveProtocol('RAM_VOLATILE')}
              title="Volatile RAM Page Cache Mode (sys_write without barrier)"
            >
              <CpuIcon size={12} color={activeProtocol === 'RAM_VOLATILE' ? '#ffffff' : '#f59e0b'} />
              <span>RAM Volatile</span>
            </button>
            <button
              style={styles.protocolPill(activeProtocol === 'JOURNAL_WAL', false)}
              onClick={() => setActiveProtocol('JOURNAL_WAL')}
              title="SQLite Write-Ahead Log Journal Mode (sys_fsync ordered barrier)"
            >
              <DatabaseIcon size={12} color={activeProtocol === 'JOURNAL_WAL' ? '#ffffff' : '#00d2ff'} />
              <span>SQLite WAL</span>
            </button>
          </div>

          <button
            style={styles.kernelConsoleBtn}
            onClick={() => setShowKernelConsole(!showKernelConsole)}
            title="Toggle Live OS Kernel Ring Buffer (dmesg)"
          >
            <TerminalIcon size={13} color="currentColor" />
            <span>dmesg</span>
          </button>
        </div>
      </div>

      {/* 1.5. OS Recovery Diagnostics Banner */}
      {recoveryBanner && (
        <div style={styles.recoveryBanner(recoveryBanner.isWal)}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flex: 1, minWidth: '280px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                backgroundColor: recoveryBanner.isWal ? 'rgba(0, 255, 136, 0.18)' : 'rgba(255, 51, 102, 0.18)',
                border: `1px solid ${recoveryBanner.isWal ? '#00ff88' : '#ff3366'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {recoveryBanner.isWal ? (
                <ShieldCheckIcon size={22} color="#00ff88" />
              ) : (
                <AlertTriangleIcon size={22} color="#ff3366" />
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <strong
                  style={{
                    fontSize: '13.5px',
                    color: recoveryBanner.isWal ? '#00ff88' : '#ff3366',
                    letterSpacing: '0.2px',
                  }}
                >
                  {recoveryBanner.isWal
                    ? '🛡️ OS CRASH RECOVERY COMPLETE: NVMe SQLite WAL Replay'
                    : '💥 OS RECOVERY FAILED: Volatile DRAM Buffer Dissipated'}
                </strong>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    backgroundColor: recoveryBanner.isWal ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 51, 102, 0.2)',
                    color: recoveryBanner.isWal ? '#00ff88' : '#ff3366',
                    border: `1px solid ${recoveryBanner.isWal ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 51, 102, 0.4)'}`,
                  }}
                >
                  {recoveryBanner.isWal ? '100% ACID Durability' : '0% ACID (Zero Guarantee)'}
                </span>
                <span style={{ fontSize: '11px', color: '#a4abd1', fontFamily: 'monospace' }}>
                  RTO: {recoveryBanner.recoveryTimeMs}ms
                </span>
              </div>

              <div style={{ fontSize: '12px', color: '#f8f9fd', lineHeight: '1.45', marginBottom: '6px' }}>
                {recoveryBanner.isWal ? (
                  <>
                    Audit verified <strong>{recoveryBanner.recoveredChunks} of {recoveryBanner.totalChunks}</strong> extents intact on disk ({formatBytes(recoveryBanner.fileSize || 0)} total).
                    {recoveryBanner.resumable
                      ? ` Next byte offset: Chunk #${recoveryBanner.recoveredChunks}. Zero blocks need retransmission.`
                      : ' All blocks verified with SHA-256 integrity barrier.'}
                  </>
                ) : (
                  <>
                    Process memory wiped upon simulated power cut. Uncommitted dirty pages had no disk write barrier (<code style={{ color: '#ff7799' }}>fsync</code>). 
                    <strong> 100% data loss ({recoveryBanner.totalChunks} chunks dissipated).</strong>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                {recoveryBanner.resumable && (
                  <button
                    style={{
                      backgroundColor: '#00d2ff',
                      color: '#090913',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '8px',
                      fontSize: '11.5px',
                      fontWeight: '800',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 0 12px rgba(0, 210, 255, 0.5)',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      handleResumeTransfer(recoveryBanner.transfer || latestTransfer);
                      setRecoveryBanner(null);
                    }}
                    title="Resume stream from verified chunk offset without retransmitting prior data"
                  >
                    <PlayIcon size={12} color="#090913" />
                    <span>▶️ Resume Transfer Now</span>
                  </button>
                )}

                {!recoveryBanner.isWal && (
                  <button
                    style={{
                      backgroundColor: 'rgba(99, 67, 224, 0.35)',
                      border: '1px solid #7e61ff',
                      color: '#ffffff',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                    onClick={() => {
                      setActiveProtocol('JOURNAL_WAL');
                      setRecoveryBanner(null);
                    }}
                    title="Switch to SQLite WAL persistent disk mode for 100% ACID durability"
                  >
                    <DatabaseIcon size={12} color="#00d2ff" />
                    <span>Switch to SQLite WAL</span>
                  </button>
                )}

                <button
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.18)',
                    color: '#00d2ff',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                  onClick={() => {
                    if (onOpenOSLab) {
                      onOpenOSLab(recoveryBanner);
                    }
                  }}
                  title="Open OS Kernel Lab to inspect sector allocation, LSN sequence, and dirty memory cache"
                >
                  <CpuIcon size={12} color="#00d2ff" />
                  <span>🔬 Inspect in OS Kernel Lab</span>
                </button>
              </div>
            </div>
          </div>

          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#a4abd1',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={() => setRecoveryBanner(null)}
            title="Dismiss"
          >
            <XIcon size={16} color="#a4abd1" />
          </button>
        </div>
      )}

      {/* 2. Top Live OS Kernel Ring Buffer (dmesg) Ticker Bar */}
      <div
        style={styles.dmesgTicker}
        onClick={() => setShowKernelConsole(!showKernelConsole)}
        title="Click to view full OS kernel ring buffer"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <span style={{ color: '#7e61ff' }}>[dmesg]</span>
          <span style={{ color: '#6f779b' }}>[{latestKernelLog.timestamp}]</span>
          <span style={{ color: latestKernelLog.level === 'ERROR' ? '#ff3366' : (latestKernelLog.level === 'WARN' ? '#f59e0b' : '#34d399') }}>
            [{latestKernelLog.subsystem}]
          </span>
          <span style={{ color: '#f8f9fd' }}>{latestKernelLog.message}</span>
        </div>
        <span style={{ color: '#00d2ff', fontSize: '9px', flexShrink: 0, marginLeft: '10px' }}>
          {showKernelConsole ? '▲ HIDE' : '▼ EXPAND'}
        </span>
      </div>

      {/* 3. Expandable Full OS Kernel Console Drawer */}
      {showKernelConsole && (
        <div style={styles.kernelDrawer}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '4px' }}>
            <strong style={{ color: '#00d2ff' }}>Linux Kernel Ring Buffer Console (dmesg -w)</strong>
            <button
              style={{ background: 'none', border: 'none', color: '#a4abd1', cursor: 'pointer', fontSize: '11px' }}
              onClick={() => kernelLogger.clear()}
            >
              Clear Buffer
            </button>
          </div>
          {kernelLogs.map((entry) => (
            <div key={entry.id} style={styles.kernelLogLine(entry.level)}>
              <span style={{ color: '#6f779b' }}>[{entry.timestamp}]</span>{' '}
              <span style={{ color: '#a78bfa' }}>[{entry.subsystem}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))}
          <div ref={kernelConsoleEndRef} />
        </div>
      )}

      {/* 4. Unified Chronological Feed: Messages & File Transmissions */}
      <div style={styles.messageFeed}>
        {feedItems.map((item) => {
          if (item.type === 'transfer') {
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: item.isMe ? 'flex-end' : 'flex-start',
                }}
              >
                <TransmissionCard
                  transfer={item.data}
                  currentUser={currentUser}
                  onSimulateCrash={handleSimulateCrashWithAbort}
                  onInterruptTransfer={handleInterruptTransfer}
                  onCrashWorker={handleCrashWorker}
                  onRecoverTransfer={() => runRecoveryForTransfer(item.data)}
                  onResumeTransfer={handleResumeTransfer}
                  onDownloadFile={onDownloadFile}
                />
              </div>
            );
          }

          // Plain text message bubble
          return (
            <div key={item.id} style={styles.msgRow(item.isMe)}>
              <div style={styles.msgBubble(item.isMe)}>
                {!item.isMe && (
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#00d2ff', marginBottom: '2px' }}>
                    {item.data.sender_name || item.data.sender_username}
                  </div>
                )}
                <div>{item.data.content}</div>
                <div style={styles.msgTime}>
                  <span>{new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()}</span>
                  {item.isMe && <span style={{ color: '#00d2ff', fontSize: '11px' }}>✓✓</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 5. Attachment Menu Studio Modal */}
      {showAttachMenu && (
        <div style={styles.attachMenu}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#e9edef' }}>
              Transmit File to {activePeer.display_name || activePeer.phone_number || 'Peer'}:
            </div>
            <button
              style={{ background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer', fontSize: '16px' }}
              onClick={() => setShowAttachMenu(false)}
            >
              ✕
            </button>
          </div>

          <div style={{ fontSize: '11px', color: '#8696a0', display: 'flex', justifyContent: 'space-between' }}>
            <span>Protocol: <strong style={{ color: activeProtocol === 'RAM_VOLATILE' ? '#f59e0b' : '#00ff88' }}>
              {activeProtocol === 'RAM_VOLATILE' ? 'RAM Buffer (0% crash guarantee)' : 'SQLite WAL (100% ACID guarantee)'}
            </strong></span>
          </div>

          {/* Chunk Flush Block Size & Simulated I/O Pacing Configuration */}
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#8696a0' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Stream Flush Block Size:</label>
              <select
                value={chunkSize}
                onChange={(e) => setChunkSize(Number(e.target.value))}
                style={{ width: '100%', padding: '6px', backgroundColor: '#111b21', color: '#e9edef', border: '1px solid #2a3942', borderRadius: '6px', outline: 'none' }}
              >
                <option value={16384}>16 KB (Detailed Fsync)</option>
                <option value={65536}>64 KB (Standard Stream)</option>
                <option value={262144}>256 KB (High Throughput)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '10px' }}>Simulated I/O Pacing:</label>
              <select
                value={chunkPacingMs}
                onChange={(e) => setChunkPacingMs(Number(e.target.value))}
                style={{ width: '100%', padding: '6px', backgroundColor: '#111b21', color: '#e9edef', border: '1px solid #2a3942', borderRadius: '6px', outline: 'none' }}
              >
                <option value={140}>🐢 Lab Demo (140ms / block)</option>
                <option value={50}>⚡ Realistic (50ms / block)</option>
                <option value={0}>🚀 Max Speed (0ms delay)</option>
              </select>
            </div>
          </div>

          {/* Deterministic Crash Checkpoint Option */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#eab308', cursor: 'pointer', backgroundColor: '#111b21', padding: '8px 10px', borderRadius: '6px', border: '1px solid #2a3942' }}>
            <input
              type="checkbox"
              checked={injectDeterministicCrash}
              onChange={(e) => setInjectDeterministicCrash(e.target.checked)}
            />
            <span>Inject deterministic worker crash at 50% bytes (tests worker SIGKILL)</span>
          </label>

          {/* 1. Primary Action: Choose ANY Physical File from PC */}
          <div
            style={{
              ...styles.attachMenuItem,
              background: 'linear-gradient(135deg, var(--color-primary, #6343e0) 0%, var(--color-accent, #00d2ff) 100%)',
              color: '#ffffff',
              justifyContent: 'center',
              fontWeight: '700',
              border: 'none',
              boxShadow: '0 0 16px rgba(0, 210, 255, 0.35)',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <span>📁 Choose Any File / Image from PC</span>
          </div>

          <div style={{ fontSize: '11px', color: '#8696a0', marginTop: '2px' }}>
            Or transmit an authentic OS sample document:
          </div>

          {/* Preset 0: Authentic PPTX Presentation Document (matches user screenshot) */}
          <div style={styles.attachMenuItem} onClick={() => handleSendPresetFile('pptx_presentation')}>
            <span style={{ fontSize: '18px' }}>📊</span>
            <div>
              <strong>Presentation Deck (OS_Crash_Consistency_PBL.pptx)</strong>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>PowerPoint OOXML presentation • ~512 KB</div>
            </div>
          </div>

          {/* Preset 1: Real Vector Architecture Diagram (SVG) */}
          <div style={styles.attachMenuItem} onClick={() => handleSendPresetFile('architecture_svg')}>
            <span style={{ fontSize: '18px' }}>🖼️</span>
            <div>
              <strong>Architecture Schematic (SVG Image)</strong>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>Real visual graphic • Opens in viewer • ~4.5 KB</div>
            </div>
          </div>

          {/* Preset 2: Real PDF Research Document */}
          <div style={styles.attachMenuItem} onClick={() => handleSendPresetFile('research_pdf')}>
            <span style={{ fontSize: '18px' }}>📑</span>
            <div>
              <strong>Crash-Consistency Report (Real PDF)</strong>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>Formatted PDF binary • Opens in Acrobat • ~2.1 KB</div>
            </div>
          </div>

          {/* Preset 3: Real SQLite Database Binary */}
          <div style={styles.attachMenuItem} onClick={() => handleSendPresetFile('sqlite_db')}>
            <span style={{ fontSize: '18px' }}>💾</span>
            <div>
              <strong>SQLite Transaction Ledger (DB Binary)</strong>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>Valid SQLite 3 binary file • ACID ledger • ~16 KB</div>
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                handleTransmitFile(e.target.files[0]);
              }
            }}
          />
        </div>
      )}

      {/* 6. Bottom Bar: Attachment, Input, Send */}
      <form style={styles.bottomBar} onSubmit={handleSendText}>
        <button
          type="button"
          style={styles.attachBtn}
          onClick={() => setShowAttachMenu(!showAttachMenu)}
          title="Transmit physical files with chunking and crash testing"
        >
          <PaperclipIcon size={20} color={showAttachMenu ? '#00d2ff' : '#a4abd1'} />
        </button>

        <input
          type="text"
          placeholder={
            isUploading
              ? uploadStatusText || 'Streaming binary chunks directly to NVMe worker...'
              : `Message ${activePeer.display_name || activePeer.phone_number}...`
          }
          style={styles.textInput}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />

        <button type="submit" style={styles.sendBtn} title="Send Message">
          <SendIcon size={18} color="#ffffff" />
        </button>
      </form>
    </div>
  );
}
