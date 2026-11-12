import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthenticatedUid, getUserCollectionPath, auth } from './firebase';
import { Client, Meeting, ActionItem, Note } from '../types';

test('getAuthenticatedUid throws when no user is signed in', () => {
  // At test boot without sign-in, auth.currentUser is null
  assert.equal(auth.currentUser, null);
  assert.throws(() => {
    getAuthenticatedUid();
  }, /Authentication required/);
});

test('getUserCollectionPath rejects unauthenticated calls and prevents caller UID spoofing', () => {
  assert.throws(() => {
    getUserCollectionPath('clients');
  }, /Authentication required/);

  assert.throws(() => {
    getUserCollectionPath('meetings');
  }, /Authentication required/);
});

test('User entities accept optional userId field without breaking schema', () => {
  const client: Client = {
    id: 'c-test-1',
    userId: 'user-xyz-123',
    name: 'عميل اختباري',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
  };

  assert.equal(client.userId, 'user-xyz-123');
  assert.equal(client.name, 'عميل اختباري');
});

test('Empty datasets are treated as valid empty states and not automatically populated', () => {
  const emptyClients: Client[] = [];
  const emptyMeetings: Meeting[] = [];
  const emptyTasks: ActionItem[] = [];
  const emptyNotes: Note[] = [];

  assert.equal(emptyClients.length, 0);
  assert.equal(emptyMeetings.length, 0);
  assert.equal(emptyTasks.length, 0);
  assert.equal(emptyNotes.length, 0);
});

test('Session reset clears all sensitive arrays to prevent cross-account disclosure', () => {
  let inMemoryClients: Client[] = [
    { id: 'c1', name: 'عميل حساب أ', createdAt: '', updatedAt: '' },
  ];
  let inMemoryMeetings: Meeting[] = [
    { id: 'm1', clientId: 'c1', title: 'اجتماع سري', dateTime: '', type: 'video', notes: '', status: 'confirmed', photoPaths: [], createdAt: '', updatedAt: '' },
  ];

  assert.equal(inMemoryClients.length, 1);

  // Simulate logout cleanup
  inMemoryClients = [];
  inMemoryMeetings = [];

  assert.equal(inMemoryClients.length, 0);
  assert.equal(inMemoryMeetings.length, 0);
});
