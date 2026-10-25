/**
 * Isolated Binary Transfer Worker Process
 *
 * Runs as an independent child process spawned by coordinator.js.
 * Reads raw binary stream from process.stdin, writes directly to persistent disk storage,
 * enforces fsync barriers in WAL mode, computes cryptographic SHA-256 checksums,
 * and handles deterministic SIGKILL process crashes without graceful cleanup handlers.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const [
  ,
  ,
  transferId,
  tempFilePath,
  metadataFilePath,
  expectedSizeStr,
  expectedHash = '',
  protocolMode = 'JOURNAL_WAL',
  chunkSizeStr = '65536',
  crashAtByteStr = '0',
] = process.argv;

const expectedSize = parseInt(expectedSizeStr, 10) || 0;
const chunkSize = parseInt(chunkSizeStr, 10) || 65536;
const crashAtByte = parseInt(crashAtByteStr, 10) || 0;

let bytesWritten = 0;
let lastFsyncByte = 0;
const hasher = crypto.createHash('sha256');

// Ensure parent directory exists
fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });

// Check existing file size if resuming
try {
  if (fs.existsSync(tempFilePath)) {
    const stat = fs.statSync(tempFilePath);
    bytesWritten = stat.size;
    lastFsyncByte = stat.size;
    if (stat.size > 0) {
      const existingBytes = fs.readFileSync(tempFilePath);
      hasher.update(existingBytes);
    }
  }
} catch {
  bytesWritten = 0;
}

// Open file descriptor for appending binary data
const fd = fs.openSync(tempFilePath, 'a');

// Notify coordinator that worker is ready
if (process.send) {
  process.send({
    type: 'READY',
    pid: process.pid,
    transferId,
    initialBytes: bytesWritten,
    protocolMode,
  });
}

// Write initial metadata snapshot
function writeDurableMetadata(status = 'RECEIVING', error = '') {
  try {
    fs.mkdirSync(path.dirname(metadataFilePath), { recursive: true });
    const meta = {
      transferId,
      tempFilePath,
      expectedSize,
      actualBytesPersisted: bytesWritten,
      expectedHash,
      protocolMode,
      chunkSize,
      workerPid: process.pid,
      status,
      error,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(metadataFilePath, JSON.stringify(meta, null, 2), 'utf8');
  } catch {
    // ignore
  }
}

writeDurableMetadata('RECEIVING');

// Process binary chunks directly from stdin
process.stdin.on('data', (chunk) => {
  try {
    // Write directly to disk descriptor
    fs.writeSync(fd, chunk, 0, chunk.length, null);
    bytesWritten += chunk.length;
    hasher.update(chunk);

    // In JOURNAL_WAL mode, enforce disk durability barrier (fsync)
    if (protocolMode === 'JOURNAL_WAL') {
      if (bytesWritten - lastFsyncByte >= chunkSize) {
        fs.fdatasyncSync(fd);
        lastFsyncByte = bytesWritten;
      }
    }

    // Deterministic crash checkpoint if requested
    if (crashAtByte > 0 && bytesWritten >= crashAtByte) {
      if (process.send) {
        process.send({
          type: 'CRASH_TRIGGERED',
          bytesWritten,
          pid: process.pid,
          message: `Worker hit deterministic crash checkpoint at ${bytesWritten} bytes. Terminating with SIGKILL.`,
        });
      }
      writeDurableMetadata('CRASHED', 'Worker terminated at deterministic test checkpoint.');

      // Abrupt SIGKILL — no graceful cleanup
      if (process.platform === 'win32') {
        process.exit(137);
      } else {
        process.kill(process.pid, 'SIGKILL');
      }
      return;
    }

    // Report progress to coordinator
    if (process.send) {
      process.send({
        type: 'PROGRESS',
        bytesWritten,
        transferredChunks: Math.ceil(bytesWritten / chunkSize),
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    if (process.send) {
      process.send({ type: 'ERROR', error: err.message, bytesWritten });
    }
    writeDurableMetadata('FAILED', err.message);
    process.exit(1);
  }
});

process.stdin.on('end', () => {
  try {
    // Final sync and close
    if (protocolMode === 'JOURNAL_WAL') {
      fs.fdatasyncSync(fd);
    }
    fs.closeSync(fd);

    const finalHash = hasher.digest('hex');
    const integrityVerified = expectedHash ? expectedHash.toLowerCase() === finalHash.toLowerCase() : true;

    writeDurableMetadata('COMPLETED');

    if (process.send) {
      process.send({
        type: 'COMPLETE',
        totalBytes: bytesWritten,
        finalHash,
        integrityVerified,
      });
    }

    process.exit(0);
  } catch (err) {
    if (process.send) {
      process.send({ type: 'ERROR', error: err.message, bytesWritten });
    }
    writeDurableMetadata('FAILED', err.message);
    process.exit(1);
  }
});

process.stdin.on('error', (err) => {
  try {
    fs.closeSync(fd);
  } catch {
    // ignore
  }
  if (process.send) {
    process.send({ type: 'STREAM_ERROR', error: err.message, bytesWritten });
  }
  writeDurableMetadata('INTERRUPTED', err.message);
  process.exit(1);
});
