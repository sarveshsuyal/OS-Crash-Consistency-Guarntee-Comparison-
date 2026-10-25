// Centralized API Service for Localhost, Render, and Vercel Deployments
// All HTTP request and response flows go through this single file.

const STORAGE_KEYS = {
  BACKEND_URL: 'CRASH_SIM_BACKEND_URL',
  AUTH_TOKEN: 'CRASH_SIM_AUTH_TOKEN',
  ACTIVE_USER: 'CRASH_SIM_ACTIVE_USER',
};

// Auto-detect base URL:
// 1. User manual override stored in localStorage
// 2. Vite environment variable VITE_BACKEND_URL (set in Vercel dashboard)
// 3. Fallback to localhost http://127.0.0.1:8000
export const getBackendUrl = () => {
  const custom = localStorage.getItem(STORAGE_KEYS.BACKEND_URL);
  if (custom && custom.trim() !== '') {
    return custom.trim().replace(/\/+$/, '');
  }
  const envUrl = import.meta.env.VITE_BACKEND_URL;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8000';
};

export const setBackendUrl = (url) => {
  if (!url || url.trim() === '') {
    localStorage.removeItem(STORAGE_KEYS.BACKEND_URL);
  } else {
    localStorage.setItem(STORAGE_KEYS.BACKEND_URL, url.trim().replace(/\/+$/, ''));
  }
};

export const getAuthToken = () => {
  return sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || null;
};

export const setAuthToken = (token) => {
  if (token) {
    sessionStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  } else {
    sessionStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  }
};

export const getStoredUser = () => {
  const raw = sessionStorage.getItem(STORAGE_KEYS.ACTIVE_USER) || localStorage.getItem(STORAGE_KEYS.ACTIVE_USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setStoredUser = (user) => {
  if (user) {
    sessionStorage.setItem(STORAGE_KEYS.ACTIVE_USER, JSON.stringify(user));
    localStorage.setItem(STORAGE_KEYS.ACTIVE_USER, JSON.stringify(user));
  } else {
    sessionStorage.removeItem(STORAGE_KEYS.ACTIVE_USER);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_USER);
  }
};

export const clearCurrentTabSession = () => {
  sessionStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  sessionStorage.removeItem(STORAGE_KEYS.ACTIVE_USER);
};

// Generic HTTP Request Handler
export async function apiRequest(endpoint, options = {}) {
  const baseUrl = getBackendUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  const isPublicAuthEndpoint =
    cleanEndpoint.includes('/auth/register/') ||
    cleanEndpoint.includes('/auth/login/') ||
    cleanEndpoint.includes('/health/');

  const token = getAuthToken();
  if (token && !isPublicAuthEndpoint && !headers['Authorization']) {
    headers['Authorization'] = `Token ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return { data: null, error: null, status: 204 };
    }

    const contentType = response.headers.get('content-type') || '';
    let data = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      // If token is invalid or expired, automatically purge stale token from client storage
      if (response.status === 401) {
        setAuthToken(null);
        setStoredUser(null);
      }

      const errorMsg = (typeof data === 'object' && data !== null)
        ? (data.error || data.detail || data.message || JSON.stringify(data))
        : data || `HTTP error ${response.status}`;
      return { data: (typeof data === 'object' ? data : null), error: errorMsg, status: response.status };
    }

    return { data, error: null, status: response.status };
  } catch (err) {
    return {
      data: null,
      error: `Network Error: Unable to reach backend at ${baseUrl}. Ensure backend is running. (${err.message})`,
      status: 0,
    };
  }
}

// Compute SHA-256 in browser using Web Crypto API
export async function computeSHA256(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// API Endpoints
export const api = {
  // Health
  checkHealth: async () => {
    return apiRequest('/api/health/');
  },

  // Auth
  auth: {
    register: async (payload) => {
      const res = await apiRequest('/api/auth/register/', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.data?.token) {
        setAuthToken(res.data.token);
        setStoredUser(res.data.user);
      }
      return res;
    },
    login: async (phoneNumber, password) => {
      const res = await apiRequest('/api/auth/login/', {
        method: 'POST',
        body: JSON.stringify({ phone_number: phoneNumber, password }),
      });
      if (res.data?.token) {
        setAuthToken(res.data.token);
        setStoredUser(res.data.user);
      }
      return res;
    },
    getCurrentUser: async () => {
      return apiRequest('/api/auth/me/');
    },
    quickStartNode: async (namePrefix = 'DeviceNode') => {
      // Generates a random valid 10-digit phone number: 9XXXXXXXXX
      const randomSuffix = Math.floor(10000000 + Math.random() * 90000000);
      const phone = `9${String(randomSuffix).slice(0, 9)}`;
      const nodeName = `${namePrefix}-${phone.slice(-4)}`;
      const colors = ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#f43f5e', '#3b82f6'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const res = await apiRequest('/api/auth/register/', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: phone,
          display_name: nodeName,
          password: 'password123',
          status_message: 'Active File Transfer & Crash Node',
          avatar_color: color,
        }),
      });

      if (res.data?.token) {
        setAuthToken(res.data.token);
        setStoredUser(res.data.user);
      }
      return res;
    },
    logout: () => {
      setAuthToken(null);
      setStoredUser(null);
    },
  },

  // Users & Chat
  users: {
    list: async (query = '') => {
      const q = query ? `?q=${encodeURIComponent(query)}` : '';
      return apiRequest(`/api/users/${q}`);
    },
  },
  chat: {
    getMessages: async (peerId) => {
      const q = peerId ? `?peer=${peerId}` : '';
      return apiRequest(`/api/messages/${q}`);
    },
    sendMessage: async (content, receiverId) => {
      return apiRequest('/api/messages/', {
        method: 'POST',
        body: JSON.stringify({ content, receiver: receiverId }),
      });
    },
  },

    // File Transfer & Crash-Consistency Engine
  transfers: {
    list: async (peerId) => {
      const q = peerId ? `?peer=${peerId}` : '';
      return apiRequest(`/api/transfers/${q}`);
    },
    getDetails: async (transferId) => {
      return apiRequest(`/api/transfers/${transferId}/`);
    },
    initiate: async (payload) => {
      return apiRequest('/api/transfers/initiate/', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    // Real Binary Stream Ingestion directly to Persistent Disk
    streamBinaryContent: async (transferId, binaryBlobOrBuffer, abortSignal = null) => {
      const baseUrl = getBackendUrl();
      const token = getAuthToken();
      const headers = {
        'Content-Type': 'application/octet-stream',
      };
      if (token) headers['Authorization'] = `Token ${token}`;

      try {
        const response = await fetch(`${baseUrl}/api/transfers/${transferId}/content`, {
          method: 'PUT',
          headers,
          body: binaryBlobOrBuffer,
          signal: abortSignal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          return { data: null, error: data?.error || data?.message || `HTTP ${response.status}`, status: response.status };
        }
        return { data, error: null, status: response.status };
      } catch (err) {
        return {
          data: null,
          error: err.name === 'AbortError' ? 'Transfer stream aborted by user.' : err.message,
          status: 0,
          isAborted: err.name === 'AbortError',
        };
      }
    },
    uploadChunk: async (transferId, chunkData) => {
      return apiRequest(`/api/transfers/${transferId}/chunk/`, {
        method: 'POST',
        body: JSON.stringify(chunkData),
      });
    },
    getResumeState: async (transferId) => {
      return apiRequest(`/api/transfers/${transferId}/resume_state/`);
    },
    // Real Network Interruption Endpoint
    interrupt: async (transferId) => {
      return apiRequest(`/api/transfers/${transferId}/interruption`, {
        method: 'POST',
      });
    },
    // Real Process-Level SIGKILL Worker Crash
    crashWorker: async (transferId) => {
      const endpoint = transferId
        ? `/api/transfers/${transferId}/crash`
        : '/api/crash/global/';
      return apiRequest(endpoint, { method: 'POST' });
    },
    simulateCrash: async (transferId) => {
      const endpoint = transferId
        ? `/api/transfers/${transferId}/crash`
        : '/api/crash/global/';
      return apiRequest(endpoint, { method: 'POST' });
    },
    // Real Disk Crash Recovery
    recover: async (transferId) => {
      return apiRequest(`/api/transfers/${transferId}/recover`, {
        method: 'POST',
      });
    },
    // Streaming Binary Download (Supports Complete or Partial Artifacts)
    getDownloadUrl: (transferId, isPartial = false) => {
      const baseUrl = getBackendUrl();
      return `${baseUrl}/api/transfers/${transferId}/download/${isPartial ? '?partial=true' : ''}`;
    },
  },

  // OS Comparative Analytics & Kernel Logs
  osMetrics: {
    get: async () => {
      return apiRequest('/api/os-metrics/');
    },
    reset: async () => {
      return apiRequest('/api/os-metrics/reset/', { method: 'POST' });
    },
  },
};
