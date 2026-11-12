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

export interface Meeting {
  id: string;
  userId?: string;
  clientId: string;
  title: string;
  dateTime: string; // ISO format
  duration?: number; // Minutes
  type: MeetingType;
  location?: string;
  notes: string; // Meeting minutes in Markdown
  status: MeetingStatus;
  photoPaths: string[];
  isFollowUpScheduled?: boolean;
  attendees?: string[];
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
