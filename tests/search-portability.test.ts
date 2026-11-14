import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ActionItem,
  Client,
  Meeting,
  Note,
  Opportunity,
  OpportunityStageEvent,
} from '../src/types/index.ts';
import {
  buildSearchIndex,
  countActiveSearchFilters,
  executeUniversalSearch,
  extractAvailableSearchTags,
  extractHighlightSegments,
  normalizeArabicSearchText,
} from '../src/utils/searchEngine.ts';
import {
  EXPORT_ATTACHMENT_DISCLOSURE_AR,
  MURAFIQ_EXPORT_SCHEMA_VERSION,
  buildEntityCsv,
  buildUserDataExportBundle,
  escapeCsvCell,
  executeSafeImportPlan,
  sanitizeCsvCell,
  validateAndPreviewImport,
} from '../src/utils/dataPortability.ts';

const MOCK_CLIENTS: Client[] = [
  {
    id: 'client_1',
    userId: 'user_A',
    name: 'أحمد الجاسم',
    company: 'شركة المنارة للاستشارات',
    industry: 'الاستشارات الإدارية',
    phone: '٠٧٩١٢٣٤٥٦٧',
    email: 'ahmed@manara.example',
    relationshipStatus: 'active',
    importance: 'high',
    tags: ['استراتيجي', 'الرياض'],
    contacts: [
      {
        id: 'ct_1',
        name: 'مصطفى الخطيب',
        title: 'مدير المشتريات',
        department: 'العقود والمناقصات',
        phone: '0559988776',
        email: 'mustafa@manara.example',
        notes: 'يفضل التواصل الصباحي',
        isPrimary: true,
      },
    ],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-10T10:00:00.000Z',
  },
  {
    id: 'client_2',
    userId: 'user_A',
    name: 'مؤسسة الرؤية الحديثة',
    company: 'الرؤية للتقنية',
    industry: 'تقنية المعلومات',
    phone: '0790001111',
    email: 'info@vision.example',
    relationshipStatus: 'follow_up_needed',
    importance: 'medium',
    tags: ['تقنية', 'عمان'],
    createdAt: '2026-10-15T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  },
];

const MOCK_MEETINGS: Meeting[] = [
  {
    id: 'meeting_1',
    userId: 'user_A',
    clientId: 'client_1',
    title: 'اجتماع مراجعة خطة التحول',
    dateTime: '2026-11-13T11:00:00.000Z',
    type: 'in_person',
    status: 'completed',
    notes: 'ملاحظات تقليدية حول الحوكمة',
    discussionSummary: 'ناقشنا هيكلة الإدارات وتطوير مؤشرات الأداء للربع الأول',
    minutesAdditionalNotes: 'ملاحظة إضافية حول جدول التسليم',
    agendaItems: [
      {
        id: 'ag_1',
        order: 1,
        title: 'بند حوكمة المشتريات',
        notes: 'تحديث لائحة الصلاحيات المالية',
      },
    ],
    decisions: [
      {
        id: 'dec_1',
        text: 'اعتماد مصفوفة الصلاحيات الجديدة قبل نهاية الشهر',
        ownerName: 'أحمد الجاسم',
        createdAt: '2026-11-13T12:00:00.000Z',
      },
    ],
    photoPaths: [],
    createdAt: '2026-11-13T09:00:00.000Z',
    updatedAt: '2026-11-13T12:30:00.000Z',
  },
];

const MOCK_OPPORTUNITIES: Opportunity[] = [
  {
    id: 'opp_1',
    userId: 'user_A',
    clientId: 'client_1',
    title: 'مشروع إعادة هيكلة المنارة',
    description: 'تقديم خدمات استشارية شاملة لمدة 6 أشهر',
    type: 'consulting',
    stage: 'proposal',
    priority: 'urgent',
    estimatedValue: 45000,
    currency: 'SAR',
    expectedCloseDate: '2026-11-30',
    nextAction: 'إرسال العرض الفني والمالي المحدث',
    nextActionDate: '2026-11-16',
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-12T10:00:00.000Z',
  },
  {
    id: 'opp_2',
    userId: 'user_A',
    clientId: 'client_2',
    title: 'عقد صيانة سنوي للأنظمة',
    description: 'اتفاقية دعم فني مستمر',
    type: 'retainer',
    stage: 'won',
    priority: 'medium',
    estimatedValue: 12000,
    currency: 'JOD',
    expectedCloseDate: '2026-11-01',
    closedAt: '2026-11-02T10:00:00.000Z',
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
  },
];

const MOCK_TASKS: ActionItem[] = [
  {
    id: 'task_1',
    userId: 'user_A',
    clientId: 'client_1',
    opportunityId: 'opp_1',
    meetingId: 'meeting_1',
    title: 'تجهيز مسودة العرض المالي',
    description: 'مراجعة التسعير مع فريق الاستشارات',
    dueDate: '2026-11-14',
    priority: 'urgent',
    status: 'pending',
    createdAt: '2026-11-13T13:00:00.000Z',
  },
];

const MOCK_NOTES: Note[] = [
  {
    id: 'note_1',
    userId: 'user_A',
    clientId: 'client_1',
    title: 'توصيات لجنة التدقيق',
    content: 'التركيز على أتمتة التقارير الشهرية وتقليل الدورة المستندية',
    tags: ['تدقيق', 'استراتيجي'],
    isPinned: true,
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
  },
];

const MOCK_STAGE_EVENTS: OpportunityStageEvent[] = [
  {
    id: 'ev_1',
    userId: 'user_A',
    opportunityId: 'opp_1',
    eventType: 'created',
    toStage: 'proposal',
    occurredAt: '2026-11-05T10:00:00.000Z',
  },
];

// 1. Alef variants normalization
test('1. Arabic normalization unifies Alef variants (أ / إ / آ / ا)', () => {
  assert.equal(normalizeArabicSearchText('أحمد'), normalizeArabicSearchText('احمد'));
  assert.equal(normalizeArabicSearchText('إبراهيم'), normalizeArabicSearchText('ابراهيم'));
  assert.equal(normalizeArabicSearchText('آفاق الأعمال'), normalizeArabicSearchText('افاق الاعمال'));
});

// 2. Teh Marbuta and Heh normalization
test('2. Arabic normalization unifies Teh Marbuta and Heh (ة / ه)', () => {
  assert.equal(normalizeArabicSearchText('شركة المنارة'), normalizeArabicSearchText('شركه المناره'));
  assert.equal(normalizeArabicSearchText('مدرسة'), normalizeArabicSearchText('مدرسه'));
});

// 3. Alef Maksura and Yeh normalization
test('3. Arabic normalization unifies Alef Maksura and Yeh (ى / ي)', () => {
  assert.equal(normalizeArabicSearchText('مصطفى'), normalizeArabicSearchText('مصطفي'));
  assert.equal(normalizeArabicSearchText('مستشفى'), normalizeArabicSearchText('مستشفي'));
});

// 4. Tashkeel (diacritics) and Tatweel (kashida) stripping
test('4. Arabic normalization strips tashkeel and tatweel without altering original text', () => {
  const original = 'أَحْمَـد الجَـاسِم';
  assert.equal(normalizeArabicSearchText(original), normalizeArabicSearchText('احمد الجاسم'));
  assert.equal(original, 'أَحْمَـد الجَـاسِم');
});

// 5. Arabic-Indic and Extended Arabic-Indic digits normalization
test('5. Arabic normalization unifies Arabic-Indic (٠-٩) and Extended (۰-۹) digits with ASCII (0-9)', () => {
  assert.equal(normalizeArabicSearchText('٠٧٩١٢٣٤٥٦٧'), '0791234567');
  assert.equal(normalizeArabicSearchText('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
});

// 6. Search across Clients and Contacts
test('6. Universal search finds both Clients and embedded Contacts (ClientContact)', () => {
  const resClient = executeUniversalSearch({
    query: 'احمد الجاسم',
    data: {
      clients: MOCK_CLIENTS,
      meetings: MOCK_MEETINGS,
      tasks: MOCK_TASKS,
      notes: MOCK_NOTES,
      opportunities: MOCK_OPPORTUNITIES,
      currentUserId: 'user_A',
    },
  });
  assert.ok(resClient.grouped.client.some((c) => c.clientRef?.id === 'client_1'));

  // Search by ASCII phone number matching Arabic-Indic phone on client_1
  const resPhone = executeUniversalSearch({
    query: '0791234567',
    data: {
      clients: MOCK_CLIENTS,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      currentUserId: 'user_A',
    },
  });
  assert.equal(resPhone.grouped.client.length, 1);

  // Search for contact name "مصطفي" (with Yeh) matching "مصطفى الخطيب"
  const resContact = executeUniversalSearch({
    query: 'مصطفي الخطيب',
    data: {
      clients: MOCK_CLIENTS,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      currentUserId: 'user_A',
    },
  });
  assert.equal(resContact.grouped.contact.length, 1);
  assert.equal(resContact.grouped.contact[0].contactRef?.id, 'ct_1');
  assert.equal(resContact.grouped.contact[0].clientRef?.id, 'client_1');
});

// 7. Search inside Meetings (discussionSummary, agendaItems, decisions, minutesAdditionalNotes)
test('7. Universal search matches Meeting discussionSummary, agendaItems, decisions, and additionalNotes', () => {
  const data = {
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: [],
    notes: [],
    opportunities: [],
    currentUserId: 'user_A',
  };

  const bySummary = executeUniversalSearch({ query: 'مؤشرات الاداء', data });
  assert.equal(bySummary.grouped.meeting.length, 1);

  const byAgenda = executeUniversalSearch({ query: 'لائحه الصلاحيات الماليه', data });
  assert.equal(byAgenda.grouped.meeting.length, 1);

  const byDecision = executeUniversalSearch({ query: 'مصفوفه الصلاحيات الجديده', data });
  assert.equal(byDecision.grouped.meeting.length, 1);

  const byAddNotes = executeUniversalSearch({ query: 'جدول التسليم', data });
  assert.equal(byAddNotes.grouped.meeting.length, 1);
});

// 8. Search across Tasks, Notes, and Opportunities (including nextAction and linked opportunity title)
test('8. Universal search matches Tasks, Notes, and Opportunities (including nextAction & stage)', () => {
  const data = {
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: MOCK_TASKS,
    notes: MOCK_NOTES,
    opportunities: MOCK_OPPORTUNITIES,
    currentUserId: 'user_A',
  };

  // Task matched by linked opportunity title
  const taskByOpp = executeUniversalSearch({
    query: 'إعادة هيكلة المنارة',
    data,
    filters: { recordType: 'task' },
  });
  assert.equal(taskByOpp.grouped.task.length, 1);
  assert.equal(taskByOpp.grouped.task[0].taskRef?.id, 'task_1');

  // Note matched by content
  const noteByContent = executeUniversalSearch({ query: 'الدوره المستنديه', data });
  assert.equal(noteByContent.grouped.note.length, 1);

  // Opportunity matched by nextAction
  const oppByNextAction = executeUniversalSearch({ query: 'العرض الفني والمالي', data });
  assert.equal(oppByNextAction.grouped.opportunity.length, 1);
  assert.equal(oppByNextAction.grouped.opportunity[0].opportunityRef?.id, 'opp_1');
});

// 9. Deterministic 5-tier ranking order
test('9. Search results follow deterministic ranking: exact > prefix > word > partial > related', () => {
  const customClients: Client[] = [
    {
      id: 'c_related',
      name: 'عميل عام',
      company: 'شركة أطلس الدولية', // Tier 5: related field
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
    {
      id: 'c_partial',
      name: 'مؤسسة نيوأطلس التجارية', // Tier 4: partial substring in title
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
    {
      id: 'c_word',
      name: 'مجموعة أطلس القابضة', // Tier 3: word boundary in title
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
    {
      id: 'c_prefix',
      name: 'أطلس للاستشارات', // Tier 2: prefix match in title
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
    {
      id: 'c_exact',
      name: 'أطلس', // Tier 1: exact match in title
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
  ];

  const res = executeUniversalSearch({
    query: 'اطلس',
    data: {
      clients: customClients,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
    },
  });

  const orderedIds = res.items.map((item) => item.clientRef?.id);
  assert.deepEqual(orderedIds, [
    'c_exact',
    'c_prefix',
    'c_word',
    'c_partial',
    'c_related',
  ]);
});

// 10. Filtering by recordType
test('10. Smart filter by recordType restricts results to the chosen entity type', () => {
  const res = executeUniversalSearch({
    query: 'المناره',
    data: {
      clients: MOCK_CLIENTS,
      meetings: MOCK_MEETINGS,
      tasks: MOCK_TASKS,
      notes: MOCK_NOTES,
      opportunities: MOCK_OPPORTUNITIES,
    },
    filters: { recordType: 'opportunity' },
  });

  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].recordType, 'opportunity');
});

// 11. Combined multi-criteria smart filters
test('11. Combinable smart filters work across clientId, priority, status, tag, datePreset, and opportunityState', () => {
  const data = {
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: MOCK_TASKS,
    notes: MOCK_NOTES,
    opportunities: MOCK_OPPORTUNITIES,
  };

  // Filter open opportunities with urgent priority for client_1
  const openUrgentOpp = executeUniversalSearch({
    query: '',
    data,
    filters: {
      clientId: 'client_1',
      priority: 'urgent',
      opportunityState: 'open',
    },
    referenceDate: new Date('2026-11-14T12:00:00Z'),
  });
  assert.equal(openUrgentOpp.items.length, 1);
  assert.equal(openUrgentOpp.items[0].opportunityRef?.id, 'opp_1');

  // Filter by tag "تدقيق"
  const byTag = executeUniversalSearch({
    query: '',
    data,
    filters: {
      tag: 'تدقيق',
    },
  });
  assert.equal(byTag.items.length, 1);
  assert.equal(byTag.items[0].noteRef?.id, 'note_1');
});

// 12. Clearing filters preserves query and counts active filters accurately
test('12. Active filter counting and filter reset preserve search query behavior', () => {
  assert.equal(countActiveSearchFilters({ recordType: 'all', priority: 'all' }), 0);
  assert.equal(
    countActiveSearchFilters({
      recordType: 'task',
      priority: 'urgent',
      clientId: 'client_1',
    }),
    3
  );

  const tags = extractAvailableSearchTags({
    clients: MOCK_CLIENTS,
    notes: MOCK_NOTES,
  });
  assert.ok(tags.includes('استراتيجي'));
  assert.ok(tags.includes('تدقيق'));
});

// 13. Safe highlight segments without HTML injection
test('13. extractHighlightSegments highlights normalized matches safely and never executes/injects HTML', () => {
  const maliciousTitle = '<script>alert("xss")</script> أَحْمَد الجاسم';
  const segments = extractHighlightSegments(maliciousTitle, 'احمد');

  const matchedSeg = segments.find((s) => s.matched);
  assert.ok(matchedSeg);
  assert.equal(matchedSeg.text, 'أَحْمَد');

  // Rejoined segments must equal exact original string including raw <script> characters
  const rejoined = segments.map((s) => s.text).join('');
  assert.equal(rejoined, maliciousTitle);
});

// 14. JSON Export with murafiq-export-v1 and honest completeness status
test('14. buildUserDataExportBundle produces murafiq-export-v1 with accurate completeness disclosure', () => {
  const onlineComplete = buildUserDataExportBundle({
    currentUserId: 'user_A',
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: MOCK_TASKS,
    notes: MOCK_NOTES,
    opportunities: MOCK_OPPORTUNITIES,
    opportunityStageEvents: MOCK_STAGE_EVENTS,
    isOnline: true,
    collectionsLoaded: {
      clients: true,
      meetings: true,
      tasks: true,
      notes: true,
      opportunities: true,
      opportunityStageEvents: true,
    },
    hasPendingLocalWrites: false,
  });

  assert.equal(onlineComplete.schemaVersion, MURAFIQ_EXPORT_SCHEMA_VERSION);
  assert.equal(onlineComplete.completeness.status, 'complete_online');
  assert.equal(onlineComplete.counts.clients, 2);
  assert.equal(onlineComplete.counts.opportunities, 2);

  const offlinePartial = buildUserDataExportBundle({
    currentUserId: 'user_A',
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: MOCK_TASKS,
    notes: MOCK_NOTES,
    opportunities: MOCK_OPPORTUNITIES,
    opportunityStageEvents: MOCK_STAGE_EVENTS,
    isOnline: false,
    collectionsLoaded: {
      clients: true,
      meetings: false,
    },
    hasPendingLocalWrites: true,
  });

  assert.equal(offlinePartial.completeness.status, 'partial_or_offline');
  assert.ok(offlinePartial.completeness.unloadedCollections.includes('الاجتماعات'));
});

// 15. CSV Export with UTF-8 BOM, commas, quotes, and multiline values
test('15. buildEntityCsv outputs UTF-8 BOM and properly escapes commas, quotes, and newlines', () => {
  const clientsWithSpecialChars: Client[] = [
    {
      id: 'c_csv_1',
      userId: 'user_A',
      name: 'شركة "الأمل"، المحدودة',
      notes: 'سطر أول\nسطر ثانٍ، مع فاصلة',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-02',
    },
  ];

  const csv = buildEntityCsv({
    entityType: 'clients',
    currentUserId: 'user_A',
    clients: clientsWithSpecialChars,
    meetings: [],
    tasks: [],
    opportunities: [],
  });

  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"شركة ""الأمل""، المحدودة"'));
  assert.ok(csv.includes('"سطر أول\nسطر ثانٍ، مع فاصلة"'));
});

// 16. CSV Formula Injection defense
test('16. sanitizeCsvCell and escapeCsvCell neutralize formula injection (=, +, -, @, Tab, CR)', () => {
  assert.equal(sanitizeCsvCell('=cmd|\' /C calc\'!A0'), "'=cmd|' /C calc'!A0");
  assert.equal(sanitizeCsvCell('+SUM(A1:A10)'), "'+SUM(A1:A10)");
  assert.equal(sanitizeCsvCell('-2+3+cmd'), "'-2+3+cmd");
  assert.equal(sanitizeCsvCell('@SUM(1,2)'), "'@SUM(1,2)");
  assert.equal(sanitizeCsvCell('   =HYPERLINK("http://evil")'), "'   =HYPERLINK(\"http://evil\")");
  assert.equal(sanitizeCsvCell('\t=1+1'), "'\t=1+1");
  assert.equal( escapeCsvCell('=1+1,2'), '"\'=1+1,2"');
});

// 17. Multi-currency discipline in Opportunities CSV export
test('17. Opportunities CSV export keeps value and currency in separate columns without summing currencies', () => {
  const csv = buildEntityCsv({
    entityType: 'opportunities',
    currentUserId: 'user_A',
    clients: MOCK_CLIENTS,
    meetings: [],
    tasks: [],
    opportunities: MOCK_OPPORTUNITIES,
  });

  assert.ok(csv.includes('القيمة التقديرية,العملة'));
  assert.ok(csv.includes('45000,SAR'));
  assert.ok(csv.includes('12000,JOD'));
  // Ensure no artificial combined total row (like 57000) exists
  assert.ok(!csv.includes('57000'));
});

// 18. Stripping secrets, internal fields, and attachment storageKeys on export
test('18. JSON Export strips any secret tokens, storageKeys, presignedUrls, and B2 attachment paths', () => {
  const pollutedClient = {
    ...MOCK_CLIENTS[0],
    idToken: 'secret-jwt-token',
    apiKey: 'secret-api-key',
    storageKey: 'users/user_A/meetings/m1/attachments/att1',
    presignedUrl: 'https://b2.example.com/secret-url',
  } as any;

  const pollutedMeeting: Meeting = {
    ...MOCK_MEETINGS[0],
    photoPaths: ['users/user_A/meetings/meeting_1/attachments/att_1'],
  };

  const bundle = buildUserDataExportBundle({
    currentUserId: 'user_A',
    clients: [pollutedClient],
    meetings: [pollutedMeeting],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
  });

  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes('secret-jwt-token'));
  assert.ok(!serialized.includes('secret-api-key'));
  assert.ok(!serialized.includes('https://b2.example.com/secret-url'));
  assert.deepEqual(bundle.data.meetings[0].photoPaths, []);
});

// 19. Explicit Backblaze B2 non-inclusion disclosure in JSON Export
test('19. JSON Export includes mandatory Backblaze B2 attachment non-inclusion disclosure', () => {
  const bundle = buildUserDataExportBundle({
    currentUserId: 'user_A',
    clients: MOCK_CLIENTS,
    meetings: MOCK_MEETINGS,
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
  });

  assert.equal(bundle.attachmentPolicyDisclosureAr, EXPORT_ATTACHMENT_DISCLOSURE_AR);
  assert.ok(
    bundle.attachmentPolicyDisclosureAr.includes(
      'يتضمن هذا التصدير بيانات التطبيق المدعومة فقط، ولا يتضمن ملفات المرفقات المخزنة في Backblaze B2.'
    )
  );
});

// 20. Reject malformed/corrupted import file
test('20. validateAndPreviewImport rejects malformed JSON or empty files safely', () => {
  const res = validateAndPreviewImport({
    fileContent: '{ invalid json ',
    fileName: 'corrupt.json',
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  assert.equal(res.canProceed, false);
  assert.ok(res.issues.some((i) => i.code === 'INVALID_FORMAT'));
});

// 21. Reject unsupported schemaVersion
test('21. validateAndPreviewImport rejects unsupported schemaVersion', () => {
  const res = validateAndPreviewImport({
    fileContent: JSON.stringify({
      schemaVersion: 'unknown-schema-v99',
      data: { clients: [{ id: 'c1', name: 'عميل' }] },
    }),
    fileName: 'wrong-schema.json',
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  assert.equal(res.canProceed, false);
  assert.ok(res.issues.some((i) => i.code === 'UNSUPPORTED_SCHEMA'));
});

// 22. Block __proto__ / constructor / prototype and strip unknown fields
test('22. validateAndPreviewImport blocks prototype pollution keys and strips unknown/attachment fields', () => {
  const protoAttack =
    '{"schemaVersion":"murafiq-export-v1","__proto__":{"isAdmin":true},"data":{"clients":[]}}';
  const protoRes = validateAndPreviewImport({
    fileContent: protoAttack,
    fileName: 'attack.json',
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });
  assert.equal(protoRes.canProceed, false);
  assert.ok(protoRes.issues.some((i) => i.code === 'PROTOTYPE_POLLUTION_BLOCKED'));

  // Unknown fields & attachment fields stripped
  const unknownFieldsPayload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [
        {
          id: 'clean_c1',
          name: 'عميل نظيف',
          unexpectedHackField: 'hack',
          storageKey: 'users/other/file',
        },
      ],
    },
  });

  const strippedRes = validateAndPreviewImport({
    fileContent: unknownFieldsPayload,
    fileName: 'extra-fields.json',
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  assert.equal(strippedRes.canProceed, true);
  const sanitizedClient = strippedRes.sanitizedBatch.clients[0] as any;
  assert.equal(sanitizedClient.unexpectedHackField, undefined);
  assert.equal(sanitizedClient.storageKey, undefined);
  assert.ok(strippedRes.issues.some((i) => i.code === 'UNKNOWN_FIELDS_STRIPPED'));
  assert.ok(strippedRes.issues.some((i) => i.code === 'ATTACHMENT_FIELDS_STRIPPED'));
});

// 23. Never trust imported userId; always bind to currentUserId
test('23. validateAndPreviewImport ignores foreign userId in import file and binds records to currentUserId', () => {
  const foreignPayload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [
        {
          id: 'c_foreign',
          userId: 'attacker_uid_999',
          name: 'عميل مستورد',
        },
      ],
    },
  });

  const preview = validateAndPreviewImport({
    fileContent: foreignPayload,
    fileName: 'foreign.json',
    existingData: {
      currentUserId: 'my_real_uid_123',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  assert.equal(preview.canProceed, true);
  assert.equal(preview.sanitizedBatch.clients[0].userId, 'my_real_uid_123');
  assert.ok(preview.issues.some((i) => i.code === 'FOREIGN_USER_ID_REBOUND'));
});

// 24. Detect duplicate records and skip by default without overwriting
test('24. validateAndPreviewImport detects duplicates (in JSON and CSV) and skips them without overwriting', () => {
  const jsonPayload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [
        { id: 'client_1', name: 'محاولة تعديل اسم أحمد الجاسم' }, // already exists
        { id: 'client_new', name: 'عميل جديد كلياً' },
      ],
    },
  });

  const preview = validateAndPreviewImport({
    fileContent: jsonPayload,
    fileName: 'dups.json',
    existingData: {
      currentUserId: 'user_A',
      clients: MOCK_CLIENTS,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  assert.equal(preview.countsByCollection.clients.duplicateSkipped, 1);
  assert.equal(preview.countsByCollection.clients.validToImport, 1);
  assert.equal(preview.sanitizedBatch.clients[0].id, 'client_new');
});

// 25. Safe handling of broken relational references (clientId, meetingId, opportunityId)
test('25. validateAndPreviewImport skips records with missing required clientId and unlinks broken optional references', () => {
  const brokenLinksPayload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [{ id: 'c_valid', name: 'عميل صالح' }],
      opportunities: [
        {
          id: 'opp_orphan',
          clientId: 'non_existent_client',
          title: 'فرصة يتيمة',
          type: 'consulting',
          stage: 'new',
          priority: 'high',
        },
      ],
      tasks: [
        {
          id: 'task_with_broken_optional_links',
          clientId: 'c_valid',
          meetingId: 'missing_meeting_99',
          opportunityId: 'missing_opp_99',
          title: 'مهمة مرتبطة بعميل صالح ولكن اجتماع وفرصة مفقودين',
          priority: 'high',
          status: 'pending',
        },
      ],
    },
  });

  const preview = validateAndPreviewImport({
    fileContent: brokenLinksPayload,
    fileName: 'relations.json',
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  // Orphan opportunity with missing required clientId is rejected
  assert.equal(preview.countsByCollection.opportunities.rejected, 1);
  assert.equal(preview.countsByCollection.opportunities.validToImport, 0);

  // Task with valid clientId but missing optional meetingId/opportunityId is imported with broken optional links unlinked
  assert.equal(preview.countsByCollection.tasks.validToImport, 1);
  assert.equal(preview.sanitizedBatch.tasks[0].meetingId, undefined);
  assert.equal(preview.sanitizedBatch.tasks[0].opportunityId, undefined);
  assert.ok(preview.brokenRelationshipsCount >= 3);
});

// 26. Require explicit confirmation and online state before executing import
test('26. executeSafeImportPlan refuses to run without explicit confirmation or while offline', async () => {
  const payload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [{ id: 'c_import_1', name: 'عميل تجريبي' }],
    },
  });

  const preview = validateAndPreviewImport({
    fileContent: payload,
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  let writesCount = 0;
  const mockHandlers = {
    saveClient: async () => {
      writesCount++;
    },
    saveOpportunity: async () => {
      writesCount++;
    },
    saveMeeting: async () => {
      writesCount++;
    },
    saveTask: async () => {
      writesCount++;
    },
    saveNote: async () => {
      writesCount++;
    },
    saveOpportunityStageEvent: async () => {
      writesCount++;
    },
  };

  // Unconfirmed -> blocked
  const unconfirmedReport = await executeSafeImportPlan({
    preview,
    confirmed: false,
    isOnline: true,
    handlers: mockHandlers,
  });
  assert.equal(unconfirmedReport.status, 'blocked_unconfirmed');
  assert.equal(writesCount, 0);

  // Offline -> blocked
  const offlineReport = await executeSafeImportPlan({
    preview,
    confirmed: true,
    isOnline: false,
    handlers: mockHandlers,
  });
  assert.equal(offlineReport.status, 'blocked_offline');
  assert.equal(writesCount, 0);
});

// 27. Partial failure handling and idempotent retry of failed items only
test('27. executeSafeImportPlan handles partial failures honestly and retries only failed records without duplicating succeeded ones', async () => {
  const payload = JSON.stringify({
    schemaVersion: MURAFIQ_EXPORT_SCHEMA_VERSION,
    data: {
      clients: [
        { id: 'c_ok', name: 'عميل ناجح' },
        { id: 'c_flaky', name: 'عميل متعثر مؤقتاً' },
      ],
    },
  });

  const preview = validateAndPreviewImport({
    fileContent: payload,
    existingData: {
      currentUserId: 'user_A',
      clients: [],
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      opportunityStageEvents: [],
    },
  });

  const savedClientIds: string[] = [];
  let shouldFailFlaky = true;

  const handlers = {
    saveClient: async (c: Client) => {
      if (c.id === 'c_flaky' && shouldFailFlaky) {
        throw new Error('انقطاع مؤقت في الشبكة');
      }
      savedClientIds.push(c.id);
    },
    saveOpportunity: async () => {},
    saveMeeting: async () => {},
    saveTask: async () => {},
    saveNote: async () => {},
    saveOpportunityStageEvent: async () => {},
  };

  // First execution: c_ok succeeds, c_flaky fails
  const firstReport = await executeSafeImportPlan({
    preview,
    confirmed: true,
    isOnline: true,
    handlers,
  });

  assert.equal(firstReport.status, 'partial_failure');
  assert.equal(firstReport.totalSucceeded, 1);
  assert.equal(firstReport.totalFailed, 1);
  assert.deepEqual(savedClientIds, ['c_ok']);

  // Second execution (Retry): c_flaky now succeeds, and c_ok is NOT written a second time
  shouldFailFlaky = false;
  const retryReport = await executeSafeImportPlan({
    preview,
    confirmed: true,
    isOnline: true,
    handlers,
    previousSucceededKeys: firstReport.succeededRecordKeys,
  });

  assert.equal(retryReport.status, 'completed');
  assert.equal(retryReport.totalSucceeded, 1);
  assert.equal(retryReport.totalFailed, 0);
  assert.deepEqual(savedClientIds, ['c_ok', 'c_flaky']);
});

// 28. Strict per-user isolation across Search, Export, and Import
test('28. Search, Export, and Import strictly isolate data by currentUserId and never leak another user records', () => {
  const mixedClients: Client[] = [
    ...MOCK_CLIENTS, // user_A
    {
      id: 'client_user_B',
      userId: 'user_B',
      name: 'عميل سري خاص بالمستخدم B',
      company: 'شركة سرية للغاية',
      createdAt: '2026-11-10',
      updatedAt: '2026-11-10',
    },
  ];

  // Search as user_A must never return user_B's client
  const searchAsUserA = executeUniversalSearch({
    query: 'عميل سري',
    data: {
      clients: mixedClients,
      meetings: [],
      tasks: [],
      notes: [],
      opportunities: [],
      currentUserId: 'user_A',
    },
  });
  assert.equal(searchAsUserA.items.length, 0);

  // Export as user_A must never include user_B's client
  const exportAsUserA = buildUserDataExportBundle({
    currentUserId: 'user_A',
    clients: mixedClients,
    meetings: [],
    tasks: [],
    notes: [],
    opportunities: [],
    opportunityStageEvents: [],
  });
  assert.ok(exportAsUserA.data.clients.every((c) => c.userId === 'user_A'));
  assert.ok(!exportAsUserA.data.clients.some((c) => c.id === 'client_user_B'));

  const indexForUserA = buildSearchIndex({
    clients: mixedClients,
    meetings: [],
    tasks: [],
    notes: [],
    opportunities: [],
    currentUserId: 'user_A',
  });
  assert.ok(!indexForUserA.some((entry) => entry.clientRef?.id === 'client_user_B'));
});
