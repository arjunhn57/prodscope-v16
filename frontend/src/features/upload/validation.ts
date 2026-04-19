export const MAX_APK_BYTES = 200 * 1024 * 1024;
export const APK_MIME = "application/vnd.android.package-archive";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

function hasApkExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".apk");
}

export function validateApk(file: File): ValidationResult {
  if (!hasApkExtension(file.name) && file.type !== APK_MIME) {
    return { ok: false, reason: "APK files only — this build didn't match .apk." };
  }

  if (file.size > MAX_APK_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      reason: `This APK is ${mb}MB. Max accepted size is 200MB.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, reason: "This APK appears to be empty." };
  }

  return { ok: true };
}

export function looksLikeApkFromDataTransfer(dt: DataTransfer): boolean {
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind !== "file") continue;
      if (item.type === APK_MIME) return true;
    }
  }
  if (dt.files && dt.files.length > 0) {
    const f = dt.files[0];
    return hasApkExtension(f.name) || f.type === APK_MIME;
  }
  return true;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}
