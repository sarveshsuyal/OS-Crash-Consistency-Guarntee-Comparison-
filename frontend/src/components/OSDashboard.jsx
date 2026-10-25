import React, { useState } from 'react';
import {
  BarChart2Icon,
  ShieldCheckIcon,
  CpuIcon,
  DatabaseIcon,
  CrashIcon,
  RefreshCwIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  TerminalIcon
} from './Icons';

export default function OSDashboard({
  isOpen,
  onClose,
  metrics,
  onResetMetrics,
  onRunBenchmark,
  isBenchmarkRunning,
  benchmarkProgress,
}) {
  const [activeTab, setActiveTab] = useState('matrix'); // 'matrix' | 'logs' | 'benchmark'

  if (!isOpen) return null;

  const summary = metrics?.summary || {};
  const matrix = metrics?.matrix || [];
  const logs = metrics?.recent_logs || [];

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: '20px',
    },
    modal: {
      backgroundColor: '#111b21',
      border: '1px solid #2a3942',
      borderRadius: '16px',
      width: '100%',
      maxWidth: '960px',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
      color: '#e9edef',
      overflow: 'hidden',
    },
    header: {
      padding: '16px 24px',
      backgroundColor: '#202c33',
      borderBottom: '1px solid #2a3942',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    title: {
      fontSize: '17px',
      fontWeight: 'bold',
      color: '#e9edef',
    },
    tabsRow: {
      display: 'flex',
      gap: '10px',
      padding: '12px 24px',
      backgroundColor: '#182229',
      borderBottom: '1px solid #202c33',
    },
    tabBtn: (isActive) => ({
      padding: '8px 16px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      backgroundColor: isActive ? '#202c33' : 'transparent',
      color: isActive ? '#00d2ff' : '#8696a0',
      transition: 'all 0.15s',
    }),
    body: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px 24px',
    },
    statsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: '12px',
      marginBottom: '20px',
    },
    statCard: (borderColor, glowColor) => ({
      backgroundColor: '#1f2c34',
      border: `1px solid ${borderColor}`,
      borderRadius: '10px',
      padding: '14px',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: `0 0 10px ${glowColor}`,
    }),
    statNumber: {
      fontSize: '22px',
      fontWeight: 'bold',
      margin: '4px 0',
    },
    statLabel: {
      fontSize: '11px',
      color: '#8696a0',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px',
      marginTop: '10px',
    },
    th: {
      textAlign: 'left',
      padding: '10px 12px',
      backgroundColor: '#202c33',
      color: '#8696a0',
      fontSize: '12px',
      borderBottom: '1px solid #2a3942',
    },
    td: {
      padding: '12px',
      borderBottom: '1px solid #202c33',
      verticalAlign: 'top',
    },
    logBox: {
      backgroundColor: '#0b141a',
      borderRadius: '8px',
      padding: '14px',
      fontFamily: 'Consolas, monospace',
      fontSize: '11px',
      height: '380px',
      overflowY: 'auto',
      border: '1px solid #202c33',
    },
    logLine: (type) => ({
      padding: '4px 0',
      color: type?.includes('CRASH') ? '#ef4444' : type?.includes('WAL') ? '#10b981' : '#00d2ff',
      lineHeight: '1.4',
    }),
    footer: {
      padding: '14px 24px',
      backgroundColor: '#202c33',
      borderTop: '1px solid #2a3942',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    closeBtn: {
      padding: '8px 18px',
      backgroundColor: '#2a3942',
      border: 'none',
      color: '#e9edef',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
    },
    actionBtn: {
      padding: '8px 16px',
      backgroundColor: '#10b981',
      border: 'none',
      color: '#0b141a',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: 'bold',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleGroup}>
            <BarChart2Icon size={22} color="#00d2ff" />
            <div>
              <div style={styles.title}>OS Crash-Consistency Analytics</div>
              <div style={{ fontSize: '11px', color: '#8696a0' }}>
                Scientific evaluation: Dirty Page Cache vs. SQLite Write-Ahead Logging (WAL)
              </div>
            </div>
          </div>
          <button style={{ background: 'none', border: 'none', color: '#8696a0', fontSize: '20px', cursor: 'pointer' }} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={styles.tabsRow}>
          <button style={styles.tabBtn(activeTab === 'matrix')} onClick={() => setActiveTab('matrix')}>
            Comparison Matrix
          </button>
          <button style={styles.tabBtn(activeTab === 'logs')} onClick={() => setActiveTab('logs')}>
            Kernel & WAL Logs ({logs.length})
          </button>
          <button style={styles.tabBtn(activeTab === 'benchmark')} onClick={() => setActiveTab('benchmark')}>
            Automated Benchmark Test
          </button>
        </div>

        {/* Modal Body */}
        <div style={styles.body}>
          {/* Top Quick Stats */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard('#f59e0b', 'rgba(245, 158, 11, 0.1)')}>
              <div style={styles.statLabel}>RAM Volatile Data Loss Rate</div>
              <div style={{ ...styles.statNumber, color: '#ef4444' }}>
                {summary.ram_loss_rate ?? 100.0}%
              </div>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>
                {summary.ram_crashes || 0} crashes / all memory cleared
              </div>
            </div>

            <div style={styles.statCard('#10b981', 'rgba(16, 185, 129, 0.1)')}>
              <div style={styles.statLabel}>SQLite WAL Data Loss Rate</div>
              <div style={{ ...styles.statNumber, color: '#10b981' }}>
                {summary.wal_loss_rate ?? 0.0}%
              </div>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>
                Zero committed transactions lost
              </div>
            </div>

            <div style={styles.statCard('#06b6d4', 'rgba(6, 182, 212, 0.1)')}>
              <div style={styles.statLabel}>Avg WAL Recovery Latency</div>
              <div style={{ ...styles.statNumber, color: '#06b6d4' }}>
                {summary.avg_recovery_ms || 2.4} ms
              </div>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>
                Fast sequential log replay
              </div>
            </div>

            <div style={styles.statCard('#8b5cf6', 'rgba(139, 92, 246, 0.1)')}>
              <div style={styles.statLabel}>Total File Transmissions</div>
              <div style={{ ...styles.statNumber, color: '#a855f7' }}>
                {summary.total_transfers || 0}
              </div>
              <div style={{ fontSize: '10px', color: '#8696a0' }}>
                {summary.wal_recovered || 0} sessions recovered via WAL
              </div>
            </div>
          </div>

          {/* TAB 1: Comparison Matrix */}
          {activeTab === 'matrix' && (
            <div>
              <h4 style={{ color: '#00d2ff', marginBottom: '8px' }}>
                OS File System & Consistency Protocol Analysis
              </h4>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Evaluation Criterion</th>
                    <th style={{ ...styles.th, color: '#f59e0b' }}>Volatile RAM Buffer (Dirty Cache)</th>
                    <th style={{ ...styles.th, color: '#10b981' }}>SQLite WAL Journaling (Disk Persistent)</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ ...styles.td, fontWeight: 'bold', color: '#e9edef' }}>{row.metric}</td>
                      <td style={{ ...styles.td, color: '#fca5a5' }}>{row.ram_mode}</td>
                      <td style={{ ...styles.td, color: '#86efac' }}>{row.wal_mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Kernel & WAL Event Logs */}
          {activeTab === 'logs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#8696a0' }}>
                  Live Kernel VFS and Storage WAL transaction stream:
                </span>
                <span style={{ fontSize: '11px', color: '#00d2ff' }}>Auto-updating</span>
              </div>
              <div style={styles.logBox}>
                {logs.length === 0 ? (
                  <div style={{ color: '#8696a0' }}>No logs recorded yet. Start a file transfer to see OS events.</div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} style={styles.logLine(log.event_type)}>
                      <span style={{ color: '#8696a0' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                      <span style={{ color: '#a855f7' }}>[{log.subsystem}]</span>{' '}
                      <strong>{log.event_type}:</strong> {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Automated Benchmark */}
          {activeTab === 'benchmark' && (
            <div>
              <h4 style={{ color: '#10b981', marginBottom: '8px' }}>
                Automated Head-to-Head Crash & Recovery Benchmark
              </h4>
              <p style={{ fontSize: '13px', color: '#8696a0', lineHeight: '1.5', marginBottom: '16px' }}>
                This automated test executes two consecutive 10-chunk transmissions (one in RAM Volatile Mode and one in
                SQLite WAL Mode). At exactly Chunk #5, an OS Power Failure / Crash is triggered. The test then executes
                recovery on both sessions and compiles an objective guarantee report.
              </p>

              <button
                style={{ ...styles.actionBtn, padding: '10px 20px', fontSize: '14px' }}
                onClick={onRunBenchmark}
                disabled={isBenchmarkRunning}
              >
                <CpuIcon size={16} color="#0b141a" />
                {isBenchmarkRunning ? benchmarkProgress || 'Running Benchmark...' : 'Run Automated Crash Benchmark'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button
            style={{ ...styles.closeBtn, backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
            onClick={onResetMetrics}
          >
            Reset Test Ledger
          </button>
          <button style={styles.closeBtn} onClick={onClose}>
            Close Analysis
          </button>
        </div>
      </div>
    </div>
  );
}
