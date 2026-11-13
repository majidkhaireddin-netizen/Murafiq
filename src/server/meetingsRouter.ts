import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  isValidResourceId,
  MEETING_HAS_ATTACHMENTS_MESSAGE_AR,
  MEETING_HAS_PENDING_ATTACHMENTS_MESSAGE_AR,
} from '../utils/attachmentPolicy.ts';
import {
  createFirebaseAttachmentMetadataStore,
  verifyFirebaseBearerToken,
  verifyMeetingOwnershipInNamedDb,
  type AttachmentMetadataStore,
  type VerifiedFirebaseUser,
} from './firebaseServerAuth.ts';

export interface MeetingsRouterDeps {
  verifyBearerToken?: (authHeader: string | undefined) => Promise<VerifiedFirebaseUser>;
  verifyMeetingOwnership?: (params: { uid: string; meetingId: string; idToken: string }) => Promise<boolean>;
  metadataStore?: AttachmentMetadataStore;
}

interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
}

export function createMeetingsRouter(customDeps: MeetingsRouterDeps = {}) {
  const router = express.Router();
  const verifyToken = customDeps.verifyBearerToken ?? verifyFirebaseBearerToken;
  const verifyMeetingOwner = customDeps.verifyMeetingOwnership ?? verifyMeetingOwnershipInNamedDb;
  const metadataStore = customDeps.metadataStore ?? createFirebaseAttachmentMetadataStore();

  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const user = await verifyToken(req.headers.authorization);
      req.authUser = user;
      next();
    } catch (err: any) {
      const code = String(err?.code || '');
      const msg = String(err?.message || '');
      const isAuthFailure =
        msg.startsWith('UNAUTHENTICATED:') ||
        (code.startsWith('auth/') && code !== 'auth/internal-error');

      if (isAuthFailure) {
        res.status(401).json({
          error: 'UNAUTHENTICATED',
          messageArabic: 'يجب تسجيل الدخول بحساب Google الموثّق للوصول إلى اللقاءات.',
        });
        return;
      }

      res.status(500).json({
        error: 'AUTH_VERIFICATION_UNAVAILABLE',
        messageArabic: 'تعذر التحقق من جلسة المصادقة على الخادم مؤقتاً.',
      });
    }
  };

  router.use(requireAuth);

  /**
   * Server-authoritative Meeting Deletion Guard.
   * Refuses deletion with 409 whenever committed attachments OR active/pending upload intents exist.
   * Never deletes or modifies any Backblaze B2 objects.
   */
  router.post('/delete', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const uid = req.authUser!.uid;
      const body = (req.body || {}) as Record<string, unknown>;

      const claimedUid = body.uid ?? body.userId ?? body.ownerId;
      if (claimedUid !== undefined && claimedUid !== uid) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'مرفوض: لا يُسمح بحذف لقاءات تخص حساباً آخر.',
        });
        return;
      }

      if (!isValidResourceId(body.meetingId)) {
        res.status(400).json({
          error: 'INVALID_MEETING_ID',
          messageArabic: 'معرّف اللقاء غير صالح.',
        });
        return;
      }

      const meetingId = body.meetingId;
      const ownsMeeting = await verifyMeetingOwner({
        uid,
        meetingId,
        idToken: req.authUser!.idToken,
      });

      if (!ownsMeeting) {
        res.status(403).json({
          error: 'MEETING_ACCESS_DENIED',
          messageArabic: 'اللقاء غير موجود أو لا تملك صلاحية حذفه.',
        });
        return;
      }

      const deleteResult = await metadataStore.deleteMeetingIfNoAttachments({
        uid,
        meetingId,
      });

      if (deleteResult.outcome === 'blocked_attachments') {
        res.status(409).json({
          error: 'MEETING_HAS_ATTACHMENTS',
          messageArabic: MEETING_HAS_ATTACHMENTS_MESSAGE_AR,
        });
        return;
      }

      if (deleteResult.outcome === 'blocked_pending_intents') {
        res.status(409).json({
          error: 'MEETING_HAS_PENDING_ATTACHMENTS',
          messageArabic: MEETING_HAS_PENDING_ATTACHMENTS_MESSAGE_AR,
        });
        return;
      }

      if (deleteResult.outcome === 'not_found') {
        res.status(404).json({
          error: 'MEETING_NOT_FOUND',
          messageArabic: 'اللقاء المطلوب غير موجود.',
        });
        return;
      }

      res.json({
        deleted: true,
        meetingId,
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({
          error: 'FORBIDDEN',
          messageArabic: 'تم رفض الوصول إلى بيانات اللقاء.',
        });
        return;
      }
      if (msg.startsWith('FIREBASE_ADMIN_NOT_CONFIGURED:')) {
        res.status(503).json({
          error: 'FIREBASE_ADMIN_NOT_CONFIGURED',
          messageArabic:
            'تعذر التحقق من مرفقات اللقاء على الخادم لأن صلاحيات Firebase Admin غير مهيأة بعد.',
        });
        return;
      }
      res.status(500).json({
        error: 'DELETE_MEETING_FAILED',
        messageArabic: 'تعذر إتمام حذف اللقاء على الخادم. يرجى المحاولة مرة أخرى.',
      });
    }
  });

  return router;
}
