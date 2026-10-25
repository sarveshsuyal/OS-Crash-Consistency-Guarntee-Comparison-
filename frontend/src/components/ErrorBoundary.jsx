import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('React ErrorBoundary caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetSession = () => {
    sessionStorage.clear();
    localStorage.clear();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            width: '100vw',
            backgroundColor: '#0b141a',
            color: '#e9edef',
            fontFamily: 'system-ui, sans-serif',
            padding: '24px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: '560px',
              backgroundColor: '#111b21',
              border: '1px solid #2a3942',
              borderRadius: '16px',
              padding: '32px',
              boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '12px' }}>⚙️</div>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: '#00d2ff' }}>
              System Display Recovered
            </h2>
            <p style={{ fontSize: '13px', color: '#8696a0', lineHeight: '1.5', marginBottom: '20px' }}>
              The application encountered a client-side rendering exception. The state has been captured safely.
            </p>

            <div
              style={{
                backgroundColor: '#1f2c34',
                padding: '12px',
                borderRadius: '8px',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#ef4444',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '20px',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              {this.state.error?.toString()}
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#00a884',
                  color: '#0b141a',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                ↻ Reload Application
              </button>

              <button
                onClick={this.handleResetSession}
                style={{
                  padding: '10px 18px',
                  backgroundColor: '#202c33',
                  color: '#e9edef',
                  border: '1px solid #2a3942',
                  borderRadius: '8px',
                  fontWeight: 'bold',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                Clear Cache & Restart
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

