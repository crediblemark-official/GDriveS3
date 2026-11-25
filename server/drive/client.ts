const FOLDER_NAME = "GDriveS3";
const SUBFOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface AccountDriveInfo {
  email: string;
  limit: number;
  usage: number;
  folderId: string;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime?: string;
}

export interface DriveTelemetry {
  totalRequests: number;
  rateLimitHits: number;
  retryAttempts: number;
  failedRequests: number;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

const telemetry: DriveTelemetry = {
  totalRequests: 0,
  rateLimitHits: 0,
  retryAttempts: 0,
  failedRequests: 0,
  lastErrorAt: null,
  lastErrorMessage: null,
};

function computeBackoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(10_000, retryAfterSec * 1000);
  }
  const base = Number(process.env.GDRIVES3_DRIVE_RETRY_BASE_MS || 250);
  const jitter = Math.floor(Math.random() * Math.max(10, Math.round(base * 0.4)));
  return base * Math.pow(2, attempt) + jitter;
}

export class DriveClient {
  static getTelemetry(): DriveTelemetry {
    return { ...telemetry };
  }

  static resetTelemetry(): void {
    telemetry.totalRequests = 0;
    telemetry.rateLimitHits = 0;
    telemetry.retryAttempts = 0;
    telemetry.failedRequests = 0;
    telemetry.lastErrorAt = null;
    telemetry.lastErrorMessage = null;
  }

  static async fetchWithRetry(
    url: string,
    init: RequestInit,
    maxRetries: number = 3
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      telemetry.totalRequests++;
      try {
        const res = await fetch(url, init);
        if (res.status === 429) {
          telemetry.rateLimitHits++;
        }
        if (RETRYABLE_STATUSES.has(res.status) && attempt < maxRetries) {
          telemetry.retryAttempts++;
          const waitMs = computeBackoffMs(attempt, res.headers.get("retry-after"));
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (!res.ok && res.status !== 206 && res.status !== 404 && res.status !== 416) {
          telemetry.failedRequests++;
          telemetry.lastErrorAt = new Date().toISOString();
          telemetry.lastErrorMessage = `HTTP ${res.status}`;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          telemetry.retryAttempts++;
          const waitMs = computeBackoffMs(attempt, null);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        telemetry.failedRequests++;
        telemetry.lastErrorAt = new Date().toISOString();
        telemetry.lastErrorMessage = (err as Error)?.message || String(err);
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Drive API request failed");
  }

  static async getAccountInfo(accessToken: string): Promise<AccountDriveInfo> {
    // 1. Fetch about & storage quota
    const aboutRes = await this.fetchWithRetry(
      "https://www.googleapis.com/drive/v3/about?fields=user,storageQuota",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!aboutRes.ok) throw new Error(`Gagal membaca info akun Drive: ${await aboutRes.text()}`);
    const about = (await aboutRes.json()) as {
      user?: { emailAddress: string };
      storageQuota?: { limit?: string; usage?: string };
    };

    const email = about.user?.emailAddress || "unknown@gmail.com";
    const limit = Number(about.storageQuota?.limit || 0);
    const usage = Number(about.storageQuota?.usage || 0);

    // 2. Ensure folder "GDriveS3" exists
    const folderId = await this.ensureFolder(accessToken);

    return { email, limit, usage, folderId };
  }

  static async ensureFolder(accessToken: string): Promise<string> {
    const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listRes = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (listRes.ok) {
      const data = (await listRes.json()) as { files?: { id: string }[] };
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
    }

    // Buat folder baru jika belum ada
    const createRes = await this.fetchWithRetry("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });

    if (!createRes.ok) throw new Error(`Gagal membuat folder ${FOLDER_NAME}: ${await createRes.text()}`);
    const created = (await createRes.json()) as { id: string };
    return created.id;
  }

  private static subfolderCache = new Map<string, { id: string; expiresAt: number }>();

  static async ensureSubfolder(
    accessToken: string,
    subfolderName: string,
    parentFolderId: string
  ): Promise<string> {
    if (!parentFolderId) return "";
    const cacheKey = `${parentFolderId}:${subfolderName}`;
    const cached = this.subfolderCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.id;
    }

    const safeName = escapeDriveQuery(subfolderName);
    const safeParent = escapeDriveQuery(parentFolderId);
    const q = `name = '${safeName}' and '${safeParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listRes = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (listRes.ok) {
      const data = (await listRes.json()) as { files?: { id: string }[] };
      if (data.files && data.files.length > 0) {
        this.subfolderCache.set(cacheKey, {
          id: data.files[0].id,
          expiresAt: Date.now() + SUBFOLDER_CACHE_TTL_MS,
        });
        return data.files[0].id;
      }
    }

    // Buat subfolder untuk bucket di dalam folder induk GDriveS3
    const createRes = await this.fetchWithRetry("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: subfolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Gagal membuat folder bucket ${subfolderName}: ${await createRes.text()}`);
    }
    const created = (await createRes.json()) as { id: string };
    this.subfolderCache.set(cacheKey, {
      id: created.id,
      expiresAt: Date.now() + SUBFOLDER_CACHE_TTL_MS,
    });
    return created.id;
  }

  static async listFolderFiles(
    accessToken: string,
    parentFolderId: string
  ): Promise<DriveFileItem[]> {
    const results: DriveFileItem[] = [];
    let pageToken = "";
    const safeParent = escapeDriveQuery(parentFolderId);
    const q = `'${safeParent}' in parents and trashed = false`;

    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", q);
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime)");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await this.fetchWithRetry(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Gagal membaca isi folder Drive: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        nextPageToken?: string;
        files?: { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string }[];
      };
      for (const f of data.files || []) {
        results.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          modifiedTime: f.modifiedTime,
        });
      }
      pageToken = data.nextPageToken || "";
    } while (pageToken);

    return results;
  }

  static async uploadStream(
    accessToken: string,
    folderId: string,
    name: string,
    contentType: string,
    stream: ReadableStream
  ): Promise<string> {
    // 1. Inisiasi Resumable Upload (dengan retry/backoff)
    const initRes = await this.fetchWithRetry(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          name,
          parents: folderId ? [folderId] : [],
        }),
      }
    );

    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      throw new Error(`Gagal menginisiasi upload resumable Drive: ${await initRes.text()}`);
    }

    // 2. Pipe Stream langsung ke Google Drive
    telemetry.totalRequests++;
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType || "application/octet-stream",
      },
      body: stream,
      // @ts-expect-error Bun supports duplex streaming on native fetch
      duplex: "half",
    });

    if (!uploadRes.ok) {
      if (uploadRes.status === 429) telemetry.rateLimitHits++;
      telemetry.failedRequests++;
      telemetry.lastErrorAt = new Date().toISOString();
      telemetry.lastErrorMessage = `Upload HTTP ${uploadRes.status}`;
      throw new Error(`Upload stream ke Drive gagal: ${await uploadRes.text()}`);
    }

    const result = (await uploadRes.json()) as { id: string };
    return result.id;
  }

  static async downloadStream(
    accessToken: string,
    fileId: string,
    rangeHeader?: string | null
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    return this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`,
      { headers }
    );
  }

  static async deleteFile(accessToken: string, fileId: string): Promise<void> {
    const res = await this.fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Gagal menghapus file Drive (${res.status}): ${await res.text()}`);
    }
  }

  static async copyFile(
    accessToken: string,
    sourceFileId: string,
    name: string,
    folderId?: string
  ): Promise<string> {
    const res = await this.fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files/${sourceFileId}/copy?fields=id`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          parents: folderId ? [folderId] : [],
        }),
      }
    );

    if (!res.ok) throw new Error(`Copy file server-side gagal: ${await res.text()}`);
    const data = (await res.json()) as { id: string };
    return data.id;
  }
}
