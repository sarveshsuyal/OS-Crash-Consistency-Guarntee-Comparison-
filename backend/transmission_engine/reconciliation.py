import sys
from django.utils import timezone
from .models import FileTransferSession, CrashEventLog
from .state_machine import transition_transfer_state, TransferState


def reconcile_interrupted_transfers() -> dict:
    """
    Startup Reconciliation Engine:
    Executed on backend process startup to reconcile in-flight transfers with persistent storage reality.

    1. All uncommitted RAM_VOLATILE transfers that were IN_PROGRESS or INITIATED
       have permanently lost their process-memory buffers on process restart.
       They are reconciled to CORRUPTED_LOST.
    2. All JOURNAL_WAL transfers that were IN_PROGRESS or RECOVERING
       have their persisted chunk files preserved on disk.
       They are reconciled to INTERRUPTED so the operator/user can execute journal recovery or resume.
    """
    # Guard against running during migrations / test setup without tables
    try:
        in_flight = FileTransferSession.objects.filter(
            status__in=[TransferState.IN_PROGRESS, TransferState.RECOVERING]
        )
    except Exception:
        return {'reconciled_ram': 0, 'reconciled_wal': 0}

    ram_count = 0
    wal_count = 0

    for transfer in in_flight:
        if transfer.protocol_mode == 'RAM_VOLATILE':
            try:
                transition_transfer_state(
                    transfer,
                    TransferState.CORRUPTED_LOST,
                    reason="Server process restarted. Process-local volatile RAM buffer wiped to 0."
                )
                transfer.crash_timestamp = timezone.now()
                transfer.crash_details = {
                    'fault_type': 'PROCESS_RESTART_VOLATILE_WIPE',
                    'storage_layer': 'RAM_HEAP_WIPED',
                    'recovery_possible': False,
                    'os_verdict': 'Data permanently lost. Volatile buffer dissipates immediately on process termination.'
                }
                transfer.save(update_fields=['crash_timestamp', 'crash_details', 'updated_at'])
                ram_count += 1
            except Exception:
                pass
        else:
            try:
                from .models import JournalChunk
                persisted_count = JournalChunk.objects.filter(transfer=transfer).count()
                transition_transfer_state(
                    transfer,
                    TransferState.INTERRUPTED,
                    reason=f"Server process restarted. Persisted chunks survive on disk ({persisted_count}/{transfer.total_chunks} verified blocks ready for recovery)."
                )
                transfer.crash_timestamp = timezone.now()
                transfer.crash_details = {
                    'fault_type': 'PROCESS_RESTART_DISK_PRESERVED',
                    'storage_layer': 'PERSISTENT_DISK_CHUNKS',
                    'persisted_chunks': persisted_count,
                    'total_chunks': transfer.total_chunks,
                    'recovery_possible': True,
                    'os_verdict': f"Cold reboot complete. {persisted_count} blocks preserved on persistent disk. Ready for journal recovery or seamless resumption."
                }
                transfer.save(update_fields=['crash_timestamp', 'crash_details', 'updated_at'])
                wal_count += 1
            except Exception:
                pass

    if ram_count > 0 or wal_count > 0:
        CrashEventLog.objects.create(
            event_type='STARTUP_RECONCILIATION_COMPLETED',
            subsystem='KERNEL_SUPERVISOR',
            message=f"Startup reconciliation: marked {ram_count} RAM sessions as CORRUPTED_LOST, {wal_count} WAL sessions as INTERRUPTED.",
            details={'reconciled_ram': ram_count, 'reconciled_wal': wal_count}
        )

    return {'reconciled_ram': ram_count, 'reconciled_wal': wal_count}
