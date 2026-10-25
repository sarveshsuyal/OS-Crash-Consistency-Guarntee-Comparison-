import React from 'react';
import {
  ShieldCheckIcon,
  CpuIcon,
  DatabaseIcon,
  SettingsIcon,
  BarChart2Icon,
  UserIcon,
  LogOutIcon,
  MenuIcon,
  CrashIcon,
} from './Icons';

export default function Navbar({
  user,
  activeProtocol,
  setActiveProtocol,
  viewMode = 'CHAT',
  setViewMode,
  onOpenServerConfig,
  onOpenOSDashboard,
  onOpenAuth,
  onLogout,
  onGlobalCrash,
  backendStatus,
  onToggleSidebar,
}) {
  const isOnline = backendStatus === 'ONLINE';

  const styles = {
    navbar: {
      height: '62px',
      backgroundColor: 'var(--color-surface, #14142a)',
      borderBottom: '1px solid var(--color-border, rgba(99, 67, 224, 0.25))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      color: 'var(--color-text-primary, #f8f9fd)',
      position: 'relative',
      zIndex: 40,
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
    },
    leftBrand: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    menuToggleBtn: {
      display: 'none',
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      color: 'var(--color-text-primary, #f8f9fd)',
      padding: '7px',
      borderRadius: '8px',
      cursor: 'pointer',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoBadge: {
      width: '38px',
      height: '38px',
      borderRadius: '10px',
      background: 'linear-gradient(135deg, var(--color-primary, #6343e0) 0%, var(--color-accent, #00d2ff) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 16px rgba(0, 210, 255, 0.35)',
      flexShrink: 0,
    },
    titleGroup: {
      display: 'flex',
      flexDirection: 'column',
    },
    mainTitle: {
      fontSize: '14.5px',
      fontWeight: '800',
      letterSpacing: '0.3px',
      color: 'var(--color-text-primary, #f8f9fd)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    subTitle: {
      fontSize: '11px',
      color: 'var(--color-text-secondary, #a4abd1)',
      letterSpacing: '0.2px',
    },
    centerControls: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      padding: '4px',
      borderRadius: '24px',
      border: '1px solid rgba(99, 67, 224, 0.25)',
    },
    protocolPill: (isActive, isRam) => ({
      padding: '6px 14px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '700',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'all 0.2s ease',
      border: 'none',
      background: isActive
        ? (isRam
            ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
            : 'linear-gradient(135deg, #6343e0 0%, #00d2ff 100%)')
        : 'transparent',
      color: isActive ? '#ffffff' : 'var(--color-text-muted, #6f779b)',
      boxShadow: isActive
        ? (isRam ? '0 0 14px rgba(245, 158, 11, 0.5)' : '0 0 16px rgba(0, 210, 255, 0.5)')
        : 'none',
    }),
    rightActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    statusBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 10px',
      borderRadius: '16px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      fontSize: '11px',
      fontWeight: '600',
      color: isOnline ? '#00ff88' : '#ff3366',
      cursor: 'pointer',
      border: `1px solid ${isOnline ? 'rgba(0, 255, 136, 0.25)' : 'rgba(255, 51, 102, 0.25)'}`,
      transition: 'all 0.2s',
    },
    dot: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: isOnline ? '#00ff88' : '#ff3366',
      boxShadow: isOnline ? '0 0 8px #00ff88' : '0 0 8px #ff3366',
    },
    iconBtn: {
      background: 'rgba(99, 67, 224, 0.15)',
      border: '1px solid rgba(99, 67, 224, 0.35)',
      color: 'var(--color-text-primary, #f8f9fd)',
      padding: '7px 12px',
      borderRadius: '8px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '12px',
      fontWeight: '700',
      transition: 'all 0.2s ease',
    },
    userBadge: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 10px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      borderRadius: '20px',
      border: '1px solid rgba(99, 67, 224, 0.25)',
      cursor: 'pointer',
    },
    avatar: (color) => ({
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      backgroundColor: color || 'var(--color-primary, #6343e0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#ffffff',
      fontWeight: 'bold',
      fontSize: '12px',
    }),
  };

  return (
    <header style={styles.navbar}>
      {/* Brand & Mobile Hamburger */}
      <div style={styles.leftBrand}>
        <button
          style={{
            ...styles.menuToggleBtn,
            display: typeof window !== 'undefined' && window.innerWidth <= 768 ? 'flex' : 'none',
          }}
          className="mobile-menu-btn"
          onClick={onToggleSidebar}
          title="Toggle Contacts List"
        >
          <MenuIcon size={18} color="var(--color-accent, #00d2ff)" />
        </button>

        <div style={styles.logoBadge}>
          <ShieldCheckIcon size={22} color="#ffffff" />
        </div>
        <div style={styles.titleGroup}>
          <div style={styles.mainTitle}>
            Crash-Consistency Engine
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                background: 'rgba(0, 210, 255, 0.15)',
                border: '1px solid rgba(0, 210, 255, 0.3)',
                borderRadius: '4px',
                color: 'var(--color-accent, #00d2ff)',
                fontWeight: '700',
              }}
            >
              OS LAB
            </span>
          </div>
          <div style={styles.subTitle} className="hide-on-mobile">
            Volatile RAM Buffer vs. SQLite Write-Ahead Logging (WAL)
          </div>
        </div>
      </div>

      {/* View Mode Switcher: Peer Chat vs OS Storage Lab (Always Visible) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'rgba(9, 9, 19, 0.8)', padding: '4px', borderRadius: '24px', border: '1px solid rgba(99, 67, 224, 0.25)' }}>
        <button
          style={styles.protocolPill(viewMode === 'CHAT', false)}
          onClick={() => setViewMode && setViewMode('CHAT')}
          title="Switch to Peer Chat & File Transmission"
        >
          <span>💬 Peer Chat</span>
        </button>
        <button
          style={styles.protocolPill(viewMode === 'LAB', false)}
          onClick={() => setViewMode && setViewMode('LAB')}
          title="Switch to OS Kernel Storage & Hardware Virtualization Lab"
        >
          <span>🔬 OS Kernel Lab</span>
        </button>
      </div>

      {/* Protocol Toggle (Desktop & Tablet) */}
      <div style={styles.centerControls} className="hide-on-mobile">
        <button
          style={styles.protocolPill(activeProtocol === 'RAM_VOLATILE', true)}
          onClick={() => setActiveProtocol('RAM_VOLATILE')}
          title="Volatile RAM Page Cache: High speed but 0% crash consistency. Data destroyed upon crash."
        >
          <CpuIcon size={14} color={activeProtocol === 'RAM_VOLATILE' ? '#ffffff' : '#f59e0b'} />
          RAM Buffer (0% ACID)
        </button>
        <button
          style={styles.protocolPill(activeProtocol === 'JOURNAL_WAL', false)}
          onClick={() => setActiveProtocol('JOURNAL_WAL')}
          title="Persistent SQLite WAL Journal: Atomic transaction log. 100% crash consistency guarantee."
        >
          <DatabaseIcon size={14} color={activeProtocol === 'JOURNAL_WAL' ? '#ffffff' : '#00d2ff'} />
          SQLite WAL (100% ACID)
        </button>
      </div>

      {/* Top Center: Direct Red Crash Button */}
      <button
        style={{
          backgroundColor: '#ff3366',
          border: 'none',
          color: '#ffffff',
          padding: '6px 14px',
          borderRadius: '18px',
          fontSize: '11.5px',
          fontWeight: '800',
          letterSpacing: '0.3px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          boxShadow: '0 0 14px rgba(255, 51, 102, 0.45)',
          transition: 'all 0.15s ease',
        }}
        onClick={onGlobalCrash}
        title="Simulate immediate power failure / crash"
        className="hide-on-mobile"
      >
        <CrashIcon size={14} color="#ffffff" />
        <span>Crash System</span>
      </button>

      {/* Right Actions: Server Status, OS Inspector, User */}
      <div style={styles.rightActions}>
        <div style={styles.statusBadge} onClick={onOpenServerConfig} title="Click to view/change backend URL for Render or Localhost">
          <div style={styles.dot} />
          <span className="hide-on-mobile">{isOnline ? 'Online' : 'Offline'}</span>
          <SettingsIcon size={13} color="var(--color-text-secondary, #a4abd1)" />
        </div>

        <button style={styles.iconBtn} onClick={onOpenOSDashboard} title="Open OS System Comparison & Benchmark Console">
          <BarChart2Icon size={15} color="var(--color-accent, #00d2ff)" />
          <span className="hide-on-mobile">Analytics</span>
        </button>

        {user ? (
          <div style={styles.userBadge} onClick={onOpenAuth} title="Click to view account profile">
            <div style={styles.avatar(user.profile?.avatar_color)}>
              {(user.profile?.display_name || user.username)?.charAt(0).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }} className="hide-on-mobile">
              <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-text-primary, #f8f9fd)' }}>
                {user.profile?.display_name || user.username}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--color-accent, #00d2ff)', fontFamily: 'monospace' }}>
                {user.phone_number || user.profile?.phone_number || user.username}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLogout();
              }}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #6f779b)', cursor: 'pointer', padding: '2px', display: 'flex', marginLeft: '4px' }}
              title="Sign Out"
            >
              <LogOutIcon size={14} />
            </button>
          </div>
        ) : (
          <button
            style={{
              ...styles.iconBtn,
              background: 'linear-gradient(135deg, var(--color-primary, #6343e0) 0%, var(--color-accent, #00d2ff) 100%)',
              color: '#ffffff',
              border: 'none',
              boxShadow: '0 0 12px rgba(0, 210, 255, 0.4)',
            }}
            onClick={onOpenAuth}
          >
            <UserIcon size={15} color="#ffffff" />
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
