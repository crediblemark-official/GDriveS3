# GDriveS3 User Guide

This guide walks through setting up **Google Cloud OAuth 2.0**, operating the **Admin Web Panel**, connecting **S3 clients**, and deploying GDriveS3 to production with a custom domain and HTTPS.

---

## 1. Google Cloud OAuth 2.0 Setup

GDriveS3 requires OAuth 2.0 credentials so you can link Google Drive accounts into your *storage pool*.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or select an existing one).
2. Navigate to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.
3. Navigate to **APIs & Services → OAuth consent screen**:
   - Choose **External** (or *Internal* if using Google Workspace).
   - Enter an application name (e.g., `GDriveS3`) and support email.
   - Under **Test users**, add the Google email addresses you plan to link to GDriveS3 (required while the app status is *Testing*).
4. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs:
     - Local: `http://localhost:8787/api/accounts/callback`
     - Production (custom domain): `https://panel.yourdomain.com/api/accounts/callback`
5. Copy the **Client ID** and **Client Secret** into your `.env` file at the project root:

```env
GDRIVES3_GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GDRIVES3_GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
GDRIVES3_GOOGLE_REDIRECT_URI="http://localhost:8787/api/accounts/callback"
```

---

## 2. Running & First Login

Start the server from the project root:

```bash
bun install
bun run build:panel
bun run dev
```

Open the Web Panel at `http://localhost:8787` and sign in with the default admin credentials (configurable via `.env`):
- **Email**: `admin@gdrives3.local`
- **Password**: `change-me-now`

> **Important:** Change `GDRIVES3_ADMIN_EMAIL` and `GDRIVES3_ADMIN_PASSWORD` in `.env` (or update the password in the panel) before exposing your server to the public internet.

---

## 3. Web Panel Workflow

### A. Linking Google Drive Accounts
1. Go to **Google Drive Pool**.
2. Click **+ Tautkan Akun** (Link Account) in the top-right header.
3. Grant Google Drive permissions on the Google consent page.
4. Once connected, the account appears in the pool list with its storage usage and daily upload limit (`750 GB/day` per Google account).

### B. Selecting a Balancing Strategy
On the **Dashboard**, choose how new S3 uploads are distributed across linked accounts:
- **Round Robin**: Alternates evenly across all active accounts.
- **Least Used**: Prioritizes the account with the most free storage space.
- **Fill First**: Fills the primary account until full before moving to the next.
- **Hash Key**: Deterministically maps an object *key* to the same account.

### C. Managing Buckets & Files
1. Open **Buckets & File** and click **+ Buat Bucket** (use lowercase letters, numbers, `-`, or `.`).
2. Each bucket automatically gets an isolated subfolder in Google Drive at `GDriveS3/<bucket-name>/`.
3. Click a bucket name to open the **File Manager**:
   - **Upload Files**: Files larger than `10 MB` are automatically uploaded using *sliced multipart upload*.
   - **Share Links**: Click the share icon on any file row to generate an **S3 Presigned URL** (1 hour, 24 hours, or 7 days).

### D. Creating S3 Access Keys
1. Open **S3 Access Keys** and click **+ Buat Key**.
2. Save the **Access Key ID** and **Secret Access Key** — the *Secret Key* is shown only once upon creation.

---

## 4. Connecting S3 Clients

The S3 API listens on port `9000` (`http://localhost:9000`) and uses **Path-Style** addressing (`forcePathStyle: true`).

### AWS CLI
```bash
export AWS_ACCESS_KEY_ID="GDS3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="GDS3_SECRET_KEY"

aws s3 ls --endpoint-url http://localhost:9000
aws s3 cp ./backup.tar.gz s3://my-bucket/backup.tar.gz --endpoint-url http://localhost:9000
```

### rclone (`rclone.conf`)
```ini
[gdrives3]
type = s3
provider = Other
env_auth = false
access_key_id = GDS3_ACCESS_KEY_ID
secret_access_key = GDS3_SECRET_KEY
endpoint = http://localhost:9000
force_path_style = true
```

### Node.js (`@aws-sdk/client-s3`)
```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: "GDS3_ACCESS_KEY_ID",
    secretAccessKey: "GDS3_SECRET_KEY",
  },
  forcePathStyle: true,
});
```

---

## 5. Production Deployment (Domain & HTTPS)

For local use or private networks (LAN/Tailscale), a domain is **optional**. For public internet exposure, use a **domain with HTTPS** to protect Google OAuth callbacks and S3 credentials.

Because GDriveS3 uses **Path-Style** endpoints, you **do not need wildcard DNS** (`*.s3.yourdomain.com`). Simply point two standard subdomains via **Caddy**:

```caddyfile
panel.yourdomain.com {
    reverse_proxy localhost:8787
}

s3.yourdomain.com {
    reverse_proxy localhost:9000
}
```

Then update `.env` for production:
```env
GDRIVES3_GOOGLE_REDIRECT_URI="https://panel.yourdomain.com/api/accounts/callback"
GDRIVES3_S3_PUBLIC_URL="https://s3.yourdomain.com"
```

---

## 6. Database Persistence & Backups (SQLite)

GDriveS3 stores metadata in SQLite (`gdrives3.db` in WAL mode) inside `GDRIVES3_DATA_DIR`. To prevent data loss across redeployments:

1. **Use a persistent directory** outside the build folder (or a *persistent volume* in Docker):
   ```env
   GDRIVES3_DATA_DIR=/var/lib/gdrives3-data
   ```
2. **Preserve your encryption key (`GDRIVES3_ENCRYPTION_KEY`)**: Set `GDRIVES3_ENCRYPTION_KEY` explicitly in `.env` (`openssl rand -base64 32`) or keep `<GDRIVES3_DATA_DIR>/.enckey` backed up. Without this key, stored Google Drive tokens and S3 Secret Keys in `gdrives3.db` cannot be decrypted.
3. **Safe online backup while running**:
   ```bash
   sqlite3 /var/lib/gdrives3-data/gdrives3.db ".backup '/path/backup/gdrives3.db'"
   ```
