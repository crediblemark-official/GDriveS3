# GDriveS3

> **S3-Compatible Object Storage over Google Drive.**  
> Built with **Bun + ElysiaJS + Drizzle ORM (`bun:sqlite`)**, and a **Vue 3 + Vite + Tailwind CSS v4** Admin Panel.

---

## Key Features

- **S3-Compatible API (`:9000`)**: Supports AWS Signature V4 (`Authorization` header & Presigned URLs), `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`, `PutObject`, `GetObject` (byte-range streaming), `HeadObject`, `CopyObject`, `DeleteObject`, `Multi-Object Delete`, and **S3 Multipart Upload**.
- **Google Drive Storage Pool**: Combine multiple Google Drive accounts into a single storage pool with load-balancing strategies (*Round Robin*, *Least Used*, *Fill First*, *Hash Key*) and clean folder mapping under `GDriveS3/<bucket>/`.
- **Zero Local Object Storage**: Files are streamed directly to Google Drive API v3 via resumable uploads; only metadata is stored in local SQLite (`gdrives3-data/gdrives3.db`).
- **Encrypted at Rest**: OAuth refresh tokens and S3 Secret Access Keys are encrypted in SQLite using **AES-256-GCM**.
- **Admin Web Panel (`:8787`)**: File Manager with virtual folder navigation, file previews, *sliced multipart upload* (>10 MB), optional client-side image optimization, 1-click Presigned URL generator, webhook alerts, dynamic S3 CORS settings, and account quota monitoring.

---

## Directory Structure

```text
.
├── server/                 # Backend (Bun + Elysia + Drizzle ORM)
│   ├── api/                # Panel REST API (auth, accounts, buckets, keys, settings, logs)
│   ├── core/               # Config, AES-256-GCM cipher, CORS, webhook & terminal logger
│   ├── db/                 # SQLite schema & bun:sqlite connection
│   ├── drive/              # Google Drive OAuth2, Resumable Client, & Balancer
│   ├── s3/                 # SigV4 auth, XML serializer, Multipart, & S3 Engine
│   └── index.ts            # Main entrypoint dual listener (:9000 & :8787)
├── panel/                  # Frontend Admin Panel (Vue 3 + Vite + Tailwind v4)
│   └── src/
│       ├── components/     # AppLayout, AppIcon, BottomSheet, Modals, Snippets
│       ├── composables/    # useTheme & useToast
│       ├── lib/            # Formatters & client-side image optimizer
│       └── views/          # Dashboard, Buckets, FileManager, Accounts, Keys, Logs, Settings, Login
├── docs/                   # Documentation & VitePress Live Docs
│   ├── .vitepress/         # VitePress configuration
│   ├── USER_GUIDE.md       # User guide & Google OAuth setup
│   └── ARCHITECTURE.md     # Architecture & cryptography reference
├── tests/                  # Unit & integration tests (bun test)
├── package.json            # Root dependencies & scripts
├── build.ts                # Production build pipeline
└── tsconfig.json           # Strict TypeScript configuration
```

---

## Quick Start

### 1. Installation & Environment Setup
```bash
bun install
cp .env.example .env
```
Configure your **Google OAuth 2.0** credentials in `.env` (`GDRIVES3_GOOGLE_CLIENT_ID`, `GDRIVES3_GOOGLE_CLIENT_SECRET`, `GDRIVES3_GOOGLE_REDIRECT_URI`). See the [User Guide](docs/USER_GUIDE.md) for step-by-step instructions.

### 2. Development Mode
```bash
# Terminal 1: Backend Server (S3 on :9000 & API/Panel on :8787)
bun run dev

# Terminal 2: Vite Panel HMR (on :5173 proxied to :8787)
bun run dev:panel
```

### 3. Production Build
```bash
bun run build
```
The compiled static panel from `panel/dist` is automatically served by Elysia on port `8787` (`http://localhost:8787`).

### 4. Live Documentation (VitePress)
```bash
# Preview documentation locally
bun run docs:dev

# Build static documentation site to docs/.vitepress/dist
bun run docs:build
```

---

## Testing with AWS CLI

After creating a **Bucket** and an **S3 Access Key** in the web panel:

```bash
export AWS_ACCESS_KEY_ID="GDS3..."
export AWS_SECRET_ACCESS_KEY="..."

# Create a bucket
aws s3 mb s3://my-bucket --endpoint-url http://localhost:9000

# Upload a file directly to Google Drive
aws s3 cp ./file.pdf s3://my-bucket/ --endpoint-url http://localhost:9000

# List bucket contents
aws s3 ls s3://my-bucket/ --endpoint-url http://localhost:9000
```

---

## License

Released under the [MIT](LICENSE) license.
