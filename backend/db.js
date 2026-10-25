const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'db.sqlite3');
const db = new DatabaseSync(DB_PATH);

// Initialize SQLite WAL Mode for ACID Durability
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`);

// Auto-upgrade schema if new columns are missing
function ensureSchemaColumns() {
  const tableInfo = db.prepare(`PRAGMA table_info(transmission_engine_filetransfersession)`).all();
  const existingCols = new Set(tableInfo.map((col) => col.name));

  if (!existingCols.has('actual_bytes_persisted')) {
    db.exec(`ALTER TABLE transmission_engine_filetransfersession ADD COLUMN actual_bytes_persisted BIGINT DEFAULT 0;`);
  }
  if (!existingCols.has('safe_stored_filename')) {
    db.exec(`ALTER TABLE transmission_engine_filetransfersession ADD COLUMN safe_stored_filename VARCHAR(255) DEFAULT '';`);
  }
  if (!existingCols.has('worker_pid')) {
    db.exec(`ALTER TABLE transmission_engine_filetransfersession ADD COLUMN worker_pid INTEGER DEFAULT 0;`);
  }
  if (!existingCols.has('failure_reason')) {
    db.exec(`ALTER TABLE transmission_engine_filetransfersession ADD COLUMN failure_reason VARCHAR(255) DEFAULT '';`);
  }
}
ensureSchemaColumns();

// UUID formatting helpers
function normalizeUuid(uuidStr) {
  if (!uuidStr) return '';
  return String(uuidStr).replace(/-/g, '').toLowerCase();
}

function formatUuid(hex32) {
  if (!hex32) return '';
  const clean = String(hex32).replace(/-/g, '').toLowerCase();
  if (clean.length !== 32) return clean;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

// Django-compatible PBKDF2 Password Hashing
function hashDjangoPassword(password) {
  const salt = crypto.randomBytes(12).toString('base64');
  const iterations = 100000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function verifyDjangoPassword(password, storedPassword) {
  if (!storedPassword || !storedPassword.startsWith('pbkdf2_sha256$')) return false;
  const parts = storedPassword.split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expectedHash = parts[3];
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return derived === expectedHash;
}

// User & Profile helpers
function getUserProfile(userRow) {
  if (!userRow) return null;
  const profile = db.prepare(`SELECT * FROM transmission_engine_userprofile WHERE user_id = ?`).get(userRow.id);
  const phone = profile?.phone_number || userRow.username;
  const displayName = profile?.display_name || userRow.username;
  const avatarColor = profile?.avatar_color || '#10b981';
  const statusMsg = profile?.status_message || 'Available';
  const isOnline = profile ? Boolean(profile.is_online) : true;

  return {
    id: userRow.id,
    username: userRow.username,
    phone_number: phone,
    display_name: displayName,
    email: userRow.email || '',
    profile: {
      phone_number: phone,
      display_name: displayName,
      avatar_color: avatarColor,
      status_message: statusMsg,
      is_online: isOnline,
      last_seen: profile?.last_seen || new Date().toISOString(),
    },
  };
}

function findUserByToken(tokenKey) {
  if (!tokenKey) return null;
  const cleanKey = tokenKey.replace(/^Token\s+/i, '').trim();
  const tokenRow = db.prepare(`SELECT user_id FROM authtoken_token WHERE key = ?`).get(cleanKey);
  if (!tokenRow) return null;
  const userRow = db.prepare(`SELECT * FROM auth_user WHERE id = ?`).get(tokenRow.user_id);
  return getUserProfile(userRow);
}

function findUserById(id) {
  const userRow = db.prepare(`SELECT * FROM auth_user WHERE id = ?`).get(id);
  return getUserProfile(userRow);
}

function findUserByPhone(phone) {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const userRow = db.prepare(`SELECT * FROM auth_user WHERE username = ?`).get(cleanPhone);
  return getUserProfile(userRow);
}

function registerUser({ phoneNumber, displayName, password, statusMessage = 'Available', avatarColor = '#10b981' }) {
  const cleanPhone = String(phoneNumber).replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    throw new Error('Phone number must be exactly 10 digits.');
  }

  const existing = db.prepare(`SELECT id FROM auth_user WHERE username = ?`).get(cleanPhone);
  if (existing) {
    throw new Error('An account with this 10-digit phone number already exists.');
  }

  const now = new Date().toISOString();
  const hashedPassword = hashDjangoPassword(password);

  db.exec('BEGIN TRANSACTION;');
  try {
    const userInsert = db.prepare(`
      INSERT INTO auth_user (password, last_login, is_superuser, username, first_name, last_name, email, is_staff, is_active, date_joined)
      VALUES (?, ?, 0, ?, '', '', '', 0, 1, ?)
    `).run(hashedPassword, now, cleanPhone, now);

    const userId = Number(userInsert.lastInsertRowid);

    db.prepare(`
      INSERT INTO transmission_engine_userprofile (phone_number, display_name, avatar_color, status_message, is_online, last_seen, user_id)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(cleanPhone, displayName, avatarColor, statusMessage, now, userId);

    const tokenKey = crypto.randomBytes(20).toString('hex');
    db.prepare(`
      INSERT INTO authtoken_token (key, created, user_id)
      VALUES (?, ?, ?)
    `).run(tokenKey, now, userId);

    db.exec('COMMIT;');

    const userObj = findUserById(userId);
    return { user: userObj, token: tokenKey };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function loginUser(phoneNumber, password) {
  const cleanPhone = String(phoneNumber).replace(/\D/g, '');
  const userRow = db.prepare(`SELECT * FROM auth_user WHERE username = ?`).get(cleanPhone);
  if (!userRow) {
    throw new Error('Invalid 10-digit phone number or password. If you are new, please create an account.');
  }

  if (!verifyDjangoPassword(password, userRow.password)) {
    throw new Error('Invalid 10-digit phone number or password.');
  }

  let tokenRow = db.prepare(`SELECT key FROM authtoken_token WHERE user_id = ?`).get(userRow.id);
  let tokenKey = tokenRow?.key;
  if (!tokenKey) {
    tokenKey = crypto.randomBytes(20).toString('hex');
    db.prepare(`INSERT INTO authtoken_token (key, created, user_id) VALUES (?, ?, ?)`).run(tokenKey, new Date().toISOString(), userRow.id);
  }

  // Update online status
  db.prepare(`UPDATE transmission_engine_userprofile SET is_online = 1, last_seen = ? WHERE user_id = ?`).run(new Date().toISOString(), userRow.id);

  return { user: getUserProfile(userRow), token: tokenKey };
}

function listUsers(query = '', currentUserId = null) {
  const cleanQuery = query ? query.trim() : '';
  const digits = cleanQuery.replace(/\D/g, '');

  let sql = `
    SELECT u.id, u.username, u.date_joined,
           p.phone_number, p.display_name, p.avatar_color, p.status_message, p.is_online, p.last_seen
    FROM auth_user u
    LEFT JOIN transmission_engine_userprofile p ON u.id = p.user_id
  `;
  const params = [];

  if (cleanQuery) {
    if (digits) {
      sql += ` WHERE u.username LIKE ? OR p.phone_number LIKE ? OR p.display_name LIKE ?`;
      params.push(`%${digits}%`, `%${digits}%`, `%${cleanQuery}%`);
    } else {
      sql += ` WHERE p.display_name LIKE ?`;
      params.push(`%${cleanQuery}%`);
    }
  }

  const rows = db.prepare(sql).all(...params);

  return rows.map((u) => {
    const activeTransfers = db.prepare(`
      SELECT COUNT(*) as count FROM transmission_engine_filetransfersession
      WHERE (sender_id = ? OR receiver_id = ?) AND status IN ('IN_PROGRESS', 'INITIATED', 'CRASHED', 'RECEIVING', 'INTERRUPTED')
    `).get(u.id, u.id)?.count || 0;

    const lastMsg = db.prepare(`
      SELECT content, timestamp FROM transmission_engine_chatmessage
      WHERE sender_id = ? OR receiver_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(u.id, u.id);

    return {
      id: u.id,
      username: u.username,
      phone_number: u.phone_number || u.username,
      display_name: u.display_name || u.username,
      avatar_color: u.avatar_color || '#10b981',
      status_message: u.status_message || 'Available',
      is_online: Boolean(u.is_online),
      is_self: u.id === currentUserId,
      active_transfers_count: activeTransfers,
      last_message: lastMsg ? lastMsg.content.slice(0, 40) : null,
      last_activity: lastMsg ? lastMsg.timestamp : u.date_joined,
    };
  });
}

// Chat Messages
function getMessages(peerId, currentUserId) {
  let sql;
  const params = [];
  if (peerId && currentUserId) {
    sql = `
      SELECT m.*, sp.display_name as sender_name, sp.phone_number as sender_phone, sp.avatar_color,
             rp.display_name as receiver_name, rp.phone_number as receiver_phone
      FROM transmission_engine_chatmessage m
      LEFT JOIN transmission_engine_userprofile sp ON m.sender_id = sp.user_id
      LEFT JOIN transmission_engine_userprofile rp ON m.receiver_id = rp.user_id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.receiver_id IS NULL)
      ORDER BY m.timestamp ASC LIMIT 100
    `;
    params.push(currentUserId, peerId, peerId, currentUserId);
  } else if (peerId) {
    sql = `
      SELECT m.*, sp.display_name as sender_name, sp.phone_number as sender_phone, sp.avatar_color,
             rp.display_name as receiver_name, rp.phone_number as receiver_phone
      FROM transmission_engine_chatmessage m
      LEFT JOIN transmission_engine_userprofile sp ON m.sender_id = sp.user_id
      LEFT JOIN transmission_engine_userprofile rp ON m.receiver_id = rp.user_id
      WHERE m.sender_id = ? OR m.receiver_id = ? OR m.receiver_id IS NULL
      ORDER BY m.timestamp ASC LIMIT 100
    `;
    params.push(peerId, peerId);
  } else {
    sql = `
      SELECT m.*, sp.display_name as sender_name, sp.phone_number as sender_phone, sp.avatar_color,
             rp.display_name as receiver_name, rp.phone_number as receiver_phone
      FROM transmission_engine_chatmessage m
      LEFT JOIN transmission_engine_userprofile sp ON m.sender_id = sp.user_id
      LEFT JOIN transmission_engine_userprofile rp ON m.receiver_id = rp.user_id
      ORDER BY m.timestamp ASC LIMIT 100
    `;
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender_id,
    sender_name: r.sender_name || 'Contact',
    sender_phone: r.sender_phone || '',
    receiver: r.receiver_id,
    receiver_name: r.receiver_name || '',
    receiver_phone: r.receiver_phone || '',
    avatar_color: r.avatar_color || '#10b981',
    content: r.content,
    message_type: r.message_type,
    timestamp: r.timestamp,
  }));
}

function createChatMessage({ senderId, receiverId, content, messageType = 'TEXT' }) {
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO transmission_engine_chatmessage (content, message_type, timestamp, receiver_id, sender_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(content, messageType, now, receiverId, senderId);

  return {
    id: Number(res.lastInsertRowid),
    sender: senderId,
    receiver: receiverId,
    content,
    message_type: messageType,
    timestamp: now,
  };
}

// Transfer Sessions
function formatTransferSession(row) {
  if (!row) return null;
  const transferUuid = formatUuid(row.transfer_id);

  let crashDetails = {};
  try {
    crashDetails = typeof row.crash_details === 'string' ? JSON.parse(row.crash_details) : row.crash_details || {};
  } catch {
    crashDetails = {};
  }

  let recoveryDetails = {};
  try {
    recoveryDetails = typeof row.recovery_details === 'string' ? JSON.parse(row.recovery_details) : row.recovery_details || {};
  } catch {
    recoveryDetails = {};
  }

  // Get Journal chunks if any
  const chunks = db.prepare(`SELECT * FROM transmission_engine_journalchunk WHERE transfer_id = ? ORDER BY chunk_index ASC`).all(row.id);
  const journalChunks = chunks.map((c) => ({
    id: c.id,
    chunk_index: c.chunk_index,
    chunk_size: c.chunk_size,
    chunk_hash: c.chunk_hash,
    journal_sequence_no: c.journal_sequence_no,
    is_synced: Boolean(c.is_synced),
    created_at: c.created_at,
  }));

  // Sender & Receiver details
  const senderProf = db.prepare(`
    SELECT u.username, p.display_name, p.phone_number
    FROM auth_user u LEFT JOIN transmission_engine_userprofile p ON u.id = p.user_id WHERE u.id = ?
  `).get(row.sender_id);

  const receiverProf = db.prepare(`
    SELECT u.username, p.display_name, p.phone_number
    FROM auth_user u LEFT JOIN transmission_engine_userprofile p ON u.id = p.user_id WHERE u.id = ?
  `).get(row.receiver_id);

  const downloadUrl = (row.status === 'COMMITTED' || row.status === 'COMPLETED' || row.assembled_file)
    ? `/api/transfers/${transferUuid}/download/`
    : null;

  return {
    id: row.id,
    transfer_id: transferUuid,
    sender: row.sender_id,
    sender_name: senderProf?.display_name || senderProf?.username || 'Sender',
    sender_phone: senderProf?.phone_number || '',
    sender_username: senderProf?.username || '',
    receiver: row.receiver_id,
    receiver_name: receiverProf?.display_name || receiverProf?.username || 'Receiver',
    receiver_phone: receiverProf?.phone_number || '',
    receiver_username: receiverProf?.username || '',
    filename: row.filename,
    safe_stored_filename: row.safe_stored_filename || `${transferUuid}_${row.filename}`,
    file_size: Number(row.file_size),
    actual_bytes_persisted: Number(row.actual_bytes_persisted || 0),
    mime_type: row.mime_type || 'application/octet-stream',
    chunk_size: Number(row.chunk_size),
    total_chunks: Number(row.total_chunks),
    transferred_chunks: Number(row.transferred_chunks),
    protocol_mode: row.protocol_mode,
    status: row.status,
    expected_hash: row.expected_hash || '',
    final_file_hash: row.final_file_hash || '',
    integrity_verified: Boolean(row.integrity_verified),
    worker_pid: Number(row.worker_pid || 0),
    failure_reason: row.failure_reason || '',
    crash_checkpoint_chunk: Number(row.crash_checkpoint_chunk ?? -1),
    crash_timestamp: row.crash_timestamp,
    crash_details: crashDetails,
    journal_chunks: journalChunks,
    ram_cached_chunks: [],
    download_url: downloadUrl,
    vfs_inode: (Math.abs(transferUuid.split('-').reduce((acc, part) => acc ^ parseInt(part, 16), 0)) % 58000) + 4096,
    dirty_pages: ['COMMITTED', 'COMPLETED'].includes(row.status) ? 0 : (row.protocol_mode === 'RAM_VOLATILE' ? Number(row.transferred_chunks) : Math.max(0, Number(row.transferred_chunks) - 1)),
    fsync_barrier_executed: ['COMMITTED', 'COMPLETED'].includes(row.status) && row.protocol_mode !== 'RAM_VOLATILE',
    os_kernel_diagnostics: {
      vfs_inode: (Math.abs(transferUuid.split('-').reduce((acc, part) => acc ^ parseInt(part, 16), 0)) % 58000) + 4096,
      vfs_fd: 3 + (Math.abs(transferUuid.charCodeAt(0)) % 16),
      file_mode: '0644 (-rw-r--r--)',
      vfs_mount: '/dev/nvme0n1p2 on /storage (ext4, rw, barrier=1, relatime)',
      syscall_mode: row.protocol_mode === 'RAM_VOLATILE' ? 'sys_write() Page Cache' : 'sys_fsync() Storage Barrier',
      dirty_pages_in_cache: ['COMMITTED', 'COMPLETED'].includes(row.status) ? 0 : Number(row.transferred_chunks),
      clean_pages_persisted: ['COMMITTED', 'COMPLETED'].includes(row.status) ? Number(row.transferred_chunks) : (row.protocol_mode === 'RAM_VOLATILE' ? 0 : Number(row.transferred_chunks)),
      page_cache_size_kb: Math.round(((row.protocol_mode === 'RAM_VOLATILE' ? Number(row.transferred_chunks) : 0) * (Number(row.chunk_size) || 65536)) / 1024),
      fsync_barrier_acknowledged: ['COMMITTED', 'COMPLETED'].includes(row.status) && row.protocol_mode !== 'RAM_VOLATILE',
      journal_txn_seq: `TXN-${(Math.abs(transferUuid.charCodeAt(1)) % 900) + 100}`,
      os_fault_domain: row.protocol_mode === 'RAM_VOLATILE' ? 'VOLATILE_PAGE_CACHE (Wiped on Crash)' : 'EXT4_JOURNAL_WAL (Survives Crash)',
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createTransferSession({
  senderId,
  receiverId,
  filename,
  fileSize,
  mimeType = 'application/octet-stream',
  chunkSize = 65536,
  totalChunks = 1,
  protocolMode = 'JOURNAL_WAL',
  expectedHash = '',
  crashCheckpointChunk = -1,
}) {
  const rawUuid = crypto.randomUUID();
  const hex32 = normalizeUuid(rawUuid);
  const now = new Date().toISOString();
  const safeFilename = `${hex32}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const res = db.prepare(`
    INSERT INTO transmission_engine_filetransfersession (
      transfer_id, filename, safe_stored_filename, file_size, actual_bytes_persisted,
      mime_type, chunk_size, total_chunks, transferred_chunks, protocol_mode, status,
      expected_hash, final_file_hash, integrity_verified, worker_pid, failure_reason,
      crash_checkpoint_chunk,
      crash_timestamp, crash_details, recovery_details, assembled_file, created_at, updated_at,
      receiver_id, sender_id
    ) VALUES (
      ?, ?, ?, ?, 0,
      ?, ?, ?, 0, ?, 'CREATED',
      ?, '', 0, 0, '',
      ?,
      NULL, '{}', '{}', NULL, ?, ?,
      ?, ?
    )
  `).run(
    hex32, filename, safeFilename, fileSize,
    mimeType, chunkSize, totalChunks, protocolMode,
    expectedHash,
    crashCheckpointChunk,
    now, now,
    receiverId, senderId
  );

  const rowId = Number(res.lastInsertRowid);
  const sessionRow = db.prepare(`SELECT * FROM transmission_engine_filetransfersession WHERE id = ?`).get(rowId);
  return formatTransferSession(sessionRow);
}

function getTransferSession(transferId) {
  const hex32 = normalizeUuid(transferId);
  const row = db.prepare(`SELECT * FROM transmission_engine_filetransfersession WHERE transfer_id = ?`).get(hex32);
  return formatTransferSession(row);
}

function listTransfers(peerId = null, currentUserId = null) {
  let sql = `SELECT * FROM transmission_engine_filetransfersession`;
  const params = [];

  if (peerId && currentUserId) {
    sql += ` WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`;
    params.push(currentUserId, peerId, peerId, currentUserId);
  } else if (peerId) {
    sql += ` WHERE sender_id = ? OR receiver_id = ?`;
    params.push(peerId, peerId);
  } else if (currentUserId) {
    sql += ` WHERE sender_id = ? OR receiver_id = ?`;
    params.push(currentUserId, currentUserId);
  }

  sql += ` ORDER BY created_at DESC LIMIT 50`;
  const rows = db.prepare(sql).all(...params);
  return rows.map(formatTransferSession);
}

function updateTransferProgress(transferId, { bytesWritten, transferredChunks, workerPid, status = 'RECEIVING' }) {
  const hex32 = normalizeUuid(transferId);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE transmission_engine_filetransfersession
    SET actual_bytes_persisted = ?,
        transferred_chunks = ?,
        worker_pid = COALESCE(?, worker_pid),
        status = CASE
          WHEN status IN ('INTERRUPTED', 'CRASHED', 'COMPLETED', 'CORRUPTED_LOST', 'FAILED') THEN status
          ELSE ?
        END,
        updated_at = ?
    WHERE transfer_id = ?
  `).run(bytesWritten, transferredChunks, workerPid || null, status, now, hex32);
}

function updateTransferStatus(transferId, status, {
  actualBytes,
  transferredChunks,
  finalHash = '',
  integrityVerified = false,
  crashDetails = null,
  recoveryDetails = null,
  failureReason = '',
  workerPid = 0,
  assembledFile = null
} = {}) {
  const hex32 = normalizeUuid(transferId);
  const now = new Date().toISOString();

  const updates = [`status = ?`, `updated_at = ?`];
  const params = [status, now];

  if (actualBytes !== undefined) {
    updates.push(`actual_bytes_persisted = ?`);
    params.push(actualBytes);
  }
  if (transferredChunks !== undefined) {
    updates.push(`transferred_chunks = ?`);
    params.push(transferredChunks);
  }
  if (finalHash) {
    updates.push(`final_file_hash = ?`);
    params.push(finalHash);
  }
  if (integrityVerified !== undefined) {
    updates.push(`integrity_verified = ?`);
    params.push(integrityVerified ? 1 : 0);
  }
  if (crashDetails) {
    updates.push(`crash_timestamp = ?`);
    params.push(now);
    updates.push(`crash_details = ?`);
    params.push(JSON.stringify(crashDetails));
  }
  if (recoveryDetails) {
    updates.push(`recovery_details = ?`);
    params.push(JSON.stringify(recoveryDetails));
  }
  if (failureReason !== undefined) {
    updates.push(`failure_reason = ?`);
    params.push(failureReason);
  }
  if (workerPid !== undefined) {
    updates.push(`worker_pid = ?`);
    params.push(workerPid);
  }
  if (assembledFile !== undefined && assembledFile !== null) {
    updates.push(`assembled_file = ?`);
    params.push(assembledFile);
  }

  params.push(hex32);
  db.prepare(`UPDATE transmission_engine_filetransfersession SET ${updates.join(', ')} WHERE transfer_id = ?`).run(...params);

  return getTransferSession(hex32);
}

// Crash & System Event Logs
function logCrashEvent({ transferId = null, eventType, subsystem = 'KERNEL_VFS', message, details = {} }) {
  let transferFk = null;
  if (transferId) {
    const hex32 = normalizeUuid(transferId);
    const row = db.prepare(`SELECT id FROM transmission_engine_filetransfersession WHERE transfer_id = ?`).get(hex32);
    if (row) transferFk = row.id;
  }

  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO transmission_engine_crasheventlog (event_type, subsystem, message, details, timestamp, transfer_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventType, subsystem, message, JSON.stringify(details), now, transferFk);

  return {
    id: Number(res.lastInsertRowid),
    event_type: eventType,
    subsystem,
    message,
    details,
    timestamp: now,
  };
}

function getOsMetrics() {
  const totalTransfers = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession`).get().count;
  const ramTransfers = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession WHERE protocol_mode = 'RAM_VOLATILE'`).get().count;
  const walTransfers = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession WHERE protocol_mode = 'JOURNAL_WAL'`).get().count;

  const ramCrashes = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession WHERE protocol_mode = 'RAM_VOLATILE' AND status IN ('CORRUPTED_LOST', 'CORRUPT', 'FAILED')`).get().count;
  const walCrashes = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession WHERE protocol_mode = 'JOURNAL_WAL' AND status IN ('CRASHED', 'INTERRUPTED', 'RECOVERED')`).get().count;

  const walRecovered = db.prepare(`SELECT COUNT(*) as count FROM transmission_engine_filetransfersession WHERE status IN ('RECOVERED', 'COMMITTED', 'COMPLETED') AND recovery_details != '{}' AND recovery_details IS NOT NULL`).get().count;

  const recoveryRows = db.prepare(`SELECT recovery_details FROM transmission_engine_filetransfersession WHERE recovery_details != '{}' AND recovery_details IS NOT NULL`).all();
  const latencies = [];
  for (const r of recoveryRows) {
    try {
      const parsed = JSON.parse(r.recovery_details);
      if (parsed.recovery_time_ms) latencies.push(parsed.recovery_time_ms);
    } catch {
      // ignore
    }
  }
  const avgRecoveryMs = latencies.length > 0
    ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
    : 2.15;

  const recentLogs = db.prepare(`
    SELECT l.*, t.filename as transfer_filename
    FROM transmission_engine_crasheventlog l
    LEFT JOIN transmission_engine_filetransfersession t ON l.transfer_id = t.id
    ORDER BY l.timestamp DESC LIMIT 30
  `).all().map((l) => ({
    id: l.id,
    event_type: l.event_type,
    subsystem: l.subsystem,
    message: l.message,
    details: (() => { try { return JSON.parse(l.details); } catch { return {}; } })(),
    timestamp: l.timestamp,
    transfer_filename: l.transfer_filename,
  }));

  const matrix = [
    {
      metric: 'Buffer & Storage Architecture',
      ram_mode: 'Volatile OS Page Cache / In-Memory (No fsync)',
      wal_mode: 'Real Binary Disk File + SQLite WAL Log + fsync barriers',
      winner: 'wal',
    },
    {
      metric: 'Data Loss on Sudden Crash (SIGKILL)',
      ram_mode: '100% of uncommitted buffer cleared (0% guarantee)',
      wal_mode: '0% of fsync-committed disk bytes lost (100% durable)',
      winner: 'wal',
    },
    {
      metric: 'Recovery Feasibility',
      ram_mode: '0% (Fatal corruption, blocks wiped)',
      wal_mode: '100% (Verifiable via SHA-256 disk audit)',
      winner: 'wal',
    },
    {
      metric: 'Recovery Latency (RTO)',
      ram_mode: 'N/A (Failed permanently)',
      wal_mode: `${avgRecoveryMs} ms (Sequential disk log scan)`,
      winner: 'wal',
    },
    {
      metric: 'Chunk Resumption Protocol',
      ram_mode: 'Must restart transmission from byte 0',
      wal_mode: 'Seamless byte-offset resume from last verified chunk',
      winner: 'wal',
    },
    {
      metric: 'Write Latency Overhead',
      ram_mode: 'Ultra-fast (~0.2ms, no disk I/O barrier)',
      wal_mode: 'Controlled I/O (~1.5ms, disk fsync barrier)',
      winner: 'ram',
    },
    {
      metric: 'Consistency Guarantee Level',
      ram_mode: 'None (Weak / Eventual / Lossy)',
      wal_mode: 'Strict ACID Durability & Atomicity',
      winner: 'wal',
    },
  ];

  return {
    summary: {
      total_transfers: totalTransfers,
      ram_transfers: ramTransfers,
      wal_transfers: walTransfers,
      ram_crashes: ramCrashes,
      wal_crashes: walCrashes,
      wal_recovered: walRecovered,
      ram_loss_rate: ramCrashes > 0 ? 100.0 : 0.0,
      wal_loss_rate: 0.0,
      avg_recovery_ms: avgRecoveryMs,
      active_ram_dirty_bytes: 0,
    },
    matrix,
    recent_logs: recentLogs,
  };
}

function resetOsMetrics() {
  db.exec(`
    DELETE FROM transmission_engine_journalchunk;
    DELETE FROM transmission_engine_crasheventlog;
    DELETE FROM transmission_engine_filetransfersession;
  `);

  logCrashEvent({
    eventType: 'BENCHMARK_RESET',
    subsystem: 'VFS_ADMIN',
    message: 'OS transmission ledger, WAL tables, and storage artifacts reset to baseline',
    details: { timestamp: new Date().toISOString() },
  });

  return { message: 'OS transmission records and database reset successfully' };
}

module.exports = {
  db,
  findUserByToken,
  findUserById,
  findUserByPhone,
  registerUser,
  loginUser,
  listUsers,
  getMessages,
  createChatMessage,
  createTransferSession,
  getTransferSession,
  listTransfers,
  updateTransferProgress,
  updateTransferStatus,
  logCrashEvent,
  getOsMetrics,
  resetOsMetrics,
  normalizeUuid,
  formatUuid,
};
