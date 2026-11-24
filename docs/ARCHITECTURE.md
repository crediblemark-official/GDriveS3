# GDriveS3 Architecture & Technical Reference

GDriveS3 adalah server penyimpanan berbasis **AWS S3-compatible API** yang menggunakan multi-akun **Google Drive** sebagai storage pool backend tak terbatas (*infinite storage pool*). Dibangun menggunakan runtime **Bun**, framework **ElysiaJS**, ORM **Drizzle SQLite**, dan antarmuka manajemen web **Vue 3 + Tailwind CSS v4**.

---

## 1. Arsitektur Dual-Port Server

Sistem menjalankan dua listener port independen dalam satu proses Bun tunggal:

```
                  ┌──────────────────────────────────────────────┐
                  │                 Klien & Pengguna             │
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

1. **Port 9000 (`GDRIVES3_S3_PORT`)**: Listener murni AWS S3 API kompatibel Signature V4.
   - Mendukung `ListBuckets`, `CreateBucket`, `DeleteBucket`, `HeadBucket`
   - Mendukung `PutObject`, `GetObject` (dengan range streaming), `HeadObject`, `DeleteObject`, `CopyObject`
   - Mendukung **S3 Multipart Upload** (`?uploads`, `?uploadId&partNumber`, `?uploadId`)
   - Mendukung **Multi-Object Delete** (`POST /:bucket?delete`)
   - Mendukung **Presigned Query URL** (`?X-Amz-Algorithm=AWS4-HMAC-SHA256&...`)
2. **Port 8787 (`GDRIVES3_PORT`)**: Web Admin Panel SPA & REST API.
   - Manajemen Google Drive Pool (OAuth 2.0 Web flow & token refresh)
   - S3 File Manager dengan folder virtual & breadcrumbs
   - Pembuat S3 Access Keys (SigV4 credentials)
   - Pengaturan strategi load balancing & Garbage Collector pembersih part upload

---

## 2. Struktur Google Drive Folder Mapping

Setiap bucket yang dibuat di GDriveS3 dipetakan langsung menjadi subfolder rapi di dalam folder utama `GDriveS3` pada Google Drive:

```
Google Drive (info.rasyiqi@gmail.com)
└── GDriveS3/
    ├── testos/
    │   ├── halo-dunia.txt
    │   └── dokumen-2026/
    │       └── laporan.pdf
    └── backup-vps/
        └── database.dump.gz
```

Nama file asli dipertahankan sehingga Anda dapat membuka, membagikan, atau mencari file langsung dari antarmuka Google Drive resmi kapan saja.

---

## 3. Strategi Balancing Multi-Akun

Pengguna dapat menautkan lebih dari satu akun Google Drive. Saat file baru diunggah melalui S3 API, `Balancer` memilih akun Drive tujuan berdasarkan strategi yang dipilih:

| Strategi | ID | Deskripsi |
|---|---|---|
| **Round Robin** | `round_robin` | Bergantian merata ke setiap akun Google aktif yang belum mencapai batas harian (750 GB/hari). |
| **Least Used** | `least_used` | Mengalokasikan file ke akun dengan penggunaan kuota terkecil saat ini. |
| **Fill First** | `fill_first` | Mengisi akun utama sampai mendekati batas kuota sebelum beralih ke akun berikutnya. |
| **Hash Key** | `hash` | Melakukan hash deterministik atas nama file sehingga key yang sama selalu masuk ke akun yang sama. |

---

## 4. Keamanan & Kriptografi Data

- **Token at Rest**: Refresh token Google Drive dan Secret Access Key S3 dienkripsi dalam SQLite menggunakan **AES-256-GCM** via Web Crypto API native Bun.
- **SigV4 Constant-Time Verification**: Verifikasi tanda tangan HMAC-SHA256 diverifikasi menggunakan XOR constant-time comparison untuk mencegah *timing attack*.
- **No Foreign Keys DB**: Integritas data dikelola di level aplikasi (Application-Level Integrity) untuk mencegah lock contention dan memudahkan backup SQLite.

---

## 5. Contoh Integrasi Langsung (Show, Don't Tell)

### AWS CLI
```bash
export AWS_ACCESS_KEY_ID="GDS3_YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="GDS3_YOUR_SECRET_KEY"

# List semua bucket
aws s3 ls --endpoint-url http://localhost:9000

# Unggah file
aws s3 cp backup.tar.gz s3://testos/backup.tar.gz --endpoint-url http://localhost:9000

# Sinkronisasi folder lokal ke S3
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

// Unggah
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

# List bucket
response = s3.list_buckets()
for bucket in response['Buckets']:
    print(bucket['Name'])
```
