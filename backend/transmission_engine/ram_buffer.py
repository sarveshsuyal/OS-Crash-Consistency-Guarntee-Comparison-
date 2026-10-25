import time
import base64
import hashlib
from typing import Dict, Any, Optional, Tuple


class RAMBufferCapacityExceededError(Exception):
    """Raised when RAM volatile buffer exceeds allocated capacity (backpressure)."""
    pass


class VolatileRAMBufferStore:
    """
    Process-local volatile RAM buffer store.
    Simulates OS Dirty Page Cache held entirely in process virtual memory.
    Because data resides only in process heap, ANY process termination (SIGKILL, crash, reboot)
    destroys this buffer completely without disk persistence.
    """
    # Max global dirty buffer limit (50 MB)
    MAX_GLOBAL_CAPACITY_BYTES = 50 * 1024 * 1024
    # Max per-session buffer limit (20 MB)
    MAX_SESSION_CAPACITY_BYTES = 20 * 1024 * 1024

    def __init__(self):
        # Structure: { transfer_id_str: { 'chunks': { chunk_idx: { data_bytes, hash, size, timestamp } }, 'dirty_bytes': int, 'meta': dict } }
        self._cache: Dict[str, Dict[str, Any]] = {}

    def allocate(self, transfer_id: str, meta: dict):
        self._cache[str(transfer_id)] = {
            'meta': meta,
            'chunks': {},
            'dirty_bytes': 0,
            'allocated_at': time.time(),
        }

    def put_chunk(
        self,
        transfer_id: str,
        chunk_index: int,
        chunk_size: int,
        chunk_hash: str,
        data_base64: str
    ) -> Tuple[int, bool]:
        """
        Validates and stores a chunk in process volatile RAM.
        Returns: (unique_chunk_count, is_duplicate)
        """
        t_id = str(transfer_id)
        if t_id not in self._cache:
            self._cache[t_id] = {'meta': {}, 'chunks': {}, 'dirty_bytes': 0, 'allocated_at': time.time()}

        session_cache = self._cache[t_id]

        # Decode and compute checksum
        raw_bytes = base64.b64decode(data_base64)
        if len(raw_bytes) != chunk_size:
            raise ValueError(f"Chunk size mismatch: expected {chunk_size} bytes, received {len(raw_bytes)} bytes")

        computed_hash = hashlib.sha256(raw_bytes).hexdigest()
        if chunk_hash and computed_hash.lower() != chunk_hash.lower():
            raise ValueError(f"Chunk hash mismatch: computed {computed_hash} != expected {chunk_hash}")

        # Check for duplicate chunk
        if chunk_index in session_cache['chunks']:
            existing_chunk = session_cache['chunks'][chunk_index]
            if existing_chunk['hash'] == computed_hash:
                # Idempotent re-receipt: do not increment dirty bytes or chunk count
                return len(session_cache['chunks']), True
            else:
                raise ValueError(f"Conflicting chunk index {chunk_index} with different hash")

        # Capacity and backpressure accounting
        total_global_dirty = self.get_total_dirty_bytes()
        if total_global_dirty + chunk_size > self.MAX_GLOBAL_CAPACITY_BYTES:
            raise RAMBufferCapacityExceededError(
                f"Global RAM buffer capacity exceeded ({total_global_dirty + chunk_size} > {self.MAX_GLOBAL_CAPACITY_BYTES} bytes)"
            )

        if session_cache['dirty_bytes'] + chunk_size > self.MAX_SESSION_CAPACITY_BYTES:
            raise RAMBufferCapacityExceededError(
                f"Session RAM buffer limit exceeded ({session_cache['dirty_bytes'] + chunk_size} > {self.MAX_SESSION_CAPACITY_BYTES} bytes)"
            )

        # Store in volatile heap memory
        session_cache['chunks'][chunk_index] = {
            'index': chunk_index,
            'size': chunk_size,
            'hash': computed_hash,
            'data_bytes': raw_bytes,
            'cached_at': time.time(),
        }
        session_cache['dirty_bytes'] += chunk_size
        return len(session_cache['chunks']), False

    def get_chunks(self, transfer_id: str) -> Dict[int, Dict[str, Any]]:
        t_id = str(transfer_id)
        if t_id in self._cache:
            return self._cache[t_id]['chunks']
        return {}

    def get_chunk_count(self, transfer_id: str) -> int:
        t_id = str(transfer_id)
        if t_id in self._cache:
            return len(self._cache[t_id]['chunks'])
        return 0

    def get_dirty_bytes(self, transfer_id: str) -> int:
        t_id = str(transfer_id)
        if t_id in self._cache:
            return self._cache[t_id].get('dirty_bytes', 0)
        return 0

    def get_total_dirty_bytes(self) -> int:
        return sum(item.get('dirty_bytes', 0) for item in self._cache.values())

    def simulate_crash_wipe(self, transfer_id: Optional[str] = None) -> dict:
        """
        Simulates power cut / kernel panic / volatile memory loss.
        All uncommitted RAM buffers are wiped to 0.
        """
        if transfer_id:
            t_id = str(transfer_id)
            lost_chunks = len(self._cache.get(t_id, {}).get('chunks', {}))
            lost_bytes = self._cache.get(t_id, {}).get('dirty_bytes', 0)
            if t_id in self._cache:
                del self._cache[t_id]
            return {
                'wiped_transfers': 1,
                'lost_chunks': lost_chunks,
                'lost_bytes': lost_bytes,
                'mode': 'SPECIFIC_SESSION_WIPE'
            }
        else:
            total_transfers = len(self._cache)
            total_chunks = sum(len(v.get('chunks', {})) for v in self._cache.values())
            total_bytes = sum(v.get('dirty_bytes', 0) for v in self._cache.values())
            self._cache.clear()
            return {
                'wiped_transfers': total_transfers,
                'lost_chunks': total_chunks,
                'lost_bytes': total_bytes,
                'mode': 'FULL_SYSTEM_CRASH_WIPE'
            }

    def clear(self):
        self._cache.clear()


# Process-level singleton instance
ram_buffer_store = VolatileRAMBufferStore()
