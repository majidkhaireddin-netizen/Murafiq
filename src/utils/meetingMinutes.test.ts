import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionItem, Meeting } from '../types';
import { MEETING_TEMPLATES } from '../data/meetingTemplates';
import { sanitizeFirestorePayload } from '../services/firebase';
import {
  addAgendaItemToList,
  addDecisionToList,
  addParticipantToList,
  applyTemplateToMeetingNonDestructive,
  createLinkedMeetingTask,
  findDuplicateMeetingTask,
  formatMinutesPlainText,
  getDiscussionSectionsForDisplay,
  getEffectiveParticipants,
  isMinutesLocked,
  redactTemporaryAttachmentUrls,
  removeAgendaItemFromList,
  reorderAgendaItems,
  sanitizeMeetingForSave,
  syncAttendeesFromParticipants,
  transitionMinutesStatus,
  updateAgendaItemInList,
} from './meetingMinutes';
import { detectEntityConflict, resolveConflictRecord } from './conflictLogic';

const BASE_LEGACY_MEETING: Meeting = {
  id: 'm-legacy-1',
  clientId: 'c-1',
  title: 'مراجعة عقد التوريد السنوي',
  dateTime: '2026-11-14T10:00:00.000Z',
  duration: 60,
  type: 'in_person',
  location: 'مقر العميل - الرياض',
  notes: 'ملحوظة قديمة مهمة يجب ألا تُفقد عند التحرير أو تطبيق القوالب.',
  status: 'confirmed',
  photoPaths: [],
  isFollowUpScheduled: false,
  attendees: ['أ. سلطان القحطاني', 'أنت'],
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
};

test('1. Create and edit structured meeting minutes + sanitize optional fields without undefined', () => {
  let participants = addParticipantToList([], {
    name: 'أ. خالد السبيعي',
    role: 'مدير المشروع',
    party: 'external',
  });
  participants = addParticipantToList(participants, {
    name: 'أنت',
    party: 'internal',
  });

  let agenda = addAgendaItemToList([], {
    title: 'استعراض الجدول الزمني',
    notes: 'التركيز على المرحلة الأولى',
    durationMinutes: 20,
  });
  agenda = addAgendaItemToList(agenda, {
    title: 'اعتماد خطة التسليم',
    durationMinutes: 15,
  });

  const decisions = addDecisionToList([], {
    text: 'اعتماد إطلاق المرحلة الأولى بتاريخ 1 ديسمبر',
    agendaItemId: agenda[1].id,
    ownerName: 'أ. خالد السبيعي',
  });

  const draftMeeting: Meeting = {
    id: 'm-structured-1',
    clientId: 'c-1',
    title: 'اجتماع انطلاق المشروع',
    dateTime: '2026-11-14T11:30',
    duration: 0, // Valid falsy number must be preserved
    type: 'video',
    location: undefined,
    notes: '',
    discussionSummary: 'تم التوافق على نطاق المرحلة الأولى وآلية المراجعة الأسبوعية.',
    status: 'confirmed',
    photoPaths: [],
    participants,
    attendees: syncAttendeesFromParticipants(participants),
    agendaItems: agenda,
    decisions,
    followUpDateTime: '2026-11-21T10:00',
    isFollowUpScheduled: true,
    minutesStatus: 'review',
    minutesIncludedSections: ['basicInfo', 'participants', 'agenda', 'decisions', 'tasks'],
    minutesAdditionalNotes: 'يرجى إرسال شعار الشركة بصيغة SVG.',
    createdAt: '2026-11-14T09:00:00.000Z',
    updatedAt: '2026-11-14T09:00:00.000Z',
  };

  const sanitized = sanitizeMeetingForSave(draftMeeting);
  const firestorePayload = sanitizeFirestorePayload(sanitized);

  assert.equal(firestorePayload.duration, 0);
  assert.equal('location' in firestorePayload, false);
  assert.equal(firestorePayload.participants.length, 2);
  assert.equal(firestorePayload.agendaItems.length, 2);
  assert.equal(firestorePayload.decisions.length, 1);
  assert.equal(firestorePayload.decisions[0].agendaItemId, agenda[1].id);
  assert.equal(firestorePayload.minutesStatus, 'review');

  // Verify zero undefined values anywhere in serialized payload
  const jsonRoundtrip = JSON.stringify(firestorePayload);
  assert.equal(jsonRoundtrip.includes('undefined'), false);
});

test('2. Legacy meeting opens, displays, and saves without losing notes or attendees', () => {
  const effectiveParticipants = getEffectiveParticipants(BASE_LEGACY_MEETING);
  assert.equal(effectiveParticipants.length, 2);
  assert.equal(effectiveParticipants[0].party, 'external');
  assert.equal(effectiveParticipants[0].name, 'أ. سلطان القحطاني');
  assert.equal(effectiveParticipants[1].party, 'internal');

  const displayDiscussions = getDiscussionSectionsForDisplay(BASE_LEGACY_MEETING);
  assert.equal(displayDiscussions.primarySummary, BASE_LEGACY_MEETING.notes);
  assert.equal(displayDiscussions.hasSeparateLegacyNotes, false);

  // Edit discussionSummary without wiping legacy notes
  const updated = sanitizeMeetingForSave({
    ...BASE_LEGACY_MEETING,
    discussionSummary: 'ملخص منظم جديد تمت إضافته فوق الملاحظات القديمة.',
  });

  assert.equal(updated.notes, BASE_LEGACY_MEETING.notes);
  assert.deepEqual(updated.attendees, BASE_LEGACY_MEETING.attendees);
  const displayAfter = getDiscussionSectionsForDisplay(updated);
  assert.equal(displayAfter.hasSeparateLegacyNotes, true);
  assert.equal(displayAfter.legacyNotes, BASE_LEGACY_MEETING.notes);
});

test('3. Agenda items: add, edit, reorder, and delete cleanly unlinking orphaned decision references', () => {
  let items = addAgendaItemToList([], { title: 'البند الأول', durationMinutes: 10 });
  items = addAgendaItemToList(items, { title: 'البند الثاني', durationMinutes: 20 });
  items = addAgendaItemToList(items, { title: 'البند الثالث', durationMinutes: 15 });

  assert.deepEqual(
    items.map((i) => `${i.order}:${i.title}`),
    ['1:البند الأول', '2:البند الثاني', '3:البند الثالث']
  );

  // Move third item up
  items = reorderAgendaItems(items, items[2].id, 'up');
  assert.deepEqual(
    items.map((i) => `${i.order}:${i.title}`),
    ['1:البند الأول', '2:البند الثالث', '3:البند الثاني']
  );

  // Edit second item notes
  items = updateAgendaItemInList(items, items[1].id, { notes: 'ملاحظة البند المعدل' });
  assert.equal(items[1].notes, 'ملاحظة البند المعدل');

  // Link decision to item[1], then delete item[1] -> decision text stays, agendaItemId cleared
  const decisions = addDecisionToList([], {
    text: 'قرار مرتبط بالبند الثالث',
    agendaItemId: items[1].id,
  });

  const removed = removeAgendaItemFromList(items, items[1].id, decisions);
  assert.equal(removed.agendaItems.length, 2);
  assert.deepEqual(
    removed.agendaItems.map((i) => i.order),
    [1, 2]
  );
  assert.equal(removed.decisions.length, 1);
  assert.equal(removed.decisions[0].agendaItemId, undefined);
});

test('4. Linked manual task creation & duplicate prevention with Arabic normalization', () => {
  const existingTasks: ActionItem[] = [
    {
      id: 't-1',
      meetingId: 'm-1',
      clientId: 'c-1',
      title: 'إرسال العرض المالي النهائي',
      priority: 'high',
      status: 'pending',
      createdAt: '2026-11-14T10:00:00.000Z',
    },
  ];

  // Attempt duplicate with Alef / Teh Marbuta / extra whitespace variations
  const dupCheck = findDuplicateMeetingTask(existingTasks, {
    meetingId: 'm-1',
    title: '  ارسال   العرض المالي النهائي ',
  });
  assert.ok(dupCheck);

  const rejected = createLinkedMeetingTask(
    {
      meetingId: 'm-1',
      clientId: 'c-1',
      title: 'ارسال العرض المالي النهائي',
      priority: 'medium',
    },
    existingTasks
  );
  assert.equal(rejected.ok, false);

  // Different meeting ID with same title is allowed
  const allowedOtherMeeting = createLinkedMeetingTask(
    {
      meetingId: 'm-2',
      clientId: 'c-1',
      title: 'إرسال العرض المالي النهائي',
      priority: 'medium',
    },
    existingTasks
  );
  assert.equal(allowedOtherMeeting.ok, true);
  if (allowedOtherMeeting.ok) {
    assert.equal(allowedOtherMeeting.task.meetingId, 'm-2');
    assert.equal(allowedOtherMeeting.task.provenance, 'approved');
  }
});

test('5. Templates library covers 6+ archetypes and applies non-destructively while preserving custom content', () => {
  assert.ok(MEETING_TEMPLATES.length >= 6);

  const discoveryTemplate = MEETING_TEMPLATES.find((t) => t.id === 'discovery_scoping')!;
  const existingMeeting: Meeting = {
    ...BASE_LEGACY_MEETING,
    agendaItems: [
      {
        id: 'ag-existing',
        title: 'بند خاص مسجل مسبقاً',
        notes: 'ملاحظات خاصة لا يجوز حذفها',
        order: 1,
      },
      {
        id: 'ag-dup',
        title: discoveryTemplate.defaultAgendaItems[0].title,
        order: 2,
      },
    ],
    discussionSummary: 'ملخص نقاش أولي سجله المستخدم.',
  };

  const merged = applyTemplateToMeetingNonDestructive(existingMeeting, discoveryTemplate);

  // Preserves original title, notes, and user discussionSummary
  assert.equal(merged.title, existingMeeting.title);
  assert.equal(merged.notes, existingMeeting.notes);
  assert.ok(merged.discussionSummary?.startsWith('ملخص نقاش أولي سجله المستخدم.'));
  assert.ok(merged.discussionSummary?.includes(discoveryTemplate.defaultDiscussionStarter));

  // Keeps existing custom agenda item #1 and skips duplicate template item #1
  assert.equal(merged.agendaItems?.[0].id, 'ag-existing');
  assert.equal(
    merged.agendaItems?.filter((a) => a.title === discoveryTemplate.defaultAgendaItems[0].title)
      .length,
    1
  );
  assert.ok((merged.agendaItems?.length || 0) > 2);
});

test('6. Minutes lifecycle locks "final" and requires explicit confirmation to reopen', () => {
  const finalized = transitionMinutesStatus(BASE_LEGACY_MEETING, 'final');
  assert.equal(finalized.allowed, true);
  assert.equal(isMinutesLocked(finalized.meeting), true);

  // Unconfirmed reopen blocked
  const blockedReopen = transitionMinutesStatus(finalized.meeting, 'review');
  assert.equal(blockedReopen.allowed, false);
  assert.ok(blockedReopen.reasonArabic?.includes('تأكيد'));

  // Confirmed reopen succeeds
  const allowedReopen = transitionMinutesStatus(finalized.meeting, 'review', {
    confirmedReopen: true,
  });
  assert.equal(allowedReopen.allowed, true);
  assert.equal(isMinutesLocked(allowedReopen.meeting), false);
});

test('7. PDF/Plain-text output works offline locally and redacts temporary Backblaze URLs or tokens', () => {
  const unsafeText =
    'راجع العقد عبر https://s3.us-west-004.backblazeb2.com/Murafiq/users/u1/file.pdf?X-Amz-Signature=secret123&X-Amz-Credential=abc';
  const redacted = redactTemporaryAttachmentUrls(unsafeText);
  assert.equal(redacted.includes('backblazeb2.com'), false);
  assert.equal(redacted.includes('secret123'), false);

  const meetingWithSecretUrl: Meeting = {
    ...BASE_LEGACY_MEETING,
    discussionSummary: unsafeText,
    minutesStatus: 'final',
  };

  const exportedText = formatMinutesPlainText({
    meeting: meetingWithSecretUrl,
    clientName: 'شركة النخبة',
    linkedTasks: [],
    includedSections: ['basicInfo', 'discussions', 'decisions'],
    additionalNotes: 'ملاحظة ختامية محلية.',
  });

  assert.equal(exportedText.includes('backblazeb2.com'), false);
  assert.equal(exportedText.includes('X-Amz-Signature'), false);
  assert.ok(exportedText.includes('توقيعاً رقمياً'));
  assert.ok(exportedText.includes('شركة النخبة'));
  // Decisions section included, tasks section omitted when unchecked
  assert.ok(exportedText.includes('القرارات المعتمدة'));
  assert.equal(exportedText.includes('المهام والالتزامات المرتبطة'), false);
});

test('8. Conflict detection recognizes nested structured fields accurately', () => {
  const local: Meeting = {
    ...BASE_LEGACY_MEETING,
    agendaItems: [{ id: 'ag-1', title: 'بند محلي', order: 1 }],
  };
  const remote: Meeting = {
    ...BASE_LEGACY_MEETING,
    agendaItems: [{ id: 'ag-1', title: 'بند سحابي', order: 1 }],
  };

  const conflict = detectEntityConflict(local, remote, 'meeting');
  assert.ok(conflict);
  assert.ok(conflict.differingFields.some((f) => f.field === 'agendaItems'));

  const resolved = resolveConflictRecord<Meeting>(conflict, 'keep_local');
  assert.equal(resolved.agendaItems?.[0].title, 'بند محلي');
});
