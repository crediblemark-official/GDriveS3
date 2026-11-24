---
layout: home

hero:
  name: "GDriveS3"
  text: "Object Storage over Google Drive"
  tagline: Gabungkan banyak akun Google Drive menjadi satu endpoint AWS S3 API yang ringan, terenkripsi, dan siap produksi di Bun.
  actions:
    - theme: brand
      text: Panduan Pengguna
      link: /USER_GUIDE
    - theme: alt
      text: Arsitektur Teknis
      link: /ARCHITECTURE

features:
  - title: Kompatibel AWS S3 & SigV4
    details: Mendukung AWS CLI, rclone, AWS SDK v3, boto3, Presigned URL, dan Multipart Upload di port 9000.
  - title: Multi-Akun Storage Pool
    details: Tautkan banyak akun Google Drive dengan balancer Round Robin, Least Used, Fill First, atau Hash Key.
  - title: Zero Local Object Storage
    details: Byte file di-stream langsung ke Google Drive API v3; disk lokal hanya menyimpan metadata SQLite.
  - title: Terenkripsi AES-256-GCM
    details: Refresh token Google Drive dan S3 Secret Access Key dienkripsi saat disimpan di database.
---
