"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { PaperclipIcon, CloseIcon } from "@/components/icons";

export type StagedFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; previewUrl: string | null };
type UploadResult = { ok: true; attachment: StagedFile } | { ok: false; error: string };

/**
 * Shared "attach a file to this reply" state, used by the agent, client, and
 * guest composers alike. `upload` is whichever server action actually
 * performs the upload for that caller (uploadTicketAttachment for a
 * real session, uploadGuestAttachment for a token-authenticated guest) —
 * this hook only owns the staging/chip/remove bookkeeping, not who's allowed
 * to upload. Files upload immediately on selection (staged, not yet linked
 * to any message) and show as removable chips; their ids get passed as
 * `attachmentIds` when the reply is actually sent, and the staged list
 * clears after a successful send.
 */
export function useStagedAttachments(upload: (formData: FormData) => Promise<UploadResult>) {
  const { toast } = useToast();
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.set("file", file);
        const result = await upload(formData);
        if (!result.ok) {
          toast({ title: "Couldn't attach file", description: result.error, variant: "error" });
          continue;
        }
        setStaged((prev) => [...prev, result.attachment]);
      }
      setUploading(false);
    },
    [upload, toast]
  );

  const remove = useCallback((id: string) => setStaged((prev) => prev.filter((a) => a.id !== id)), []);
  const reset = useCallback(() => setStaged([]), []);

  return { staged, uploading, addFiles, remove, reset, attachmentIds: staged.map((a) => a.id) };
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function StagedAttachmentChips({ files, onRemove }: { files: StagedFile[]; onRemove: (id: string) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {files.map((f) => (
        <span
          key={f.id}
          className="inline-flex items-center gap-1.5 rounded-lg bg-black/5 pl-2 pr-1 py-1 text-[11px] font-medium max-w-[200px]"
        >
          <PaperclipIcon className="h-3 w-3 shrink-0 text-[var(--color-neutral-500)]" />
          <span className="truncate">{f.fileName}</span>
          <span className="text-[var(--color-neutral-400)] shrink-0">{formatBytes(f.sizeBytes)}</span>
          <button
            type="button"
            onClick={() => onRemove(f.id)}
            aria-label={`Remove ${f.fileName}`}
            className="h-4 w-4 shrink-0 flex items-center justify-center rounded-full hover:bg-black/10 cursor-pointer"
          >
            <CloseIcon className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
