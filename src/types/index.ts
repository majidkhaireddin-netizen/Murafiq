export type MeetingType = 'in_person' | 'phone' | 'video' | 'chat';

export type MeetingStatus = 'draft' | 'confirmed' | 'completed';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type SyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'failed';

export type ProvenanceType = 'source' | 'ai_suggested' | 'approved' | 'uncertain';

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
  createdAt: string;
  updatedAt: string;
}

export interface ActionItem {
  id: string;
  userId?: string;
  meetingId?: string;
  clientId: string;
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
}

export type EntityType = 'client' | 'meeting' | 'task' | 'note';

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
  payload?: Client | Meeting | ActionItem | Note;
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

