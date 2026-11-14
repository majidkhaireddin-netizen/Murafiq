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
  createdAt: string;
  updatedAt: string;
}

export interface ActionItem {
  id: string;
  userId?: string;
  meetingId?: string;
  clientId: string;
  opportunityId?: string;
  title: string;
  description?: string;
  dueDate?: string; // YYYY-MM-DD
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
  | 'opportunityStageEvent';

export type ResolutionChoice = 'keep_local' | 'keep_remote' | 'merge';

export type ConflictDetectionSource = 'simulated_dev' | 'manual_review' | 'field_diff';

export interface ConflictItem {
  id: string;
  entityType: EntityType;
  entityTitle: string;
  localVersion: Client | Meeting | ActionItem | Note;
  remoteVersion: Client | Meeting | ActionItem | Note;
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
    | OpportunityStageEvent;
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

export type ReminderSourceType = 'task' | 'meeting' | 'client' | 'opportunity';

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
  | 'opportunity_stale';

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
  | 'opportunity';

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
}

export interface SearchCollectionsLoadedState {
  clients: boolean;
  meetings: boolean;
  tasks: boolean;
  notes: boolean;
  opportunities: boolean;
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

export type CsvExportEntityType = 'clients' | 'tasks' | 'meetings' | 'opportunities';

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
  };
  data: {
    clients: Client[];
    meetings: Meeting[];
    tasks: ActionItem[];
    notes: Note[];
    opportunities: Opportunity[];
    opportunityStageEvents: OpportunityStageEvent[];
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
    | 'opportunityStageEvents';
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
  };
  totalSucceeded: number;
  totalSkippedDuplicates: number;
  totalFailed: number;
  succeededRecordKeys: string[];
}


