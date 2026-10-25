import os
import shutil
import tempfile
import base64
import hashlib
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from rest_framework.test import APIClient
from rest_framework import status

from .models import UserProfile, FileTransferSession, JournalChunk, CrashEventLog
from .ram_buffer import ram_buffer_store
from .journal_engine import WALJournalEngine
from .state_machine import TransferState
from .reconciliation import reconcile_interrupted_transfers


class CrashConsistencyLaboratoryTests(TestCase):
    def setUp(self):
        # Create isolated temporary directory for persistent disk chunks
        self.test_storage_dir = tempfile.mkdtemp(prefix="lab_storage_test_")
        self.patcher = override_settings(PERSISTENT_STORAGE_ROOT=self.test_storage_dir)
        self.patcher.enable()

        # Clear process volatile RAM buffer
        ram_buffer_store.clear()

        # Create Test Users: User A (Sender), User B (Receiver), User C (Unauthorized)
        self.user_a = User.objects.create_user(username='9876543210', password='password123')
        UserProfile.objects.create(user=self.user_a, phone_number='9876543210', display_name='Node-A-Sender')

        self.user_b = User.objects.create_user(username='9123456780', password='password123')
        UserProfile.objects.create(user=self.user_b, phone_number='9123456780', display_name='Node-B-Receiver')

        self.user_c = User.objects.create_user(username='9998887770', password='password123')
        UserProfile.objects.create(user=self.user_c, phone_number='9998887770', display_name='Node-C-Intruder')

        # API Clients
        self.client_a = APIClient()
        self.client_a.force_authenticate(user=self.user_a)

        self.client_b = APIClient()
        self.client_b.force_authenticate(user=self.user_b)

        self.client_c = APIClient()
        self.client_c.force_authenticate(user=self.user_c)

        # Prepare test payload: 3 chunks of 64 bytes each = 192 bytes
        self.chunk_size = 64
        self.payload_bytes = b"AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPP" * 3
        self.total_size = len(self.payload_bytes)
        self.total_chunks = 3
        self.file_sha256 = hashlib.sha256(self.payload_bytes).hexdigest()

        # Split into chunks
        self.chunks_data = []
        for i in range(self.total_chunks):
            chunk_slice = self.payload_bytes[i * self.chunk_size:(i + 1) * self.chunk_size]
            c_hash = hashlib.sha256(chunk_slice).hexdigest()
            c_b64 = base64.b64encode(chunk_slice).decode('utf-8')
            self.chunks_data.append({
                'index': i,
                'size': len(chunk_slice),
                'hash': c_hash,
                'base64': c_b64,
                'bytes': chunk_slice
            })

    def tearDown(self):
        self.patcher.disable()
        ram_buffer_store.clear()
        if os.path.exists(self.test_storage_dir):
            shutil.rmtree(self.test_storage_dir, ignore_errors=True)

    # -------------------------------------------------------------
    # Scenario 1: Successful RAM-mode transfer
    # -------------------------------------------------------------
    def test_01_successful_ram_mode_transfer(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'ram_test.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'RAM_VOLATILE',
            'expected_hash': self.file_sha256,
            'receiver_id': self.user_b.id
        }, format='json')
        self.assertEqual(init_res.status_code, status.HTTP_201_CREATED)
        transfer_id = init_res.data['transfer_id']

        # Upload all 3 chunks into RAM
        for c in self.chunks_data:
            res = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': c['index'],
                'chunk_size': c['size'],
                'chunk_hash': c['hash'],
                'data_base64': c['base64']
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.status, TransferState.COMMITTED)
        self.assertTrue(session.integrity_verified)
        self.assertEqual(session.final_file_hash, self.file_sha256)
        self.assertIsNotNone(session.assembled_file)

    # -------------------------------------------------------------
    # Scenario 2: RAM-mode process crash with uncommitted data loss
    # -------------------------------------------------------------
    def test_02_ram_mode_crash_with_uncommitted_data_loss(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'ram_crash.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'RAM_VOLATILE',
            'expected_hash': self.file_sha256,
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Upload 2 chunks (incomplete)
        for c in self.chunks_data[:2]:
            self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': c['index'],
                'chunk_size': c['size'],
                'chunk_hash': c['hash'],
                'data_base64': c['base64']
            }, format='json')

        # Inject crash
        crash_res = self.client_a.post(f'/api/transfers/{transfer_id}/crash/', {'real_kill': False}, format='json')
        self.assertEqual(crash_res.status_code, status.HTTP_200_OK)
        self.assertEqual(crash_res.data['status'], TransferState.CORRUPTED_LOST)

        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.status, TransferState.CORRUPTED_LOST)
        self.assertEqual(ram_buffer_store.get_chunk_count(str(transfer_id)), 0)

        # Attempt recovery: RAM data cannot be recovered
        rec_res = self.client_a.post(f'/api/transfers/{transfer_id}/recover/', format='json')
        self.assertEqual(rec_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(rec_res.data['success'])

        # Attempt download: must fail
        dl_res = self.client_b.get(f'/api/transfers/{transfer_id}/download/')
        self.assertEqual(dl_res.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------
    # Scenario 3: Successful persistent-disk transfer
    # -------------------------------------------------------------
    def test_03_successful_persistent_disk_transfer(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'disk_test.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'expected_hash': self.file_sha256,
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Upload all 3 chunks
        for c in self.chunks_data:
            res = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': c['index'],
                'chunk_size': c['size'],
                'chunk_hash': c['hash'],
                'data_base64': c['base64']
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.status, TransferState.COMMITTED)
        self.assertEqual(session.transferred_chunks, 3)
        self.assertEqual(session.actual_bytes_persisted, self.total_size)
        self.assertEqual(session.final_file_hash, self.file_sha256)

        # Check physical chunk files on disk
        chunk_records = JournalChunk.objects.filter(transfer=session)
        self.assertEqual(chunk_records.count(), 3)
        for cr in chunk_records:
            self.assertTrue(os.path.exists(cr.chunk_file_path))

    # -------------------------------------------------------------
    # Scenario 4: Persistent-disk process crash and recovery
    # -------------------------------------------------------------
    def test_04_persistent_disk_crash_and_recovery(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'disk_recover.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'expected_hash': self.file_sha256,
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Upload chunk 0 and 1
        for c in self.chunks_data[:2]:
            self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': c['index'],
                'chunk_size': c['size'],
                'chunk_hash': c['hash'],
                'data_base64': c['base64']
            }, format='json')

        # Crash mid-transfer
        crash_res = self.client_a.post(f'/api/transfers/{transfer_id}/crash/', {'real_kill': False}, format='json')
        self.assertEqual(crash_res.status_code, status.HTTP_200_OK)
        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.status, TransferState.CRASHED)

        # Upload missing chunk 2 (resume)
        c2 = self.chunks_data[2]
        self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
            'chunk_index': c2['index'],
            'chunk_size': c2['size'],
            'chunk_hash': c2['hash'],
            'data_base64': c2['base64']
        }, format='json')

        # Run Recovery Engine
        rec_res = self.client_a.post(f'/api/transfers/{transfer_id}/recover/', format='json')
        self.assertEqual(rec_res.status_code, status.HTTP_200_OK)
        self.assertTrue(rec_res.data['success'])
        self.assertEqual(rec_res.data['report']['recovered_chunks_count'], 3)

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)
        self.assertEqual(session.final_file_hash, self.file_sha256)

    # -------------------------------------------------------------
    # Scenario 5 & 6: Receiver downloads file & original SHA-256 matches
    # -------------------------------------------------------------
    def test_05_and_06_receiver_downloads_recovered_file_and_hash_matches(self):
        # Create and complete persistent transfer
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='download_verify.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            expected_hash=self.file_sha256,
            status=TransferState.INITIATED
        )
        for c in self.chunks_data:
            WALJournalEngine.commit_wal_chunk(session, c['index'], c['size'], c['hash'], c['base64'])

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)

        # Receiver downloads the file
        dl_res = self.client_b.get(f'/api/transfers/{session.transfer_id}/download/')
        self.assertEqual(dl_res.status_code, status.HTTP_200_OK)

        downloaded_bytes = b"".join(dl_res.streaming_content)
        downloaded_hash = hashlib.sha256(downloaded_bytes).hexdigest()

        # Byte-for-byte SHA-256 match
        self.assertEqual(downloaded_bytes, self.payload_bytes)
        self.assertEqual(downloaded_hash, self.file_sha256)

    # -------------------------------------------------------------
    # Scenario 7: Missing chunks prevent false success
    # -------------------------------------------------------------
    def test_07_missing_chunks_prevent_false_success(self):
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='missing_chunk.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            expected_hash=self.file_sha256,
            status=TransferState.INITIATED
        )
        # Upload chunk 0 and chunk 2 (chunk 1 is missing!)
        WALJournalEngine.commit_wal_chunk(session, self.chunks_data[0]['index'], self.chunks_data[0]['size'], self.chunks_data[0]['hash'], self.chunks_data[0]['base64'])
        WALJournalEngine.commit_wal_chunk(session, self.chunks_data[2]['index'], self.chunks_data[2]['size'], self.chunks_data[2]['hash'], self.chunks_data[2]['base64'])

        # Attempt recovery
        report = WALJournalEngine.execute_recovery(session)
        self.assertFalse(report['is_fully_restored'])
        self.assertIn(1, report['missing_indices'])
        self.assertEqual(report['recovered_chunks_count'], 2)

        session.refresh_from_db()
        self.assertNotEqual(session.status, TransferState.COMMITTED)
        self.assertEqual(session.status, TransferState.RECOVERED)

        # Download must be prohibited
        dl_res = self.client_b.get(f'/api/transfers/{session.transfer_id}/download/')
        self.assertEqual(dl_res.status_code, status.HTTP_400_BAD_REQUEST)

    # -------------------------------------------------------------
    # Scenario 8: Corrupted chunks are rejected or reported
    # -------------------------------------------------------------
    def test_08_corrupted_chunks_are_rejected(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'corrupt.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Corrupt the payload: change first byte
        corrupted_bytes = b"X" + self.chunks_data[0]['bytes'][1:]
        corrupted_b64 = base64.b64encode(corrupted_bytes).decode('utf-8')

        # Send with original expected hash -> must be rejected with 400
        res = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
            'chunk_index': 0,
            'chunk_size': len(corrupted_bytes),
            'chunk_hash': self.chunks_data[0]['hash'],
            'data_base64': corrupted_b64
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('checksum mismatch', res.data['error'].lower())

    # -------------------------------------------------------------
    # Scenario 9: Duplicate chunk uploads do not inflate counters
    # -------------------------------------------------------------
    def test_09_duplicate_chunk_uploads_do_not_inflate_counters(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'duplicate.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']
        c0 = self.chunks_data[0]

        # First upload
        res1 = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
            'chunk_index': c0['index'],
            'chunk_size': c0['size'],
            'chunk_hash': c0['hash'],
            'data_base64': c0['base64']
        }, format='json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data['transferred_chunks'], 1)
        self.assertEqual(res1.data['actual_bytes_persisted'], c0['size'])

        # Duplicate upload
        res2 = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
            'chunk_index': c0['index'],
            'chunk_size': c0['size'],
            'chunk_hash': c0['hash'],
            'data_base64': c0['base64']
        }, format='json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertTrue(res2.data['is_duplicate'])
        self.assertEqual(res2.data['transferred_chunks'], 1)
        self.assertEqual(res2.data['actual_bytes_persisted'], c0['size'])

        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.transferred_chunks, 1)
        self.assertEqual(session.actual_bytes_persisted, c0['size'])

    # -------------------------------------------------------------
    # Scenario 10: Out-of-order chunks are reconstructed correctly
    # -------------------------------------------------------------
    def test_10_out_of_order_chunks_reconstructed_correctly(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'out_of_order.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'expected_hash': self.file_sha256,
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Upload in order: chunk 2, then chunk 0, then chunk 1
        out_of_order = [self.chunks_data[2], self.chunks_data[0], self.chunks_data[1]]
        for c in out_of_order:
            res = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': c['index'],
                'chunk_size': c['size'],
                'chunk_hash': c['hash'],
                'data_base64': c['base64']
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.status, TransferState.COMMITTED)
        self.assertEqual(session.final_file_hash, self.file_sha256)

        # Download and verify assembled bytes match original order
        dl = self.client_b.get(f'/api/transfers/{transfer_id}/download/')
        self.assertEqual(b"".join(dl.streaming_content), self.payload_bytes)

    # -------------------------------------------------------------
    # Scenario 11: Repeated recovery requests do not corrupt committed file
    # -------------------------------------------------------------
    def test_11_repeated_recovery_requests_do_not_corrupt_committed_file(self):
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='repeated_recovery.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            expected_hash=self.file_sha256,
            status=TransferState.INITIATED
        )
        for c in self.chunks_data:
            WALJournalEngine.commit_wal_chunk(session, c['index'], c['size'], c['hash'], c['base64'])

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)
        original_hash = session.final_file_hash

        # Call recover 3 times
        for _ in range(3):
            res = self.client_a.post(f'/api/transfers/{session.transfer_id}/recover/', format='json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertTrue(res.data['success'])

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)
        self.assertEqual(session.final_file_hash, original_hash)

    # -------------------------------------------------------------
    # Scenario 12: Committed transfer rejects additional chunks
    # -------------------------------------------------------------
    def test_12_committed_transfer_rejects_additional_chunks(self):
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='terminal_test.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            expected_hash=self.file_sha256,
            status=TransferState.INITIATED
        )
        for c in self.chunks_data:
            WALJournalEngine.commit_wal_chunk(session, c['index'], c['size'], c['hash'], c['base64'])

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)

        # Attempt to post another chunk
        res = self.client_a.post(f'/api/transfers/{session.transfer_id}/chunk/', {
            'chunk_index': 0,
            'chunk_size': self.chunks_data[0]['size'],
            'chunk_hash': self.chunks_data[0]['hash'],
            'data_base64': self.chunks_data[0]['base64']
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("terminal 'COMMITTED'", res.data['error'])

    # -------------------------------------------------------------
    # Scenario 13: One user cannot download another user's private file
    # -------------------------------------------------------------
    def test_13_one_user_cannot_download_another_users_private_file(self):
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='private_secret.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            expected_hash=self.file_sha256,
            status=TransferState.INITIATED
        )
        for c in self.chunks_data:
            WALJournalEngine.commit_wal_chunk(session, c['index'], c['size'], c['hash'], c['base64'])

        session.refresh_from_db()
        self.assertEqual(session.status, TransferState.COMMITTED)

        # User C attempts to download -> must be 403 Forbidden
        dl_res = self.client_c.get(f'/api/transfers/{session.transfer_id}/download/')
        self.assertEqual(dl_res.status_code, status.HTTP_403_FORBIDDEN)

    # -------------------------------------------------------------
    # Scenario 14: Unauthorized users cannot trigger crashes or recover
    # -------------------------------------------------------------
    def test_14_unauthorized_users_cannot_trigger_crashes_or_recover(self):
        session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='unauth_test.bin',
            file_size=self.total_size,
            chunk_size=self.chunk_size,
            total_chunks=self.total_chunks,
            protocol_mode='JOURNAL_WAL',
            status=TransferState.IN_PROGRESS
        )

        # User C attempts to crash transfer -> 403 Forbidden
        crash_res = self.client_c.post(f'/api/transfers/{session.transfer_id}/crash/', {'real_kill': False}, format='json')
        self.assertEqual(crash_res.status_code, status.HTTP_403_FORBIDDEN)

        # User C attempts to run recovery -> 403 Forbidden
        rec_res = self.client_c.post(f'/api/transfers/{session.transfer_id}/recover/', format='json')
        self.assertEqual(rec_res.status_code, status.HTTP_403_FORBIDDEN)

    # -------------------------------------------------------------
    # Scenario 15: Failed storage operation does not produce false success
    # -------------------------------------------------------------
    def test_15_failed_storage_operation_does_not_produce_false_success(self):
        init_res = self.client_a.post('/api/transfers/initiate/', {
            'filename': 'storage_fail.bin',
            'file_size': self.total_size,
            'chunk_size': self.chunk_size,
            'total_chunks': self.total_chunks,
            'protocol_mode': 'JOURNAL_WAL',
            'receiver_id': self.user_b.id
        }, format='json')
        transfer_id = init_res.data['transfer_id']

        # Mock open to raise IOError during disk write
        with patch("builtins.open", side_effect=IOError("Disk I/O Error simulated")):
            res = self.client_a.post(f'/api/transfers/{transfer_id}/chunk/', {
                'chunk_index': 0,
                'chunk_size': self.chunks_data[0]['size'],
                'chunk_hash': self.chunks_data[0]['hash'],
                'data_base64': self.chunks_data[0]['base64']
            }, format='json')
            self.assertEqual(res.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Ensure no chunk was persisted
        session = FileTransferSession.objects.get(transfer_id=transfer_id)
        self.assertEqual(session.transferred_chunks, 0)
        self.assertEqual(JournalChunk.objects.filter(transfer=session).count(), 0)

    # -------------------------------------------------------------
    # Scenario 16: Application startup reconciles interrupted transfers
    # -------------------------------------------------------------
    def test_16_application_startup_reconciles_interrupted_transfers(self):
        # 1. Uncommitted RAM session in IN_PROGRESS
        ram_session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='reconcile_ram.bin',
            file_size=self.total_size,
            protocol_mode='RAM_VOLATILE',
            status=TransferState.IN_PROGRESS
        )

        # 2. Disk WAL session in IN_PROGRESS
        wal_session = FileTransferSession.objects.create(
            sender=self.user_a,
            receiver=self.user_b,
            filename='reconcile_wal.bin',
            file_size=self.total_size,
            protocol_mode='JOURNAL_WAL',
            status=TransferState.IN_PROGRESS
        )

        # Execute Startup Reconciliation Engine
        stats = reconcile_interrupted_transfers()
        self.assertEqual(stats['reconciled_ram'], 1)
        self.assertEqual(stats['reconciled_wal'], 1)

        ram_session.refresh_from_db()
        wal_session.refresh_from_db()

        # RAM session marked CORRUPTED_LOST
        self.assertEqual(ram_session.status, TransferState.CORRUPTED_LOST)
        self.assertIn("volatile RAM buffer wiped", ram_session.failure_reason)

        # WAL session marked INTERRUPTED (ready to recover)
        self.assertEqual(wal_session.status, TransferState.INTERRUPTED)
        self.assertIn("Persisted chunks survive on disk", wal_session.failure_reason)
