# Panduan Pengguna G3 Storage

Panduan ini menjelaskan cara menyiapkan **Google Cloud OAuth 2.0**, mengoperasikan **Admin Web Panel**, menghubungkan **klien S3**, hingga men-deploy G3 ke server produksi dengan domain dan HTTPS.

---

## 1. Setup Google Cloud OAuth 2.0

G3 membutuhkan kredensial OAuth 2.0 agar Anda bisa menautkan akun Google Drive ke dalam *storage pool*.

1. Buka [Google Cloud Console](https://console.cloud.google.com/) dan buat proyek baru (atau pilih proyek yang sudah ada).
2. Masuk ke **APIs & Services → Library**, cari **Google Drive API**, lalu klik **Enable**.
3. Masuk ke **APIs & Services → OAuth consent screen**:
   - Pilih **External** (atau *Internal* jika memakai Google Workspace).
   - Isi nama aplikasi (misal `G3 Storage`) dan email dukungan.
   - Pada bagian **Test users**, tambahkan alamat email Google yang akan ditautkan ke G3 (wajib jika status aplikasi masih *Testing*).
4. Masuk ke **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs:
     - Lokal: `http://localhost:8787/api/accounts/callback`
     - Produksi (pakai domain): `https://panel.domainmu.com/api/accounts/callback`
5. Salin **Client ID** dan **Client Secret** ke file `.env` di root proyek:

```env
G3_GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
G3_GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
G3_GOOGLE_REDIRECT_URI="http://localhost:8787/api/accounts/callback"
```

---

## 2. Menjalankan & Login Pertama Kali

Jalankan server dari root proyek:

```bash
bun install
bun run build:panel
bun run dev
```

Buka Web Panel di `http://localhost:8787` dan masuk dengan akun admin default (dapat diubah lewat `.env`):
- **Email**: `admin@g3.local`
- **Password**: `change-me-now`

> **Penting:** Segera ubah `G3_ADMIN_EMAIL` dan `G3_ADMIN_PASSWORD` di `.env` sebelum server dibuka ke publik.

---

## 3. Alur Kerja di Web Panel

### A. Menautkan Akun Google Drive
1. Buka menu **Google Drive Pool**.
2. Klik **+ Tautkan Akun** di header kanan atas.
3. Berikan izin akses Google Drive pada halaman login Google.
4. Setelah berhasil, akun akan muncul di daftar beserta pemakaian kuota dan batas upload harian (`750 GB/hari` per akun Google).

### B. Mengatur Strategi Balancer
Pada menu **Ringkasan**, pilih strategi distribusi file untuk setiap unggahan baru:
- **Round Robin**: Membagi unggahan secara bergantian ke semua akun aktif.
- **Least Used**: Memprioritaskan akun dengan pemakaian ruang paling kecil.
- **Fill First**: Mengisi satu akun hingga penuh sebelum berpindah ke akun berikutnya.
- **Hash Key**: Memetakan nama file (*key*) secara deterministik ke akun yang sama.

### C. Mengelola Bucket & File
1. Buka menu **Buckets & File** lalu klik **+ Buat Bucket** (gunakan huruf kecil, angka, `-`, atau `.`).
2. Setiap bucket otomatis dibuatkan folder terisolasi di Google Drive pada `G3 Storage/<nama-bucket>/`.
3. Klik nama bucket untuk membuka **File Manager**:
   - **Unggah File**: File berukuran `> 10 MB` otomatis dipecah menggunakan *sliced multipart upload*.
   - **Bagikan Tautan**: Klik ikon bagikan pada baris file untuk membuat **S3 Presigned URL** (1 jam, 24 jam, atau 7 hari).

### D. Membuat S3 Access Key
1. Buka menu **S3 Access Keys** dan klik **+ Buat Key**.
2. Simpan **Access Key ID** dan **Secret Access Key** yang muncul — *Secret Key* hanya ditampilkan satu kali saat dibuat.

---

## 4. Menghubungkan Klien S3

Endpoint S3 berjalan di port `9000` (`http://localhost:9000`) dan menggunakan format **Path-Style** (`forcePathStyle: true`).

### AWS CLI
```bash
export AWS_ACCESS_KEY_ID="G3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="G3_SECRET_KEY"

aws s3 ls --endpoint-url http://localhost:9000
aws s3 cp ./backup.tar.gz s3://my-bucket/backup.tar.gz --endpoint-url http://localhost:9000
```

### rclone (`rclone.conf`)
```ini
[g3]
type = s3
provider = Other
env_auth = false
access_key_id = G3_ACCESS_KEY_ID
secret_access_key = G3_SECRET_KEY
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
    accessKeyId: "G3_ACCESS_KEY_ID",
    secretAccessKey: "G3_SECRET_KEY",
  },
  forcePathStyle: true,
});
```

---

## 5. Deploy Produksi (Domain & HTTPS)

Untuk pemakaian lokal atau jaringan internal (LAN/Tailscale), domain **tidak wajib**. Namun untuk akses publik lewat internet, disarankan memakai **domain + HTTPS** agar Google OAuth dan kredensial S3 aman.

Karena G3 memakai **Path-Style**, Anda **tidak butuh wildcard DNS** (`*.s3.domainmu.com`). Cukup siapkan 2 subdomain biasa dengan **Caddy**:

```caddyfile
panel.domainmu.com {
    reverse_proxy localhost:8787
}

s3.domainmu.com {
    reverse_proxy localhost:9000
}
```

Lalu perbarui `.env` untuk produksi:
```env
G3_GOOGLE_REDIRECT_URI="https://panel.domainmu.com/api/accounts/callback"
```
