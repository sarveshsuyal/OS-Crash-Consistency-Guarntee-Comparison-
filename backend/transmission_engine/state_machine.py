"""
Transfer State Machine.
Defines explicit legal states, strict state transition validation, and audit logging.
"""

from typing import Optional, Dict, Any, List
from django.utils import timezone
from .models import FileTransferSession, CrashEventLog


class TransferState:
    INITIATED = 'INITIATED'
    IN_PROGRESS = 'IN_PROGRESS'
    INTERRUPTED = 'INTERRUPTED'
    RECOVERING = 'RECOVERING'
    RECOVERED = 'RECOVERED'
    COMMITTED = 'COMMITTED'
    FAILED = 'FAILED'
    CRASHED = 'CRASHED'
    CORRUPTED_LOST = 'CORRUPTED_LOST'


# Legal state transitions map
VALID_TRANSITIONS = {
    TransferState.INITIATED: {
        TransferState.IN_PROGRESS,
        TransferState.INTERRUPTED,
        TransferState.CRASHED,
        TransferState.CORRUPTED_LOST,
        TransferState.FAILED,
    },
    TransferState.IN_PROGRESS: {
        TransferState.IN_PROGRESS,    # Continuous chunk receipt
        TransferState.COMMITTED,      # All chunks assembled and verified
        TransferState.INTERRUPTED,    # Network loss, timeout, or orderly halt / restart
        TransferState.RECOVERING,     # Direct recovery audit on interrupted transfer
        TransferState.CRASHED,        # Sudden process termination / crash injection
        TransferState.CORRUPTED_LOST, # Volatile RAM wipe
        TransferState.FAILED,         # Unrecoverable error / payload corruption
    },
    TransferState.CRASHED: {
        TransferState.RECOVERING,     # Recovery process initiated
        TransferState.INTERRUPTED,    # Reconciled on restart
        TransferState.CORRUPTED_LOST, # RAM mode verified lost
        TransferState.FAILED,
    },
    TransferState.INTERRUPTED: {
        TransferState.IN_PROGRESS,    # Resumed transmission
        TransferState.RECOVERING,     # Running recovery
        TransferState.CRASHED,        # Crashed while interrupted
        TransferState.FAILED,
    },
    TransferState.RECOVERING: {
        TransferState.RECOVERED,      # Valid partial recovery, ready to resume
        TransferState.COMMITTED,      # All chunks recovered, verified and reassembled
        TransferState.FAILED,         # Corruption detected during recovery
        TransferState.INTERRUPTED,    # Recovery was interrupted
    },
    TransferState.RECOVERED: {
        TransferState.IN_PROGRESS,    # Resumed transmission from last verified chunk
        TransferState.COMMITTED,      # If verified complete
        TransferState.INTERRUPTED,
        TransferState.FAILED,
    },
    TransferState.COMMITTED: set(),       # Terminal state: cannot accept more chunks or be modified
    TransferState.CORRUPTED_LOST: set(),  # Terminal state: unrecoverable data loss in RAM
    TransferState.FAILED: {
        TransferState.RECOVERING,     # Allow retry of recovery if operator requests
        TransferState.IN_PROGRESS,    # Allow retry
    },
}


class InvalidStateTransitionError(Exception):
    """Raised when an illegal transfer state transition is attempted."""
    def __init__(self, from_state: str, to_state: str, message: str = ""):
        self.from_state = from_state
        self.to_state = to_state
        self.message = message or f"Illegal transition from '{from_state}' to '{to_state}'"
        super().__init__(self.message)


def can_transition(from_state: str, to_state: str) -> bool:
    """Checks whether transitioning from from_state to to_state is valid."""
    allowed = VALID_TRANSITIONS.get(from_state, set())
    return to_state in allowed


def transition_transfer_state(
    transfer: FileTransferSession,
    new_state: str,
    reason: str = "",
    details: Optional[Dict[str, Any]] = None,
    save: bool = True,
    extra_fields: Optional[List[str]] = None
) -> FileTransferSession:
    """
    Validates and performs an explicit state transition on FileTransferSession.
    Logs an audit event in CrashEventLog.
    """
    current_state = transfer.status

    if current_state == new_state:
        # Idempotent no-op
        if save and extra_fields:
            if extra_fields == '__all__':
                transfer.save()
            else:
                transfer.save(update_fields=extra_fields)
        return transfer

    if not can_transition(current_state, new_state):
        raise InvalidStateTransitionError(
            current_state,
            new_state,
            f"State transition from {current_state} to {new_state} is prohibited. Allowed: {list(VALID_TRANSITIONS.get(current_state, []))}"
        )

    transfer.status = new_state
    if reason:
        transfer.failure_reason = reason

    if details is None:
        details = {}
    details['previous_state'] = current_state
    details['new_state'] = new_state
    details['reason'] = reason

    if save:
        if extra_fields == '__all__':
            transfer.save()
        else:
            update_fields = ['status', 'updated_at']
            if reason:
                update_fields.append('failure_reason')
            if extra_fields:
                for f in extra_fields:
                    if f not in update_fields:
                        update_fields.append(f)
            transfer.save(update_fields=update_fields)

    # Log state machine event
    CrashEventLog.objects.create(
        transfer=transfer,
        event_type=f"STATE_TRANSITION_{new_state}",
        subsystem="TRANSFER_STATE_MACHINE",
        message=f"Transfer state changed: {current_state} -> {new_state}. {reason}".strip(),
        details=details
    )

    return transfer
