import React, { useState } from 'react';
import { UserIcon, ShieldCheckIcon, AlertTriangleIcon, CheckCircleIcon } from './Icons';
import { api } from '../api';

export default function AuthModal({
  isOpen,
  onClose,
  onAuthSuccess,
  currentUser,
}) {
  const [isRegister, setIsRegister] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [statusMessage, setStatusMessage] = useState('Available for OS file transfer');
  const [avatarColor, setAvatarColor] = useState('#10b981');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // Clean phone number to digits only (max 10)
  const handlePhoneChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 10);
    setPhoneNumber(raw);
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (phoneNumber.length !== 10) {
      setError('Please enter a valid 10-digit phone number (e.g. 9876543210).');
      return;
    }

    if (!password || password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }

    setLoading(true);

    try {
      if (isRegister) {
        if (!displayName.trim()) {
          setError('Please provide your name or display handle.');
          setLoading(false);
          return;
        }

        const res = await api.auth.register({
          phone_number: phoneNumber,
          display_name: displayName.trim(),
          password,
          status_message: statusMessage.trim() || 'Available',
          avatar_color: avatarColor,
        });

        if (res.data?.user) {
          onAuthSuccess(res.data.user);
          onClose();
        } else {
          setError(res.error || 'Failed to create account. Please check your details.');
        }
      } else {
        const res = await api.auth.login(phoneNumber, password);
        if (res.data?.user) {
          onAuthSuccess(res.data.user);
          onClose();
        } else {
          setError(res.error || 'Invalid 10-digit phone number or password.');
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication error.');
    } finally {
      setLoading(false);
    }
  };

  const colorPalette = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#f43f5e', '#3b82f6'];

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 110,
      padding: '20px',
    },
    modal: {
      backgroundColor: '#111b21',
      border: '1px solid #2a3942',
      borderRadius: '16px',
      width: '100%',
      maxWidth: '440px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
      color: '#e9edef',
      overflow: 'hidden',
    },
    header: {
      padding: '18px 22px',
      backgroundColor: '#202c33',
      borderBottom: '1px solid #2a3942',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontWeight: 'bold',
      fontSize: '16px',
    },
    body: {
      padding: '22px',
    },
    label: {
      fontSize: '11px',
      fontWeight: '600',
      color: '#8696a0',
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
      marginBottom: '6px',
      display: 'flex',
      justifyContent: 'space-between',
    },
    phoneInputGroup: {
      display: 'flex',
      alignItems: 'center',
      backgroundColor: '#202c33',
      border: '1px solid #2a3942',
      borderRadius: '8px',
      overflow: 'hidden',
      marginBottom: '14px',
    },
    phonePrefix: {
      padding: '10px 12px',
      backgroundColor: '#182229',
      color: '#8696a0',
      fontSize: '13px',
      fontWeight: '600',
      borderRight: '1px solid #2a3942',
      userSelect: 'none',
    },
    phoneInput: {
      flex: 1,
      padding: '10px 12px',
      backgroundColor: 'transparent',
      border: 'none',
      color: '#e9edef',
      fontSize: '15px',
      letterSpacing: '1px',
      outline: 'none',
      fontFamily: 'monospace',
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: '#202c33',
      border: '1px solid #2a3942',
      borderRadius: '8px',
      color: '#e9edef',
      fontSize: '13px',
      outline: 'none',
      boxSizing: 'border-box',
      marginBottom: '14px',
    },
    colorRow: {
      display: 'flex',
      gap: '10px',
      marginBottom: '16px',
      marginTop: '4px',
    },
    colorCircle: (color, isSelected) => ({
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: color,
      cursor: 'pointer',
      border: isSelected ? '2px solid #ffffff' : '2px solid transparent',
      boxShadow: isSelected ? `0 0 8px ${color}` : 'none',
      transition: 'transform 0.1s',
    }),
    submitBtn: {
      width: '100%',
      padding: '12px',
      backgroundColor: '#10b981',
      border: 'none',
      borderRadius: '8px',
      color: '#0b141a',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      marginTop: '4px',
      transition: 'background 0.2s',
    },
    errorBox: {
      padding: '10px 12px',
      borderRadius: '8px',
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      border: '1px solid #ef4444',
      color: '#ef4444',
      fontSize: '12px',
      marginBottom: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    switchModeBox: {
      marginTop: '16px',
      textAlign: 'center',
      fontSize: '12px',
      color: '#8696a0',
    },
    switchLink: {
      color: '#00d2ff',
      cursor: 'pointer',
      fontWeight: 'bold',
      marginLeft: '4px',
    },
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerTitle}>
            <ShieldCheckIcon size={20} color="#10b981" />
            <span>{isRegister ? 'Register Phone Account' : 'Sign in with Phone Number'}</span>
          </div>
          {currentUser && (
            <button
              style={{ background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer', fontSize: '18px' }}
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>

        {/* Form Body */}
        <div style={styles.body}>
          {error && (
            <div style={styles.errorBox}>
              <AlertTriangleIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* If Register: Full Name / Display Name */}
            {isRegister && (
              <div>
                <label style={styles.label}>
                  <span>Full Name / Display Name</span>
                  <span style={{ textTransform: 'none', fontSize: '10px', color: '#00d2ff' }}>
                    (Names can be identical across users)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. John Doe, Sarah Connor"
                  style={styles.input}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
            )}

            {/* 10-Digit Phone Number (Unique Account ID) */}
            <div>
              <label style={styles.label}>
                <span>10-Digit Phone Number</span>
                <span style={{ color: phoneNumber.length === 10 ? '#10b981' : '#f59e0b', fontSize: '10px' }}>
                  {phoneNumber.length} / 10 Digits
                </span>
              </label>
              <div style={styles.phoneInputGroup}>
                <div style={styles.phonePrefix}>+91 / No.</div>
                <input
                  type="tel"
                  placeholder="9876543210"
                  style={styles.phoneInput}
                  value={phoneNumber}
                  onChange={handlePhoneChange}
                  maxLength={10}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={styles.label}>
                <span>Password</span>
              </label>
              <input
                type="password"
                placeholder="Enter account password"
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {/* If Register: Status Bio & Avatar Color */}
            {isRegister && (
              <div>
                <label style={styles.label}>
                  <span>About / Status Message</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Available for file transfers"
                  style={styles.input}
                  value={statusMessage}
                  onChange={(e) => setStatusMessage(e.target.value)}
                />

                <label style={styles.label}>
                  <span>Avatar Theme Accent</span>
                </label>
                <div style={styles.colorRow}>
                  {colorPalette.map((col) => (
                    <div
                      key={col}
                      style={styles.colorCircle(col, avatarColor === col)}
                      onClick={() => setAvatarColor(col)}
                    />
                  ))}
                </div>
              </div>
            )}

            <button type="submit" style={styles.submitBtn} disabled={loading}>
              {loading
                ? 'Processing...'
                : isRegister
                ? 'Create Account & Connect'
                : 'Sign In to Account'}
            </button>
          </form>

          {/* Toggle Login / Register */}
          <div style={styles.switchModeBox}>
            {isRegister ? (
              <span>
                Already have an account?
                <span style={styles.switchLink} onClick={() => { setIsRegister(false); setError(''); }}>
                  Sign In with Phone
                </span>
              </span>
            ) : (
              <span>
                Don&apos;t have an account yet?
                <span style={styles.switchLink} onClick={() => { setIsRegister(true); setError(''); }}>
                  Register 10-Digit Account
                </span>
              </span>
            )}
          </div>

          {/* 1-Click Quick Device Node Provisioning for Multi-Tab Testing */}
          <div style={{ marginTop: '16px', borderTop: '1px solid #202c33', paddingTop: '14px', textAlign: 'center' }}>
            <button
              type="button"
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'rgba(6, 182, 212, 0.15)',
                border: '1px solid #06b6d4',
                borderRadius: '8px',
                color: '#00d2ff',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
              onClick={async () => {
                setError('');
                setLoading(true);
                try {
                  const res = await api.auth.quickStartNode();
                  if (res.data?.user) {
                    onAuthSuccess(res.data.user);
                    onClose();
                  } else {
                    setError(res.error || 'Failed to auto-provision node.');
                  }
                } catch (err) {
                  setError(err.message || 'Auto-provisioning error.');
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
            >
              <span>⚡ Quick Start New Tab Device Node (1-Click)</span>
            </button>
            <div style={{ fontSize: '11px', color: '#8696a0', marginTop: '6px' }}>
              Instantly provisions an isolated 10-digit peer node for testing transfers across browser tabs.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
