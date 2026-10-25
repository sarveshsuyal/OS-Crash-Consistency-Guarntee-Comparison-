import React, { useState } from 'react';
import {
  SearchIcon,
  CrashIcon,
  RefreshCwIcon,
  UserIcon,
  LogOutIcon,
  XIcon
} from './Icons';

export default function Sidebar({
  users = [],
  activePeer,
  onSelectPeer,
  currentUser,
  onLogout,
  onGlobalCrash,
  onRefresh,
  transfers = [],
  onSearchChange,
  searchQuery = '',
  isMobileDrawerOpen = false,
  onCloseMobileDrawer,
}) {
  const formatPhone = (phone) => {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return phone;
  };

  const filteredUsers = users.filter((u) => {
    if (u.id === currentUser?.id) return false;
    return true;
  });

  const handlePeerClick = (peer) => {
    onSelectPeer(peer);
    if (onCloseMobileDrawer) {
      onCloseMobileDrawer();
    }
  };

  const styles = {
    // Mobile backdrop overlay
    drawerBackdrop: {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(5, 5, 12, 0.75)',
      backdropFilter: 'blur(6px)',
      zIndex: 90,
      display: isMobileDrawerOpen ? 'block' : 'none',
      transition: 'opacity 0.3s ease',
    },
    sidebar: {
      width: '340px',
      backgroundColor: 'var(--color-surface, #14142a)',
      borderRight: '1px solid var(--color-border, rgba(99, 67, 224, 0.22))',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      color: 'var(--color-text-primary, #f8f9fd)',
      boxShadow: '4px 0 24px rgba(0, 0, 0, 0.35)',
      zIndex: 95,
      transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    },
    userHeader: {
      padding: '14px 16px',
      backgroundColor: 'rgba(9, 9, 19, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid var(--color-border, rgba(99, 67, 224, 0.2))',
    },
    currentUserInfo: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      minWidth: 0,
    },
    avatar: (color) => ({
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      backgroundColor: color || 'var(--color-primary, #6343e0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      color: '#ffffff',
      fontSize: '15px',
      flexShrink: 0,
      boxShadow: `0 0 12px ${color ? `${color}66` : 'rgba(99, 67, 224, 0.4)'}`,
      border: '2px solid rgba(255, 255, 255, 0.15)',
    }),
    userTextGroup: {
      minWidth: 0,
    },
    userName: {
      fontSize: '14px',
      fontWeight: '700',
      color: 'var(--color-text-primary, #f8f9fd)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    userPhone: {
      fontSize: '11px',
      color: 'var(--color-accent, #00d2ff)',
      fontFamily: 'monospace',
      fontWeight: '600',
    },
    searchContainer: {
      padding: '12px 14px',
      borderBottom: '1px solid var(--color-border, rgba(99, 67, 224, 0.15))',
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      backgroundColor: 'rgba(12, 12, 26, 0.6)',
    },
    searchBox: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      backgroundColor: 'rgba(9, 9, 19, 0.8)',
      borderRadius: '10px',
      padding: '8px 12px',
      flex: 1,
      border: '1px solid rgba(99, 67, 224, 0.25)',
      boxShadow: 'inset 0 1px 4px rgba(0, 0, 0, 0.4)',
    },
    searchInput: {
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-primary, #f8f9fd)',
      fontSize: '13px',
      outline: 'none',
      width: '100%',
    },
    peerList: {
      flex: 1,
      overflowY: 'auto',
      padding: '6px 0',
    },
    peerItem: (isSelected) => ({
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      cursor: 'pointer',
      backgroundColor: isSelected
        ? 'rgba(99, 67, 224, 0.25)'
        : 'transparent',
      transition: 'background-color 0.15s ease',
      borderLeft: isSelected
        ? '4px solid var(--color-accent, #00d2ff)'
        : '4px solid transparent',
      borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
    }),
    peerDetails: {
      flex: 1,
      minWidth: 0,
    },
    peerNameRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '3px',
    },
    peerName: {
      fontSize: '14px',
      fontWeight: '700',
      color: 'var(--color-text-primary, #f8f9fd)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    peerPhoneBadge: {
      fontSize: '11px',
      color: 'var(--color-text-secondary, #a4abd1)',
      fontFamily: 'monospace',
    },
    peerStatus: {
      fontSize: '12px',
      color: 'var(--color-text-muted, #6f779b)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      marginTop: '2px',
    },
    transferBadge: (mode) => ({
      fontSize: '9.5px',
      padding: '2px 6px',
      borderRadius: '6px',
      backgroundColor: mode === 'RAM_VOLATILE' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(0, 210, 255, 0.2)',
      color: mode === 'RAM_VOLATILE' ? '#f59e0b' : '#00d2ff',
      border: `1px solid ${mode === 'RAM_VOLATILE' ? '#f59e0b' : '#00d2ff'}`,
      fontWeight: 'bold',
      marginLeft: '6px',
    }),
    emptyBox: {
      padding: '40px 20px',
      textAlign: 'center',
      color: 'var(--color-text-secondary, #a4abd1)',
      fontSize: '13px',
      lineHeight: '1.5',
    },
    globalCrashBtn: {
      margin: '12px',
      padding: '12px',
      borderRadius: '10px',
      backgroundColor: 'rgba(255, 51, 102, 0.15)',
      border: '1px solid rgba(255, 51, 102, 0.5)',
      color: '#ff3366',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      fontSize: '12px',
      fontWeight: '800',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '0 0 12px rgba(255, 51, 102, 0.2)',
    },
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      <div
        style={styles.drawerBackdrop}
        onClick={onCloseMobileDrawer}
        className="mobile-backdrop"
      />

      <aside
        style={styles.sidebar}
        className={`sidebar-container ${isMobileDrawerOpen ? 'drawer-open' : ''}`}
      >
        {/* Logged in User Bar */}
        <div style={styles.userHeader}>
          <div style={styles.currentUserInfo}>
            <div style={styles.avatar(currentUser?.profile?.avatar_color)}>
              {currentUser?.profile?.display_name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div style={styles.userTextGroup}>
              <div style={styles.userName}>
                {currentUser?.profile?.display_name || 'My Node'}
              </div>
              <div style={styles.userPhone}>
                {formatPhone(currentUser?.phone_number || currentUser?.profile?.phone_number)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={onLogout}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-muted, #6f779b)',
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
              }}
              title="Sign out from this phone account"
            >
              <LogOutIcon size={16} />
            </button>

            {onCloseMobileDrawer && (
              <button
                onClick={onCloseMobileDrawer}
                className="hide-on-desktop"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-secondary, #a4abd1)',
                  cursor: 'pointer',
                  padding: '6px',
                  display: 'none',
                }}
                title="Close drawer"
              >
                <XIcon size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Search Input & Refresh */}
        <div style={styles.searchContainer}>
          <div style={styles.searchBox}>
            <SearchIcon size={15} color="var(--color-accent, #00d2ff)" />
            <input
              type="text"
              placeholder="Search contacts by name or phone..."
              style={styles.searchInput}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <button
            onClick={onRefresh}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-secondary, #a4abd1)',
              cursor: 'pointer',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Refresh registered contacts"
          >
            <RefreshCwIcon size={14} />
          </button>
        </div>

        {/* Contact List */}
        <div style={styles.peerList}>
          {filteredUsers.length === 0 ? (
            <div style={styles.emptyBox}>
              <div style={{ marginBottom: '10px', fontSize: '28px' }}>📡</div>
              <div style={{ fontWeight: '700', color: '#f8f9fd', marginBottom: '6px' }}>No peer nodes found</div>
              <div style={{ fontSize: '12px' }}>
                {searchQuery
                  ? `No user matching "${searchQuery}". Check the 10-digit number or name.`
                  : 'Start another device node in an incognito window to simulate distributed crash recovery!'}
              </div>
            </div>
          ) : (
            filteredUsers.map((peer) => {
              const isSelected = activePeer?.id === peer.id;
              const peerTransfers = transfers.filter(
                (t) => (t.sender === peer.id || t.receiver === peer.id) && t.status !== 'COMMITTED'
              );
              const activeTransfer = peerTransfers[0];

              return (
                <div
                  key={peer.id}
                  style={styles.peerItem(isSelected)}
                  onClick={() => handlePeerClick(peer)}
                >
                  <div style={styles.avatar(peer.avatar_color)}>
                    {peer.display_name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div style={styles.peerDetails}>
                    <div style={styles.peerNameRow}>
                      <span style={styles.peerName}>{peer.display_name}</span>
                      {activeTransfer && (
                        <span style={styles.transferBadge(activeTransfer.protocol_mode)}>
                          {activeTransfer.protocol_mode === 'RAM_VOLATILE' ? 'RAM' : 'WAL'}
                        </span>
                      )}
                    </div>
                    <div style={styles.peerPhoneBadge}>
                      {formatPhone(peer.phone_number)}
                    </div>
                    <div style={styles.peerStatus}>
                      {activeTransfer
                        ? `File: ${activeTransfer.filename} (${activeTransfer.status})`
                        : peer.status_message || peer.last_message || 'Ready for file transfers'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
