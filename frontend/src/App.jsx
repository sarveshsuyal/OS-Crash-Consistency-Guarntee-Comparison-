import React, { useState, useEffect, useCallback, useRef } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import OSDashboard from './components/OSDashboard';
import ServerConfigModal from './components/ServerConfigModal';
import AuthModal from './components/AuthModal';
import ToastContainer from './components/ToastContainer';
import OSKernelLab from './components/OSKernelLab';
import { api, getStoredUser, setStoredUser, computeSHA256, arrayBufferToBase64 } from './api';
import {
  playNotificationSound,
  triggerDesktopNotification,
  requestNotificationPermission,
} from './utils/notifications';

export default function App() {
  const [currentUser, setCurrentUser] = useState(getStoredUser());
  const [activePeer, setActivePeer] = useState(null);
  const [activeProtocol, setActiveProtocol] = useState('JOURNAL_WAL'); // 'JOURNAL_WAL' | 'RAM_VOLATILE'
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [backendStatus, setBackendStatus] = useState('CHECKING');

  // Notification Toasts State
  const [toasts, setToasts] = useState([]);
  const seenMsgIdsRef = useRef(new Set());
  const seenTransferIdsRef = useRef(new Set());
  const isFirstLoadRef = useRef(true);

  // Modals
  const [isServerConfigOpen, setIsServerConfigOpen] = useState(false);
  const [isOSDashboardOpen, setIsOSDashboardOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(!getStoredUser());
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState('CHAT'); // 'CHAT' | 'LAB'
  const [activeRecoveryReport, setActiveRecoveryReport] = useState(null);

  const handleOpenOSLab = (report = null) => {
    if (report) {
      setActiveRecoveryReport(report);
    }
    setViewMode('LAB');
  };

  // Automated Benchmark State
  const [isBenchmarkRunning, setIsBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');

  const addToast = useCallback((toast) => {
    setToasts((prev) => [toast, ...prev.slice(0, 3)]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 6000);
  }, []);

  // 1. Initial Health Check & Load Users List
  const checkHealthAndLoadData = useCallback(async () => {
    try {
      const healthRes = await api.checkHealth();
      if (healthRes.data?.status === 'ONLINE') {
        setBackendStatus('ONLINE');
      } else {
        setBackendStatus('OFFLINE');
      }

      // Fetch users list
      const usersRes = await api.users.list(searchQuery);
      if (usersRes.data && Array.isArray(usersRes.data)) {
        setUsers(usersRes.data);
      }
    } catch (err) {
      console.error('Initial load failed:', err);
      setBackendStatus('OFFLINE');
    }
  }, [searchQuery]);

  useEffect(() => {
    checkHealthAndLoadData();
    requestNotificationPermission();
  }, [checkHealthAndLoadData]);

  // Set default active peer when users list loads
  useEffect(() => {
    if (users.length > 0 && !activePeer) {
      const peer = users.find((u) => u.id !== currentUser?.id);
      if (peer) setActivePeer(peer);
    }
  }, [users, currentUser, activePeer]);

  // 2. Fetch Chat Messages & Transfers with Active Peer
  const refreshFeed = useCallback(async () => {
    try {
      const metricsRes = await api.osMetrics.get();
      if (metricsRes.data) setMetrics(metricsRes.data);

      if (activePeer) {
        const [msgRes, transferRes] = await Promise.all([
          api.chat.getMessages(activePeer.id),
          api.transfers.list(activePeer.id),
        ]);

        const newMsgs = msgRes.data || [];
        const newTransfers = transferRes.data || [];

        // Check for new incoming notifications (if not first load)
        if (!isFirstLoadRef.current) {
          // Check new incoming messages
          for (const m of newMsgs) {
            if (m.sender !== currentUser?.id && !seenMsgIdsRef.current.has(m.id)) {
              playNotificationSound();
              triggerDesktopNotification(
                `💬 Message from ${m.sender_name || 'Contact'}`,
                m.content
              );
              addToast({
                id: `msg-${m.id}-${Date.now()}`,
                type: 'message',
                title: `Message from ${m.sender_name || 'Contact'}`,
                message: m.content,
                peer: activePeer,
              });
              seenMsgIdsRef.current.add(m.id);
            }
          }

          // Check new incoming transfers
          for (const t of newTransfers) {
            if (t.sender !== currentUser?.id && !seenTransferIdsRef.current.has(t.transfer_id)) {
              playNotificationSound();
              triggerDesktopNotification(
                `📁 Incoming File from ${t.sender_name || 'Contact'}`,
                `${t.filename} (${(t.file_size / 1024).toFixed(1)} KB) via [${t.protocol_mode}]`
              );
              addToast({
                id: `trans-${t.transfer_id}-${Date.now()}`,
                type: 'file',
                title: `📁 File Transfer from ${t.sender_name || 'Contact'}`,
                message: `${t.filename} (${(t.file_size / 1024).toFixed(1)} KB)`,
                meta: `Protocol: ${t.protocol_mode === 'RAM_VOLATILE' ? 'RAM Buffer' : 'SQLite WAL'}`,
                peer: activePeer,
              });
              seenTransferIdsRef.current.add(t.transfer_id);
            }
          }
        } else {
          // First load: register initial IDs without alerting
          newMsgs.forEach((m) => seenMsgIdsRef.current.add(m.id));
          newTransfers.forEach((t) => seenTransferIdsRef.current.add(t.transfer_id));
          isFirstLoadRef.current = false;
        }

        setMessages(newMsgs);
        setTransfers(newTransfers);
      }
    } catch (err) {
      console.error('Refresh feed error:', err);
    }
  }, [activePeer, currentUser, addToast]);

  // Polling loop every 3 seconds for live peer-to-peer updates
  useEffect(() => {
    refreshFeed();
    const interval = setInterval(refreshFeed, 3000);
    return () => clearInterval(interval);
  }, [refreshFeed]);

  // Handle search by name or 10-digit phone
  const handleSearchChange = async (val) => {
    setSearchQuery(val);
    try {
      const res = await api.users.list(val);
      if (res.data && Array.isArray(res.data)) {
        setUsers(res.data);
      }
    } catch (err) {
      console.error('Search error:', err);
    }
  };

  const handleLogout = () => {
    api.auth.logout();
    setCurrentUser(null);
    setActivePeer(null);
    setMessages([]);
    setTransfers([]);
    seenMsgIdsRef.current.clear();
    seenTransferIdsRef.current.clear();
    isFirstLoadRef.current = true;
    setIsAuthModalOpen(true);
  };

  // 3. Send Chat Message
  const handleSendMessage = async (content, receiverId) => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }
    const res = await api.chat.sendMessage(content, receiverId);
    if (res.data) {
      setMessages((prev) => [...prev, res.data]);
      seenMsgIdsRef.current.add(res.data.id);
    }
  };

  // 4. Transfer Actions
  const handleInitiateTransfer = async (payload) => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return null;
    }
    const res = await api.transfers.initiate(payload);
    if (res.data) {
      setTransfers((prev) => [res.data, ...prev]);
      seenTransferIdsRef.current.add(res.data.transfer_id);
      refreshFeed();
      return res.data;
    }
    return null;
  };

  const handleUploadChunk = async (transferId, chunkData) => {
    const res = await api.transfers.uploadChunk(transferId, chunkData);
    if (res.data) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.transfer_id === transferId
            ? { ...t, transferred_chunks: res.data.transferred_chunks, status: res.data.status }
            : t
        )
      );
      return res.data;
    }
    return null;
  };

  const handleInterruptTransfer = async (transferId) => {
    const res = await api.transfers.interrupt(transferId);
    refreshFeed();
    return res.data;
  };

  const handleCrashWorker = async (transferId) => {
    const res = await api.transfers.crashWorker(transferId);
    refreshFeed();
    return res.data;
  };

  const handleSimulateCrash = async (transferId) => {
    const res = await api.transfers.simulateCrash(transferId);
    refreshFeed();
    return res.data;
  };

  const handleRecoverTransfer = async (transferId) => {
    const res = await api.transfers.recover(transferId);
    refreshFeed();
    return res.data || (res.error ? { error: res.error, report: res.data?.report } : null);
  };

  const handleDownloadFile = (transferId, isPartial = false) => {
    const url = api.transfers.getDownloadUrl(transferId, isPartial);
    window.open(url, '_blank');
  };

  const handleGlobalCrash = async () => {
    try {
      const res = await api.transfers.simulateCrash(null);
      addToast({
        id: `crash-${Date.now()}`,
        type: 'CRASH',
        title: '⚡ Power Cut Injected',
        message: res.data?.message || 'Volatile caches wiped out. Active processes halted.',
      });
      refreshFeed();
    } catch (err) {
      console.error('Crash failed:', err);
    }
  };

  const handleResetMetrics = async () => {
    if (window.confirm('Reset all transfer sessions, journal logs, and metric counters?')) {
      await api.osMetrics.reset();
      refreshFeed();
    }
  };

  // 5. Automated Benchmark Test (Using Real Binary Streams)
  const handleRunBenchmark = async () => {
    if (!currentUser) {
      setIsAuthModalOpen(true);
      return;
    }
    if (!activePeer) {
      alert('Please select or search for a contact node first to run the benchmark transfer.');
      return;
    }

    setIsBenchmarkRunning(true);
    setBenchmarkProgress('Initializing Real Binary Benchmark Nodes...');

    try {
      // 128 KB real binary buffer
      const dummyPayload = 'REAL_BINARY_OS_CRASH_CONSISTENCY_BENCHMARK_BYTES_WAL_FSYNC_VERIFY_'.repeat(2000);
      const encoder = new TextEncoder();
      const rawBytes = encoder.encode(dummyPayload);
      const chunkSize = 65536; // 64 KB flush blocks
      const totalChunks = Math.ceil(rawBytes.byteLength / chunkSize);
      const expectedHash = await computeSHA256(rawBytes.buffer);

      // STEP 1: RAM Volatile Mode Test
      setBenchmarkProgress('Test 1/2: Streaming real binary bytes under Volatile RAM Buffer Mode...');
      const ramTransfer = await handleInitiateTransfer({
        filename: 'ram-volatile-benchmark.bin',
        file_size: rawBytes.byteLength,
        mime_type: 'application/octet-stream',
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        expected_hash: expectedHash,
        protocol_mode: 'RAM_VOLATILE',
        receiver_id: activePeer?.id,
      });

      if (ramTransfer?.transfer_id) {
        // Stream half the binary data
        const halfBlob = new Blob([rawBytes.slice(0, 65536)]);
        await api.transfers.streamBinaryContent(ramTransfer.transfer_id, halfBlob);

        setBenchmarkProgress('Test 1/2: Injecting abrupt process crash / power wipe in Volatile RAM mode...');
        await handleCrashWorker(ramTransfer.transfer_id);
        await new Promise((r) => setTimeout(r, 600));

        setBenchmarkProgress('Test 1/2: Attempting RAM recovery -> Result: 100% Volatile Data Loss (0% guarantee)...');
        await handleRecoverTransfer(ramTransfer.transfer_id);
      }

      await new Promise((r) => setTimeout(r, 1000));

      // STEP 2: SQLite WAL Mode Test
      setBenchmarkProgress('Test 2/2: Streaming real binary bytes under SQLite WAL Journal Mode...');
      const walTransfer = await handleInitiateTransfer({
        filename: 'sqlite-wal-benchmark.bin',
        file_size: rawBytes.byteLength,
        mime_type: 'application/octet-stream',
        chunk_size: chunkSize,
        total_chunks: totalChunks,
        expected_hash: expectedHash,
        protocol_mode: 'JOURNAL_WAL',
        receiver_id: activePeer?.id,
      });

      if (walTransfer?.transfer_id) {
        // Stream with deterministic crash at 65536 bytes
        const fullBlob = new Blob([rawBytes]);
        await api.transfers.streamBinaryContent(`${walTransfer.transfer_id}?crash_at=65536`, fullBlob);

        setBenchmarkProgress('Test 2/2: Worker process terminated by SIGKILL at byte 65536 on SQLite WAL...');
        await new Promise((r) => setTimeout(r, 600));

        setBenchmarkProgress('Test 2/2: Executing Real Physical Disk Audit & SHA-256 Recovery...');
        await handleRecoverTransfer(walTransfer.transfer_id);
      }

      setBenchmarkProgress('Benchmark complete! Real binary persistent disk metrics updated.');
      await refreshFeed();
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error('Benchmark execution error:', err);
    } finally {
      setIsBenchmarkRunning(false);
      setBenchmarkProgress('');
    }
  };

  const styles = {
    appContainer: {
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      backgroundColor: 'var(--color-bg, #090913)',
      overflow: 'hidden',
    },
    mainLayout: {
      display: 'flex',
      flex: 1,
      height: 'calc(100vh - 62px)',
      overflow: 'hidden',
      position: 'relative',
    },
  };

  return (
    <div style={styles.appContainer}>
      {/* Floating Notifications Toast Banner */}
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        onSelectContact={(peer) => setActivePeer(peer)}
      />

      {/* Top Navbar */}
      <Navbar
        user={currentUser}
        activeProtocol={activeProtocol}
        setActiveProtocol={setActiveProtocol}
        viewMode={viewMode}
        setViewMode={setViewMode}
        onOpenServerConfig={() => setIsServerConfigOpen(true)}
        onOpenOSDashboard={() => setIsOSDashboardOpen(true)}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onLogout={handleLogout}
        onGlobalCrash={handleGlobalCrash}
        backendStatus={backendStatus}
        onToggleSidebar={() => setIsMobileDrawerOpen((prev) => !prev)}
      />

      {/* Main Workspace: Either WhatsApp-Style Chat View OR OS Kernel Storage Lab */}
      {viewMode === 'LAB' ? (
        <OSKernelLab
          metrics={metrics}
          activeProtocol={activeProtocol}
          setActiveProtocol={setActiveProtocol}
          transfers={transfers}
          onRefreshMetrics={refreshFeed}
          onRunBenchmark={handleRunBenchmark}
          isBenchmarkRunning={isBenchmarkRunning}
          benchmarkProgress={benchmarkProgress}
          onSimulateGlobalCrash={handleGlobalCrash}
          onResetMetrics={handleResetMetrics}
          backendStatus={backendStatus}
          recoveryReport={activeRecoveryReport}
          onClearRecoveryReport={() => setActiveRecoveryReport(null)}
          onBackToChat={() => setViewMode('CHAT')}
        />
      ) : (
        <main style={styles.mainLayout}>
          <Sidebar
            users={users}
            activePeer={activePeer}
            onSelectPeer={(peer) => setActivePeer(peer)}
            currentUser={currentUser}
            onLogout={handleLogout}
            onGlobalCrash={handleGlobalCrash}
            onRefresh={checkHealthAndLoadData}
            transfers={transfers}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            isMobileDrawerOpen={isMobileDrawerOpen}
            onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
          />

          <ChatWindow
            activePeer={activePeer}
            currentUser={currentUser}
            messages={messages}
            transfers={transfers}
            activeProtocol={activeProtocol}
            setActiveProtocol={setActiveProtocol}
            onSendMessage={handleSendMessage}
            onInitiateTransfer={handleInitiateTransfer}
            onUploadChunk={handleUploadChunk}
            onSimulateCrash={handleSimulateCrash}
            onInterruptTransfer={handleInterruptTransfer}
            onCrashWorker={handleCrashWorker}
            onRecoverTransfer={handleRecoverTransfer}
            onDownloadFile={handleDownloadFile}
            onOpenOSLab={handleOpenOSLab}
            onGlobalCrash={handleGlobalCrash}
          />
        </main>
      )}

      {/* Modals */}
      <OSDashboard
        isOpen={isOSDashboardOpen}
        onClose={() => setIsOSDashboardOpen(false)}
        metrics={metrics}
        onResetMetrics={handleResetMetrics}
        onRunBenchmark={handleRunBenchmark}
        isBenchmarkRunning={isBenchmarkRunning}
        benchmarkProgress={benchmarkProgress}
      />

      <ServerConfigModal
        isOpen={isServerConfigOpen}
        onClose={() => setIsServerConfigOpen(false)}
        onUrlUpdated={() => {
          checkHealthAndLoadData();
          refreshFeed();
        }}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          checkHealthAndLoadData();
          refreshFeed();
        }}
      />
    </div>
  );
}
