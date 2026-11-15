export type MeetingType = 'in_person' | 'phone' | 'video' | 'chat';

export type MeetingStatus = 'draft' | 'confirmed' | 'completed' | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type SyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'failed';

export type ProvenanceType = 'source' | 'ai_suggested' | 'approved' | 'uncertain';

export type ClientRelationshipStatus =
  | 'lead'
  | 'initial_contact'
  | 'active'
  | 'follow_up_needed'
  | 'inactive';

export type ClientImportanceLevel = 'high' | 'medium' | 'low';

export type ClientCategory = 'vip' | 'corporate' | 'sme' | 'individual' | 'partner' | 'other';

export interface ClientContact {
  id: string;
  name: string;
  title?: string;
  department?: string;
  phone?: string;
  email?: string;
  notes?: string;
  isPrimary: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Client {
  id: string;
  userId?: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  notes?: string;
  avatarPath?: string;
  color?: string;
  isFavorite?: boolean;
  // Task 005: Client 360 & Relationship Intelligence (strictly optional for legacy compatibility)
  industry?: string;
  category?: ClientCategory | string;
  relationshipStatus?: ClientRelationshipStatus;
  importance?: ClientImportanceLevel;
  tags?: string[];
  website?: string;
  address?: string;
  source?: string;
  description?: string;
  contacts?: ClientContact[];
  createdAt: string;
  updatedAt: string;
}

export type ParticipantParty = 'internal' | 'external';

export interface MeetingParticipant {
  id: string;
  name: string;
  role?: string;
  party: ParticipantParty;
}

export interface MeetingAgendaItem {
  id: string;
  title: string;
  notes?: string;
  durationMinutes?: number;
  order: number;
}

export interface MeetingDecision {
  id: string;
  text: string;
  agendaItemId?: string;
  ownerName?: string;
  createdAt: string;
}

export type MinutesStatus = 'draft' | 'review' | 'final';

export type MinutesSectionKey =
  | 'basicInfo'
  | 'participants'
  | 'agenda'
  | 'discussions'
  | 'decisions'
  | 'tasks'
  | 'followUp'
  | 'additionalNotes';

export interface Meeting {
  id: string;
  userId?: string;
  clientId: string;
  title: string;
  dateTime: string; // ISO format
  duration?: number; // Minutes
  type: MeetingType;
  location?: string;
  notes: string; // Legacy & Markdown meeting minutes (preserved for backward compatibility)
  status: MeetingStatus;
  photoPaths: string[];
  isFollowUpScheduled?: boolean;
  attendees?: string[];
  // Structured Workspace & Minutes fields (Task 004-B — strictly optional for legacy compatibility)
  participants?: MeetingParticipant[];
  agendaItems?: MeetingAgendaItem[];
  discussionSummary?: string;
  decisions?: MeetingDecision[];
  followUpDateTime?: string; // ISO/datetime string for next meeting or follow-up
  minutesStatus?: MinutesStatus;
  minutesStatusUpdatedAt?: string;
  minutesIncludedSections?: MinutesSectionKey[];
  minutesAdditionalNotes?: string;
  appliedTemplateId?: string;
  opportunityId?: string;
  // Task 012: Smart Meeting Preparation & Briefing (strictly optional for legacy compatibility)
  preparation?: MeetingPreparationData;
  createdAt: string;
  updatedAt: string;
}

export type MeetingGoalStatus =
  | 'planned'
  | 'achieved'
  | 'partially_achieved'
  | 'not_achieved'
  | 'deferred';

export interface MeetingPreparationGoal {
  id: string;
  text: string;
  status: MeetingGoalStatus;
  note?: string;
  order: number;
  createdAt: string;
  updatedAt?: string;
}

export interface MeetingPreparationData {
  goals?: MeetingPreparationGoal[];
  notes?: string;
  dismissedTopicKeys?: string[];
  updatedAt?: string;
}

export interface ActionItem {
  id: string;
  userId?: string;
  meetingId?: string;
  clientId: string;
  opportunityId?: string;
  interactionId?: string;
  playbookRunId?: string;
  playbookStepId?: string;
  title: string;
  description?: string;
  dueDate?: string; // YYYY-MM-DD (موعد الاستحقاق)
  scheduledStartAt?: string; // ISO datetime string (وقت بدء العمل المخطط - Time Block)
  scheduledEndAt?: string; // ISO datetime string (وقت انتهاء العمل المخطط - Time Block)
  priority: TaskPriority;
  status: TaskStatus;
  reminderDate?: string;
  completedAt?: string;
  provenance?: ProvenanceType;
  createdAt: string;
}

export interface Note {
  id: string;
  userId?: string;
  clientId?: string;
  title: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  color?: string;
  createdAt: string;
  updatedAt?: string;
}

export type EntityType =
  | 'client'
  | 'meeting'
  | 'task'
  | 'note'
  | 'reminder'
  | 'preference'
  | 'opportunity'
  | 'opportunityStageEvent'
  | 'interaction'
  | 'playbookTemplate'
  | 'playbookRun';

export type ResolutionChoice = 'keep_local' | 'keep_remote' | 'merge';

export type ConflictDetectionSource = 'simulated_dev' | 'manual_review' | 'field_diff' | 'revision_cas';

export interface ConflictItem {
  id: string;
  entityType: EntityType;
  entityTitle: string;
  localVersion: Client | Meeting | ActionItem | Note | Opportunity | PlaybookTemplate | PlaybookRun;
  remoteVersion: Client | Meeting | ActionItem | Note | Opportunity | PlaybookTemplate | PlaybookRun;
  differingFields: {
    field: string;
    fieldLabelArabic: string;
    localValue: any;
    remoteValue: any;
  }[];
  detectedAt: string;
  isSimulated?: boolean;
  detectionSource?: ConflictDetectionSource;
}

export type CacheMode = 'memory' | 'persistent';

export interface CacheInitError {
  code?: string;
  messageArabic: string;
  detail: string;
}

export interface CacheRuntimeState {
  activeMode: CacheMode;
  requestedMode: CacheMode;
  requiresReload: boolean;
  initError: CacheInitError | null;
  isDefaultMemoryOnly: boolean;
}

export type WriteErrorCategory =
  | 'permission-denied'
  | 'unauthenticated'
  | 'invalid-argument'
  | 'failed-precondition'
  | 'unavailable'
  | 'unknown';

export interface RejectedWriteRecord {
  opId: string;
  entityType: EntityType;
  entityId: string;
  entityTitle: string;
  operation: 'save' | 'delete';
  category: WriteErrorCategory;
  messageArabic: string;
  rawMessage: string;
  payload?:
    | Client
    | Meeting
    | ActionItem
    | Note
    | ReminderStateRecord
    | FollowUpPreferences
    | Opportunity
    | OpportunityStageEvent
    | CommunicationInteraction
    | PlaybookTemplate
    | PlaybookRun;
  occurredAt: string;
}

export interface AppState {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  syncState: SyncState;
  conflicts: ConflictItem[];
  isBiometricLocked: boolean;
  isBiometricEnabled: boolean;
  pinCode: string;
  showHijri: boolean;
  language: 'ar' | 'en';
}

export type AllowedAttachmentMimeType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export type AttachmentUploadStatus = 'completed';

export type AttachmentDeleteStatus = 'active' | 'deleting' | 'b2_deleted' | 'delete_failed';

export type UploadIntentStatus =
  | 'pending'
  | 'committing'
  | 'committed'
  | 'cleaning'
  | 'abandoned'
  | 'deleted';

export interface UploadIntentRecord {
  attachmentId: string;
  userId: string;
  meetingId: string;
  fileName: string;
  contentType: AllowedAttachmentMimeType;
  sizeBytes: number;
  storageKey: string;
  bucket?: string;
  status: UploadIntentStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  committedAt?: string;
  committingLeaseExpiresAt?: string;
  cleaningStartedAt?: string;
  cleanedAt?: string;
  cleanupReason?: 'client_abandoned' | 'expired_uncommitted' | 'verification_failed';
}

export interface MeetingAttachmentGuardRecord {
  guardVersion: 1;
  meetingId: string;
  userId: string;
  activeAttachmentIds: string[];
  pendingIntentIds: string[];
  locked: boolean;
  updatedAt: string;
}

export interface MeetingAttachment {
  id: string;
  userId: string;
  meetingId: string;
  fileName: string;
  contentType: AllowedAttachmentMimeType;
  sizeBytes: number;
  storageKey: string;
  storageProvider: 'backblaze_b2';
  uploadStatus: AttachmentUploadStatus;
  deleteStatus?: AttachmentDeleteStatus;
  deleteErrorArabic?: string;
  etag?: string;
  createdAt: string;
  updatedAt?: string;
}

// =========================================================================
// Task 004-C: Intelligent Meeting Assistant Types (Session-only until approved)
// =========================================================================

export type AiSectionInclusionKey =
  | 'title'
  | 'agenda'
  | 'discussions'
  | 'legacyNotes'
  | 'participants'
  | 'additionalNotes'
  | 'existingTasks';

export type AiSectionInclusionSelection = Record<AiSectionInclusionKey, boolean>;

export type AiDecisionConfidence = 'explicit' | 'needs_confirmation';

export type AiOpenPointCategory = 'open_question' | 'ambiguity' | 'risk';

export interface AiMeetingInputAgendaItem {
  id: string;
  order: number;
  title: string;
  notes?: string;
}

export interface AiMeetingInputParticipant {
  name: string;
  role?: string;
  party: ParticipantParty;
}

export interface AiMeetingInputPayload {
  meetingId: string;
  meetingTitle?: string;
  meetingDateIso?: string;
  meetingType?: MeetingType;
  clientName?: string;
  includedSections: AiSectionInclusionKey[];
  participants?: AiMeetingInputParticipant[];
  agendaItems?: AiMeetingInputAgendaItem[];
  discussionSummary?: string;
  legacyNotes?: string;
  minutesAdditionalNotes?: string;
  existingTasksSummary?: string[];
}

export interface AiSuggestedSummary {
  overview: string;
  mainTopics: string[];
  keyOutcomes: string[];
  nextDirection: string;
  insufficientInfo: boolean;
}

export interface AiSuggestedDecision {
  id: string;
  text: string;
  confidence: AiDecisionConfidence;
  ownerName?: string;
  agendaItemId?: string;
  sourceExcerpt?: string;
}

export interface AiSuggestedActionItem {
  id: string;
  title: string;
  description?: string;
  ownerName?: string;
  dueDate?: string; // Strict YYYY-MM-DD when resolved, otherwise undefined
  priority: TaskPriority;
  needsDueDateConfirmation: boolean;
  needsOwnerConfirmation?: boolean;
  agendaItemId?: string;
}

export interface AiOpenPoint {
  id: string;
  text: string;
  category: AiOpenPointCategory;
}

export interface AiFollowUpSuggestion {
  id: string;
  actionText: string;
  suggestedDate?: string; // Strict YYYY-MM-DD when resolved, otherwise undefined
  needsDateConfirmation: boolean;
  suggestedQuestions: string[];
}

export interface MeetingAiAnalysisResult {
  analysisId: string;
  generatedAt: string;
  model: string;
  summary: AiSuggestedSummary;
  decisions: AiSuggestedDecision[];
  actionItems: AiSuggestedActionItem[];
  openQuestions: AiOpenPoint[];
  followUpSuggestions: AiFollowUpSuggestion[];
  warningsArabic: string[];
}

export type AiReviewItemState = 'pending' | 'approved' | 'ignored' | 'save_failed';

// =========================================================================
// Task 006: Smart Follow-Up, Reminders & Daily Command Center Types
// =========================================================================

export type DailyTaskBucketKey =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'later'
  | 'no_due_date';

export type ReminderSourceType =
  | 'task'
  | 'meeting'
  | 'client'
  | 'opportunity'
  | 'interaction'
  | 'playbook_step';

export type ReminderReason =
  | 'task_overdue'
  | 'task_due_today'
  | 'task_due_soon'
  | 'task_high_priority'
  | 'meeting_imminent'
  | 'meeting_follow_up'
  | 'client_stale_contact'
  | 'opportunity_overdue_action'
  | 'opportunity_closing_soon'
  | 'opportunity_missing_next_action'
  | 'opportunity_stale'
  | 'interaction_follow_up_due'
  | 'interaction_follow_up_overdue'
  | 'playbook_step_due_today'
  | 'playbook_step_overdue'
  | 'playbook_step_due_soon';

export type ReminderStatus = 'active' | 'snoozed' | 'resolved' | 'invalidated';

export type SnoozePreset = '1h' | 'tomorrow' | '3d' | 'next_week' | 'custom';

export type MeetingLeadMinutesOption = 15 | 30 | 60 | 120 | 1440;
export type UpcomingTaskWindowDaysOption = 0 | 2 | 3 | 7;

export interface FollowUpPreferences {
  id: string;
  userId?: string;
  remindersEnabled: boolean;
  showOverdueTasks: boolean;
  showUpcomingMeetings: boolean;
  meetingLeadMinutes: MeetingLeadMinutesOption;
  upcomingTaskWindowDays: UpcomingTaskWindowDaysOption;
  showStaleClients: boolean;
  staleClientDays?: number;
  updatedAt: string;
}

export interface ReminderStateRecord {
  id: string;
  userId?: string;
  sourceType: ReminderSourceType;
  sourceId: string;
  reason: ReminderReason;
  clientId?: string;
  status: 'snoozed' | 'resolved' | 'invalidated';
  sourceFingerprint: string;
  snoozedUntil?: string;
  resolvedAt?: string;
  invalidatedAt?: string;
  invalidationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderItem {
  id: string;
  sourceType: ReminderSourceType;
  sourceId: string;
  reason: ReminderReason;
  clientId?: string;
  clientName?: string;
  meetingId?: string;
  taskId?: string;
  interactionId?: string;
  playbookRunId?: string;
  playbookStepId?: string;
  titleArabic: string;
  titleEnglish: string;
  subtitleArabic: string;
  subtitleEnglish: string;
  dueAt?: string;
  severity: 'high' | 'medium' | 'info';
  status: ReminderStatus;
  sourceFingerprint: string;
  snoozedUntil?: string;
  invalidationReasonArabic?: string;
  basisDisclosureArabic?: string;
  provenance: ProvenanceType;
}

export interface DailyCommandSummary {
  dueTodayTasksCount: number;
  overdueTasksCount: number;
  todayMeetingsCount: number;
  upcomingMeetingsCount: number;
  followUpsRequiredCount: number;
  highPriorityTasksCount: number;
  overdueOpportunitiesCount?: number;
  dueInteractionFollowUpsCount?: number;
}

// =========================================================================
// Task 008: Opportunity Management & Relationship Pipeline Types
// =========================================================================

export type OpportunityStage =
  | 'new'
  | 'qualification'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

export type OpportunityType =
  | 'service'
  | 'consulting'
  | 'retainer'
  | 'partnership'
  | 'project'
  | 'other';

export type OpportunityCurrency = 'JOD' | 'SAR' | 'USD' | 'EUR' | 'AED' | 'EGP';

export type OpportunityStageEventType =
  | 'created'
  | 'stage_changed'
  | 'closed_won'
  | 'closed_lost'
  | 'reopened';

export interface Opportunity {
  id: string;
  userId?: string;
  clientId: string;
  title: string;
  description?: string;
  type: OpportunityType;
  stage: OpportunityStage;
  priority: TaskPriority;
  estimatedValue?: number;
  currency?: OpportunityCurrency;
  expectedCloseDate?: string; // YYYY-MM-DD
  nextAction?: string;
  nextActionDate?: string; // YYYY-MM-DD
  source?: string;
  lostReason?: string;
  closedAt?: string;
  reopenedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityStageEvent {
  id: string;
  userId?: string;
  opportunityId: string;
  eventType: OpportunityStageEventType;
  fromStage?: OpportunityStage;
  toStage: OpportunityStage;
  note?: string;
  occurredAt: string;
}

// =========================================================================
// Task 009: Advanced Search, Smart Filters & Safe Data Portability Types
// =========================================================================

export type SearchRecordType =
  | 'client'
  | 'contact'
  | 'meeting'
  | 'task'
  | 'note'
  | 'opportunity'
  | 'interaction'
  | 'playbook';

export type SearchMatchTier =
  | 'exact'
  | 'prefix'
  | 'word'
  | 'partial'
  | 'related'
  | 'filter_only';

export type SearchDateRangePreset = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';

export type SearchOpportunityOpenFilter = 'all' | 'open' | 'closed' | 'won' | 'lost';

export interface SearchFilterState {
  recordType: 'all' | SearchRecordType;
  clientId: string; // 'all' or specific client.id
  datePreset: SearchDateRangePreset;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  status: string; // 'all' or entity status
  priority: 'all' | TaskPriority;
  tag: string; // 'all' or tag string
  opportunityState: SearchOpportunityOpenFilter;
}

export interface HighlightSegment {
  text: string;
  matched: boolean;
}

export interface SearchResultItem {
  id: string;
  recordType: SearchRecordType;
  recordTypeLabelAr: string;
  recordTypeLabelEn: string;
  title: string;
  subtitle?: string;
  snippet: string;
  matchedFieldLabelAr: string;
  matchTier: SearchMatchTier;
  score: number;
  clientId?: string;
  clientName?: string;
  dateIso?: string;
  statusLabelAr?: string;
  priority?: TaskPriority;
  tags?: string[];
  // Direct navigation references
  clientRef?: Client;
  contactRef?: ClientContact;
  meetingRef?: Meeting;
  taskRef?: ActionItem;
  noteRef?: Note;
  opportunityRef?: Opportunity;
  interactionRef?: CommunicationInteraction;
  playbookRunRef?: PlaybookRun;
}

export interface SearchCollectionsLoadedState {
  clients: boolean;
  meetings: boolean;
  tasks: boolean;
  notes: boolean;
  opportunities: boolean;
  interactions?: boolean;
  playbookRuns?: boolean;
}

export interface SearchExecutionResult {
  items: SearchResultItem[];
  grouped: Record<SearchRecordType, SearchResultItem[]>;
  totalMatched: number;
  returnedCount: number;
  truncated: boolean;
  isDataIncomplete: boolean;
  incompleteCollectionsAr: string[];
  activeFilterCount: number;
}

export type CsvExportEntityType = 'clients' | 'tasks' | 'meetings' | 'opportunities' | 'interactions';

export type DataCompletenessStatus = 'complete_online' | 'partial_or_offline';

export interface ExportCompletenessMeta {
  status: DataCompletenessStatus;
  isOnline: boolean;
  allCollectionsLoaded: boolean;
  hasPendingLocalWrites: boolean;
  unloadedCollections: string[];
  disclosureAr: string;
}

export interface AttachmentExportSummary {
  meetingsWithLegacyPhotoPathsCount: number;
  totalLegacyPhotoPathsCount: number;
  policyDisclosureAr: string;
}

export interface MurafiqExportBundleV1 {
  schemaVersion: 'murafiq-export-v1';
  application: 'Murafiq';
  exportedAt: string;
  completeness: ExportCompletenessMeta;
  attachmentPolicyDisclosureAr: string;
  securityDisclosureAr: string;
  attachmentSummary: AttachmentExportSummary;
  excludedItems: string[];
  counts: {
    clients: number;
    meetings: number;
    tasks: number;
    notes: number;
    opportunities: number;
    opportunityStageEvents: number;
    interactions?: number;
    playbookTemplates?: number;
    playbookRuns?: number;
  };
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
    opportunities: Opportunity[];
    opportunityStageEvents: OpportunityStageEvent[];
    interactions?: CommunicationInteraction[];
    playbookTemplates?: PlaybookTemplate[];
    playbookRuns?: PlaybookRun[];
  };
}

export type ImportFormatType = 'murafiq_json' | 'clients_csv';

export type ImportIssueSeverity = 'error' | 'warning';

export interface ImportValidationIssue {
  id: string;
  collection:
    | 'file'
    | 'clients'
    | 'meetings'
    | 'tasks'
    | 'notes'
    | 'opportunities'
    | 'opportunityStageEvents'
    | 'interactions'
    | 'playbookTemplates'
    | 'playbookRuns';
  recordId?: string;
  recordTitle?: string;
  severity: ImportIssueSeverity;
  code:
    | 'INVALID_FORMAT'
    | 'UNSUPPORTED_SCHEMA'
    | 'FILE_TOO_LARGE'
    | 'PROTOTYPE_POLLUTION_BLOCKED'
    | 'INVALID_ID'
    | 'MISSING_REQUIRED_FIELD'
    | 'UNKNOWN_FIELDS_STRIPPED'
    | 'INVALID_FIELD_VALUE'
    | 'DUPLICATE_SKIPPED'
    | 'MISSING_CLIENT_SKIPPED'
    | 'BROKEN_OPTIONAL_LINK_UNLINKED'
    | 'MISSING_OPPORTUNITY_SKIPPED'
    | 'FOREIGN_USER_ID_REBOUND'
    | 'ATTACHMENT_FIELDS_STRIPPED';
  messageAr: string;
}

export interface SanitizedImportBatch {
  clients: Client[];
  meetings: Meeting[];
  tasks: ActionItem[];
  notes: Note[];
  opportunities: Opportunity[];
  opportunityStageEvents: OpportunityStageEvent[];
  interactions?: CommunicationInteraction[];
  playbookTemplates?: PlaybookTemplate[];
  playbookRuns?: PlaybookRun[];
}

export interface ImportPreviewResult {
  canProceed: boolean;
  fatalErrorAr?: string;
  format: ImportFormatType;
  schemaVersionDetected?: string;
  countsByCollection: {
    clients: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    meetings: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    tasks: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    notes: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    opportunities: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    opportunityStageEvents: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    interactions?: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    playbookTemplates?: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
    playbookRuns?: { totalInFile: number; validToImport: number; duplicateSkipped: number; rejected: number };
  };
  totalInFile: number;
  totalValidToImport: number;
  totalDuplicatesSkipped: number;
  totalRejected: number;
  brokenRelationshipsCount: number;
  issues: ImportValidationIssue[];
  sanitizedBatch: SanitizedImportBatch;
}

export interface ImportCollectionExecutionReport {
  attempted: number;
  succeeded: number;
  skippedDuplicates: number;
  failed: number;
  failedItems: { id: string; title: string; errorAr: string }[];
}

export interface ImportExecutionReport {
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'partial_failure' | 'blocked_offline' | 'blocked_unconfirmed' | 'failed';
  messageAr: string;
  collections: {
    clients: ImportCollectionExecutionReport;
    opportunities: ImportCollectionExecutionReport;
    meetings: ImportCollectionExecutionReport;
    tasks: ImportCollectionExecutionReport;
    notes: ImportCollectionExecutionReport;
    opportunityStageEvents: ImportCollectionExecutionReport;
    interactions?: ImportCollectionExecutionReport;
    playbookTemplates?: ImportCollectionExecutionReport;
    playbookRuns?: ImportCollectionExecutionReport;
  };
  totalSucceeded: number;
  totalSkippedDuplicates: number;
  totalFailed: number;
  succeededRecordKeys: string[];
}

// =========================================================================
// Task 010: Integrated Calendar, Weekly Planner & Time Blocking Types
// =========================================================================

export type CalendarViewMode = 'month' | 'week' | 'day' | 'planner';

export type CalendarWeekStartDay = 6 | 0 | 1; // 6 = Saturday, 0 = Sunday, 1 = Monday

export type CalendarTimeFormat = '12h' | '24h';

export type CalendarDefaultBlockMinutes = 30 | 45 | 60 | 90 | 120;

export type CalendarActivityType =
  | 'meeting'
  | 'task_block'
  | 'task_due'
  | 'follow_up'
  | 'opportunity_action'
  | 'opportunity_close'
  | 'playbook_step';

export type CalendarFilterScope =
  | 'all'
  | 'meetings'
  | 'tasks'
  | 'follow_ups'
  | 'opportunities';

export interface CalendarSettings {
  weekStartDay: CalendarWeekStartDay;
  timeFormat: CalendarTimeFormat;
  defaultBlockMinutes: CalendarDefaultBlockMinutes;
  showMeetings: boolean;
  showTasks: boolean;
  showFollowUps: boolean;
  showOpportunities: boolean;
  showPlaybooks?: boolean;
  showCancelledMeetings: boolean;
  workingDayStartHour: number; // e.g. 8
  workingDayEndHour: number; // e.g. 18
}

export interface CalendarEventItem {
  id: string;
  sourceId: string;
  activityType: CalendarActivityType;
  activityTypeLabelAr: string;
  activityTypeLabelEn: string;
  title: string;
  subtitle?: string;
  dateKey: string; // YYYY-MM-DD in active timezone
  isTimed: boolean; // true for meetings & task_block, false for date-only task_due / opportunity dates
  startIso?: string;
  endIso?: string;
  startMs?: number;
  endMs?: number;
  durationMinutes?: number;
  hasKnownDuration: boolean;
  clientId?: string;
  clientName?: string;
  statusLabelAr: string;
  isCompletedOrClosed: boolean;
  isCancelled: boolean;
  isOverdue: boolean;
  priority?: TaskPriority;
  provenance?: ProvenanceType;
  minutesLocked?: boolean;
  // Original entity references (never duplicate data)
  meetingRef?: Meeting;
  taskRef?: ActionItem;
  opportunityRef?: Opportunity;
  interactionRef?: CommunicationInteraction;
  playbookRunRef?: PlaybookRun;
  playbookStepId?: string;
}

export interface CalendarDayCell {
  dateKey: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  dayOfWeek: number; // 0-6 (Sun-Sat)
  dayNameShortAr: string;
  dayNameFullAr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEventItem[];
  counts: {
    meetings: number;
    taskBlocks: number;
    tasksDue: number;
    followUps: number;
    opportunities: number;
    total: number;
  };
  hasConflict: boolean;
}

export interface CalendarConflictPair {
  id: string;
  dateKey: string;
  firstEvent: CalendarEventItem;
  secondEvent: CalendarEventItem;
  overlapStartIso: string;
  overlapEndIso: string;
  overlapMinutes: number;
  reasonAr: string;
}

export interface DayAvailableGap {
  startIso: string;
  endIso: string;
  startHourLabel: string;
  endHourLabel: string;
  durationMinutes: number;
}

export interface WeeklyPlanSummary {
  weekStartKey: string;
  weekEndKey: string;
  meetingsCount: number;
  dueTasksCount: number;
  timeBlockedTasksCount: number;
  followUpsCount: number;
  opportunityActionsCount: number;
  overdueCommitmentsCount: number;
  scheduledMeetingMinutes: number;
  scheduledMeetingHours: number;
  meetingsWithoutDurationCount: number;
  plannedTaskWorkMinutes: number;
  plannedTaskWorkHours: number;
  conflictsCount: number;
}

// =========================================================================
// Task 011: Communication Center & Interaction History Types
// =========================================================================

export type CommunicationChannel =
  | 'phone_call'
  | 'whatsapp'
  | 'email'
  | 'in_person_visit'
  | 'video_call'
  | 'sms'
  | 'other';

export type CommunicationDirection = 'outbound' | 'inbound';

export type CommunicationOutcome =
  | 'answered'
  | 'no_answer'
  | 'busy_or_callback'
  | 'message_sent'
  | 'replied'
  | 'agreement_reached'
  | 'follow_up_needed'
  | 'info_shared'
  | 'other';

export interface CommunicationInteraction {
  id: string;
  userId?: string;
  clientId: string;
  contactId?: string;
  contactName?: string;
  opportunityId?: string;
  meetingId?: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  occurredAt: string; // ISO datetime string
  durationMinutes?: number; // 0..1440
  subject: string; // 1..200 chars
  summary?: string; // <= 5000 chars
  topics?: string[]; // <= 20 tags
  outcome: CommunicationOutcome;
  nextStep?: string; // <= 500 chars
  nextFollowUpDate?: string; // YYYY-MM-DD
  linkedTaskId?: string; // Optional reference to ActionItem created from this interaction
  createdAt: string;
  updatedAt: string;
}

export type CommunicationDatePreset = 'all' | 'today' | '7d' | '30d' | '90d' | 'custom';

export interface CommunicationFilterState {
  searchQuery: string;
  clientId: string; // 'all' or clientId
  contactId: string; // 'all' or contactId
  opportunityId: string; // 'all' or opportunityId
  channel: 'all' | CommunicationChannel;
  direction: 'all' | CommunicationDirection;
  outcome: 'all' | CommunicationOutcome;
  followUpFilter: 'all' | 'needs_follow_up' | 'overdue_follow_up' | 'has_linked_task';
  datePreset: CommunicationDatePreset;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  sortBy: 'occurred_desc' | 'occurred_asc' | 'follow_up_asc';
}

export interface ClientCommunicationSummary {
  clientId: string;
  totalInteractions: number;
  lastInteractionAt: string | null;
  lastInteractionChannel: CommunicationChannel | null;
  lastInteractionOutcome: CommunicationOutcome | null;
  lastContactAt: string | null; // Latest between past held meetings and logged interactions
  daysSinceLastContact: number | null;
  isStaleContact: boolean;
  pendingFollowUpsCount: number;
  overdueFollowUpsCount: number;
  nextFollowUpDate: string | null;
  byChannel: Record<CommunicationChannel, number>;
  byContactId: Record<string, { count: number; lastOccurredAt: string }>;
  recentTopics: string[];
}

export interface CommunicationCenterSummary {
  totalInteractions: number;
  interactionsToday: number;
  interactionsLast7Days: number;
  interactionsLast30Days: number;
  outboundCount: number;
  inboundCount: number;
  followUpsDueTodayCount: number;
  followUpsOverdueCount: number;
  followUpsPendingTotalCount: number;
  staleClientsCount: number;
  activeClientsContactedLast30Days: number;
  byChannel: Record<CommunicationChannel, number>;
  byOutcome: Record<CommunicationOutcome, number>;
}

// =========================================================================
// Task 012: Smart Meeting Preparation & Briefing Types
// =========================================================================

export interface PreparationCollectionsLoadedState {
  clients: boolean;
  meetings: boolean;
  tasks: boolean;
  notes: boolean;
  opportunities: boolean;
  opportunityStageEvents: boolean;
  interactions: boolean;
}

export interface PreparationCompletenessMeta {
  isOnline: boolean;
  allCollectionsLoaded: boolean;
  unloadedCollectionsAr: string[];
  hasPendingWrites: boolean;
  status: 'complete_online' | 'partial_or_offline';
  disclosureAr: string;
}

export type SuggestedDiscussionTopicSourceType =
  | 'overdue_task'
  | 'due_today_task'
  | 'opportunity_next_action'
  | 'interaction_follow_up'
  | 'previous_meeting_follow_up'
  | 'previous_decision';

export interface SuggestedDiscussionTopic {
  key: string;
  title: string;
  reasonAr: string;
  sourceType: SuggestedDiscussionTopicSourceType;
  sourceId: string;
  sourceLabelAr: string;
  priorityWeight: number;
  alreadyInAgenda: boolean;
  isDismissed: boolean;
}

export interface PreviousMeetingBriefItem {
  meeting: Meeting;
  summaryExcerpt: string;
  decisions: MeetingDecision[];
  openTasksCount: number;
  completedTasksCount: number;
}

export interface MeetingPreparationBrief {
  meeting: Meeting;
  client: Client | null;
  primaryContact: ClientContact | null;
  contacts: ClientContact[];
  participants: MeetingParticipant[];
  completeness: PreparationCompletenessMeta;
  relationshipSummary: {
    totalInteractionsCount: number;
    confirmedInteractionsCount: number;
    attemptInteractionsCount: number;
    lastConfirmedInteraction: CommunicationInteraction | null;
    lastAttemptInteraction: CommunicationInteraction | null;
    lastHeldMeeting: Meeting | null;
    lastConfirmedContactAt: string | null;
    daysSinceLastConfirmedContact: number | null;
    pendingFollowUpInteractions: CommunicationInteraction[];
    overdueFollowUpInteractions: CommunicationInteraction[];
    recentInteractions: CommunicationInteraction[];
    recordsDisclosureAr: string;
  };
  previousMeetings: PreviousMeetingBriefItem[];
  recentDecisions: {
    decision: MeetingDecision;
    meetingId: string;
    meetingTitle: string;
    meetingDate: string;
  }[];
  openTasks: {
    overdue: ActionItem[];
    dueToday: ActionItem[];
    upcoming: ActionItem[];
    noDueDate: ActionItem[];
    totalOpenCount: number;
  };
  opportunitiesContext: {
    linkedOpportunity: Opportunity | null;
    linkedOpportunityStageEvents: OpportunityStageEvent[];
    otherClientOpportunities: Opportunity[];
  };
  suggestedTopics: SuggestedDiscussionTopic[];
  goals: MeetingPreparationGoal[];
  preparationNotes: string;
  clientNotes: Note[];
  isMinutesFinalLocked: boolean;
  isMeetingCancelled: boolean;
  canEditAgendaAndMinutes: boolean;
  canEditGoals: boolean;
  canUpdatePostMeetingGoalStatus: boolean;
  minutesStatusLabelAr: string;
}

export type AiBriefingSectionInclusionKey =
  | 'currentMeeting'
  | 'clientSummary'
  | 'previousMeetings'
  | 'openTasks'
  | 'opportunityDetails'
  | 'recentInteractions'
  | 'clientNotes';

export type AiBriefingSectionSelection = Record<AiBriefingSectionInclusionKey, boolean>;

export interface AiBriefingInputPayload {
  meetingId: string;
  meetingTitle: string;
  meetingDateTime: string;
  meetingType?: string;
  meetingLocation?: string;
  meetingStatus?: string;
  includedSections: AiBriefingSectionSelection;
  clientSummary?: {
    name: string;
    company?: string;
    industry?: string;
    relationshipStatus?: string;
    importance?: string;
    primaryContactName?: string;
    primaryContactRole?: string;
  };
  agendaItems?: { title: string; notes?: string }[];
  preparationGoals?: { text: string; status: string; note?: string }[];
  preparationNotes?: string;
  previousMeetings?: {
    title: string;
    dateTime: string;
    status: string;
    summary: string;
    decisions: string[];
  }[];
  openTasks?: {
    title: string;
    dueDate?: string;
    priority: string;
    status: string;
    bucket: string;
  }[];
  linkedOpportunity?: {
    title: string;
    stage: string;
    priority: string;
    valueDisplay?: string;
    expectedCloseDate?: string;
    nextAction?: string;
    nextActionDate?: string;
  };
  otherOpenOpportunitiesCount?: number;
  recentInteractions?: {
    channel: string;
    direction: string;
    occurredAt: string;
    outcome: string;
    isConfirmedContact: boolean;
    subject: string;
    summary?: string;
    nextStep?: string;
    nextFollowUpDate?: string;
  }[];
  clientNotes?: { title: string; content: string }[];
}

export type AiBriefingBasisType = 'documented_fact' | 'inference' | 'ai_suggestion';

export interface AiBriefingTalkingPoint {
  id: string;
  title: string;
  rationale: string;
  basisType: AiBriefingBasisType;
  sourceReferenceAr?: string;
}

export interface AiBriefingSuggestedGoal {
  id: string;
  text: string;
  note?: string;
}

export interface MeetingAiBriefingResult {
  executiveBriefing: string;
  recommendedTalkingPoints: AiBriefingTalkingPoint[];
  suggestedQuestions: string[];
  potentialRisks: string[];
  expectedOutcomes: AiBriefingSuggestedGoal[];
  warnings: string[];
  generatedAt: string;
  modelUsed: string;
}

// =========================================================================
// Task 013: Relationship Playbooks & Follow-Up Sequences Types
// =========================================================================

export type PlaybookCategory =
  | 'lead_engagement'
  | 'proposal_follow_up'
  | 'post_meeting'
  | 'relationship_reactivation'
  | 'custom';

export type PlaybookStepType = 'task' | 'communication' | 'manual';

export type PlaybookDuePolicyType = 'from_start' | 'after_previous_completion';

export interface PlaybookDuePolicy {
  type: PlaybookDuePolicyType;
  offsetDays: number;
}

export interface PlaybookTemplateStep {
  id: string;
  title: string;
  description?: string;
  stepType: PlaybookStepType;
  order: number;
  duePolicy: PlaybookDuePolicy;
  priority?: TaskPriority;
  suggestedChannel?: CommunicationChannel;
}

export interface PlaybookTemplate {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  category: PlaybookCategory;
  steps: PlaybookTemplateStep[];
  isSystemTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PlaybookRunStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export type PlaybookStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export type PlaybookStepCompletionMethod = 'manual' | 'linked_task' | 'linked_communication';

export interface PlaybookRunStep {
  id: string;
  title: string;
  description?: string;
  stepType: PlaybookStepType;
  order: number;
  status: PlaybookStepStatus;
  duePolicy: PlaybookDuePolicy;
  dueDate?: string; // Strict YYYY-MM-DD when resolved; undefined when awaiting prerequisite completion
  priority?: TaskPriority;
  suggestedChannel?: CommunicationChannel;
  startedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  linkedTaskId?: string;
  linkedInteractionId?: string;
  completionMethod?: PlaybookStepCompletionMethod;
  note?: string;
}

export interface PlaybookRun {
  id: string;
  userId?: string;
  templateId?: string;
  templateName: string;
  clientId: string;
  opportunityId?: string;
  status: PlaybookRunStatus;
  steps: PlaybookRunStep[];
  startDateKey?: string; // Strict YYYY-MM-DD calendar date on which the playbook starts
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  revision?: number;
}

export interface PlaybookProgressMetrics {
  totalStepsCount: number;
  completedStepsCount: number;
  skippedStepsCount: number;
  inProgressStepsCount: number;
  pendingStepsCount: number;
  actionableRemainingCount: number;
  completionRatio: number;
  completionPercent: number;
  isReadyToFinish: boolean;
}

export interface PlaybookRescheduleSuggestion {
  runId: string;
  stepId: string;
  stepTitle: string;
  linkedTaskId: string;
  currentTaskDueDate: string;
  suggestedDueDate: string;
  reasonAr: string;
}

// =========================================================================
// Task 014: Document Intelligence & Smart Attachment Analysis Types
// =========================================================================

export type DocumentAiAnalysisMode = 'comprehensive' | 'question';

export type DocumentAiUiState =
  | 'idle'
  | 'consent'
  | 'loading'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'offline'
  | 'unsupported_file'
  | 'configuration_error';

export type DocumentAiReviewItemState = 'pending' | 'approved' | 'ignored' | 'save_failed';

export interface DocumentAiAnalysisRequest {
  meetingId: string;
  attachmentId: string;
  analysisMode: DocumentAiAnalysisMode;
  question?: string;
}

export interface DocumentAiComprehensiveSummary {
  overview: string;
  documentTypeLabel?: string;
  mainSubject?: string;
  insufficientInfo: boolean;
}

export interface DocumentAiSuggestedDecision {
  id: string;
  text: string;
  confidence: AiDecisionConfidence;
  ownerName?: string;
  sourceEvidence?: string;
}

export interface DocumentAiSuggestedTask {
  id: string;
  title: string;
  description?: string;
  ownerName?: string;
  dueDate?: string;
  priority: TaskPriority;
  needsDueDateConfirmation: boolean;
  needsOwnerConfirmation: boolean;
  sourceEvidence?: string;
}

export interface DocumentAiImportantDate {
  id: string;
  label: string;
  dateIso?: string;
  rawDateText?: string;
  needsDateConfirmation: boolean;
  sourceEvidence?: string;
}

export interface DocumentAiQuestionAnswer {
  question: string;
  answer: string;
  supportingEvidence: string[];
  insufficientInformation: boolean;
}

export interface DocumentAiAnalysisResult {
  analysisId: string;
  generatedAt: string;
  model: string;
  meetingId: string;
  attachmentId: string;
  fileName: string;
  contentType: AllowedAttachmentMimeType;
  sizeBytes: number;
  analysisMode: DocumentAiAnalysisMode;
  summary?: DocumentAiComprehensiveSummary;
  keyPoints: string[];
  decisions: DocumentAiSuggestedDecision[];
  suggestedTasks: DocumentAiSuggestedTask[];
  importantDates: DocumentAiImportantDate[];
  openQuestions: AiOpenPoint[];
  questionAnswer?: DocumentAiQuestionAnswer;
  limitations: string[];
  warningsArabic: string[];
}
