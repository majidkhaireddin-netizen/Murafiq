import test from 'node:test';
import assert from 'node:assert';
import {
  SYSTEM_COMMUNICATION_TEMPLATES,
  interpolateTemplate,
  buildWhatsAppOutreachUrl,
  buildEmailOutreachUrl,
  sanitizeCommunicationTemplateForSave,
} from '../src/utils/communicationComposerEngine.ts';
import { buildCommunicationAiPrompt } from '../src/server/communicationAiService.ts';
import type { Client, Opportunity } from '../src/types/index.ts';

test('1. System communication templates load successfully and are marked as system templates', () => {
  assert.ok(SYSTEM_COMMUNICATION_TEMPLATES.length >= 6);
  for (const tmpl of SYSTEM_COMMUNICATION_TEMPLATES) {
    assert.strictEqual(tmpl.isSystemTemplate, true);
    assert.ok(tmpl.id);
    assert.ok(tmpl.title);
    assert.ok(tmpl.bodyTemplate);
  }
});

test('2. Pure variable interpolation replaces allowlisted variables correctly', () => {
  const templateStr = 'مرحباً {{contactName}} من شركة {{companyName}} بخصوص {{opportunityTitle}}.';
  const client: Client = {
    id: 'c1',
    name: 'شركة الأفق',
    company: 'مجموعة الأفق الذكي',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const contact = {
    id: 'ct1',
    name: 'أحمد خالد',
    isPrimary: true,
  };
  const opportunity: Opportunity = {
    id: 'opp1',
    clientId: 'c1',
    title: 'مشروع التحول الرقمي',
    type: 'service',
    stage: 'proposal',
    priority: 'high',
    estimatedValue: 15000,
    currency: 'JOD',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const { result, variablesUsed } = interpolateTemplate(templateStr, {
    client,
    contact,
    opportunity,
  });

  assert.strictEqual(
    result,
    'مرحباً أحمد خالد من شركة مجموعة الأفق الذكي بخصوص مشروع التحول الرقمي.'
  );
  assert.strictEqual(variablesUsed.contactName, 'أحمد خالد');
  assert.strictEqual(variablesUsed.companyName, 'مجموعة الأفق الذكي');
  assert.strictEqual(variablesUsed.opportunityTitle, 'مشروع التحول الرقمي');
});

test('3. Interpolation leaves unknown variables unreplaced safely without throwing', () => {
  const templateStr = 'اختبار {{unknownVar}} و {{clientName}}.';
  const { result } = interpolateTemplate(templateStr, {
    client: {
      id: 'c1',
      name: 'شركة اختبار',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  assert.strictEqual(result, 'اختبار {{unknownVar}} و شركة اختبار.');
});

test('4. buildWhatsAppOutreachUrl constructs correct wa.me link with encoded text', () => {
  const link = buildWhatsAppOutreachUrl('+962 7 9000 0000', 'مرحباً بك');
  assert.strictEqual(link, 'https://wa.me/962790000000?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D9%8B%20%D8%A8%D9%83');

  const invalid = buildWhatsAppOutreachUrl('123', 'test');
  assert.strictEqual(invalid, null);
});

test('5. buildEmailOutreachUrl constructs correct mailto link with encoded subject and body', () => {
  const link = buildEmailOutreachUrl('test@example.com', 'عرض سعر', 'محتوى الرسالة');
  assert.strictEqual(
    link,
    'mailto:test@example.com?subject=%D8%B9%D8%B1%D8%B6%20%D8%B3%D8%B9%D8%B1&body=%D9%85%D8%AD%D8%AA%D9%88%D9%89%20%D8%A7%D9%84%D8%B1%D8%B3%D8%A7%D9%84%D8%A9'
  );

  const invalid = buildEmailOutreachUrl('notanemail', 'sub', 'body');
  assert.strictEqual(invalid, null);
});

test('6. sanitizeCommunicationTemplateForSave enforces system template protection and sanitization', () => {
  const raw = {
    id: 'custom-1',
    title: 'قالب مخصص جديد',
    category: 'custom' as any,
    channel: 'whatsapp' as any,
    bodyTemplate: 'مرحباً {{clientName}}',
    variables: [],
    isSystemTemplate: true, // should be forced to false
    createdAt: '',
    updatedAt: '',
  };

  const sanitized = sanitizeCommunicationTemplateForSave(raw, 'user-123');
  assert.strictEqual(sanitized.isSystemTemplate, false);
  assert.strictEqual(sanitized.userId, 'user-123');
  assert.strictEqual(sanitized.title, 'قالب مخصص جديد');
  assert.deepStrictEqual(sanitized.variables, ['clientName']);
});

test('7. buildCommunicationAiPrompt formats AI prompt correctly', () => {
  const prompt = buildCommunicationAiPrompt(
    {
      channel: 'whatsapp',
      clientId: 'c1',
      tone: 'formal',
      granularity: 'short',
      customPrompt: 'ركز على سرعة التنفيذ',
    },
    {
      clientName: 'شركة النور',
      companyName: 'مؤسسة النور',
      contactName: 'سارة أحمد',
      opportunityTitle: 'تطوير النظام',
      opportunityValue: '10,000 SAR',
      nextAction: 'إرسال العرض',
    }
  );

  assert.ok(prompt.includes('whatsapp'));
  assert.ok(prompt.includes('formal'));
  assert.ok(prompt.includes('سارة أحمد'));
  assert.ok(prompt.includes('ركز على سرعة التنفيذ'));
});
