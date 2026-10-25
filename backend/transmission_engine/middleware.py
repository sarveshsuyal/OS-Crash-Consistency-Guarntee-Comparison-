from .reconciliation import reconcile_interrupted_transfers

_reconciliation_done = False


class StartupReconciliationMiddleware:
    """
    Ensures that when the backend server process boots up,
    any in-flight transfers from a previous process crash are safely reconciled
    on the very first HTTP request.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        global _reconciliation_done
        if not _reconciliation_done:
            _reconciliation_done = True
            try:
                reconcile_interrupted_transfers()
            except Exception:
                pass
        return self.get_response(request)
