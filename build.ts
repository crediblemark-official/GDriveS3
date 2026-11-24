import { $ } from "bun";

console.log("-----------------------------------------");
console.log("    GDriveS3 Build & Packaging Pipeline  ");
console.log("-----------------------------------------");

// 1. Build Panel Vue 3 SPA
console.log("📦 1. Compiling Vue 3 Panel...");
await $`bun run build:panel`;

// 2. Typecheck
console.log("🔍 2. Verifying TypeScript Types...");
await $`bun run typecheck`;

console.log("\n✅ Panel & Server siap!");
console.log("Untuk menjalankan server: bun run dev");
