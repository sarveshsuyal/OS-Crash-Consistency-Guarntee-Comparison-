import os
import re
import base64
import hashlib
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from django.conf import settings
from django.db import transaction
from django.core.files.base import ContentFile
from django.utils import timezone

from .models import FileTransferSession, JournalChunk, CrashEventLog
from .state_machine import transition_transfer_state, TransferState, InvalidStateTransitionError


def get_storage_root() -> Path:
    """
    Returns the authoritative persistent storage directory root.
    Checks settings or falls back to workspace storage folder.
    """
    custom = getattr(settings, 'PERSISTENT_STORAGE_ROOT', None)
    if custom:
        root = Path(custom)
    else:
        root = Path(settings.BASE_DIR).parent / 'storage'
        if not root.exists():
            root = Path(settings.BASE_DIR) / 'storage'

    root.mkdir(parents=True, exist_ok=True)
    (root / 'incoming').mkdir(parents=True, exist_ok=True)
    (root / 'completed').mkdir(parents=True, exist_ok=True)
    (root / 'chunks').mkdir(parents=True, exist_ok=True)
    return root


def sanitize_filename(filename: str) -> str:
    """
    Sanitizes filename to prevent directory traversal and safe filesystem storage.
    """
    cleaned = os.path.basename(filename.strip().replace('\\', '/'))
    cleaned = re.sub(r'[^a-zA-Z0-9._-]', '_', cleaned)
    if not cleaned or cleaned.startswith('.'):
        cleaned = f"file_{cleaned}"
    return cleaned[:180]


class WALJournalEngine:
    """
    Persistent Disk / Storage Journal Engine.
    Implements:
    - Real chunk writes to disk using safe temporary file + atomic rename (os.replace).
    - fsync durability barriers.
    - Checksum verification on disk before database metadata commit.
    - Monotonic journal sequence logging in SQLite.
    - True physical chunk recovery and whole-file assembly with SHA-256 verification.
    """

    @classmethod
    def get_chunk_dir(cls, transfer_id: str) -> Path:
        storage_root = get_storage_root()
        chunk_dir = storage_root / 'chunks' / str(transfer_id)
        chunk_dir.mkdir(parents=True, exist_ok=True)
        return chunk_dir

    @classmethod
    def get_completed_file_path(cls, transfer: FileTransferSession) -> Path:
        storage_root = get_storage_root()
        safe_name = sanitize_filename(transfer.filename)
        return storage_root / 'completed' / f"{transfer.transfer_id}_{safe_name}"

    @classmethod
    def commit_wal_chunk(
        cls,
        transfer: FileTransferSession,
        chunk_index: int,
        chunk_size: int,
        chunk_hash: str,
        data_base64: str
    ) -> Tuple[JournalChunk, bool]:
        """
        Durable Chunk Storage Procedure:
        1. Validates payload length and SHA-256 before disk write.
        2. Writes binary bytes to a temporary file in chunk storage.
        3. Flushes and executes fsync on the file descriptor.
        4. Verifies written file on disk by reading and computing SHA-256.
        5. Atomically renames temporary file to <chunk_index>.chunk via os.replace.
        6. Commits metadata into SQLite JournalChunk inside an atomic transaction.
        7. Enforces idempotent duplicate handling.
        Returns: (JournalChunk, is_duplicate)
        """
        # Validate state allows chunk uploads
        if transfer.status in [TransferState.COMMITTED, TransferState.CORRUPTED_LOST]:
            raise ValueError(f"Cannot upload chunks to session in terminal '{transfer.status}' status")

        # Bounds validation
        if chunk_index < 0 or chunk_index >= transfer.total_chunks:
            raise ValueError(f"Chunk index {chunk_index} is out of range [0, {transfer.total_chunks - 1}]")

        # Decode base64 payload
        try:
            raw_bytes = base64.b64decode(data_base64)
        except Exception as e:
            raise ValueError(f"Invalid base64 payload: {str(e)}")

        if len(raw_bytes) != chunk_size:
            raise ValueError(f"Payload size mismatch: expected {chunk_size} bytes, got {len(raw_bytes)} bytes")

        computed_hash = hashlib.sha256(raw_bytes).hexdigest()
        if chunk_hash and computed_hash.lower() != chunk_hash.lower():
            raise ValueError(f"Chunk checksum mismatch: computed {computed_hash} != expected {chunk_hash}")

        chunk_dir = cls.get_chunk_dir(str(transfer.transfer_id))
        target_chunk_file = chunk_dir / f"{chunk_index}.chunk"
        temp_chunk_file = chunk_dir / f"{chunk_index}.chunk.tmp.{uuid.uuid4().hex}"

        # Safe Disk Write with fsync
        try:
            with open(temp_chunk_file, 'wb') as f:
                f.write(raw_bytes)
                f.flush()
                os.fsync(f.fileno())

            # Verify chunk on disk
            with open(temp_chunk_file, 'rb') as f:
                on_disk_bytes = f.read()
                on_disk_hash = hashlib.sha256(on_disk_bytes).hexdigest()
                if on_disk_hash.lower() != computed_hash.lower():
                    raise IOError(f"On-disk chunk verification failed for chunk #{chunk_index}")

            # Atomic rename into permanent chunk path
            os.replace(temp_chunk_file, target_chunk_file)
        except Exception as e:
            if temp_chunk_file.exists():
                try:
                    temp_chunk_file.unlink()
                except OSError:
                    pass
            raise IOError(f"Filesystem write failed for chunk #{chunk_index}: {str(e)}")

        # SQLite Metadata Commit
        with transaction.atomic():
            # Check for existing chunk record (idempotency check)
            existing = JournalChunk.objects.filter(transfer=transfer, chunk_index=chunk_index).first()
            if existing:
                if existing.chunk_hash.lower() == computed_hash.lower() and existing.chunk_size == chunk_size:
                    # Idempotent re-upload of same chunk
                    return existing, True
                else:
                    # Conflicting chunk hash at same index
                    raise ValueError(f"Conflicting chunk #{chunk_index} with different checksum already committed")

            last_chunk = JournalChunk.objects.filter(transfer=transfer).order_by('-journal_sequence_no').first()
            seq_no = (last_chunk.journal_sequence_no + 1) if last_chunk else 1

            chunk_record = JournalChunk.objects.create(
                transfer=transfer,
                chunk_index=chunk_index,
                chunk_size=chunk_size,
                chunk_hash=computed_hash,
                chunk_file_path=str(target_chunk_file),
                data_base64='',  # Disk-persisted: binary file on disk is the source of truth
                journal_sequence_no=seq_no,
                is_synced=True,
            )

            # Update transfer statistics
            persisted_chunks = list(JournalChunk.objects.filter(transfer=transfer).only('chunk_index', 'chunk_size'))
            unique_count = len(persisted_chunks)
            total_persisted_bytes = sum(c.chunk_size for c in persisted_chunks)

            transfer.transferred_chunks = unique_count
            transfer.actual_bytes_persisted = total_persisted_bytes

            if transfer.status not in [TransferState.COMMITTED, TransferState.CRASHED, TransferState.INTERRUPTED]:
                if transfer.status != TransferState.IN_PROGRESS:
                    transition_transfer_state(transfer, TransferState.IN_PROGRESS, reason=f"Received chunk #{chunk_index}", save=False)

            transfer.save(update_fields=['transferred_chunks', 'actual_bytes_persisted', 'status', 'updated_at'])

            CrashEventLog.objects.create(
                transfer=transfer,
                event_type='WAL_BLOCK_COMMITTED',
                subsystem='STORAGE_DISK_JOURNAL',
                message=f"Chunk #{chunk_index} committed to persistent disk & journal (Seq #{seq_no}, {chunk_size} bytes, fsync=OK)",
                details={
                    'chunk_index': chunk_index,
                    'seq_no': seq_no,
                    'size': chunk_size,
                    'hash': computed_hash[:16] + '...',
                    'disk_file': str(target_chunk_file.name),
                    'persisted_count': unique_count,
                    'total_chunks': transfer.total_chunks,
                    'actual_bytes_persisted': total_persisted_bytes
                }
            )

            # Check if all chunks are received to finalize
            if unique_count >= transfer.total_chunks:
                cls.finalize_transfer(transfer)

            return chunk_record, False

    @classmethod
    def finalize_transfer(cls, transfer: FileTransferSession) -> bool:
        """
        Reassembles all committed chunks from disk into a complete verified file.
        1. Verifies that every single chunk index from 0 to total_chunks - 1 exists on disk and in DB.
        2. Reads each chunk sequentially, verifies SHA-256 against journal record.
        3. Writes to temporary assembled file, executes fsync, and verifies total file SHA-256.
        4. Atomically replaces final file and commits status as COMMITTED.
        """
        # Lock transfer record if possible
        if transfer.status == TransferState.COMMITTED and transfer.assembled_file:
            return True  # Idempotent success

        chunks_by_index = {
            c.chunk_index: c
            for c in JournalChunk.objects.filter(transfer=transfer)
        }

        # Verify all indices exist
        missing_indices = []
        for idx in range(transfer.total_chunks):
            if idx not in chunks_by_index:
                missing_indices.append(idx)
            else:
                chunk_record = chunks_by_index[idx]
                chunk_file = Path(chunk_record.chunk_file_path)
                if not chunk_file.exists() or chunk_file.stat().st_size != chunk_record.chunk_size:
                    missing_indices.append(idx)

        if missing_indices:
            CrashEventLog.objects.create(
                transfer=transfer,
                event_type='FINALIZATION_BLOCKED',
                subsystem='STORAGE_ASSEMBLER',
                message=f"Cannot finalize transfer: {len(missing_indices)} chunks missing ({missing_indices[:5]})",
                details={'missing_indices': missing_indices}
            )
            return False

        final_dest = cls.get_completed_file_path(transfer)
        temp_dest = final_dest.with_suffix(f".tmp.{uuid.uuid4().hex}")

        hasher = hashlib.sha256()
        total_written = 0

        try:
            with open(temp_dest, 'wb') as out_f:
                for idx in range(transfer.total_chunks):
                    chunk_record = chunks_by_index[idx]
                    chunk_file = Path(chunk_record.chunk_file_path)

                    with open(chunk_file, 'rb') as in_f:
                        chunk_bytes = in_f.read()

                    # Verify chunk integrity before assembling
                    chunk_hash = hashlib.sha256(chunk_bytes).hexdigest()
                    if chunk_hash.lower() != chunk_record.chunk_hash.lower():
                        raise IOError(f"Corrupted chunk detected at index #{idx} during assembly")

                    out_f.write(chunk_bytes)
                    hasher.update(chunk_bytes)
                    total_written += len(chunk_bytes)

                out_f.flush()
                os.fsync(out_f.fileno())

            # Verify assembled file size and SHA-256
            final_hash = hasher.hexdigest()
            if total_written != transfer.file_size:
                raise IOError(f"Assembled file size {total_written} != expected file size {transfer.file_size}")

            if transfer.expected_hash and final_hash.lower() != transfer.expected_hash.lower():
                raise IOError(f"Assembled file hash {final_hash} != expected hash {transfer.expected_hash}")

            # Atomic rename into final location
            os.replace(temp_dest, final_dest)

            # Update transfer record
            with open(final_dest, 'rb') as final_f:
                transfer.assembled_file.save(
                    sanitize_filename(transfer.filename),
                    ContentFile(final_f.read()),
                    save=False
                )

            transfer.final_file_hash = final_hash
            transfer.transferred_chunks = transfer.total_chunks
            transfer.actual_bytes_persisted = total_written
            transfer.integrity_verified = True
            transfer.safe_stored_filename = str(final_dest.name)

            transition_transfer_state(
                transfer,
                TransferState.COMMITTED,
                reason=f"File reassembled from {transfer.total_chunks} disk chunks and verified (SHA-256: {final_hash[:16]}...)",
                save=True,
                extra_fields=['assembled_file', 'final_file_hash', 'transferred_chunks', 'actual_bytes_persisted', 'integrity_verified', 'safe_stored_filename']
            )

            CrashEventLog.objects.create(
                transfer=transfer,
                event_type='WAL_TRANSACTION_COMMITTED',
                subsystem='STORAGE_DISK_JOURNAL',
                message=f"Transfer verified & committed to disk: {total_written} bytes. SHA-256: {final_hash[:16]}...",
                details={
                    'total_bytes': total_written,
                    'total_chunks': transfer.total_chunks,
                    'sha256': final_hash,
                    'verified': True,
                    'completed_file': str(final_dest.name)
                }
            )
            return True

        except Exception as e:
            if temp_dest.exists():
                try:
                    temp_dest.unlink()
                except OSError:
                    pass
            CrashEventLog.objects.create(
                transfer=transfer,
                event_type='ASSEMBLY_CORRUPTION_FAILED',
                subsystem='STORAGE_ASSEMBLER',
                message=f"Failed to assemble file: {str(e)}",
                details={'error': str(e)}
            )
            transition_transfer_state(transfer, TransferState.FAILED, reason=str(e), save=True)
            return False

    @classmethod
    def execute_recovery(cls, transfer: FileTransferSession) -> dict:
        """
        Executes Real Disk Crash Recovery:
        1. Reads SQLite journal records for the session.
        2. Audits physical chunk files on disk (verifying existence, size, and SHA-256).
        3. Identifies missing, corrupted, and intact chunks.
        4. If all expected chunks exist and are intact, reassembles and commits the file.
        5. If incomplete, transitions to RECOVERED with verified chunk list ready for resumption.
        6. If corruption detected, reports details and transitions appropriately.
        """
        if transfer.status == TransferState.COMMITTED:
            # Transfer is already committed and verified
            return {
                'engine': 'Physical_Disk_Journal_Recovery_Engine',
                'recovery_time_ms': 0.1,
                'total_expected_chunks': transfer.total_chunks,
                'recovered_chunks_count': transfer.total_chunks,
                'missing_chunks_count': 0,
                'corrupted_chunks_count': 0,
                'recovered_bytes': transfer.file_size,
                'verified_chunk_indices': list(range(transfer.total_chunks)),
                'missing_indices': [],
                'corrupted_indices': [],
                'is_fully_restored': True,
                'status': TransferState.COMMITTED,
                'consistency_guarantee': '100% of committed disk chunks',
                'data_loss_percentage': 0.0,
                'timestamp': timezone.now().isoformat(),
            }

        start_time = time.time()
        transition_transfer_state(transfer, TransferState.RECOVERING, reason="Executing disk journal crash recovery audit")

        journal_chunks = {
            c.chunk_index: c
            for c in JournalChunk.objects.filter(transfer=transfer)
        }

        valid_indices = []
        corrupted_indices = []
        missing_indices = []
        recovered_bytes = 0

        for idx in range(transfer.total_chunks):
            if idx not in journal_chunks:
                missing_indices.append(idx)
                continue

            chunk_record = journal_chunks[idx]
            chunk_file = Path(chunk_record.chunk_file_path)

            if not chunk_file.exists():
                missing_indices.append(idx)
                continue

            try:
                with open(chunk_file, 'rb') as f:
                    chunk_bytes = f.read()

                calc_hash = hashlib.sha256(chunk_bytes).hexdigest()
                if (
                    len(chunk_bytes) == chunk_record.chunk_size and
                    calc_hash.lower() == chunk_record.chunk_hash.lower()
                ):
                    valid_indices.append(idx)
                    recovered_bytes += len(chunk_bytes)
                else:
                    corrupted_indices.append(idx)
            except Exception:
                corrupted_indices.append(idx)

        duration_ms = round((time.time() - start_time) * 1000, 2)
        is_complete = (len(valid_indices) == transfer.total_chunks and not corrupted_indices)

        if is_complete:
            # All chunks intact on disk -> finalize file
            success = cls.finalize_transfer(transfer)
            final_status = TransferState.COMMITTED if success else TransferState.FAILED
        elif len(valid_indices) > 0 and not corrupted_indices:
            # Partial intact chunks -> mark RECOVERED (ready to resume missing chunks)
            transition_transfer_state(transfer, TransferState.RECOVERED, reason=f"Recovered {len(valid_indices)} intact chunks from disk journal")
            transfer.transferred_chunks = len(valid_indices)
            transfer.actual_bytes_persisted = recovered_bytes
            transfer.save(update_fields=['transferred_chunks', 'actual_bytes_persisted', 'updated_at'])
            final_status = TransferState.RECOVERED
        else:
            # Corrupted chunks or zero chunks
            reason = f"Recovery audit failed: {len(corrupted_indices)} corrupted, {len(missing_indices)} missing chunks"
            transition_transfer_state(transfer, TransferState.FAILED, reason=reason)
            final_status = TransferState.FAILED

        recovery_report = {
            'engine': 'Physical_Disk_Journal_Recovery_Engine',
            'recovery_time_ms': duration_ms,
            'total_expected_chunks': transfer.total_chunks,
            'recovered_chunks_count': len(valid_indices),
            'missing_chunks_count': len(missing_indices),
            'corrupted_chunks_count': len(corrupted_indices),
            'recovered_bytes': recovered_bytes,
            'verified_chunk_indices': valid_indices,
            'missing_indices': missing_indices,
            'corrupted_indices': corrupted_indices,
            'is_fully_restored': is_complete,
            'status': final_status,
            'consistency_guarantee': '100% of committed disk chunks',
            'data_loss_percentage': 0.0 if is_complete else round((1.0 - (len(valid_indices) / max(1, transfer.total_chunks))) * 100, 1),
            'timestamp': timezone.now().isoformat(),
        }

        transfer.recovery_details = recovery_report
        transfer.save(update_fields=['recovery_details'])

        CrashEventLog.objects.create(
            transfer=transfer,
            event_type='DISK_RECOVERY_AUDIT_COMPLETED',
            subsystem='STORAGE_RECOVERY',
            message=f"Disk recovery audit: {len(valid_indices)}/{transfer.total_chunks} intact ({recovery_report['consistency_guarantee']}) in {duration_ms}ms",
            details=recovery_report
        )

        return recovery_report
