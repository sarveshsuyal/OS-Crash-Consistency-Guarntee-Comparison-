from django.apps import AppConfig
from django.db.backends.signals import connection_created


def activate_sqlite_wal(sender, connection, **kwargs):
    """
    Ensures SQLite activates Write-Ahead Logging (WAL) and proper sync pragma.
    This provides true OS filesystem crash consistency and non-blocking concurrent readers.
    """
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode = WAL;')
        cursor.execute('PRAGMA synchronous = NORMAL;')


class TransmissionEngineConfig(AppConfig):
    name = 'transmission_engine'

    def ready(self):
        connection_created.connect(activate_sqlite_wal)
        # Safely trigger cold boot reconciliation on process startup
        import sys
        if 'runserver' in sys.argv or 'gunicorn' in sys.argv[0]:
            try:
                from .reconciliation import reconcile_interrupted_transfers
                reconcile_interrupted_transfers()
            except Exception:
                pass

