import { defineConfig } from "vitepress";

export default defineConfig({
  title: "GDriveS3",
  description: "S3-Compatible Object Storage over Google Drive",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Beranda", link: "/" },
      { text: "Panduan Pengguna", link: "/USER_GUIDE" },
      { text: "Arsitektur", link: "/ARCHITECTURE" },
    ],
    sidebar: [
      {
        text: "Dokumentasi",
        items: [
          { text: "Panduan Pengguna", link: "/USER_GUIDE" },
          { text: "Arsitektur Teknis", link: "/ARCHITECTURE" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
    outline: {
      level: [2, 3],
      label: "Di halaman ini",
    },
    docFooter: {
      prev: "Sebelumnya",
      next: "Berikutnya",
    },
  },
});
