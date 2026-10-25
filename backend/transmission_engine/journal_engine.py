
import os
import re
import base64
import hashlib
import time
import uuid
from pathlib import Path
from typing import Tuple

from django.conf import settings
from django.db import transaction
from django.core.files.base import ContentFile
from django.utils import timezone

from .models import FileTransferSession, JournalChunk, CrashEventLog
from .state_machine import (
    transition_transfer_state,
    TransferState,
    InvalidStateTransitionError,
)


def get_storage_root() -> Path:
    """
    Return the configured storage root.

    For production, set PERSISTENT_STORAGE_ROOT to the mount path of your
    persistent disk. The fallback is suitable for local development only.
    """
    custom = getattr(settings, "PERSISTENT_STORAGE_ROOT", None)

    if custom:
        root = Path(custom).expanduser()
    else:
        root = Path(settings.BASE_DIR).parent / "storage"

    root.mkdir(parents=True, exist_ok=True)

    for directory in ("incoming", "completed", "chunks"):
        (root / directory).mkdir(parents=True, exist_ok=True)

    return root.resolve()


def sanitize_filename(filename: str) -> str:
    """Sanitize a filename before using it in a storage path."""
    cleaned = os.path.basename((filename or "").strip().replace("\\", "/"))
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", cleaned)

    if not cleaned or cleaned.startswith("."):
        cleaned = f"file_{cleaned}"

    return cleaned[:180]


def _sha256_file(path: Path) -> str:
    """Calculate a file's SHA-256 hash without loading the entire file."""
    digest = hashlib.sha256()

    with open(path, "rb") as file_obj:
        for block in iter(lambda: file_obj.read(1024 * 1024), b""):
            digest.update(block)

    return digest.hexdigest()


def _atomic_write(path: Path, data: bytes) -> None:
    """
    Write bytes to a temporary file, fsync it, verify it, and atomically
    replace the destination. The temporary file is created in the same
    directory so the rename stays on the same filesystem.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(
        f"{path.name}.tmp.{uuid.uuid4().hex}"
    )

    try:
        with open(temporary_path, "wb") as file_obj:
            file_obj.write(data)
            file_obj.flush()
            os.fsync(file_obj.fileno())

        expected_hash = hashlib.sha256(data).hexdigest()
        if _sha256_file(temporary_path) != expected_hash:
            raise IOError("Temporary file checksum verification failed")

        os.replace(temporary_path, path)

        # Best-effort directory fsync: supported on common POSIX systems.
        # Some platforms/filesystems do not permit opening directories.
        try:
            directory_fd = os.open(str(path.parent), os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        except OSError:
            pass

    finally:
        try:
            if temporary_path.exists():
                temporary_path.unlink()
        except OSError:
            pass


def _chunk_file_is_valid(
    path: Path,
    expected_size: int,
    expected_hash: str,
) -> bool:
    """Check a persisted chunk's existence, size, and checksum."""
    try:
        if not path.is_file() or path.stat().st_size != expected_size:
            return False

        return _sha256_file(path).lower() == expected_hash.lower()
    except OSError:
        return False


class WALJournalEngine:
    """
    Disk-backed Write-Ahead Logging-style chunk engine.

    Chunk bytes are persisted to disk and verified before the corresponding
    journal metadata is committed. Database metadata and filesystem writes
    are separate resources, so recovery must still handle orphaned files
    left behind by a process crash.
    """

    @classmethod
    def get_chunk_dir(cls, transfer_id: str) -> Path:
        chunk_dir = get_storage_root() / "chunks" / str(transfer_id)
        chunk_dir.mkdir(parents=True, exist_ok=True)
        return chunk_dir

    @classmethod
    def get_completed_file_path(
        cls,
        transfer: FileTransferSession,
    ) -> Path:
        safe_name = sanitize_filename(transfer.filename)
        return (
            get_storage_root()
            / "completed"
            / f"{transfer.transfer_id}_{safe_name}"
        )

    @classmethod
    def commit_wal_chunk(
        cls,
        transfer: FileTransferSession,
        chunk_index: int,
        chunk_size: int,
        chunk_hash: str,
        data_base64: str,
    ) -> Tuple[JournalChunk, bool]:
        """
        Persist and journal one chunk.

        Returns:
            (JournalChunk, is_duplicate)

        An identical previously journaled chunk is idempotent. A conflicting
        upload for an already committed chunk index is rejected before its
        contents can replace the existing chunk file.
        """
        if transfer.status in (
            TransferState.COMMITTED,
            TransferState.CORRUPTED_LOST,
            TransferState.CRASHED,
            TransferState.RECOVERING,
        ):
            raise ValueError(
                f"Cannot upload chunks while transfer status is "
                f"'{transfer.status}'"
            )

        if chunk_index < 0 or chunk_index >= transfer.total_chunks:
            raise ValueError(
                f"Chunk index {chunk_index} is out of range "
                f"[0, {transfer.total_chunks - 1}]"
            )

        if chunk_size < 0:
            raise ValueError("Chunk size cannot be negative")

        try:
            raw_bytes = base64.b64decode(data_base64, validate=True)
        except Exception as exc:
            raise ValueError(f"Invalid base64 payload: {exc}") from exc

        if len(raw_bytes) != chunk_size:
            raise ValueError(
                f"Payload size mismatch: expected {chunk_size} bytes, "
                f"got {len(raw_bytes)} bytes"
            )

        computed_hash = hashlib.sha256(raw_bytes).hexdigest()

        if chunk_hash and computed_hash.lower() != chunk_hash.lower():
            raise ValueError(
                f"Chunk checksum mismatch: computed {computed_hash}, "
                f"expected {chunk_hash}"
            )

        chunk_dir = cls.get_chunk_dir(str(transfer.transfer_id))
        target_path = chunk_dir / f"{chunk_index}.chunk"
        temporary_path = chunk_dir / (
            f"{chunk_index}.chunk.tmp.{uuid.uuid4().hex}"
        )

        # Stage and fsync the payload before touching the final chunk path.
        try:
            with open(temporary_path, "wb") as file_obj:
                file_obj.write(raw_bytes)
                file_obj.flush()
                os.fsync(file_obj.fileno())

            if not _chunk_file_is_valid(
                temporary_path, chunk_size, computed_hash
            ):
                raise IOError("Staged chunk verification failed")

            with transaction.atomic():
                # Serialize writers for this transfer on databases that
                # support row-level SELECT FOR UPDATE.
                locked_transfer = (
                    FileTransferSession.objects.select_for_update()
                    .get(pk=transfer.pk)
                )

                existing = JournalChunk.objects.filter(
                    transfer=locked_transfer,
                    chunk_index=chunk_index,
                ).first()

                if existing:
                    if (
                        existing.chunk_hash.lower() != computed_hash.lower()
                        or existing.chunk_size != chunk_size
                    ):
                        raise ValueError(
                            f"Conflicting chunk #{chunk_index}: a different "
                            "checksum or size is already committed"
                        )

                    existing_path = (
                        Path(existing.chunk_file_path)
                        if existing.chunk_file_path
                        else target_path
                    )

                    if _chunk_file_is_valid(
                        existing_path,
                        existing.chunk_size,
                        existing.chunk_hash,
                    ):
                        return existing, True

                    # The database already records these exact bytes, but
                    # the corresponding disk file is missing or damaged.
                    # Repair it using the checksum-verified payload.
                    os.replace(temporary_path, target_path)
                    existing.chunk_file_path = str(target_path)
                    existing.is_synced = True
                    existing.data_base64 = ""
                    existing.save(
                        update_fields=[
                            "chunk_file_path",
                            "is_synced",
                            "data_base64",
                        ]
                    )

                    CrashEventLog.objects.create(
                        transfer=locked_transfer,
                        event_type="WAL_CHUNK_REPAIRED",
                        subsystem="STORAGE_DISK_JOURNAL",
                        message=(
                            f"Repaired persisted chunk #{chunk_index} "
                            "from a checksum-verified re-upload"
                        ),
                        details={
                            "chunk_index": chunk_index,
                            "chunk_hash": computed_hash,
                            "chunk_size": chunk_size,
                        },
                    )

                    return existing, True

                # No journal record exists. Only now replace the final file
                # and create the corresponding metadata record.
                os.replace(temporary_path, target_path)

                if not _chunk_file_is_valid(
                    target_path, chunk_size, computed_hash
                ):
                    raise IOError(
                        f"Final disk verification failed for chunk "
                        f"#{chunk_index}"
                    )

                last_chunk = (
                    JournalChunk.objects.filter(transfer=locked_transfer)
                    .order_by("-journal_sequence_no")
                    .first()
                )
                sequence_number = (
                    last_chunk.journal_sequence_no + 1
                    if last_chunk
                    else 1
                )

                chunk_record = JournalChunk.objects.create(
                    transfer=locked_transfer,
                    chunk_index=chunk_index,
                    chunk_size=chunk_size,
                    chunk_hash=computed_hash,
                    chunk_file_path=str(target_path),
                    data_base64="",
                    journal_sequence_no=sequence_number,
                    is_synced=True,
                )

                persisted_chunks = list(
                    JournalChunk.objects.filter(
                        transfer=locked_transfer
                    ).only("chunk_index", "chunk_size")
                )

                locked_transfer.transferred_chunks = len(persisted_chunks)
                locked_transfer.actual_bytes_persisted = sum(
                    item.chunk_size for item in persisted_chunks
                )

                # Resume interrupted/recovered/failed transfers when a new
                # valid chunk is accepted.
                if locked_transfer.status in (
                    TransferState.INITIATED,
                    TransferState.INTERRUPTED,
                    TransferState.RECOVERED,
                    TransferState.FAILED,
                ):
                    transition_transfer_state(
                        locked_transfer,
                        TransferState.IN_PROGRESS,
                        reason=f"Received chunk #{chunk_index}",
                        save=False,
                    )

                locked_transfer.save(
                    update_fields=[
                        "transferred_chunks",
                        "actual_bytes_persisted",
                        "status",
                        "failure_reason",
                        "updated_at",
                    ]
                )

                CrashEventLog.objects.create(
                    transfer=locked_transfer,
                    event_type="WAL_BLOCK_COMMITTED",
                    subsystem="STORAGE_DISK_JOURNAL",
                    message=(
                        f"Chunk #{chunk_index} committed to disk and journal "
                        f"(sequence #{sequence_number}, {chunk_size} bytes)"
                    ),
                    details={
                        "chunk_index": chunk_index,
                        "seq_no": sequence_number,
                        "size": chunk_size,
                        "hash": computed_hash,
                        "disk_file": target_path.name,
                        "persisted_count": len(persisted_chunks),
                        "total_chunks": locked_transfer.total_chunks,
                        "actual_bytes_persisted": (
                            locked_transfer.actual_bytes_persisted
                        ),
                    },
                )

                # All expected chunk indexes must exist before finalization.
                if len(persisted_chunks) >= locked_transfer.total_chunks:
                    cls.finalize_transfer(locked_transfer)

                # Reflect changes in the caller's model instance.
                transfer.refresh_from_db()

                return chunk_record, False

        except Exception:
            raise
        finally:
            try:
                if temporary_path.exists():
                    temporary_path.unlink()
            except OSError:
                pass

    @classmethod
    def finalize_transfer(cls, transfer: FileTransferSession) -> bool:
        """
        Assemble chunks in index order, verify each chunk and the final file,
        then transition the transfer to COMMITTED.
        """
        transfer.refresh_from_db()

        if transfer.status == TransferState.COMMITTED and transfer.assembled_file:
            return True

        if transfer.status in (
            TransferState.CORRUPTED_LOST,
            TransferState.FAILED,
        ):
            # FAILED transfers may be retried through the state machine,
            # but they must first enter a valid recovery/resume state.
            if transfer.status == TransferState.CORRUPTED_LOST:
                return False

        chunks_by_index = {
            record.chunk_index: record
            for record in JournalChunk.objects.filter(transfer=transfer)
        }

        missing_indices = []
        for index in range(transfer.total_chunks):
            record = chunks_by_index.get(index)

            if record is None:
                missing_indices.append(index)
                continue

            chunk_path = Path(record.chunk_file_path)
            if not _chunk_file_is_valid(
                chunk_path,
                record.chunk_size,
                record.chunk_hash,
            ):
                missing_indices.append(index)

        if missing_indices:
            CrashEventLog.objects.create(
                transfer=transfer,
                event_type="FINALIZATION_BLOCKED",
                subsystem="STORAGE_ASSEMBLER",
                message=(
                    f"Cannot finalize transfer: {len(missing_indices)} "
                    f"chunks missing or invalid ({missing_indices[:10]})"
                ),
                details={"missing_indices": missing_indices},
            )
            return False

        final_path = cls.get_completed_file_path(transfer)
        temporary_path = final_path.with_name(
            f"{final_path.name}.tmp.{uuid.uuid4().hex}"
        )

        digest = hashlib.sha256()
        total_written = 0

        try:
            with open(temporary_path, "wb") as output_file:
                for index in range(transfer.total_chunks):
                    record = chunks_by_index[index]
                    chunk_path = Path(record.chunk_file_path)

                    with open(chunk_path, "rb") as input_file:
                        chunk_bytes = input_file.read()

                    if len(chunk_bytes) != record.chunk_size:
                        raise IOError(
                            f"Chunk #{index} size changed during assembly"
                        )

                    chunk_digest = hashlib.sha256(chunk_bytes).hexdigest()
                    if chunk_digest.lower() != record.chunk_hash.lower():
                        raise IOError(
                            f"Chunk #{index} checksum failed during assembly"
                        )

                    output_file.write(chunk_bytes)
                    digest.update(chunk_bytes)
                    total_written += len(chunk_bytes)

                output_file.flush()
                os.fsync(output_file.fileno())

            final_hash = digest.hexdigest()

            if total_written != transfer.file_size:
                raise IOError(
                    f"Assembled size {total_written} does not match "
                    f"expected size {transfer.file_size}"
                )

            if (
                transfer.expected_hash
                and final_hash.lower() != transfer.expected_hash.lower()
            ):
                raise IOError(
                    "Assembled file checksum does not match expected hash"
                )

            os.replace(temporary_path, final_path)

            # Keep the Django FileField in sync with the assembled file.
            # Configure MEDIA_ROOT on persistent storage in production if
            # downloads depend on this FileField surviving redeploys.
            with open(final_path, "rb") as final_file:
                transfer.assembled_file.save(
                    sanitize_filename(transfer.filename),
                    ContentFile(final_file.read()),
                    save=False,
                )

            transfer.final_file_hash = final_hash
            transfer.transferred_chunks = transfer.total_chunks
            transfer.actual_bytes_persisted = total_written
            transfer.integrity_verified = True
            transfer.safe_stored_filename = str(final_path.name)

            transition_transfer_state(
                transfer,
                TransferState.COMMITTED,
                reason=(
                    f"File reassembled from {transfer.total_chunks} verified "
                    f"chunks (SHA-256: {final_hash})"
                ),
                save=True,
                extra_fields=[
                    "assembled_file",
                    "final_file_hash",
                    "transferred_chunks",
                    "actual_bytes_persisted",
                    "integrity_verified",
                    "safe_stored_filename",
                ],
            )

            CrashEventLog.objects.create(
                transfer=transfer,
                event_type="WAL_TRANSACTION_COMMITTED",
                subsystem="STORAGE_DISK_JOURNAL",
                message=(
                    f"Transfer committed and verified: {total_written} bytes"
                ),
                details={
                    "total_bytes": total_written,
                    "total_chunks": transfer.total_chunks,
                    "sha256": final_hash,
                    "verified": True,
                    "completed_file": final_path.name,
                },
            )

            return True

        except Exception as exc:
            try:
                if temporary_path.exists():
                    temporary_path.unlink()
            except OSError:
                pass

            CrashEventLog.objects.create(
                transfer=transfer,
                event_type="ASSEMBLY_CORRUPTION_FAILED",
                subsystem="STORAGE_ASSEMBLER",
                message=f"Failed to assemble file: {exc}",
                details={"error": str(exc)},
            )

            transfer.refresh_from_db()

            if transfer.status != TransferState.FAILED:
                try:
                    transition_transfer_state(
                        transfer,
                        TransferState.FAILED,
                        reason=str(exc)[:255],
                        save=True,
                    )
                except InvalidStateTransitionError:
                    # Preserve the original assembly failure. The current
                    # state may be terminal and must not be bypassed.
                    pass

            return False

    @classmethod
    def execute_recovery(cls, transfer: FileTransferSession) -> dict:
        """
        Audit journal records and physical chunk files.

        Complete valid transfers are assembled. Incomplete transfers with no
        corrupt committed chunks become RECOVERED so missing chunks can be
        uploaded again. Corrupt chunks result in FAILED.
        """
        transfer.refresh_from_db()

        if transfer.status == TransferState.COMMITTED:
            return {
                "engine": "Physical_Disk_Journal_Recovery_Engine",
                "recovery_time_ms": 0.0,
                "total_expected_chunks": transfer.total_chunks,
                "recovered_chunks_count": transfer.total_chunks,
                "missing_chunks_count": 0,
                "corrupted_chunks_count": 0,
                "recovered_bytes": transfer.file_size,
                "verified_chunk_indices": list(range(transfer.total_chunks)),
                "missing_indices": [],
                "corrupted_indices": [],
                "is_fully_restored": True,
                "status": TransferState.COMMITTED,
                "consistency_guarantee": "Verified committed disk chunks",
                "data_loss_percentage": 0.0,
                "timestamp": timezone.now().isoformat(),
            }

        if transfer.status == TransferState.CORRUPTED_LOST:
            return {
                "engine": "Physical_Disk_Journal_Recovery_Engine",
                "recovery_time_ms": 0.0,
                "total_expected_chunks": transfer.total_chunks,
                "recovered_chunks_count": 0,
                "missing_chunks_count": transfer.total_chunks,
                "corrupted_chunks_count": 0,
                "recovered_bytes": 0,
                "verified_chunk_indices": [],
                "missing_indices": list(range(transfer.total_chunks)),
                "corrupted_indices": [],
                "is_fully_restored": False,
                "status": TransferState.CORRUPTED_LOST,
                "consistency_guarantee": "No recoverable chunks verified",
                "data_loss_percentage": 100.0,
                "timestamp": timezone.now().isoformat(),
            }

        start_time = time.time()

        journal_chunks = {
            record.chunk_index: record
            for record in JournalChunk.objects.filter(transfer=transfer)
        }

        # An untouched transfer with no journal entries does not need a
        # recovery state transition. It remains available for normal upload.
        if (
            transfer.status == TransferState.INITIATED
            and not journal_chunks
        ):
            report = {
                "engine": "Physical_Disk_Journal_Recovery_Engine",
                "recovery_time_ms": 0.0,
                "total_expected_chunks": transfer.total_chunks,
                "recovered_chunks_count": 0,
                "missing_chunks_count": transfer.total_chunks,
                "corrupted_chunks_count": 0,
                "recovered_bytes": 0,
                "verified_chunk_indices": [],
                "missing_indices": list(range(transfer.total_chunks)),
                "corrupted_indices": [],
                "is_fully_restored": False,
                "status": TransferState.INITIATED,
                "consistency_guarantee": "No chunks had been committed",
                "data_loss_percentage": 0.0,
                "timestamp": timezone.now().isoformat(),
            }
            transfer.recovery_details = report
            transfer.save(update_fields=["recovery_details"])
            return report

        # RECOVERED does not allow RECOVERING -> audit it in place. For
        # other supported states, enter RECOVERING using the state machine.
        if transfer.status != TransferState.RECOVERED:
            if transfer.status == TransferState.INITIATED:
                transition_transfer_state(
                    transfer,
                    TransferState.IN_PROGRESS,
                    reason="Journal entries found during recovery audit",
                )

            try:
                transition_transfer_state(
                    transfer,
                    TransferState.RECOVERING,
                    reason="Executing disk journal crash recovery audit",
                )
            except InvalidStateTransitionError:
                raise

        valid_indices = []
        corrupted_indices = []
        missing_indices = []
        recovered_bytes = 0

        for index in range(transfer.total_chunks):
            record = journal_chunks.get(index)

            if record is None:
                missing_indices.append(index)
                continue

            chunk_path = Path(record.chunk_file_path)

            if not chunk_path.is_file():
                missing_indices.append(index)
                continue

            if _chunk_file_is_valid(
                chunk_path,
                record.chunk_size,
                record.chunk_hash,
            ):
                valid_indices.append(index)
                recovered_bytes += record.chunk_size
            else:
                corrupted_indices.append(index)

        duration_ms = round((time.time() - start_time) * 1000, 2)
        is_complete = (
            len(valid_indices) == transfer.total_chunks
            and not missing_indices
            and not corrupted_indices
        )

        if is_complete:
            success = cls.finalize_transfer(transfer)
            transfer.refresh_from_db()
            final_status = (
                TransferState.COMMITTED
                if success
                else transfer.status
            )

        elif not corrupted_indices:
            # Missing chunks are not proof of corruption. Preserve verified
            # chunks and allow the sender to resume the transfer.
            if transfer.status != TransferState.RECOVERED:
                transition_transfer_state(
                    transfer,
                    TransferState.RECOVERED,
                    reason=(
                        f"Recovery verified {len(valid_indices)} intact "
                        "chunks; missing chunks can be resumed"
                    ),
                )

            transfer.transferred_chunks = len(valid_indices)
            transfer.actual_bytes_persisted = recovered_bytes
            transfer.save(
                update_fields=[
                    "transferred_chunks",
                    "actual_bytes_persisted",
                    "updated_at",
                ]
            )
            final_status = TransferState.RECOVERED

        else:
            reason = (
                f"Recovery found {len(corrupted_indices)} corrupted and "
                f"{len(missing_indices)} missing chunks"
            )

            if transfer.status != TransferState.FAILED:
                transition_transfer_state(
                    transfer,
                    TransferState.FAILED,
                    reason=reason,
                )

            final_status = TransferState.FAILED

        report = {
            "engine": "Physical_Disk_Journal_Recovery_Engine",
            "recovery_time_ms": duration_ms,
            "total_expected_chunks": transfer.total_chunks,
            "recovered_chunks_count": len(valid_indices),
            "missing_chunks_count": len(missing_indices),
            "corrupted_chunks_count": len(corrupted_indices),
            "recovered_bytes": recovered_bytes,
            "verified_chunk_indices": valid_indices,
            "missing_indices": missing_indices,
            "corrupted_indices": corrupted_indices,
            "is_fully_restored": is_complete and final_status == TransferState.COMMITTED,
            "status": final_status,
            "consistency_guarantee": "Verified committed disk chunks",
            "data_loss_percentage": (
                0.0
                if is_complete
                else round(
                    (
                        1.0
                        - len(valid_indices) / max(1, transfer.total_chunks)
                    )
                    * 100,
                    1,
                )
            ),
            "timestamp": timezone.now().isoformat(),
        }

        transfer.recovery_details = report
        transfer.save(update_fields=["recovery_details"])

        CrashEventLog.objects.create(
            transfer=transfer,
            event_type="DISK_RECOVERY_AUDIT_COMPLETED",
            subsystem="STORAGE_RECOVERY",
            message=(
                f"Disk recovery audit: {len(valid_indices)}/"
                f"{transfer.total_chunks} chunks verified in {duration_ms}ms"
            ),
            details=report,
        )

        return report
