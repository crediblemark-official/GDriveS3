# GDriveS3 Architecture & Technical Reference

GDriveS3 is an **AWS S3-compatible object storage server** backed by a multi-account **Google Drive** storage pool. It is built on the **Bun** runtime, **ElysiaJS**, **Drizzle ORM (SQLite)**, and a **Vue 3 + Tailwind CSS v4** management panel.

---

## 1. Dual-Port Server Architecture

The server runs two independent HTTP listeners inside a single Bun process:

```text
                  ┌──────────────────────────────────────────────┐
                  │               Clients & Users                │
                  └───────────────┬──────────────┬───────────────┘
                                  │              │
                   AWS S3 Traffic │              │ REST & Panel Traffic
                     (Port :9000) │              │ (Port :8787)
                                  ▼              ▼
                    ┌───────────────────┐  ┌───────────────────┐
                    │ S3 Router & SigV4 │  │ Panel App Router  │
                    │   Interceptor     │  │   & Static SPA    │
                    └─────────┬─────────┘  └─────────┬─────────┘
                              │                      │
                              ▼                      ▼
                    ┌──────────────────────────────────────────┐
                    │            S3 Storage Engine             │
                    └─────────────────────┬────────────────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        │                                   │
                        ▼                                   ▼
          ┌───────────────────────────┐       ┌───────────────────────────┐
          │   Local SQLite Metadata   │       │  Drive Multi-Account Pool │
          │  (Buckets, Keys, Objects) │       │ (OAuth2, Resumable Streams│
          └───────────────────────────┘       └───────────────────────────┘
```

1. **Port 9000 (`GDRIVES3_S3_PORT`)**: Pure AWS S3 API listener with Signature V4 authentication.
   - Supports `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`
   - Supports `PutObject`, `GetObject` (with byte-range streaming), `HeadObject`, `DeleteObject`, `CopyObject`
   - Supports **S3 Multipart Upload** (`?uploads`, `?uploadId&partNumber`, `?uploadId`, `ListParts`, `ListMultipartUploads`)
   - Supports **Multi-Object Delete** (`POST /:bucket?delete`)
   - Supports **Presigned Query URLs** (`?X-Amz-Algorithm=AWS4-HMAC-SHA256&...`) with expiration verification
2. **Port 8787 (`GDRIVES3_PORT`)**: Web Admin Panel SPA & REST API.
   - Google Drive Pool management (OAuth 2.0 Web flow & cached token refresh)
   - S3 File Manager with virtual folders, breadcrumbs, and optional client-side image optimization
   - S3 Access Key management (SigV4 credentials)
   - Load-balancing strategy controls, webhook alerts, dynamic S3 CORS settings, and Multipart Garbage Collector

---

## 2. Google Drive Folder Mapping

Each bucket created in GDriveS3 maps directly to a dedicated subfolder inside the root `GDriveS3` folder on Google Drive:

```text
Google Drive (user@gmail.com)
└── GDriveS3/
    ├── testos/
    │   ├── hello-world.txt
    │   └── docs-2026/
    │       └── report.pdf
    └── backup-vps/
        └── database.dump.gz
```

Original object names are preserved so you can inspect, share, or search files directly from the standard Google Drive UI at any time.

---

## 3. Multi-Account Balancing Strategies

You can link multiple Google Drive accounts to the pool. Whenever a new object is uploaded via the S3 API, `Balancer` selects the target Drive account according to the active strategy:

| Strategy | ID | Description |
|---|---|---|
| **Round Robin** | `round_robin` | Distributes uploads evenly across all active accounts below the 750 GB/day upload limit. |
| **Least Used** | `least_used` | Prioritizes the account with the most remaining free quota. |
| **Fill First** | `fill_first` | Fills the oldest connected account up to its storage limit before moving to the next. |
| **Hash Key** | `hash` | Deterministically hashes the object key so the same key consistently maps to the same account. |

---

## 4. Security & Cryptography

- **Tokens at Rest**: Google Drive refresh tokens and S3 Secret Access Keys are encrypted in SQLite using **AES-256-GCM** via Bun's native Web Crypto API.
- **SigV4 Constant-Time Verification**: HMAC-SHA256 signatures are verified using XOR constant-time comparison to prevent timing attacks, and presigned URLs enforce `X-Amz-Date` + `X-Amz-Expires` expiration.
- **Application-Level Integrity**: Foreign keys are managed at the application layer in SQLite WAL mode with unique `(bucket_id, object_key)` indexing to minimize lock contention and simplify hot backups.

---

## 5. Integration Examples

### AWS CLI
```bash
export AWS_ACCESS_KEY_ID="GDS3_YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="GDS3_YOUR_SECRET_KEY"

# List all buckets
aws s3 ls --endpoint-url http://localhost:9000

# Upload a file
aws s3 cp backup.tar.gz s3://testos/backup.tar.gz --endpoint-url http://localhost:9000

# Sync a local directory to S3
aws s3 sync ./my-photos s3://testos/my-photos --endpoint-url http://localhost:9000
```

### Node.js (AWS SDK v3)
```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "http://localhost:9000",
  region: "us-east-1",
  credentials: {
    accessKeyId: "GDS3_YOUR_ACCESS_KEY_ID",
    secretAccessKey: "GDS3_YOUR_SECRET_KEY",
  },
  forcePathStyle: true,
});

// Upload
await s3.send(new PutObjectCommand({
  Bucket: "testos",
  Key: "data.json",
  Body: JSON.stringify({ hello: "world" }),
  ContentType: "application/json",
}));
```

### Python (Boto3)
```python
import boto3

s3 = boto3.client(
    's3',
    endpoint_url='http://localhost:9000',
    aws_access_key_id='GDS3_YOUR_ACCESS_KEY_ID',
    aws_secret_access_key='GDS3_YOUR_SECRET_KEY',
    region_name='us-east-1'
)

# List buckets
response = s3.list_buckets()
for bucket in response['Buckets']:
    print(bucket['Name'])
```

---

## 6. Transparency, Audit & Known Limitations

- **Drive API Retries & Telemetry**: `DriveClient` automatically retries transient `429` / `5xx` responses with exponential backoff + jitter and exposes request, throttle, retry, and error counters on the Dashboard.
- **Failed-Delete Queue**: Failed Google Drive file deletions are queued in `pending_drive_deletes` and retried hourly (or manually from Settings) rather than failing silently.
- **Drive ↔ SQLite Audit**: The Settings panel provides a pool audit tool to detect objects missing from Google Drive or orphan Drive files consuming quota.
- **Architectural Boundaries**: GDriveS3 is a single-node SQLite + proxy gateway using Path-Style S3 addressing; it is not designed for high-concurrency public CDN traffic, multi-region replication, or S3 object versioning/ACLs.
