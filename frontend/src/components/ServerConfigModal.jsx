import React, { useState } from 'react';
import { SettingsIcon, CheckCircleIcon, AlertTriangleIcon, RefreshCwIcon } from './Icons';
import { getBackendUrl, setBackendUrl, api } from '../api';

export default function ServerConfigModal({ isOpen, onClose, onUrlUpdated }) {
  const [urlInput, setUrlInput] = useState(getBackendUrl());
  const [pingStatus, setPingStatus] = useState(null); // { success: bool, message: str, loading: bool }

  if (!isOpen) return null;

  const handleTestPing = async (targetUrl) => {
    setPingStatus({ loading: true, message: 'Testing connection...' });
    const urlToTest = targetUrl || urlInput;
    // Temporarily set to test
    const old = getBackendUrl();
    setBackendUrl(urlToTest);

    const res = await api.checkHealth();
    if (res.data?.status === 'ONLINE') {
      setPingStatus({
        success: true,
        loading: false,
        message: `Connected successfully! Engine: ${res.data.database}. Subsystem: ${res.data.subsystem}`,
      });
      onUrlUpdated(urlToTest);
    } else {
      // Revert if failed
      setBackendUrl(old);
      setPingStatus({
        success: false,
        loading: false,
        message: res.error || 'Connection failed. Ensure backend is awake on Render or running locally.',
      });
    }
  };

  const handleSave = () => {
    setBackendUrl(urlInput);
    onUrlUpdated(urlInput);
    onClose();
  };

  const handleResetLocal = () => {
    const local = 'http://127.0.0.1:8000';
    setUrlInput(local);
    setBackendUrl(local);
    handleTestPing(local);
  };

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
      zIndex: 110,
      padding: '20px',
    },
    modal: {
      backgroundColor: '#111b21',
      border: '1px solid #2a3942',
      borderRadius: '16px',
      width: '100%',
      maxWidth: '540px',
      boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
      color: '#e9edef',
      overflow: 'hidden',
    },
    header: {
      padding: '16px 20px',
      backgroundColor: '#202c33',
      borderBottom: '1px solid #2a3942',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    body: {
      padding: '20px',
    },
    input: {
      width: '100%',
      padding: '10px 14px',
      backgroundColor: '#202c33',
      border: '1px solid #2a3942',
      borderRadius: '8px',
      color: '#e9edef',
      fontSize: '14px',
      outline: 'none',
      boxSizing: 'border-box',
      marginTop: '8px',
      marginBottom: '12px',
    },
    presetRow: {
      display: 'flex',
      gap: '8px',
      marginBottom: '16px',
    },
    presetBtn: {
      padding: '6px 12px',
      borderRadius: '6px',
      backgroundColor: '#202c33',
      border: '1px solid #2a3942',
      color: '#8696a0',
      fontSize: '11px',
      cursor: 'pointer',
    },
    statusBox: (isSuccess) => ({
      padding: '10px 14px',
      borderRadius: '8px',
      backgroundColor: isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
      border: `1px solid ${isSuccess ? '#10b981' : '#ef4444'}`,
      color: isSuccess ? '#10b981' : '#ef4444',
      fontSize: '12px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }),
    footer: {
      padding: '14px 20px',
      backgroundColor: '#202c33',
      borderTop: '1px solid #2a3942',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    btn: (primary) => ({
      padding: '8px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: '600',
      border: 'none',
      cursor: 'pointer',
      backgroundColor: primary ? '#10b981' : '#2a3942',
      color: primary ? '#0b141a' : '#e9edef',
    }),
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
            <SettingsIcon size={18} color="#00d2ff" />
            <span>Render & Vercel Backend URL Config</span>
          </div>
          <button style={{ background: 'none', border: 'none', color: '#8696a0', cursor: 'pointer', fontSize: '18px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <p style={{ fontSize: '13px', color: '#8696a0', lineHeight: '1.4', margin: '0 0 10px 0' }}>
            Configure the central Django backend URL. When deployed on <strong>Vercel</strong>, enter your{' '}
            <strong>Render</strong> service URL here (e.g. <code>https://my-backend.onrender.com</code>).
            All HTTP requests and file chunking will automatically route through this single URL.
          </p>

          <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#e9edef' }}>
            Backend API Root URL:
          </label>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            style={styles.input}
            placeholder="http://127.0.0.1:8000 or https://xyz.onrender.com"
          />

          <div style={styles.presetRow}>
            <button style={styles.presetBtn} onClick={handleResetLocal}>
              Use Localhost (127.0.0.1:8000)
            </button>
            <button
              style={styles.presetBtn}
              onClick={() => handleTestPing()}
              disabled={pingStatus?.loading}
            >
              <RefreshCwIcon size={12} color="#00d2ff" /> Test Ping Connection
            </button>
          </div>

          {pingStatus && (
            <div style={styles.statusBox(pingStatus.success)}>
              {pingStatus.success ? <CheckCircleIcon size={16} /> : <AlertTriangleIcon size={16} />}
              <span>{pingStatus.message}</span>
            </div>
          )}

          <div style={{ fontSize: '11px', color: '#8696a0', backgroundColor: '#182229', padding: '10px', borderRadius: '8px' }}>
            💡 <strong>Render Free Tier Note:</strong> Render spun-down instances take ~30-50s to wake up on the first
            request. If you deploy on Render, click &quot;Test Ping Connection&quot; once to wake it up!
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.btn(false)} onClick={onClose}>
            Cancel
          </button>
          <button style={styles.btn(true)} onClick={handleSave}>
            Save &amp; Apply URL
          </button>
        </div>
      </div>
    </div>
  );
}
