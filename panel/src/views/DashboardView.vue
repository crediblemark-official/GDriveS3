<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-primary">Ringkasan Sistem</h1>
        <p class="text-xs text-secondary mt-0.5">Pantauan pool penyimpanan Google Drive dan trafik S3</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-success-bg text-success border border-success-border">
          <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
          Aktif (:9000)
        </span>
      </div>
    </div>

    <!-- Bento Grid Metrics -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <!-- Card 1: Total Kapasitas Pool -->
      <div class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between text-secondary mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider">Kapasitas Pool Drive</span>
            <AppIcon name="database" class="w-4 h-4 text-muted" />
          </div>
          <div class="text-2xl font-bold font-mono tracking-tight text-primary">
            {{ formatBytes(stats.totalStorageUsage) }}
          </div>
          <div class="text-xs text-muted font-mono mt-1">
            dari total {{ formatBytes(stats.totalStorageLimit) }} terhubung
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-subtle">
          <div class="w-full h-2 bg-canvas rounded-full overflow-hidden border border-subtle">
            <div
              class="h-full bg-brand transition-all duration-500"
              :style="{ width: `${usagePercent}%` }"
            ></div>
          </div>
          <div class="flex justify-between text-[11px] text-muted font-mono mt-1.5">
            <span>{{ usagePercent }}% terpakai</span>
            <span>{{ stats.accountsCount }} akun Google</span>
          </div>
        </div>
      </div>

      <!-- Card 2: Buckets & Objek -->
      <div class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between text-secondary mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider">Objek S3 Tersimpan</span>
            <AppIcon name="folder" class="w-4 h-4 text-muted" />
          </div>
          <div class="text-2xl font-bold font-mono tracking-tight text-primary">
            {{ stats.objectsCount }}
          </div>
          <div class="text-xs text-muted font-mono mt-1">
            tersebar di {{ stats.bucketsCount }} bucket
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-subtle flex items-center justify-between text-xs">
          <RouterLink to="/buckets" class="text-primary font-medium hover:underline inline-flex items-center gap-1">
            Buka File Manager &rarr;
          </RouterLink>
          <span class="font-mono text-muted">{{ formatBytes(stats.totalObjectBytes) }}</span>
        </div>
      </div>

      <!-- Card 3: Konfigurasi Endpoint S3 -->
      <div class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between text-secondary mb-2">
            <span class="text-xs font-semibold uppercase tracking-wider">Endpoint AWS S3</span>
            <AppIcon name="server" class="w-4 h-4 text-muted" />
          </div>
          <div class="p-2.5 bg-canvas border border-subtle rounded-lg font-mono text-xs text-primary break-all select-all">
            http://localhost:9000
          </div>
        </div>

        <div class="mt-4 pt-4 border-t border-subtle flex items-center justify-between text-xs text-secondary">
          <span>Format Path-Style</span>
          <RouterLink to="/keys" class="text-primary font-medium hover:underline">
            Kredensial SigV4 &rarr;
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- Accounts Pool Overview -->
    <div class="bg-surface border border-subtle rounded-xl shadow-xs overflow-hidden">
      <div class="p-4 border-b border-subtle flex items-center justify-between">
        <div>
          <h2 class="font-bold text-sm text-primary">Pool Akun Google Drive</h2>
          <p class="text-xs text-muted">Akun yang tergabung dalam penyeimbang beban penyimpanan</p>
        </div>
        <RouterLink
          to="/accounts"
          class="px-3 py-1.5 text-xs font-semibold bg-surface-raised hover:bg-surface-raised/80 border border-subtle rounded-lg text-primary transition-colors"
        >
          Kelola Akun
        </RouterLink>
      </div>

      <div class="divide-y divide-subtle">
        <div
          v-for="acc in stats.accounts"
          :key="acc.id"
          class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-canvas border border-subtle flex items-center justify-center font-mono text-xs font-semibold">
              G
            </div>
            <div>
              <div class="font-medium text-primary font-mono text-xs">{{ acc.email }}</div>
              <div class="text-[11px] text-muted">
                Status: <span class="text-success font-medium capitalize">{{ acc.status }}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-6 font-mono text-xs">
            <div>
              <span class="text-muted">Kapasitas: </span>
              <span class="text-primary">{{ formatBytes(acc.storageUsage) }} / {{ formatBytes(acc.storageLimit) }}</span>
            </div>
            <div>
              <span class="text-muted">Upload Hari Ini: </span>
              <span class="text-primary">{{ formatBytes(acc.dailyBytes) }}</span>
            </div>
          </div>
        </div>

        <div v-if="stats.accounts.length === 0" class="p-8 text-center text-xs text-muted">
          Belum ada akun Google Drive yang ditautkan. Hubungkan akun di menu Google Drive Pool.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import AppIcon from "../components/AppIcon.vue";

const stats = ref({
  accountsCount: 0,
  bucketsCount: 0,
  objectsCount: 0,
  totalStorageLimit: 0,
  totalStorageUsage: 0,
  totalObjectBytes: 0,
  accounts: [] as any[],
});

const usagePercent = computed(() => {
  if (stats.value.totalStorageLimit === 0) return 0;
  return Math.min(100, Math.round((stats.value.totalStorageUsage / stats.value.totalStorageLimit) * 100));
});

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function fetchStats() {
  try {
    const res = await fetch("/api/stats");
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch (err) {
    console.error("Gagal memuat stats:", err);
  }
}

onMounted(() => {
  fetchStats();
});
</script>
