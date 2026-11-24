# G3 Storage

> **S3-Compatible Object Storage over Google Drive.**  
> Built with **Bun + ElysiaJS + Drizzle ORM (`bun:sqlite`)**, and a **Vue 3 + Vite + Tailwind CSS v4** Admin Panel.

---

## Fitur Utama

- **S3 Compatible API (`:9000`)**: Mendukung AWS Signature V4 (`Authorization` header & Presigned URL), `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`, `PutObject`, `GetObject` (byte-range streaming), `HeadObject`, `CopyObject`, `DeleteObject`, `Multi-Object Delete`, dan **S3 Multipart Upload**.
- **Google Drive Storage Pool**: Gabungkan beberapa akun Google Drive menjadi satu pool penyimpanan dengan strategi penyeimbang (*Round Robin*, *Least Used*, *Fill First*, *Hash Key*) serta pemetaan folder rapi `G3 Storage/<bucket>/`.
- **Zero Local Object Storage**: File di-stream langsung ke Google Drive API v3 secara *resumable*; hanya metadata yang disimpan di SQLite lokal (`g3-data/g3.db`).
- **Keamanan Terenkripsi**: Refresh token OAuth dan Secret Access Key dienkripsi di database dengan **AES-256-GCM**.
- **Admin Web Panel (`:8787`)**: File Manager dengan navigasi folder virtual, pratinjau file, *sliced multipart upload* (>10 MB), generator Presigned URL 1-klik, dan pemantau kuota akun.

---

## Struktur Direktori

```text
.
├── server/                 # Backend (Bun + Elysia + Drizzle ORM)
│   ├── api/                # Panel REST API (auth, accounts, buckets, keys, settings)
│   ├── core/               # Config, AES-256-GCM cipher, & terminal logger
│   ├── db/                 # SQLite schema & bun:sqlite connection
│   ├── drive/              # Google Drive OAuth2, Resumable Client, & Balancer
│   ├── s3/                 # SigV4 auth, XML serializer, Multipart, & S3 Engine
│   └── index.ts            # Main entrypoint dual listener (:9000 & :8787)
├── panel/                  # Frontend Admin Panel (Vue 3 + Vite + Tailwind v4)
│   └── src/
│       ├── components/     # AppLayout, AppIcon, BottomSheet, Modals, Snippets
│       ├── composables/    # useTheme & useToast
│       ├── lib/            # API client & formatters
│       └── views/          # Dashboard, Buckets, FileManager, Accounts, Keys, Login
├── docs/                   # Dokumentasi & VitePress Live Docs
│   ├── .vitepress/         # Konfigurasi VitePress
│   ├── USER_GUIDE.md       # Panduan pengguna & setup Google OAuth
│   └── ARCHITECTURE.md     # Referensi arsitektur & kriptografi
├── tests/                  # Unit & integration tests (bun test)
├── package.json            # Single root dependencies
├── build.ts                # Production build pipeline
└── tsconfig.json           # Strict TypeScript configuration
```

---

## Quick Start

### 1. Instalasi & Konfigurasi Environment
```bash
bun install
cp .env.example .env
```
Atur kredensial **Google OAuth 2.0** di `.env` (`G3_GOOGLE_CLIENT_ID`, `G3_GOOGLE_CLIENT_SECRET`, `G3_GOOGLE_REDIRECT_URI`). Lihat [Panduan Pengguna](docs/USER_GUIDE.md) untuk langkah lengkapnya.

### 2. Menjalankan Mode Development
```bash
# Terminal 1: Backend Server (S3 di :9000 & API/Panel di :8787)
bun run dev

# Terminal 2: Vite Panel HMR (di :5173 dengan proxy ke :8787)
bun run dev:panel
```

### 3. Build Production
```bash
bun run build
```
Panel statis dari `panel/dist` akan otomatis disajikan oleh Elysia pada port `8787` (`http://localhost:8787`).

### 4. Dokumentasi Live (VitePress)
```bash
# Preview dokumentasi secara lokal
bun run docs:dev

# Build situs dokumentasi statis ke docs/.vitepress/dist
bun run docs:build
```

---

## Pengujian via AWS CLI

Setelah membuat **Bucket** dan **S3 Access Key** di web panel:

```bash
export AWS_ACCESS_KEY_ID="G3..."
export AWS_SECRET_ACCESS_KEY="..."

# Buat bucket
aws s3 mb s3://my-bucket --endpoint-url http://localhost:9000

# Unggah file langsung ke Google Drive
aws s3 cp ./file.pdf s3://my-bucket/ --endpoint-url http://localhost:9000

# List isi bucket
aws s3 ls s3://my-bucket/ --endpoint-url http://localhost:9000
```

---

## Lisensi

Dirilis di bawah lisensi [MIT](LICENSE).
