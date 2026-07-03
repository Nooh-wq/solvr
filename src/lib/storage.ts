import { createClient } from "@supabase/supabase-js";

// Server-only: uses the service role key (bypasses Supabase Storage's own
// RLS-style bucket policies), so this must never be imported from a
// client component. Reuses the same Supabase project already provisioned
// for the database (see .env) — no new account/credentials needed.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
// SECURITY-DECISION: SVG is intentionally NOT allowed. These files go into a
// PUBLIC Supabase bucket and are served from the storage origin; an uploaded
// SVG can carry embedded <script>, so opening its public URL directly would
// execute attacker JS (stored-XSS / phishing on your storage domain). Raster
// formats can't do that. Re-enable SVG only behind server-side sanitization
// (e.g. DOMPurify with SVG profile, or force Content-Disposition: attachment).
export const IMAGE_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];

const ensuredBuckets = new Set<string>();

/** Creates the bucket (public — logos/avatars need to render without auth) on first use, idempotently. */
async function ensureBucket(bucket: string) {
  if (ensuredBuckets.has(bucket) || !supabase) return;
  const { error } = await supabase.storage.createBucket(bucket, {
    public: true,
    fileSizeLimit: IMAGE_MAX_BYTES,
    allowedMimeTypes: IMAGE_ALLOWED_MIME,
  });
  // "already exists" is expected on every call after the first — only a
  // real failure should stop the upload.
  if (error && !/already exists/i.test(error.message)) throw error;
  ensuredBuckets.add(bucket);
}

export type UploadImageResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Uploads a single image file to a public Supabase Storage bucket and
 * returns its public URL. Used for tenant branding logos and user profile
 * pictures — both are small, public-by-nature images, unlike ticket
 * attachments (private, tenant-scoped, not yet implemented — see README).
 */
export async function uploadImage(bucket: string, path: string, file: File): Promise<UploadImageResult> {
  if (!supabase) {
    return { ok: false, error: "Image uploads aren't configured (missing Supabase credentials)." };
  }
  if (!IMAGE_ALLOWED_MIME.includes(file.type)) {
    return { ok: false, error: "Unsupported file type — use PNG, JPEG, or WEBP." };
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, error: "File is too large — max 2MB." };
  }

  await ensureBucket(bucket);

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) return { ok: false, error: error.message };

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
