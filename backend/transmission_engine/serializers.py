import re
from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile, ChatMessage, FileTransferSession, JournalChunk, CrashEventLog
from .ram_buffer import ram_buffer_store


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = ['phone_number', 'display_name', 'avatar_color', 'status_message', 'is_online', 'last_seen']


class UserSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer(read_only=True)
    phone_number = serializers.CharField(source='profile.phone_number', read_only=True)
    display_name = serializers.CharField(source='profile.display_name', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'phone_number', 'display_name', 'email', 'profile']


class RegisterSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=15)
    display_name = serializers.CharField(max_length=100)
    password = serializers.CharField(write_only=True, min_length=4)
    status_message = serializers.CharField(max_length=255, required=False, default='Available')
    avatar_color = serializers.CharField(max_length=30, required=False, default='#10b981')

    def validate_phone_number(self, value):
        # Extract digits only
        cleaned = re.sub(r'\D', '', value)
        if len(cleaned) != 10:
            raise serializers.ValidationError("Phone number must be exactly 10 digits (e.g. 9876543210).")
        if User.objects.filter(username=cleaned).exists() or UserProfile.objects.filter(phone_number=cleaned).exists():
            raise serializers.ValidationError("An account with this 10-digit phone number already exists.")
        return cleaned

    def create(self, validated_data):
        phone = validated_data['phone_number']
        display_name = validated_data['display_name']
        password = validated_data['password']
        status_msg = validated_data.get('status_message', 'Available')
        color = validated_data.get('avatar_color', '#10b981')

        user = User.objects.create_user(
            username=phone,
            password=password
        )
        UserProfile.objects.create(
            user=user,
            phone_number=phone,
            display_name=display_name,
            avatar_color=color,
            status_message=status_msg,
            is_online=True
        )
        return user


class ChatMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.profile.display_name', read_only=True)
    sender_phone = serializers.CharField(source='sender.profile.phone_number', read_only=True)
    receiver_name = serializers.CharField(source='receiver.profile.display_name', read_only=True)
    receiver_phone = serializers.CharField(source='receiver.profile.phone_number', read_only=True)
    avatar_color = serializers.CharField(source='sender.profile.avatar_color', read_only=True)

    class Meta:
        model = ChatMessage
        fields = [
            'id',
            'sender',
            'sender_name',
            'sender_phone',
            'receiver',
            'receiver_name',
            'receiver_phone',
            'avatar_color',
            'content',
            'message_type',
            'timestamp'
        ]


class JournalChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = JournalChunk
        fields = ['id', 'chunk_index', 'chunk_size', 'chunk_hash', 'journal_sequence_no', 'is_synced', 'created_at']


class FileTransferSessionSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.profile.display_name', read_only=True)
    sender_phone = serializers.CharField(source='sender.profile.phone_number', read_only=True)
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    receiver_name = serializers.CharField(source='receiver.profile.display_name', read_only=True)
    receiver_phone = serializers.CharField(source='receiver.profile.phone_number', read_only=True)
    receiver_username = serializers.CharField(source='receiver.username', read_only=True)
    journal_chunks = JournalChunkSerializer(many=True, read_only=True)
    ram_cached_chunks = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = FileTransferSession
        fields = [
            'transfer_id',
            'sender',
            'sender_name',
            'sender_phone',
            'sender_username',
            'receiver',
            'receiver_name',
            'receiver_phone',
            'receiver_username',
            'filename',
            'safe_stored_filename',
            'file_size',
            'actual_bytes_persisted',
            'mime_type',
            'chunk_size',
            'total_chunks',
            'transferred_chunks',
            'protocol_mode',
            'status',
            'expected_hash',
            'final_file_hash',
            'integrity_verified',
            'worker_pid',
            'failure_reason',
            'crash_timestamp',
            'crash_details',
            'recovery_details',
            'journal_chunks',
            'ram_cached_chunks',
            'download_url',
            'vfs_inode',
            'dirty_pages',
            'fsync_barrier_executed',
            'os_kernel_diagnostics',
            'created_at',
            'updated_at'
        ]

    vfs_inode = serializers.SerializerMethodField()
    dirty_pages = serializers.SerializerMethodField()
    fsync_barrier_executed = serializers.SerializerMethodField()
    os_kernel_diagnostics = serializers.SerializerMethodField()

    def get_vfs_inode(self, obj):
        # Deterministic Linux Inode ID
        return (abs(hash(str(obj.transfer_id))) % 58000) + 4096

    def get_dirty_pages(self, obj):
        if obj.status in ['COMMITTED', 'COMPLETED']:
            return 0
        if obj.protocol_mode == 'RAM_VOLATILE':
            return obj.transferred_chunks
        return max(0, obj.transferred_chunks - 1)

    def get_fsync_barrier_executed(self, obj):
        return obj.status in ['COMMITTED', 'COMPLETED'] and obj.protocol_mode != 'RAM_VOLATILE'

    def get_os_kernel_diagnostics(self, obj):
        ino = (abs(hash(str(obj.transfer_id))) % 58000) + 4096
        fd = 3 + (abs(hash(str(obj.transfer_id))) % 16)
        is_committed = obj.status in ['COMMITTED', 'COMPLETED']
        dirty = 0 if is_committed else obj.transferred_chunks

        return {
            'vfs_inode': ino,
            'vfs_fd': fd,
            'file_mode': '0644 (-rw-r--r--)',
            'vfs_mount': '/dev/nvme0n1p2 on /storage (ext4, rw, barrier=1, relatime)',
            'syscall_mode': 'sys_write() Page Cache' if obj.protocol_mode == 'RAM_VOLATILE' else 'sys_fsync() Storage Barrier',
            'dirty_pages_in_cache': dirty,
            'clean_pages_persisted': obj.transferred_chunks if is_committed else (0 if obj.protocol_mode == 'RAM_VOLATILE' else obj.transferred_chunks),
            'page_cache_size_kb': round((dirty * (obj.chunk_size or 65536)) / 1024, 1),
            'fsync_barrier_acknowledged': is_committed and obj.protocol_mode != 'RAM_VOLATILE',
            'journal_txn_seq': f"TXN-{(abs(hash(str(obj.transfer_id))) % 900) + 100}",
            'os_fault_domain': 'VOLATILE_PAGE_CACHE (Wiped on Crash)' if obj.protocol_mode == 'RAM_VOLATILE' else 'EXT4_JOURNAL_WAL (Survives Crash)',
        }

    def get_ram_cached_chunks(self, obj):
        if obj.protocol_mode == 'RAM_VOLATILE':
            cached = ram_buffer_store.get_chunks(str(obj.transfer_id))
            return [
                {
                    'chunk_index': idx,
                    'size': c.get('size'),
                    'hash': c.get('hash'),
                    'is_volatile': True
                }
                for idx, c in sorted(cached.items())
            ]
        return []

    def get_download_url(self, obj):
        if obj.assembled_file:
            return obj.assembled_file.url
        return None


class CrashEventLogSerializer(serializers.ModelSerializer):
    transfer_filename = serializers.CharField(source='transfer.filename', read_only=True)

    class Meta:
        model = CrashEventLog
        fields = ['id', 'transfer', 'transfer_filename', 'event_type', 'subsystem', 'message', 'details', 'timestamp']
