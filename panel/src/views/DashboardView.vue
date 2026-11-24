<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-primary">Ringkasan Sistem</h1>
        <p class="text-xs text-secondary mt-0.5">Pantauan pool penyimpanan Google Drive dan trafik S3</p>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="runGarbageCollection"
          :disabled="isCleaning"
          class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface hover:bg-surface-raised border border-subtle text-primary transition-all flex items-center gap-1.5 active:scale-[0.99]"
        >
          <AppIcon name="refresh" class="w-3.5 h-3.5 text-secondary" :class="{ 'animate-spin': isCleaning }" />
          <span>{{ isCleaning ? "Membersihkan..." : "Garbage Collect" }}</span>
        </button>

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

    <!-- Balancing Strategy & Storage Maintenance Section -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- Strategy Selector -->
      <div class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-sm text-primary flex items-center gap-2">
              <AppIcon name="sliders" class="w-4 h-4 text-secondary" />
              <span>Strategi Penyeimbang Multi-Akun (Balancer)</span>
            </h3>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-brand-subtle text-brand border border-subtle">
              Aktif
            </span>
          </div>
          <p class="text-xs text-secondary leading-relaxed">
            Metode pemilihan akun Google Drive ketika menerima unggahan file S3 baru dari klien.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-subtle">
          <button
            v-for="s in balancingStrategies"
            :key="s.id"
            @click="setBalancingStrategy(s.id)"
            :class="[
              'p-2.5 rounded-lg border text-left transition-all',
              currentStrategy === s.id
                ? 'bg-brand/10 border-brand text-primary ring-1 ring-brand'
                : 'bg-canvas border-subtle hover:bg-surface-raised text-secondary',
            ]"
          >
            <div class="font-mono font-semibold text-xs text-primary">{{ s.label }}</div>
            <div class="text-[10px] text-muted mt-0.5 leading-snug">{{ s.desc }}</div>
          </button>
        </div>
      </div>

      <!-- Storage Garbage Collection Info -->
      <div class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-bold text-sm text-primary flex items-center gap-2">
              <AppIcon name="trash" class="w-4 h-4 text-secondary" />
              <span>Pembersihan Sampah & Sweeper Otomatis</span>
            </h3>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-raised text-muted border border-subtle">
              Tiap 1 Jam
            </span>
          </div>
          <p class="text-xs text-secondary leading-relaxed">
            Menghapus pecahan file <em>multipart upload</em> yang kedaluwarsa atau terputus di Google Drive agar kuota tidak terbuang sia-sia.
          </p>
        </div>

        <div class="p-3 bg-canvas border border-subtle rounded-lg flex items-center justify-between text-xs font-mono">
          <div class="text-muted">
            Status: <span class="text-success font-medium">Sweeper Background Aktif</span>
          </div>
          <button
            @click="runGarbageCollection"
            :disabled="isCleaning"
            class="px-3 py-1.5 bg-brand text-brand-contrast font-semibold text-xs rounded-lg shadow-xs hover:opacity-90 active:scale-[0.99] transition-all flex items-center gap-1.5"
          >
            <AppIcon name="refresh" class="w-3.5 h-3.5" :class="{ 'animate-spin': isCleaning }" />
            <span>{{ isCleaning ? "Memproses..." : "Bersihkan Sekarang" }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modular Integration Code Snippets -->
    <CodeSnippetsCard />

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
import CodeSnippetsCard from "../components/CodeSnippetsCard.vue";
import { useToast } from "../composables/useToast";
import { formatBytes } from "../lib/format";

const toast = useToast();

const stats = ref({
  accountsCount: 0,
  bucketsCount: 0,
  objectsCount: 0,
  totalStorageLimit: 0,
  totalStorageUsage: 0,
  totalObjectBytes: 0,
  accounts: [] as any[],
});

const currentStrategy = ref("round_robin");
const isCleaning = ref(false);

const balancingStrategies = [
  { id: "round_robin", label: "Round Robin", desc: "Bergantian seimbang antar semua akun yang aktif" },
  { id: "least_used", label: "Least Used", desc: "Memprioritaskan akun dengan pemakaian kuota terkecil" },
  { id: "fill_first", label: "Fill First", desc: "Mengisi akun pertama sampai penuh sebelum pindah" },
  { id: "hash", label: "Hash Key", desc: "Konsisten memetakan nama file ke akun yang sama" },
];

const usagePercent = computed(() => {
  if (stats.value.totalStorageLimit === 0) return 0;
  return Math.min(100, Math.round((stats.value.totalStorageUsage / stats.value.totalStorageLimit) * 100));
});

async function fetchStats() {
  try {
    const res = await fetch("/api/stats");
    if (res.ok) {
      stats.value = await res.json();
    }
    const bRes = await fetch("/api/settings/balancing");
    if (bRes.ok) {
      const data = await bRes.json();
      currentStrategy.value = data.strategy || "round_robin";
    }
  } catch (err) {
    console.error("Gagal memuat stats:", err);
  }
}

async function setBalancingStrategy(strategy: string) {
  try {
    const res = await fetch("/api/settings/balancing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy }),
    });
    if (res.ok) {
      currentStrategy.value = strategy;
      toast.success(`Strategi diubah ke: ${strategy}`);
    } else {
      toast.error("Gagal mengubah strategi");
    }
  } catch {
    toast.error("Kesalahan jaringan");
  }
}

async function runGarbageCollection() {
  isCleaning.value = true;
  toast.info("Menjalankan pembersihan sampah multipart...");
  try {
    const res = await fetch("/api/storage/gc", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      toast.success(data.message || "Pembersihan selesai!");
    } else {
      toast.error("Gagal menjalankan garbage collection");
    }
  } catch {
    toast.error("Terjadi kesalahan jaringan");
  } finally {
    isCleaning.value = false;
  }
}

onMounted(() => {
  fetchStats();
});
</script>
