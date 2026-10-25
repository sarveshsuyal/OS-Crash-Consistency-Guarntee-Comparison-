import React from 'react';
import { XIcon } from './Icons';

export default function ToastContainer({ toasts, onDismiss, onSelectContact }) {
  if (!toasts || toasts.length === 0) return null;

  const styles = {
    container: {
      position: 'fixed',
      top: '72px',
      right: '20px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      pointerEvents: 'none',
      maxWidth: '380px',
      width: 'calc(100vw - 40px)',
    },
    toast: (type) => {
      let borderLeftColor = '#00d2ff'; // default accent
      let shadowGlow = 'rgba(0, 210, 255, 0.25)';
      if (type === 'crash' || type === 'error') {
        borderLeftColor = '#ff3366';
        shadowGlow = 'rgba(255, 51, 102, 0.3)';
      } else if (type === 'success') {
        borderLeftColor = '#00ff88';
        shadowGlow = 'rgba(0, 255, 136, 0.25)';
      } else if (type === 'warning') {
        borderLeftColor = '#f59e0b';
        shadowGlow = 'rgba(245, 158, 11, 0.25)';
      }

      return {
        pointerEvents: 'auto',
        backgroundColor: 'var(--color-surface-glass, rgba(20, 20, 42, 0.92))',
        backdropFilter: 'blur(12px)',
        borderLeft: `4px solid ${borderLeftColor}`,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        borderRight: '1px solid rgba(255, 255, 255, 0.08)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '12px 16px',
        color: 'var(--color-text-primary, #f8f9fd)',
        boxShadow: `0 8px 24px rgba(0, 0, 0, 0.6), 0 0 16px ${shadowGlow}`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        cursor: 'pointer',
        animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        transition: 'transform 0.15s, opacity 0.15s',
      };
    },
    iconBox: {
      fontSize: '20px',
      lineHeight: '1',
      flexShrink: 0,
      marginTop: '2px',
    },
    contentBox: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: '13px',
      fontWeight: '700',
      color: 'var(--color-text-primary, #f8f9fd)',
      marginBottom: '3px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    body: {
      fontSize: '12px',
      color: 'var(--color-text-secondary, #a4abd1)',
      lineHeight: '1.4',
      wordBreak: 'break-word',
    },
    meta: {
      fontSize: '10.5px',
      color: 'var(--color-accent, #00d2ff)',
      marginTop: '4px',
      fontWeight: '600',
    },
    closeBtn: {
      background: 'none',
      border: 'none',
      color: 'var(--color-text-muted, #6f779b)',
      cursor: 'pointer',
      padding: '2px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  };

  return (
    <div style={styles.container}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={styles.toast(toast.type)}
          onClick={() => {
            if (toast.peer) onSelectContact(toast.peer);
            onDismiss(toast.id);
          }}
        >
          <div style={styles.iconBox}>
            {toast.type === 'file' ? '📦' : toast.type === 'crash' ? '⚡' : toast.type === 'success' ? '✅' : '💬'}
          </div>
          <div style={styles.contentBox}>
            <div style={styles.title}>
              <span>{toast.title}</span>
              <button
                style={styles.closeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(toast.id);
                }}
              >
                <XIcon size={14} />
              </button>
            </div>
            <div style={styles.body}>{toast.message}</div>
            {toast.meta && <div style={styles.meta}>{toast.meta}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
