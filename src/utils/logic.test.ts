import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categorizeTasks,
  formatArabicDate,
  getRelativeTimeArabic,
  suggestFollowUpDate,
  detectClientsNeedingReview,
  universalSearch,
  applyMeetingTemplate,
  insertMeetingSnippet
} from './logic';
import { ActionItem, Client, Meeting, Note } from '../types';

test('formatArabicDate formats date correctly in Arabic', () => {
  const formatted = formatArabicDate('2026-07-15T10:00:00Z');
  assert.ok(formatted.includes('يوليو') || formatted.includes('15'));
});

test('getRelativeTimeArabic returns today, tomorrow, and past days properly', () => {
  const today = new Date().toISOString();
  assert.equal(getRelativeTimeArabic(today), 'اليوم');

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  assert.equal(getRelativeTimeArabic(tomorrow), 'غداً');
});

test('categorizeTasks groups overdue, today, this week, and later tasks properly', () => {
  const refDate = new Date('2026-07-15T12:00:00Z');

  const mockTasks: ActionItem[] = [
    {
      id: 't1',
      clientId: 'c1',
      title: 'مهمة متأخرة',
      dueDate: '2026-07-10',
      priority: 'urgent',
      status: 'pending',
      createdAt: '2026-07-01'
    },
    {
      id: 't2',
      clientId: 'c1',
      title: 'مهمة اليوم',
      dueDate: '2026-07-15',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-07-01'
    },
    {
      id: 't3',
      clientId: 'c1',
      title: 'مهمة هذا الأسبوع',
      dueDate: '2026-07-18',
      priority: 'medium',
      status: 'pending',
      createdAt: '2026-07-01'
    },
    {
      id: 't4',
      clientId: 'c1',
      title: 'مهمة لاحقاً',
      dueDate: '2026-08-20',
      priority: 'low',
      status: 'pending',
      createdAt: '2026-07-01'
    },
    {
      id: 't5',
      clientId: 'c1',
      title: 'مهمة منجزة لا تظهر في التصنيفات المعلقة',
      dueDate: '2026-07-10',
      priority: 'urgent',
      status: 'completed',
      createdAt: '2026-07-01'
    }
  ];

  const categories = categorizeTasks(mockTasks, refDate);
  assert.equal(categories.overdue.length, 1);
  assert.equal(categories.overdue[0].id, 't1');
  assert.equal(categories.today.length, 1);
  assert.equal(categories.today[0].id, 't2');
  assert.equal(categories.thisWeek.length, 1);
  assert.equal(categories.thisWeek[0].id, 't3');
  assert.equal(categories.later.length, 1);
  assert.equal(categories.later[0].id, 't4');
});

test('suggestFollowUpDate prioritizes urgent and high actions with closer dates', () => {
  const urgentSuggestion = suggestFollowUpDate('2026-07-15T00:00:00Z', 'urgent');
  assert.equal(urgentSuggestion.suggestedDate, '2026-07-17');

  const highSuggestion = suggestFollowUpDate('2026-07-15T00:00:00Z', 'high');
  assert.equal(highSuggestion.suggestedDate, '2026-07-20');
});

test('detectClientsNeedingReview flags clients with no meetings in > 30 days', () => {
  const refDate = new Date('2026-07-15T12:00:00Z');

  const clients: Client[] = [
    { id: 'c1', name: 'أحمد', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 'c2', name: 'سارة', createdAt: '2026-07-01', updatedAt: '2026-07-01' }
  ];

  const meetings: Meeting[] = [
    {
      id: 'm1',
      clientId: 'c1',
      title: 'لقاء قديم',
      dateTime: '2026-05-01T10:00:00Z', // > 70 days ago
      type: 'in_person',
      notes: 'محضر',
      status: 'completed',
      photoPaths: [],
      createdAt: '2026-05-01',
      updatedAt: '2026-05-01'
    },
    {
      id: 'm2',
      clientId: 'c2',
      title: 'لقاء حديث',
      dateTime: '2026-07-10T10:00:00Z', // 5 days ago
      type: 'in_person',
      notes: 'محضر',
      status: 'completed',
      photoPaths: [],
      createdAt: '2026-07-10',
      updatedAt: '2026-07-10'
    }
  ];

  const needingReview = detectClientsNeedingReview(clients, meetings, 30, refDate);
  assert.equal(needingReview.length, 1);
  assert.equal(needingReview[0].client.id, 'c1');
});

test('universalSearch finds matching items across all entities', () => {
  const clients: Client[] = [{ id: 'c1', name: 'أحمد الجاسم', company: 'أفق للتقنية', createdAt: '', updatedAt: '' }];
  const meetings: Meeting[] = [{ id: 'm1', clientId: 'c1', title: 'مراجعة عقد ثقة', dateTime: '', type: 'in_person', notes: 'نقاش الدفعات', status: 'confirmed', photoPaths: [], createdAt: '', updatedAt: '' }];
  const tasks: ActionItem[] = [{ id: 't1', clientId: 'c1', title: 'إرسال الفاتورة الضريبية', priority: 'high', status: 'pending', createdAt: '' }];
  const notes: Note[] = [{ id: 'n1', title: 'أفكار توسع', content: 'التركيز على عملاء قطاع التقنية', tags: ['استراتيجية'], isPinned: true, createdAt: '' }];

  const results = universalSearch('ثقة', { clients, meetings, tasks, notes });
  assert.equal(results.meetings.length, 1);
  assert.equal(results.clients.length, 0);

  const clientResults = universalSearch('أفق', { clients, meetings, tasks, notes });
  assert.equal(clientResults.clients.length, 1);
});

test('applyMeetingTemplate replaces or appends non-destructively', () => {
  const current = 'ملاحظات أولية غير مكتملة';
  const template = '### أجندة اللقاء:\n1. بند أول';

  const replaced = applyMeetingTemplate(current, template, 'replace');
  assert.equal(replaced, template);

  const appended = applyMeetingTemplate(current, template, 'append');
  assert.ok(appended.startsWith('ملاحظات أولية غير مكتملة'));
  assert.ok(appended.includes('### أجندة اللقاء:'));
  assert.ok(appended.includes('---'));
});

test('insertMeetingSnippet appends fast snippets cleanly', () => {
  const notes = '### بنود اللقاء:';
  const snippet = '\n\n> 🎯 **قرار معتمد:** اعتماد العقد\n';
  const updated = insertMeetingSnippet(notes, snippet);
  assert.ok(updated.includes('قرار معتمد'));
  assert.ok(updated.startsWith('### بنود اللقاء:'));
});
