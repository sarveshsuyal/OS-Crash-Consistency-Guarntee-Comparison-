import uuid
from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    phone_number = models.CharField(max_length=15, unique=True, db_index=True, default='')
    display_name = models.CharField(max_length=100)
    avatar_color = models.CharField(max_length=30, default='#10b981')
    status_message = models.CharField(max_length=255, default='Available')
    is_online = models.BooleanField(default=True)
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.display_name} ({self.phone_number})"



class ChatMessage(models.Model):
    MESSAGE_TYPES = [
        ('TEXT', 'Text Message'),
        ('SYSTEM', 'OS Kernel Alert'),
        ('TRANSFER_ALERT', 'File Transfer Notification'),
    ]
    
    sender = models.ForeignKey(User, related_name='sent_messages', on_delete=models.CASCADE)
    receiver = models.ForeignKey(User, related_name='received_messages', on_delete=models.CASCADE, null=True, blank=True)
    content = models.TextField()
    message_type = models.CharField(max_length=20, choices=MESSAGE_TYPES, default='TEXT')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"[{self.message_type}] {self.sender.username} -> {self.receiver.username if self.receiver else 'ALL'}: {self.content[:30]}"


class FileTransferSession(models.Model):
    PROTOCOL_MODES = [
        ('RAM_VOLATILE', 'Volatile RAM Buffer (No fsync / Dirty Page Cache)'),
        ('JOURNAL_WAL', 'Persistent SQLite Write-Ahead Logging (WAL)'),
    ]

    STATUS_CHOICES = [
        ('INITIATED', 'Initiated'),
        ('IN_PROGRESS', 'In Progress'),
        ('INTERRUPTED', 'Interrupted'),
        ('RECOVERING', 'Recovering'),
        ('RECOVERED', 'Recovered'),
        ('COMMITTED', 'Committed & Verified'),
        ('FAILED', 'Failed'),
        ('CRASHED', 'Crashed'),
        ('CORRUPTED_LOST', 'Data Permanently Lost (RAM Wipe)'),
    ]

    transfer_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    sender = models.ForeignKey(User, related_name='outgoing_transfers', on_delete=models.CASCADE)
    receiver = models.ForeignKey(User, related_name='incoming_transfers', on_delete=models.CASCADE)
    filename = models.CharField(max_length=255)
    safe_stored_filename = models.CharField(max_length=255, default='', blank=True)
    file_size = models.BigIntegerField()
    actual_bytes_persisted = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=120, default='application/octet-stream')
    chunk_size = models.IntegerField(default=65536)  # 64KB
    total_chunks = models.IntegerField(default=1)
    transferred_chunks = models.IntegerField(default=0)
    protocol_mode = models.CharField(max_length=30, choices=PROTOCOL_MODES, default='JOURNAL_WAL')
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='INITIATED')

    expected_hash = models.CharField(max_length=64, blank=True, default='')
    final_file_hash = models.CharField(max_length=64, blank=True, default='')
    integrity_verified = models.BooleanField(default=False)
    worker_pid = models.IntegerField(default=0)
    failure_reason = models.CharField(max_length=255, blank=True, default='')
    crash_checkpoint_chunk = models.IntegerField(default=-1)

    crash_timestamp = models.DateTimeField(null=True, blank=True)
    crash_details = models.JSONField(default=dict, blank=True)
    recovery_details = models.JSONField(default=dict, blank=True)

    assembled_file = models.FileField(upload_to='transfers/%Y/%m/%d/', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.filename} ({self.protocol_mode}) - {self.status}"


class JournalChunk(models.Model):
    """
    Persistent Disk WAL (Write-Ahead Logging) table.
    Records metadata and disk file path for each durably written chunk.
    """
    transfer = models.ForeignKey(FileTransferSession, related_name='journal_chunks', on_delete=models.CASCADE)
    chunk_index = models.IntegerField()
    chunk_size = models.IntegerField()
    chunk_hash = models.CharField(max_length=64)
    chunk_file_path = models.CharField(max_length=500, blank=True, default='')
    data_base64 = models.TextField(blank=True, default='')  # Base64 fallback / mirror
    journal_sequence_no = models.IntegerField()
    is_synced = models.BooleanField(default=True)  # True indicates fsync / checkpointed write
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['chunk_index']
        constraints = [
            models.UniqueConstraint(fields=['transfer', 'chunk_index'], name='unique_transfer_chunk')
        ]

    def __str__(self):
        return f"WAL #{self.journal_sequence_no} - {self.transfer.filename} [Chunk {self.chunk_index}]"


class CrashEventLog(models.Model):
    """
    OS Kernel and Storage Subsystem Event Log.
    Records crash injections, dirty buffer purges, journal replay transactions, and integrity checks.
    """
    transfer = models.ForeignKey(FileTransferSession, null=True, blank=True, on_delete=models.SET_NULL, related_name='crash_logs')
    event_type = models.CharField(max_length=60)
    subsystem = models.CharField(max_length=60, default='KERNEL_VFS')
    message = models.TextField()
    details = models.JSONField(default=dict, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"[{self.timestamp:%H:%M:%S}] [{self.subsystem}] {self.event_type}: {self.message[:40]}"
