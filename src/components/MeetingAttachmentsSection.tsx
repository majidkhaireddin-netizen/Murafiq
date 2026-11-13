import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
  WifiOff,
  X,
} from 'lucide-react';
import type { MeetingAttachment } from '../types';
import {
  formatFileSizeArabic,
  isImageMimeType,
  validateAttachmentFileRequest,
  verifyMagicBytes,
} from '../utils/attachmentPolicy';
import { formatArabicDate } from '../utils/logic';
import { subscribeMeetingAttachments } from '../services/firebase';
import {
  AttachmentClientError,
  deleteMeetingAttachment,
  fetchAttachmentBlobViaRelay,
  getFreshPresignedDownloadUrl,
  uploadMeetingAttachment,
  type UploadStage,
} from '../services/attachments';

interface MeetingAttachmentsSectionProps {
  meetingId: string;
  isOnline: boolean;
}

const STAGE_LABELS_AR: Record<UploadStage, string> = {
  validating: 'جاري التحقق من نوع الملف وصيغته...',
  requesting_url: 'جاري طلب رابط الرفع المؤقت الآمن...',
  uploading: 'جاري رفع الملف إلى التخزين السحابي...',
  verifying: 'جاري التحقق من سلامة الملف المرفوع...',
  saving_metadata: 'جاري تثبيت سجل المرفق في قاعدة البيانات...',
};

export const MeetingAttachmentsSection: React.FC<MeetingAttachmentsSectionProps> = ({
  meetingId,
  isOnline,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const [attachments, setAttachments] = useState<MeetingAttachment[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);

  // Selected local file staged for confirmation before upload
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

  // Active upload state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);

  // Action feedback (errors / success notices)
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Delete confirmation & progress
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<MeetingAttachment | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // View / Download loading indicator
  const [loadingUrlForId, setLoadingUrlForId] = useState<string | null>(null);

  // Lightbox / Document preview modal state
  const [viewerState, setViewerState] = useState<{
    attachment: MeetingAttachment;
    url: string;
    loadFailed?: boolean;
    usedRelayFallback?: boolean;
    revokeBlob?: () => void;
  } | null>(null);

  const closeViewer = () => {
    setViewerState((prev) => {
      prev?.revokeBlob?.();
      return null;
    });
  };

  // Subscribe to Firestore attachment metadata for this meeting
  useEffect(() => {
    setIsLoadingList(true);
    setListError(null);
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = subscribeMeetingAttachments(
        meetingId,
        (items) => {
          setAttachments(items);
          setIsLoadingList(false);
          setListError(null);
        },
        (err) => {
          setIsLoadingList(false);
          setListError(
            err?.message || 'تعذر تحميل قائمة المرفقات. تأكد من صلاحيات الحساب والاتصال بالإنترنت.'
          );
        }
      );
    } catch (err: any) {
      setIsLoadingList(false);
      setListError(err?.message || 'تعذر بدء اشتراك المرفقات.');
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [meetingId]);

  // Clean up object URL and any ongoing abort controller on meeting switch/unmount
  useEffect(() => {
    return () => {
      if (pendingPreviewUrl) {
        URL.revokeObjectURL(pendingPreviewUrl);
      }
      if (uploadAbortRef.current) {
        uploadAbortRef.current.abort();
      }
    };
  }, [pendingPreviewUrl]);

  useEffect(() => {
    return () => {
      viewerState?.revokeBlob?.();
    };
  }, [viewerState]);

  const clearPendingFile = () => {
    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
    }
    setPendingFile(null);
    setPendingPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenFilePicker = () => {
    setActionError(null);
    setActionSuccess(null);
    if (!isOnline) {
      setActionError(
        'رفع المرفقات يتطلب اتصالاً نشطاً بالإنترنت. لا تُخزَّن الملفات محلياً دون اتصال لحماية السرية.'
      );
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setActionError(null);
    setActionSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateAttachmentFileRequest({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });

    if (!validation.valid || !validation.normalizedContentType) {
      setActionError(validation.errorArabic || 'الملف المختار غير مسموح به.');
      e.target.value = '';
      return;
    }

    try {
      const headerBuffer = await file.slice(0, 16).arrayBuffer();
      const magicValid = verifyMagicBytes(
        new Uint8Array(headerBuffer),
        validation.normalizedContentType
      );
      if (!magicValid) {
        setActionError(
          'تعذر التحقق من توقيع الملف الفعلي (Magic Bytes). تأكد من أن الملف صورة أو PDF سليم غير معدل.'
        );
        e.target.value = '';
        return;
      }
    } catch {
      setActionError('تعذر قراءة الملف من جهازك للتحقق منه.');
      e.target.value = '';
      return;
    }

    if (pendingPreviewUrl) {
      URL.revokeObjectURL(pendingPreviewUrl);
    }

    const previewUrl = isImageMimeType(validation.normalizedContentType)
      ? URL.createObjectURL(file)
      : null;

    setPendingFile(file);
    setPendingPreviewUrl(previewUrl);
  };

  const handleStartUpload = async () => {
    if (!pendingFile) return;
    if (!isOnline) {
      setActionError('انقطع الاتصال بالإنترنت. يرجى استعادة الاتصال قبل بدء الرفع.');
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStage('validating');

    const abortController = new AbortController();
    uploadAbortRef.current = abortController;

    try {
      const uploaded = await uploadMeetingAttachment({
        meetingId,
        file: pendingFile,
        signal: abortController.signal,
        onProgress: (pct) => setUploadProgress(pct),
        onStageChange: (stage) => setUploadStage(stage),
      });

      clearPendingFile();
      setActionSuccess(`تم رفع وحفظ المرفق «${uploaded.fileName}» بأمان.`);
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      const msg =
        err instanceof AttachmentClientError || err?.message
          ? err.message
          : 'فشل رفع المرفق. يرجى التحقق من الاتصال والمحاولة مجدداً.';
      setActionError(msg);
    } finally {
      uploadAbortRef.current = null;
      setIsUploading(false);
      setUploadStage(null);
      setUploadProgress(0);
    }
  };

  const handleCancelActiveUpload = () => {
    uploadAbortRef.current?.abort();
  };

  const handleOpenViewerViaRelay = async (attachment: MeetingAttachment) => {
    setActionError(null);
    if (!isOnline) {
      setActionError('عرض المرفقات يتطلب اتصالاً نشطاً بالإنترنت.');
      return;
    }

    setLoadingUrlForId(attachment.id);
    try {
      const relayRes = await fetchAttachmentBlobViaRelay({
        meetingId,
        attachmentId: attachment.id,
        disposition: 'inline',
      });
      setViewerState((prev) => {
        prev?.revokeBlob?.();
        return {
          attachment,
          url: relayRes.blobUrl,
          loadFailed: false,
          usedRelayFallback: true,
          revokeBlob: relayRes.revoke,
        };
      });
    } catch (err: any) {
      setViewerState((prev) =>
        prev ? { ...prev, loadFailed: true, usedRelayFallback: true } : null
      );
      setActionError(err?.message || 'تعذر عرض المرفق عبر الخادم.');
    } finally {
      setLoadingUrlForId(null);
    }
  };

  const handleOpenViewer = async (attachment: MeetingAttachment, forceRefresh: boolean = false) => {
    setActionError(null);
    if (!isOnline) {
      setActionError('عرض المرفقات يتطلب اتصالاً نشطاً بالإنترنت.');
      return;
    }

    setLoadingUrlForId(attachment.id);
    try {
      const res = await getFreshPresignedDownloadUrl({
        meetingId,
        attachmentId: attachment.id,
        disposition: 'inline',
        forceRefresh,
      });
      setViewerState((prev) => {
        prev?.revokeBlob?.();
        return {
          attachment,
          url: res.downloadUrl,
          loadFailed: false,
          usedRelayFallback: false,
        };
      });
    } catch {
      // Fallback automatically to same-origin authenticated relay
      await handleOpenViewerViaRelay(attachment);
    } finally {
      setLoadingUrlForId(null);
    }
  };

  const handleDownloadAttachment = async (attachment: MeetingAttachment) => {
    setActionError(null);
    if (!isOnline) {
      setActionError('تنزيل المرفقات يتطلب اتصالاً نشطاً بالإنترنت.');
      return;
    }

    setLoadingUrlForId(attachment.id);
    try {
      const res = await getFreshPresignedDownloadUrl({
        meetingId,
        attachmentId: attachment.id,
        disposition: 'attachment',
        forceRefresh: true,
      });

      const anchor = document.createElement('a');
      anchor.href = res.downloadUrl;
      anchor.download = attachment.fileName;
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      try {
        const relayRes = await fetchAttachmentBlobViaRelay({
          meetingId,
          attachmentId: attachment.id,
          disposition: 'attachment',
        });
        const anchor = document.createElement('a');
        anchor.href = relayRes.blobUrl;
        anchor.download = attachment.fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => relayRes.revoke(), 2000);
      } catch (relayErr: any) {
        setActionError(relayErr?.message || 'تعذر تنزيل المرفق.');
      }
    } finally {
      setLoadingUrlForId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteItem) return;
    if (!isOnline) {
      setActionError('حذف المرفقات يتطلب اتصالاً نشطاً بالإنترنت لضمان إزالتها من التخزين السحابي.');
      setConfirmDeleteItem(null);
      return;
    }

    const target = confirmDeleteItem;
    setDeletingId(target.id);
    setActionError(null);
    setActionSuccess(null);

    try {
      await deleteMeetingAttachment({
        meetingId,
        attachmentId: target.id,
      });
      if (viewerState?.attachment.id === target.id) {
        closeViewer();
      }
      setConfirmDeleteItem(null);
      setActionSuccess(`تم حذف المرفق «${target.fileName}» من التخزين السحابي وسجل اللقاء.`);
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(
        err?.message ||
          'تعذر حذف الملف من التخزين السحابي. بقي المرفق مسجلاً لتتمكن من إعادة المحاولة.'
      );
      setConfirmDeleteItem(null);
    } finally {
      setDeletingId(null);
    }
  };

  const getTypeLabel = (mime: string) => {
    if (mime === 'image/jpeg') return 'صورة JPEG';
    if (mime === 'image/png') return 'صورة PNG';
    if (mime === 'image/webp') return 'صورة WebP';
    if (mime === 'application/pdf') return 'مستند PDF';
    return 'ملف';
  };

  return (
    <div
      className="pt-4 border-t border-stone-200 space-y-3"
      data-testid="meeting-attachments-section"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h4 className="font-heading font-bold text-xs text-stone-900 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5 text-emerald-700" />
            <span>المرفقات والصور والمستندات ({attachments.length})</span>
          </h4>
          <p className="text-[11px] text-stone-500 mt-0.5 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-700 shrink-0" />
            <span>تخزين خاص عبر Backblaze B2 بروابط مؤقتة التوقيع — غير مخزنة محلياً بدون إنترنت</span>
          </p>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="attachment-file-input"
            accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            type="button"
            data-testid="add-attachment-button"
            onClick={handleOpenFilePicker}
            disabled={!isOnline || isUploading}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
              !isOnline || isUploading
                ? 'bg-stone-200 text-stone-500 cursor-not-allowed'
                : 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-2xs'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>إضافة مرفق</span>
          </button>
        </div>
      </div>

      {/* Explicit Offline Notice */}
      {!isOnline && (
        <div
          data-testid="attachments-offline-notice"
          className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2"
        >
          <WifiOff className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            أنت في وضع عدم الاتصال: رفع المرفقات وعرضها وتنزيلها وحذفها يتطلب اتصالاً نشطاً
            بالإنترنت. لا يتم حفظ ملفات العملاء الحساسة تلقائياً في المتصفح.
          </span>
        </div>
      )}

      {/* Action Error Alert */}
      {actionError && (
        <div
          data-testid="attachments-error-banner"
          className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-[11px] flex items-start justify-between gap-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-rose-500 hover:text-rose-800"
            aria-label="إغلاق التنبيه"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Action Success Alert */}
      {actionSuccess && (
        <div
          data-testid="attachments-success-banner"
          className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Pre-Upload Local Preview & Confirmation Card */}
      {pendingFile && (
        <div
          data-testid="attachment-preupload-card"
          className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2.5"
        >
          <div className="flex items-start gap-3">
            {pendingPreviewUrl ? (
              <img
                src={pendingPreviewUrl}
                alt={pendingFile.name}
                className="w-16 h-16 rounded-lg object-cover border border-stone-200 shrink-0 bg-white"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg border border-stone-200 bg-white flex flex-col items-center justify-center text-rose-700 shrink-0">
                <FileText className="w-6 h-6" />
                <span className="text-[10px] font-bold mt-0.5">PDF</span>
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-bold text-stone-900 text-xs truncate">{pendingFile.name}</div>
              <div className="flex items-center gap-2 text-[11px] text-stone-600 flex-wrap">
                <span>{getTypeLabel(pendingFile.type)}</span>
                <span>•</span>
                <span>{formatFileSizeArabic(pendingFile.size)}</span>
                <span>•</span>
                <span className="text-amber-800 font-medium">بانتظار تأكيد الرفع</span>
              </div>
            </div>

            {!isUploading && (
              <button
                type="button"
                onClick={clearPendingFile}
                className="p-1 text-stone-400 hover:text-stone-700 rounded-lg"
                aria-label="إلغاء الملف المحدد"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {isUploading ? (
            <div className="space-y-1.5" data-testid="attachment-upload-progress">
              <div className="flex items-center justify-between text-[11px] text-stone-700 font-medium">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
                  <span>{uploadStage ? STAGE_LABELS_AR[uploadStage] : 'جاري الرفع...'}</span>
                </span>
                <span className="font-mono font-bold text-emerald-800">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-700 transition-all duration-150"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelActiveUpload}
                  className="text-[11px] text-rose-700 hover:underline font-medium"
                >
                  إلغاء الرفع
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={clearPendingFile}
                className="px-2.5 py-1 rounded-lg text-[11px] text-stone-600 hover:bg-stone-200 font-medium"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="confirm-upload-button"
                onClick={() => void handleStartUpload()}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-700 text-white hover:bg-emerald-800"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>تأكيد ورفع المرفق</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Attachments List */}
      {isLoadingList ? (
        <div className="p-4 text-center text-stone-500 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
          <span>جاري تحميل مرفقات اللقاء...</span>
        </div>
      ) : listError ? (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
          {listError}
        </div>
      ) : attachments.length === 0 ? (
        <div className="p-4 text-center bg-stone-50 rounded-xl border border-dashed border-stone-200 text-stone-500 text-xs space-y-1">
          <p>لا توجد مرفقات مرفوعة لهذا اللقاء بعد.</p>
          <p className="text-[10px] text-stone-400">
            الصيغ المدعومة: JPEG، PNG، WebP، PDF (الحد الأقصى 10 ميجابايت لكل ملف).
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="attachments-list">
          {attachments.map((att) => {
            const isImg = isImageMimeType(att.contentType);
            const isBusy = loadingUrlForId === att.id || deletingId === att.id;
            const isB2DeletedPendingCleanup = att.deleteStatus === 'b2_deleted';
            const isDeleteFailed = att.deleteStatus === 'delete_failed';
            const isDeletingInProgress = att.deleteStatus === 'deleting';
            const isRecoverableDelete = isB2DeletedPendingCleanup || isDeleteFailed || isDeletingInProgress;
            return (
              <div
                key={att.id}
                data-testid={`attachment-row-${att.id}`}
                className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-colors ${
                  isRecoverableDelete
                    ? 'border-amber-300 bg-amber-50/40'
                    : 'border-stone-200 bg-white hover:border-stone-300'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      isImg
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {isImg ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>

                  <div className="min-w-0">
                    <div className="font-bold text-stone-900 text-xs truncate">{att.fileName}</div>
                    <div className="flex items-center gap-2 text-[10px] text-stone-500 flex-wrap mt-0.5">
                      <span>{getTypeLabel(att.contentType)}</span>
                      <span>•</span>
                      <span>{formatFileSizeArabic(att.sizeBytes)}</span>
                      <span>•</span>
                      <span>{formatArabicDate(att.createdAt)}</span>
                      {isB2DeletedPendingCleanup ? (
                        <span className="text-amber-800 font-semibold">
                          • أُزيل من السحابة وبانتظار إكمال حذف السجل
                        </span>
                      ) : isDeleteFailed || isDeletingInProgress ? (
                        <span className="text-rose-700 font-semibold">
                          • تعذر إكمال الحذف — أعد المحاولة
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">• مؤمن</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleOpenViewer(att)}
                    disabled={!isOnline || isBusy || isB2DeletedPendingCleanup}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-50"
                    title="عرض المرفق"
                  >
                    {loadingUrlForId === att.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Eye className="w-3 h-3" />
                    )}
                    <span>عرض</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDownloadAttachment(att)}
                    disabled={!isOnline || isBusy || isB2DeletedPendingCleanup}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-50"
                    title="تنزيل المرفق"
                  >
                    <Download className="w-3 h-3" />
                    <span>تنزيل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setConfirmDeleteItem(att);
                    }}
                    disabled={!isOnline || isBusy}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-50 ${
                      isRecoverableDelete
                        ? 'bg-rose-700 text-white hover:bg-rose-800'
                        : 'text-rose-700 hover:bg-rose-50'
                    }`}
                    title={isRecoverableDelete ? 'إكمال حذف المرفق' : 'حذف المرفق'}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{isRecoverableDelete ? 'إكمال الحذف' : 'حذف'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteItem && (
        <div
          data-testid="attachment-delete-confirm-modal"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-4 border border-stone-200 space-y-3">
            <div className="flex items-center gap-2 text-rose-800">
              <Trash2 className="w-5 h-5" />
              <h4 className="font-heading font-bold text-sm">تأكيد حذف المرفق</h4>
            </div>
            <p className="text-xs text-stone-700 leading-relaxed">
              هل أنت متأكد من حذف الملف{' '}
              <strong className="text-stone-900">{confirmDeleteItem.fileName}</strong>؟ سيتم حذفه
              نهائياً من سجل اللقاء ومن التخزين السحابي الخاص.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteItem(null)}
                disabled={deletingId === confirmDeleteItem.id}
                className="px-3 py-1.5 rounded-xl text-xs text-stone-600 hover:bg-stone-100 font-medium"
              >
                إلغاء
              </button>
              <button
                type="button"
                data-testid="confirm-delete-attachment-btn"
                onClick={() => void handleConfirmDelete()}
                disabled={deletingId === confirmDeleteItem.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-60"
              >
                {deletingId === confirmDeleteItem.id && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>تأكيد الحذف</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Lightbox / PDF Viewer Modal */}
      {viewerState && (
        <div
          data-testid="attachment-viewer-modal"
          className="fixed inset-0 z-70 bg-stone-950/85 flex items-center justify-center p-3 sm:p-6"
          onClick={closeViewer}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-2 bg-stone-50">
              <div className="min-w-0">
                <h4 className="font-heading font-bold text-sm text-stone-900 truncate">
                  {viewerState.attachment.fileName}
                </h4>
                <p className="text-[11px] text-stone-500">
                  {getTypeLabel(viewerState.attachment.contentType)} •{' '}
                  {formatFileSizeArabic(viewerState.attachment.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                {!viewerState.usedRelayFallback && (
                  <button
                    type="button"
                    onClick={() => void handleOpenViewerViaRelay(viewerState.attachment)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-stone-200 hover:bg-stone-300 text-stone-800"
                    title="عرض الملف عبر خادم التطبيق إذا حظر المتصفح الرابط المباشر"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>عرض بديل</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleOpenViewer(viewerState.attachment, true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-stone-200 hover:bg-stone-300 text-stone-800"
                  title="تجديد الرابط المؤقت"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>تحديث الرابط</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadAttachment(viewerState.attachment)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  <Download className="w-3 h-3" />
                  <span>تنزيل</span>
                </button>
                <button
                  type="button"
                  onClick={closeViewer}
                  className="p-1.5 text-stone-500 hover:text-stone-900 rounded-lg"
                  aria-label="إغلاق المعاينة"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-stone-900 flex items-center justify-center p-4 min-h-[300px]">
              {viewerState.loadFailed ? (
                <div className="bg-white rounded-xl p-5 max-w-sm text-center space-y-3">
                  <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
                  <p className="text-xs text-stone-800 font-semibold">
                    تعذر عرض الملف. قد تكون صلاحية الرابط المؤقت قد انتهت.
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleOpenViewer(viewerState.attachment, true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>تحديث رابط العرض</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenViewerViaRelay(viewerState.attachment)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-800 text-white text-xs font-semibold hover:bg-stone-900"
                    >
                      <span>عرض عبر الخادم</span>
                    </button>
                  </div>
                </div>
              ) : isImageMimeType(viewerState.attachment.contentType) ? (
                <img
                  src={viewerState.url}
                  alt={viewerState.attachment.fileName}
                  onError={() => {
                    if (!viewerState.usedRelayFallback && isOnline) {
                      void handleOpenViewerViaRelay(viewerState.attachment);
                    } else {
                      setViewerState((prev) => (prev ? { ...prev, loadFailed: true } : null));
                    }
                  }}
                  className="max-h-[72vh] max-w-full object-contain rounded-lg shadow-lg"
                />
              ) : (
                <iframe
                  title={viewerState.attachment.fileName}
                  src={viewerState.url}
                  className="w-full h-[70vh] bg-white rounded-lg"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
