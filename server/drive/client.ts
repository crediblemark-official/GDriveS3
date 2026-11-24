const FOLDER_NAME = "G3 Storage";
const SUBFOLDER_CACHE_TTL_MS = 5 * 60 * 1000;

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface AccountDriveInfo {
  email: string;
  limit: number;
  usage: number;
  folderId: string;
}

export class DriveClient {
  static async getAccountInfo(accessToken: string): Promise<AccountDriveInfo> {
    // 1. Fetch about & storage quota
    const aboutRes = await fetch(
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

    // 2. Ensure folder "G3 Storage" exists
    const folderId = await this.ensureFolder(accessToken);

    return { email, limit, usage, folderId };
  }

  static async ensureFolder(accessToken: string): Promise<string> {
    const q = `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listRes = await fetch(
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
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
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
    const listRes = await fetch(
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

    // Buat subfolder untuk bucket di dalam folder induk G3 Storage
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
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

  static async uploadStream(
    accessToken: string,
    folderId: string,
    name: string,
    contentType: string,
    stream: ReadableStream
  ): Promise<string> {
    // 1. Inisiasi Resumable Upload
    const initRes = await fetch(
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

    return fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&acknowledgeAbuse=true`,
      { headers }
    );
  }

  static async deleteFile(accessToken: string, fileId: string): Promise<void> {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  static async copyFile(
    accessToken: string,
    sourceFileId: string,
    name: string,
    folderId?: string
  ): Promise<string> {
    const res = await fetch(
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
