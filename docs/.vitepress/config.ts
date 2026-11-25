import { defineConfig } from "vitepress";

export default defineConfig({
  title: "GDriveS3",
  description: "S3-Compatible Object Storage over Google Drive",
  base: "/GDriveS3/",
  cleanUrls: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/GDriveS3/logo.svg" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "User Guide", link: "/USER_GUIDE" },
      { text: "Architecture", link: "/ARCHITECTURE" },
    ],
    sidebar: [
      {
        text: "Documentation",
        items: [
          { text: "User Guide", link: "/USER_GUIDE" },
          { text: "Technical Architecture", link: "/ARCHITECTURE" },
        ],
      },
    ],
    search: {
      provider: "local",
    },
    outline: {
      level: [2, 3],
      label: "On this page",
    },
    docFooter: {
      prev: "Previous",
      next: "Next",
    },
  },
});
