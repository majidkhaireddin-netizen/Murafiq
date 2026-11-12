import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEntityConflict, resolveConflictRecord } from './conflictLogic';
import { Client, ConflictItem } from '../types';

test('detectEntityConflict returns null if no fields differ', () => {
  const local: Client = {
    id: 'c1',
    name: 'أحمد',
    company: 'أفق',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  const remote: Client = {
    id: 'c1',
    name: 'أحمد',
    company: 'أفق',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
  };

  const conflict = detectEntityConflict(local, remote, 'client');
  assert.equal(conflict, null);
});

test('detectEntityConflict detects differing fields between local and remote', () => {
  const local: Client = {
    id: 'c1',
    name: 'أحمد الجاسم',
    phone: '+966 50 111 2222',
    notes: 'ملاحظة محلية تم تدوينها بدون إنترنت',
    createdAt: '2026-01-01',
    updatedAt: '2026-07-01T10:00:00Z',
  };
  const remote: Client = {
    id: 'c1',
    name: 'أحمد الجاسم',
    phone: '+966 50 999 8888',
    notes: 'ملاحظة محدثة من جهاز آخر عبر السحابة',
    createdAt: '2026-01-01',
    updatedAt: '2026-07-01T11:00:00Z',
  };

  const conflict = detectEntityConflict(local, remote, 'client');
  assert.notEqual(conflict, null);
  assert.equal(conflict?.differingFields.length, 2);

  const phoneDiff = conflict?.differingFields.find(f => f.field === 'phone');
  assert.equal(phoneDiff?.localValue, '+966 50 111 2222');
  assert.equal(phoneDiff?.remoteValue, '+966 50 999 8888');
});

test('resolveConflictRecord applies keep_local, keep_remote, and merge appropriately', () => {
  const local = {
    id: 'm1',
    title: 'لقاء محلي',
    notes: 'ملاحظاتي بدون إنترنت',
    status: 'completed',
  };
  const remote = {
    id: 'm1',
    title: 'لقاء سحابي',
    notes: 'ملاحظات السحابة',
    status: 'confirmed',
  };

  const conflict: ConflictItem = {
    id: 'conf-1',
    entityType: 'meeting',
    entityTitle: 'لقاء',
    localVersion: local as any,
    remoteVersion: remote as any,
    differingFields: [],
    detectedAt: '',
  };

  const keptLocal = resolveConflictRecord<typeof local>(conflict, 'keep_local');
  assert.equal(keptLocal.notes, 'ملاحظاتي بدون إنترنت');
  assert.equal(keptLocal.status, 'completed');

  const keptRemote = resolveConflictRecord<typeof remote>(conflict, 'keep_remote');
  assert.equal(keptRemote.notes, 'ملاحظات السحابة');
  assert.equal(keptRemote.status, 'confirmed');

  const merged = resolveConflictRecord<typeof local>(conflict, 'merge');
  assert.ok(merged.notes.includes('النسخة السحابية'));
  assert.ok(merged.notes.includes('تعديلاتك أثناء عدم الاتصال'));
});
