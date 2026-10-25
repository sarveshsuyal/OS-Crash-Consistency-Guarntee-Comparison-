
"""
Startup reconciliation middleware.

On the first HTTP request after the backend process starts, reconcile
unfinished transfers left by a previous process interruption.

Failures are logged and can be retried on a subsequent request.
"""

import logging
from threading import Lock

from .reconciliation import reconcile_interrupted_transfers

logger = logging.getLogger(__name__)

_reconciliation_done = False
_reconciliation_lock = Lock()


class StartupReconciliationMiddleware:
    """
    Reconcile unfinished transfers once per backend process.

    If reconciliation fails, keep the completion flag unset so a later
    request can retry. A lock prevents concurrent reconciliation attempts.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        global _reconciliation_done

        if not _reconciliation_done:
            with _reconciliation_lock:
                if not _reconciliation_done:
                    try:
                        result = reconcile_interrupted_transfers()

                        logger.info(
                            "Startup reconciliation completed successfully: %s",
                            result,
                        )

                        _reconciliation_done = True

                    except Exception:
                        logger.exception(
                            "Startup reconciliation failed. "
                            "It will be retried on a subsequent request."
                        )

        return self.get_response(request)
