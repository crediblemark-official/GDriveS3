# G3 Storage (Bun + Elysia + Vue 3)

> **S3-Compatible Object Storage over Google Drive.**  
> Backend dibangun dengan **Bun + ElysiaJS + Drizzle ORM**, dan Admin Web Panel dengan **Vue 3 + Vite + Tailwind CSS v4**.

---

## ⚡ Fitur Utama

- **100% S3 Compatible**: Mendukung AWS Signature V4 (Authorization Header & Presigned URL), bucket operations, PutObject, GetObject (dengan byte-range streaming), CopyObject server-side di Google Drive, dan DeleteObject.
- **Google Drive Storage Pool**: Menggabungkan banyak akun Google Drive menjadi satu pool penyimpanan besar dengan algoritma penyeimbang (*round-robin*, *least-used*, *fill-first*, *hash*).
- **Zero Local Object Storage**: File tidak disimpan di disk lokal; byte di-stream langsung ke Google Drive API v3 secara *resumable*. Hanya metadata yang disimpan di SQLite lokal (`bun:sqlite`).
- **Hemat RAM VPS**: Runtime Bun murni dengan idle RAM hanya ~30–40 MB (jauh lebih ringan dibanding Node.js/Go container).
- **Single Root `node_modules`**: Dependensi terpadu di root tanpa bloat folder bersarang.
- **Admin Panel Modern & Anti-Slop**: Dibangun dengan Vue 3 Composition API, Tailwind CSS v4, desain Swiss hairline grid, layered neutrals, sistem vektor SVG `<AppIcon>` (tanpa raw emoji), dan mobile-friendly bottom-sheet drawer.

---

## 🏗️ Struktur Direktori

```
.
├── server/                      # Backend (Bun + Elysia + Drizzle ORM)
│   └── src/
│       ├── core/                # Config & AES-256-GCM token cipher
│       ├── db/                  # SQLite schema & bun:sqlite connection
│       ├── drive/               # Google Drive OAuth2 & Resumable Client
│       ├── s3/                  # SigV4 auth, XML serializer, & S3 Engine
│       ├── api/                 # Panel REST API (Auth, Buckets, Files, Keys)
│       └── index.ts             # Main entrypoint dual listener (:9000 & :8787)
├── panel/                       # Frontend Admin Panel (Vue 3 + Vite + Tailwind v4)
│   └── src/
│       ├── assets/              # Desain token & icon SVG AppIcon
│       ├── components/          # AppLayout, BottomSheet, AppToast
│       ├── views/               # Dashboard, Buckets, FileManager, Accounts, Keys
│       └── main.ts              # Vue entry
├── package.json                 # Single unified dependencies
├── build.ts                     # Build & bundle pipeline
└── tsconfig.json                # Strict TypeScript configuration
```

---

## 🚀 Menjalankan Secara Lokal

### 1. Salin Environment
```bash
cp .env.example .env
```
Isi `G3_GOOGLE_CLIENT_ID` dan `G3_GOOGLE_CLIENT_SECRET` jika ingin menautkan akun Google Drive.

### 2. Jalankan Mode Development
```bash
# Terminal 1: Backend Server (S3 di :9000 & API di :8787)
bun run dev

# Terminal 2: Vite Panel HMR (di :5173 dengan proxy ke :8787)
bun run dev:panel
```

### 3. Build untuk Production
```bash
bun run build
```
Hasil build panel statis akan otomatis disajikan langsung oleh Elysia di port `8787` (`http://localhost:8787`).

---

## 🧪 Pengujian via AWS CLI

Setelah membuat **Bucket** dan **S3 Access Key** di web panel:

```bash
export AWS_ACCESS_KEY_ID="G3..."
export AWS_SECRET_ACCESS_KEY="..."

# Buat bucket via S3 API
aws s3 mb s3://my-bucket --endpoint-url http://localhost:9000

# Upload file langsung ke Google Drive
aws s3 cp ./file.pdf s3://my-bucket/ --endpoint-url http://localhost:9000

# List file
aws s3 ls s3://my-bucket/ --endpoint-url http://localhost:9000
```
