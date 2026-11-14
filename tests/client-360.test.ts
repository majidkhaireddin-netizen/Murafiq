import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionItem, Client, Meeting, Note } from '../src/types';
import {
  addClientContact,
  buildClientActivityTimeline,
  buildClientDataIndex,
  computeClientKpis,
  deriveClientSyncDisplayState,
  evaluateClientAttentionAlerts,
  filterAndSortClients,
  findPotentialDuplicateClients,
  isValidEmailAddress,
  isValidPhoneForTel,
  normalizeClientContacts,
  removeClientContact,
  sanitizeClientForSave,
  sanitizePhoneForTel,
  sanitizePhoneForWhatsApp,
  sanitizeWebsiteUrl,
  setPrimaryClientContact,
  updateClientContact,
} from '../src/utils/client360';
import { universalSearch } from '../src/utils/logic';

const REF_DATE = new Date('2026-11-15T10:00:00.000Z');

const CLIENT_A: Client = {
  id: 'c_alpha',
  name: 'خالد السبيعي',
  company: 'مجموعة المدار للاستشارات',
  phone: '+966501234567',
  email: 'khaled@madar.sa',
  industry: 'الاستشارات الإدارية',
  category: 'corporate',
  relationshipStatus: 'active',
  importance: 'high',
  tags: ['عقد سنوي', 'الرياض'],
  website: 'https://madar.sa',
  address: 'الرياض - حي العليا',
  source: 'توصية مباشرة',
  description: 'شريك استراتيجي في مشاريع التحول الرقمي.',
  contacts: [
    {
      id: 'cc_1',
      name: 'سارة المنصور',
      title: 'مديرة المشاريع',
      department: 'التحول الرقمي',
      phone: '0551112233',
      email: 'sara@madar.sa',
      isPrimary: true,
    },
    {
      id: 'cc_2',
      name: 'فهد الدوسري',
      title: 'المدير المالي',
      phone: '0559998877',
      isPrimary: false,
    },
  ],
  isFavorite: true,
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-11-14T12:00:00.000Z',
};

const CLIENT_B: Client = {
  id: 'c_beta',
  name: 'نورة القحطاني',
  company: 'شركة ركيزة للتطوير',
  phone: '0507654321',
  email: 'noura@rakeezah.com',
  relationshipStatus: 'lead',
  importance: 'medium',
  tags: ['تقنية'],
  createdAt: '2026-09-10T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

const LEGACY_CLIENT: Client = {
  id: 'c_legacy',
  name: 'عميل قديم بدون حقول إضافية',
  createdAt: '2025-05-01T08:00:00.000Z',
  updatedAt: '2025-05-01T08:00:00.000Z',
};

const SAMPLE_MEETINGS: Meeting[] = [
  {
    id: 'm_a_past',
    clientId: 'c_alpha',
    title: 'اجتماع مراجعة الربع الثالث',
    dateTime: '2026-11-10T10:00:00.000Z',
    type: 'in_person',
    notes: 'مناقشة خطة التسليم.',
    discussionSummary: 'تم اعتماد نطاق المرحلة الثانية.',
    status: 'completed',
    photoPaths: ['legacy/photo1.jpg'],
    decisions: [
      {
        id: 'dec_1',
        text: 'اعتماد جدول التسليم النهائي في ديسمبر',
        ownerName: 'خالد السبيعي',
        createdAt: '2026-11-10T11:00:00.000Z',
      },
    ],
    createdAt: '2026-11-08T08:00:00.000Z',
    updatedAt: '2026-11-10T11:30:00.000Z',
  },
  {
    id: 'm_a_upcoming',
    clientId: 'c_alpha',
    title: 'اجتماع متابعة التوقيع',
    dateTime: '2026-11-16T09:00:00.000Z',
    type: 'video',
    notes: '',
    status: 'confirmed',
    photoPaths: [],
    followUpDateTime: '2026-11-22T09:00:00.000Z',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
  },
  {
    id: 'm_b_old',
    clientId: 'c_beta',
    title: 'جلسة تعارف أولية مع ركيزة',
    dateTime: '2026-10-01T10:00:00.000Z',
    type: 'phone',
    notes: 'تواصل مبدئي.',
    status: 'completed',
    photoPaths: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T10:30:00.000Z',
  },
];

const SAMPLE_TASKS: ActionItem[] = [
  {
    id: 't_a_overdue',
    clientId: 'c_alpha',
    meetingId: 'm_a_past',
    title: 'إرسال العرض المالي المعدل',
    dueDate: '2026-11-12',
    priority: 'high',
    status: 'pending',
    provenance: 'approved',
    createdAt: '2026-11-10T11:15:00.000Z',
  },
  {
    id: 't_a_open',
    clientId: 'c_alpha',
    title: 'مراجعة مسودة اتفاقية السرية',
    dueDate: '2026-11-18',
    priority: 'medium',
    status: 'in_progress',
    provenance: 'source',
    createdAt: '2026-11-11T09:00:00.000Z',
  },
  {
    id: 't_a_done',
    clientId: 'c_alpha',
    title: 'تأكيد حضور الفريق التقني',
    dueDate: '2026-11-09',
    priority: 'low',
    status: 'completed',
    completedAt: '2026-11-09T14:00:00.000Z',
    createdAt: '2026-11-08T09:00:00.000Z',
  },
  {
    id: 't_a_cancelled',
    clientId: 'c_alpha',
    title: 'مهمة ملغاة لا تُحتسب كمفتوحة',
    dueDate: '2026-11-01',
    priority: 'urgent',
    status: 'cancelled',
    createdAt: '2026-11-01T09:00:00.000Z',
  },
  {
    id: 't_b_only',
    clientId: 'c_beta',
    title: 'مهمة تخص العميل ب فقط',
    dueDate: '2026-11-05',
    priority: 'urgent',
    status: 'pending',
    createdAt: '2026-11-01T09:00:00.000Z',
  },
];

const SAMPLE_NOTES: Note[] = [
  {
    id: 'n_a_1',
    clientId: 'c_alpha',
    title: 'تفضيل أوقات الاجتماعات',
    content: 'يفضل العميل الاجتماعات الصباحية قبل الساعة 11.',
    tags: ['تفضيلات'],
    isPinned: true,
    createdAt: '2026-11-13T08:00:00.000Z',
  },
  {
    id: 'n_b_1',
    clientId: 'c_beta',
    title: 'ملاحظة خاصة بركيزة',
    content: 'تخص العميل ب فقط.',
    tags: ['ركيزة'],
    isPinned: false,
    createdAt: '2026-11-12T08:00:00.000Z',
  },
];

test('Case 1 & 3 & 4: Client 360 KPIs compute accurately and remain strictly isolated per client', () => {
  const kpisA = computeClientKpis({
    client: CLIENT_A,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    referenceDate: REF_DATE,
  });

  assert.equal(kpisA.totalMeetings, 2);
  assert.equal(kpisA.upcomingMeetings, 1);
  assert.equal(kpisA.openTasks, 2); // excludes completed & cancelled & Client B tasks
  assert.equal(kpisA.overdueTasks, 1); // only t_a_overdue (2026-11-12 < 2026-11-15)
  assert.equal(kpisA.completedTasks, 1);
  assert.equal(kpisA.notesCount, 1);
  assert.equal(kpisA.contactsCount, 2);
  assert.equal(kpisA.lastContactAt, '2026-11-10T10:00:00.000Z');
  assert.equal(kpisA.nextFollowUpAt, '2026-11-16T09:00:00.000Z');
  assert.equal(kpisA.lastActivityAt, '2026-11-14T10:00:00.000Z'); // createdAt of m_a_upcoming <= REF_DATE

  const kpisB = computeClientKpis({
    client: CLIENT_B,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    referenceDate: REF_DATE,
  });

  assert.equal(kpisB.totalMeetings, 1);
  assert.equal(kpisB.upcomingMeetings, 0);
  assert.equal(kpisB.openTasks, 1);
  assert.equal(kpisB.overdueTasks, 1);
  assert.equal(kpisB.completedTasks, 0);
  assert.equal(kpisB.notesCount, 1);
  assert.equal(kpisB.lastContactAt, '2026-10-01T10:00:00.000Z');
});

test('Case 2: Legacy client with minimal fields computes cleanly without crash', () => {
  const kpis = computeClientKpis({
    client: LEGACY_CLIENT,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    referenceDate: REF_DATE,
  });

  assert.equal(kpis.totalMeetings, 0);
  assert.equal(kpis.upcomingMeetings, 0);
  assert.equal(kpis.openTasks, 0);
  assert.equal(kpis.overdueTasks, 0);
  assert.equal(kpis.completedTasks, 0);
  assert.equal(kpis.lastContactAt, null);
  assert.equal(kpis.lastActivityAt, null);
  assert.equal(kpis.contactsCount, 0);

  const sanitized = sanitizeClientForSave(LEGACY_CLIENT);
  assert.equal(sanitized.id, LEGACY_CLIENT.id);
  assert.equal(sanitized.name, LEGACY_CLIENT.name);
  assert.equal(sanitized.contacts, undefined);
});

test('Case 5, 6 & 7: Unified chronological timeline builds real non-duplicated events with filters, sort & origin links', () => {
  const allEventsDesc = buildClientActivityTimeline({
    clientId: 'c_alpha',
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    filterType: 'all',
    sortOrder: 'desc',
  });

  // Expected unique events for c_alpha:
  // 2 meetings + 1 distinct scheduled_follow_up (2026-11-22) + 1 decision + 4 tasks + 1 note = 9 events
  assert.equal(allEventsDesc.length, 9);
  const ids = new Set(allEventsDesc.map((e) => e.id));
  assert.equal(ids.size, allEventsDesc.length, 'Timeline events must never duplicate');

  // Verify strict client isolation (no Client B records)
  assert.equal(allEventsDesc.every((e) => e.clientId === 'c_alpha'), true);

  // Verify descending chronological order
  for (let i = 1; i < allEventsDesc.length; i++) {
    assert.ok(allEventsDesc[i - 1].sortMs >= allEventsDesc[i].sortMs);
  }

  // Verify ascending chronological order
  const allEventsAsc = buildClientActivityTimeline({
    clientId: 'c_alpha',
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    filterType: 'all',
    sortOrder: 'asc',
  });
  for (let i = 1; i < allEventsAsc.length; i++) {
    assert.ok(allEventsAsc[i - 1].sortMs <= allEventsAsc[i].sortMs);
  }

  // Verify filtering by type
  const decisionsOnly = buildClientActivityTimeline({
    clientId: 'c_alpha',
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    filterType: 'decision',
  });
  assert.equal(decisionsOnly.length, 1);
  assert.equal(decisionsOnly[0].sourceType, 'meeting');
  assert.equal(decisionsOnly[0].sourceId, 'm_a_past');
  assert.equal(decisionsOnly[0].meetingId, 'm_a_past');

  const notesOnly = buildClientActivityTimeline({
    clientId: 'c_alpha',
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
    filterType: 'note',
  });
  assert.equal(notesOnly.length, 1);
  assert.equal(notesOnly[0].sourceType, 'note');
  assert.equal(notesOnly[0].sourceId, 'n_a_1');
});

test('Case 8: Indexed lookup groups meetings, tasks, and notes without N+1 scans', () => {
  const index = buildClientDataIndex({
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
  });

  assert.equal(index.meetingsByClient.get('c_alpha')?.length, 2);
  assert.equal(index.tasksByClient.get('c_alpha')?.length, 4);
  assert.equal(index.notesByClient.get('c_alpha')?.length, 1);
  assert.equal(index.meetingsByClient.get('c_beta')?.length, 1);
  assert.equal(index.meetingsByClient.get('c_legacy'), undefined);
});

test('Case 9, 10, 11, 12 & 13: Deterministic relationship attention alerts trigger transparently without mutating status', () => {
  const alertsA = evaluateClientAttentionAlerts({
    client: CLIENT_A,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    referenceDate: REF_DATE,
  });

  const kindsA = alertsA.map((a) => a.kind);
  // Overdue task + upcoming meeting tomorrow + high priority open task, NO stale contact (last meeting Nov 10)
  assert.deepEqual(kindsA, ['overdue_tasks', 'upcoming_meeting', 'high_priority_tasks']);

  const overdueAlert = alertsA.find((a) => a.kind === 'overdue_tasks')!;
  assert.match(overdueAlert.messageArabic, /مهمة متأخرة/);

  const upcomingAlert = alertsA.find((a) => a.kind === 'upcoming_meeting')!;
  assert.equal(upcomingAlert.messageArabic, 'لديك اجتماع مع هذا العميل غداً.');
  assert.equal(upcomingAlert.meetingId, 'm_a_upcoming');

  const highPrioAlert = alertsA.find((a) => a.kind === 'high_priority_tasks')!;
  assert.equal(highPrioAlert.messageArabic, 'توجد مهمة عالية الأولوية تحتاج إلى متابعة.');

  // Stale contact test on CLIENT_B (last meeting Oct 1, reference Nov 15 => 45 days >= 30)
  const alertsB = evaluateClientAttentionAlerts({
    client: CLIENT_B,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    referenceDate: REF_DATE,
  });
  const staleAlert = alertsB.find((a) => a.kind === 'stale_contact');
  assert.ok(staleAlert, 'Expected stale contact alert when >= 30 days since last contact');
  assert.match(staleAlert.messageArabic, /لم يُسجّل تواصل حديث مع هذا العميل/);
  assert.ok(staleAlert.basisDisclosureArabic?.includes('مبني على الأنشطة المسجلة'));

  // Ensure client object itself was never mutated
  assert.equal(CLIENT_A.relationshipStatus, 'active');
  assert.equal(CLIENT_B.relationshipStatus, 'lead');

  // Brand new client with 0 meetings created today should NOT trigger stale contact alert
  const brandNewClient: Client = {
    id: 'c_new_today',
    name: 'عميل جديد اليوم',
    createdAt: REF_DATE.toISOString(),
    updatedAt: REF_DATE.toISOString(),
  };
  const brandNewAlerts = evaluateClientAttentionAlerts({
    client: brandNewClient,
    meetings: [],
    tasks: [],
    referenceDate: REF_DATE,
  });
  assert.equal(brandNewAlerts.length, 0);
});

test('Case 14: Contacts CRUD enforces at most one primary contact invariant', () => {
  let contacts = addClientContact([], {
    name: 'جهة أولى',
    title: 'مدير',
    phone: '0501111111',
    isPrimary: true,
  });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].isPrimary, true);

  contacts = addClientContact(contacts, {
    name: 'جهة ثانية',
    title: 'منسقة',
    email: 'two@example.com',
    isPrimary: true,
  });
  assert.equal(contacts.length, 2);
  assert.equal(contacts.filter((c) => c.isPrimary).length, 1);
  assert.equal(contacts[0].isPrimary, false);
  assert.equal(contacts[1].isPrimary, true);

  // Switch primary back to first contact
  contacts = setPrimaryClientContact(contacts, contacts[0].id);
  assert.equal(contacts[0].isPrimary, true);
  assert.equal(contacts[1].isPrimary, false);

  // Update second contact without changing primary invariant
  contacts = updateClientContact(contacts, contacts[1].id, {
    title: 'رئيسة العمليات',
  });
  assert.equal(contacts[1].title, 'رئيسة العمليات');
  assert.equal(contacts.filter((c) => c.isPrimary).length, 1);

  // Normalize protects against malformed input having multiple primaries
  const normalized = normalizeClientContacts([
    { id: '1', name: 'أ', isPrimary: true },
    { id: '2', name: 'ب', isPrimary: true },
  ]);
  assert.equal(normalized.filter((c) => c.isPrimary).length, 1);

  // Remove contact
  contacts = removeClientContact(contacts, contacts[1].id);
  assert.equal(contacts.length, 1);
});

test('Case 15 & 16: Client list search, filtering, and sorting work accurately', () => {
  const allClients = [CLIENT_A, CLIENT_B, LEGACY_CLIENT];

  // Search by email / tag / industry / contact name
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      searchQuery: 'madar.sa',
      referenceDate: REF_DATE,
    }).length,
    1
  );
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      searchQuery: 'عقد سنوي',
      referenceDate: REF_DATE,
    })[0].client.id,
    'c_alpha'
  );
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      searchQuery: 'سارة المنصور',
      referenceDate: REF_DATE,
    })[0].client.id,
    'c_alpha'
  );

  // Filter by relationship status & importance & overdue tasks
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      relationshipStatus: 'lead',
      referenceDate: REF_DATE,
    })[0].client.id,
    'c_beta'
  );
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      importance: 'high',
      referenceDate: REF_DATE,
    })[0].client.id,
    'c_alpha'
  );
  assert.equal(
    filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
      onlyWithOverdueTasks: true,
      referenceDate: REF_DATE,
    }).length,
    2
  );

  // Sort by name
  const byName = filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
    sortBy: 'name',
    referenceDate: REF_DATE,
  });
  assert.equal(byName.length, 3);

  // Sort by importance puts high ('c_alpha') first
  const byImportance = filterAndSortClients(allClients, SAMPLE_MEETINGS, SAMPLE_TASKS, SAMPLE_NOTES, {
    sortBy: 'importance',
    referenceDate: REF_DATE,
  });
  assert.equal(byImportance[0].client.id, 'c_alpha');

  // Universal search also indexes email/tags
  const uRes = universalSearch('madar.sa', {
    clients: allClients,
    meetings: SAMPLE_MEETINGS,
    tasks: SAMPLE_TASKS,
    notes: SAMPLE_NOTES,
  });
  assert.equal(uRes.clients.length, 1);
});

test('Case 17: Non-blocking duplicate detection matches normalized Arabic name, email, and phone variants', () => {
  const phoneDup = findPotentialDuplicateClients(
    { name: 'اسم مختلف', phone: '0501234567' }, // matches +966501234567 on CLIENT_A
    [CLIENT_A, CLIENT_B]
  );
  assert.equal(phoneDup.length, 1);
  assert.equal(phoneDup[0].client.id, 'c_alpha');
  assert.ok(phoneDup[0].reasons.includes('phone'));

  const emailDup = findPotentialDuplicateClients(
    { name: 'شخص آخر', email: 'NOURA@RAKEEZAH.COM' },
    [CLIENT_A, CLIENT_B]
  );
  assert.equal(emailDup.length, 1);
  assert.equal(emailDup[0].client.id, 'c_beta');
  assert.ok(emailDup[0].reasons.includes('email'));

  const nameDup = findPotentialDuplicateClients(
    { name: 'نوره القحطانى' }, // matches نورة القحطاني
    [CLIENT_A, CLIENT_B]
  );
  assert.equal(nameDup.length, 1);
  assert.ok(nameDup[0].reasons.includes('name'));

  // Editing self must NOT trigger self-duplicate warning
  const selfEdit = findPotentialDuplicateClients(CLIENT_A, [CLIENT_A, CLIENT_B]);
  assert.equal(selfEdit.length, 0);
});

test('Case 18 & 19: Manual relationship status preserved & invalid phone/email/website blocked safely', () => {
  const updated = sanitizeClientForSave({
    ...CLIENT_A,
    relationshipStatus: 'follow_up_needed',
    tags: ['  متابعة  ', 'متابعة', 'VIP'],
  });
  assert.equal(updated.relationshipStatus, 'follow_up_needed');
  assert.deepEqual(updated.tags, ['متابعة', 'VIP']);

  assert.equal(isValidPhoneForTel('abc'), false);
  assert.equal(sanitizePhoneForTel('javascript:alert(1)'), null);
  assert.equal(sanitizePhoneForWhatsApp('0501234567'), '966501234567');
  assert.equal(isValidEmailAddress('not-an-email'), false);
  assert.equal(isValidEmailAddress('user@domain.sa'), true);
  assert.equal(sanitizeWebsiteUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeWebsiteUrl('data:text/html,hi'), null);
  assert.equal(sanitizeWebsiteUrl('madar.sa'), 'https://madar.sa/');
});

test('Case 20: Offline / Pending / Loading / Error / Synced state display accuracy', () => {
  const loadingState = deriveClientSyncDisplayState({
    clientsLoaded: false,
    meetingsLoaded: true,
    tasksLoaded: true,
    notesLoaded: true,
    hasAnyError: false,
    hasPendingWrites: false,
    isClientDocPending: false,
    hasRejectedClientWrite: false,
    isOnline: true,
  });
  assert.equal(loadingState.kind, 'loading');
  assert.equal(loadingState.isReliableComplete, false);

  const offlinePending = deriveClientSyncDisplayState({
    clientsLoaded: true,
    meetingsLoaded: true,
    tasksLoaded: true,
    notesLoaded: true,
    hasAnyError: false,
    hasPendingWrites: true,
    isClientDocPending: true,
    hasRejectedClientWrite: false,
    isOnline: false,
  });
  assert.equal(offlinePending.kind, 'offline_pending');
  assert.equal(offlinePending.isReliableComplete, false);

  const failedState = deriveClientSyncDisplayState({
    clientsLoaded: true,
    meetingsLoaded: true,
    tasksLoaded: true,
    notesLoaded: true,
    hasAnyError: false,
    hasPendingWrites: false,
    isClientDocPending: false,
    hasRejectedClientWrite: true,
    isOnline: true,
  });
  assert.equal(failedState.kind, 'failed');

  const syncedState = deriveClientSyncDisplayState({
    clientsLoaded: true,
    meetingsLoaded: true,
    tasksLoaded: true,
    notesLoaded: true,
    hasAnyError: false,
    hasPendingWrites: false,
    isClientDocPending: false,
    hasRejectedClientWrite: false,
    isOnline: true,
  });
  assert.equal(syncedState.kind, 'synced');
  assert.equal(syncedState.isReliableComplete, true);
});
