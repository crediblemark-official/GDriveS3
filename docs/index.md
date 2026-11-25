---
layout: home

hero:
  name: "GDriveS3"
  text: "Object Storage over Google Drive"
  tagline: Pool multiple Google Drive accounts into a lightweight, encrypted, Bun-powered AWS S3-compatible API endpoint.
  image:
    src: /logo.svg
    alt: GDriveS3
  actions:
    - theme: brand
      text: User Guide
      link: /USER_GUIDE
    - theme: alt
      text: Architecture
      link: /ARCHITECTURE

features:
  - title: AWS S3 & SigV4 Compatible
    details: Works with AWS CLI, rclone, AWS SDK v3, boto3, Presigned URLs, and Multipart Uploads on port 9000.
  - title: Multi-Account Storage Pool
    details: Link multiple Google Drive accounts using Round Robin, Least Used, Fill First, or Hash Key balancing.
  - title: Zero Local Object Storage
    details: Object bytes stream directly to Google Drive API v3; local disk only stores lightweight SQLite metadata.
  - title: Encrypted with AES-256-GCM
    details: Google Drive refresh tokens and S3 Secret Access Keys are encrypted at rest in SQLite.
---
