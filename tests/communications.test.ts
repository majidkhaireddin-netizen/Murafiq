import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeInteractionForSave,
  convertInteractionNextStepToTaskDraft,
  unlinkInteractionReferencesOnDelete,
  computeClientCommunicationSummary,
  computeCommunicationCenterSummary,
  filterAndSortInteractions,
  resolveInteractionContact,
  getContactInteractionHistory,
  DEFAULT_COMMUNICATION_FILTER_STATE,
} from '../src/utils/communications';
import type {
  ActionItem,
  Client,
  CommunicationInteraction,
  Meeting,
  Opportunity,
} from '../src/types';

const mockClients: Client[] = [
  {
    id: 'client_1',
    name: 'شركة الرواد التقنية',
    company: 'الرواد',
    relationshipStatus: 'active',
    contacts: [
      {
        id: 'contact_1',
        name: 'م. خالد العتيبي',
        title: 'مدير تقنية المعلومات',
        phone: '0501234567',
        isPrimary: true,
      },
      {
        id: 'contact_2',
        name: 'أ. سارة القحطاني',
        title: 'مديرة المشتريات',
        isPrimary: false,
      },
    ],
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: 'client_2',
    name: 'مؤسسة البنيان',
    relationshipStatus: 'active',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
];

const mockOpportunities: Opportunity[] = [
  {
    id: 'opp_1',
    clientId: 'client_1',
    title: 'مشروع البنية السحابية',
    type: 'project',
    stage: 'proposal',
    priority: 'high',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'opp_other_client',
    clientId: 'client_2',
    title: 'فرصة عميل آخر',
    type: 'service',
    stage: 'new',
    priority: 'medium',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  },
];

test('Task 011 — Communication Center & Interaction History Domain Suite', async (t) => {
  await t.test('1. sanitizeInteractionForSave enforces client contact and opportunity ownership & normalizes topics', () => {
    const raw: CommunicationInteraction = {
      id: 'inter_1',
      clientId: 'client_1',
      contactId: 'contact_1',
      contactName: '  م. خالد العتيبي  ',
      opportunityId: 'opp_other_client', // belongs to client_2, should be stripped!
      channel: 'phone_call',
      direction: 'outbound',
      occurredAt: '2026-11-10T10:30:00.000Z',
      durationMinutes: 25.4,
      subject: '  مراجعة العرض الفني  ',
      summary: '  تمت مناقشة بنود العرض الفني والجدول الزمني.  ',
      topics: [' العرض الفني ', 'عرض فني', 'التسعير', 'العرض الفني'],
      outcome: 'follow_up_needed',
      nextStep: '  إرسال النسخة المحدثة  ',
      nextFollowUpDate: '2026-11-14',
      createdAt: '2026-11-10T10:35:00.000Z',
      updatedAt: '2026-11-10T10:35:00.000Z',
    };

    const sanitized = sanitizeInteractionForSave(
      raw,
      mockClients,
      mockOpportunities,
      '2026-11-10T11:00:00.000Z'
    );

    assert.equal(sanitized.clientId, 'client_1');
    assert.equal(sanitized.contactId, 'contact_1');
    assert.equal(sanitized.contactName, 'م. خالد العتيبي');
    assert.equal(sanitized.opportunityId, undefined); // cross-client opportunity stripped
    assert.equal(sanitized.durationMinutes, 25);
    assert.equal(sanitized.subject, 'مراجعة العرض الفني');
    assert.deepEqual(sanitized.topics, ['العرض الفني', 'عرض فني', 'التسعير']);
  });

  await t.test('2. convertInteractionNextStepToTaskDraft creates one linked task and avoids duplicate conversion', () => {
    const interaction: CommunicationInteraction = {
      id: 'inter_conv',
      userId: 'user_1',
      clientId: 'client_1',
      contactId: 'contact_1',
      opportunityId: 'opp_1',
      channel: 'whatsapp',
      direction: 'inbound',
      occurredAt: '2026-11-12T14:00:00.000Z',
      subject: 'استفسار عن الأسعار',
      outcome: 'replied',
      nextStep: 'تجهيز عرض السعر النهائي',
      nextFollowUpDate: '2026-11-16',
      createdAt: '2026-11-12T14:05:00.000Z',
      updatedAt: '2026-11-12T14:05:00.000Z',
    };

    const first = convertInteractionNextStepToTaskDraft(interaction, [], {
      nowIso: '2026-11-12T14:10:00.000Z',
      taskId: 'task_from_inter_1',
      contactName: 'م. خالد العتيبي',
    });

    assert.equal(first.alreadyExisted, false);
    assert.equal(first.task.id, 'task_from_inter_1');
    assert.equal(first.task.interactionId, 'inter_conv');
    assert.equal(first.task.clientId, 'client_1');
    assert.equal(first.task.opportunityId, 'opp_1');
    assert.equal(first.task.dueDate, '2026-11-16');
    assert.equal(first.updatedInteraction.linkedTaskId, 'task_from_inter_1');

    // Calling again when task already exists returns existing task without creating a duplicate
    const second = convertInteractionNextStepToTaskDraft(
      first.updatedInteraction,
      [first.task],
      { nowIso: '2026-11-12T15:00:00.000Z' }
    );
    assert.equal(second.alreadyExisted, true);
    assert.equal(second.task.id, 'task_from_inter_1');
  });

  await t.test('3. unlinkInteractionReferencesOnDelete safely unlinks tasks referencing a deleted interaction', () => {
    const tasks: ActionItem[] = [
      {
        id: 't1',
        clientId: 'client_1',
        interactionId: 'inter_del',
        title: 'متابعة العرض',
        dueDate: '2026-11-16',
        priority: 'high',
        status: 'pending',
        provenance: 'approved',
        createdAt: '2026-11-12T10:00:00.000Z',
      },
      {
        id: 't2',
        clientId: 'client_1',
        title: 'مهمة مستقلة',
        dueDate: '2026-11-18',
        priority: 'medium',
        status: 'pending',
        provenance: 'source',
        createdAt: '2026-11-12T10:00:00.000Z',
      },
    ];

    const updated = unlinkInteractionReferencesOnDelete('inter_del', tasks);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, 't1');
    assert.equal(updated[0].interactionId, undefined);
  });

  await t.test('4. computeClientCommunicationSummary and computeCommunicationCenterSummary calculate accurate KPIs & stale status', () => {
    const refDate = new Date('2026-11-15T12:00:00.000Z');
    const interactions: CommunicationInteraction[] = [
      {
        id: 'i1',
        clientId: 'client_1',
        contactId: 'contact_1',
        channel: 'phone_call',
        direction: 'outbound',
        occurredAt: '2026-11-14T10:00:00.000Z',
        subject: 'مكالمة متابعة',
        topics: ['العقد', 'التوريد'],
        outcome: 'follow_up_needed',
        nextFollowUpDate: '2026-11-13', // overdue relative to 2026-11-15
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: '2026-11-14T10:00:00.000Z',
      },
    ];
    const meetings: Meeting[] = [];
    const tasks: ActionItem[] = [];

    const client1Summary = computeClientCommunicationSummary(
      mockClients[0],
      interactions,
      meetings,
      tasks,
      refDate,
      14
    );

    assert.equal(client1Summary.totalInteractions, 1);
    assert.equal(client1Summary.isStaleContact, false);
    assert.equal(client1Summary.pendingFollowUpsCount, 1);
    assert.equal(client1Summary.overdueFollowUpsCount, 1);
    assert.equal(client1Summary.byChannel.phone_call, 1);
    assert.equal(client1Summary.byContactId['contact_1']?.count, 1);

    const client2Summary = computeClientCommunicationSummary(
      mockClients[1],
      interactions,
      meetings,
      tasks,
      refDate,
      14
    );
    assert.equal(client2Summary.totalInteractions, 0);
    assert.equal(client2Summary.isStaleContact, true);

    const centerSummary = computeCommunicationCenterSummary(
      interactions,
      mockClients,
      meetings,
      tasks,
      refDate,
      14
    );
    assert.equal(centerSummary.totalInteractions, 1);
    assert.equal(centerSummary.followUpsOverdueCount, 1);
    assert.equal(centerSummary.staleClientsCount, 1);
  });

  await t.test('5. filterAndSortInteractions, resolveInteractionContact, and getContactInteractionHistory work accurately', () => {
    const interactions: CommunicationInteraction[] = [
      {
        id: 'i_a',
        clientId: 'client_1',
        contactId: 'contact_1',
        opportunityId: 'opp_1',
        channel: 'phone_call',
        direction: 'outbound',
        occurredAt: '2026-11-10T10:00:00.000Z',
        subject: 'مناقشة البنية السحابية',
        outcome: 'answered',
        createdAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-10T10:00:00.000Z',
      },
      {
        id: 'i_b',
        clientId: 'client_1',
        contactId: 'deleted_contact_id',
        channel: 'email',
        direction: 'inbound',
        occurredAt: '2026-11-12T10:00:00.000Z',
        subject: 'رد من جهة اتصال محذوفة',
        outcome: 'replied',
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ];

    const filtered = filterAndSortInteractions(
      interactions,
      { ...DEFAULT_COMMUNICATION_FILTER_STATE, channel: 'phone_call' },
      { clients: mockClients, opportunities: mockOpportunities, tasks: [] }
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'i_a');

    const resolvedExisting = resolveInteractionContact(mockClients[0], 'contact_1');
    assert.ok(resolvedExisting);
    assert.equal(resolvedExisting.name, 'م. خالد العتيبي');

    const resolvedMissing = resolveInteractionContact(mockClients[0], 'deleted_contact_id');
    assert.equal(resolvedMissing, undefined);

    const contactHistory = getContactInteractionHistory('client_1', 'contact_1', interactions);
    assert.equal(contactHistory.length, 1);
    assert.equal(contactHistory[0].id, 'i_a');
  });
});
