<template>
  <div class="space-y-0">
    <!-- Teleport primary actions into Sticky Top Header -->
    <Teleport to="#header-actions">
      <button
        @click="autoRefresh = !autoRefresh"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-[1.02] active:scale-[0.98]"
        :class="autoRefresh ? 'bg-success-bg text-success border-success-border' : 'bg-surface text-secondary border-subtle hover:bg-surface-raised'"
        title="Auto-refresh tiap 3 detik"
      >
        <span class="w-1.5 h-1.5 rounded-full" :class="autoRefresh ? 'bg-success animate-pulse' : 'bg-muted'"></span>
        <span class="hidden sm:inline">Live</span>
      </button>

      <button
        @click="loadLogs"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-surface-raised border border-subtle text-primary transition-all hover:scale-[1.02] active:scale-[0.98] shadow-2xs"
        title="Muat ulang log"
      >
        <AppIcon name="refresh" class="w-3.5 h-3.5 text-secondary" :class="{ 'animate-spin': loading }" />
        <span class="hidden sm:inline">Muat</span>
      </button>

      <button
        @click="clearAllLogs"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-danger-bg border border-subtle hover:border-danger-border text-secondary hover:text-danger transition-all hover:scale-[1.02] active:scale-[0.98] shadow-2xs"
        title="Bersihkan log memori"
      >
        <AppIcon name="trash" class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">Bersihkan</span>
      </button>
    </Teleport>

    <!-- Filter & Search Bar (Swiss Hairline Docked) -->
    <div class="p-3 sm:px-6 bg-canvas border-b border-subtle flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <!-- Filter Chips -->
      <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <button
          v-for="tab in filterTabs"
          :key="tab.id"
          @click="activeFilter = tab.id"
          class="px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all shrink-0"
          :class="activeFilter === tab.id ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 shadow-2xs' : 'bg-surface border border-subtle text-secondary hover:text-primary'"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Search -->
      <div class="relative flex-1 max-w-xs">
        <AppIcon name="search" class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari path atau pesan..."
          class="w-full pl-8 pr-7 py-1.5 text-xs bg-surface border border-subtle rounded-lg text-primary placeholder-muted focus:outline-none focus:border-border-strong font-mono transition-colors"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-primary"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- Logs Table (Swiss Hairline High-Density) -->
    <div class="bg-surface border-b border-subtle overflow-x-auto">
      <table class="w-full text-left text-xs font-mono border-collapse">
        <thead class="bg-canvas border-b border-subtle text-muted text-[11px] uppercase tracking-wider">
          <tr>
            <th class="py-2.5 px-4 sm:px-6 font-semibold w-24">Waktu</th>
            <th class="py-2.5 px-4 sm:px-6 font-semibold w-24">Layanan</th>
            <th class="py-2.5 px-4 sm:px-6 font-semibold">Aktivitas / Endpoint</th>
            <th class="py-2.5 px-4 sm:px-6 font-semibold w-20 text-right">Status</th>
            <th class="py-2.5 px-4 sm:px-6 font-semibold w-24 text-right hidden sm:table-cell">Durasi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="entry in filteredLogs" :key="entry.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-2.5 px-4 sm:px-6 text-muted align-middle whitespace-nowrap">
              {{ formatTime(entry.timestamp) }}
            </td>
            <td class="py-2.5 px-4 sm:px-6 align-middle">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border"
                :class="serviceBadgeClass(entry.service)"
              >
                {{ entry.service }}
              </span>
            </td>
            <td class="py-2.5 px-4 sm:px-6 align-middle min-w-0">
              <div v-if="entry.method" class="flex items-center gap-2 min-w-0">
                <span class="font-bold shrink-0" :class="methodClass(entry.method)">{{ entry.method }}</span>
                <span class="text-primary truncate max-w-md">{{ entry.path }}</span>
              </div>
              <div v-else class="text-primary truncate max-w-lg">
                {{ entry.message }}
              </div>
            </td>
            <td class="py-2.5 px-4 sm:px-6 text-right align-middle font-bold">
              <span v-if="entry.status" :class="statusClass(entry.status)">{{ entry.status }}</span>
              <span v-else class="text-muted uppercase text-[10px]">{{ entry.level }}</span>
            </td>
            <td class="py-2.5 px-4 sm:px-6 text-right text-muted align-middle hidden sm:table-cell">
              {{ entry.durationMs !== undefined ? `${entry.durationMs.toFixed(1)}ms` : '-' }}
            </td>
          </tr>

          <!-- Dignified Empty State -->
          <tr v-if="filteredLogs.length === 0">
            <td colspan="5" class="py-16 text-center font-sans">
              <div class="max-w-xs mx-auto space-y-2">
                <div class="w-10 h-10 rounded-xl bg-surface-raised border border-subtle flex items-center justify-center mx-auto text-muted">
                  <AppIcon name="terminal" class="w-5 h-5 opacity-60" />
                </div>
                <div class="text-xs text-secondary font-medium">Belum ada catatan aktivitas</div>
                <p class="text-[11px] text-muted">Request S3, REST API, dan event sweeper akan tampil otomatis di sini.</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";

interface LogEntry {
  id: string;
  timestamp: string;
  service: string;
  level: "info" | "success" | "warn" | "error";
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  message?: string;
}

const toast = useToast();
const logs = ref<LogEntry[]>([]);
const loading = ref(false);
const activeFilter = ref("all");
const searchQuery = ref("");
const autoRefresh = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;

const filterTabs = [
  { id: "all", label: "Semua" },
  { id: "s3", label: "S3 API" },
  { id: "api", label: "Panel API" },
  { id: "errors", label: "Error / 4xx-5xx" },
];

const filteredLogs = computed(() => {
  return logs.value.filter((entry) => {
    if (activeFilter.value === "s3" && entry.service !== "s3") return false;
    if (activeFilter.value === "api" && entry.service !== "api") return false;
    if (
      activeFilter.value === "errors" &&
      entry.level !== "error" &&
      entry.level !== "warn" &&
      (!entry.status || entry.status < 400)
    ) {
      return false;
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.trim().toLowerCase();
      const hay = `${entry.method || ""} ${entry.path || ""} ${entry.message || ""} ${entry.service}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
});

function formatTime(iso: string) {
  return new Date(iso).toTimeString().split(" ")[0];
}

function serviceBadgeClass(service: string) {
  if (service === "s3") return "bg-studio-bg text-studio border-studio-border";
  if (service === "api") return "bg-surface-raised text-primary border-subtle";
  if (service === "sweeper") return "bg-warning-bg text-warning border-warning-border";
  return "bg-canvas text-secondary border-subtle";
}

function methodClass(method: string) {
  if (method === "GET") return "text-studio";
  if (method === "POST" || method === "PUT") return "text-success";
  if (method === "DELETE") return "text-danger";
  return "text-secondary";
}

function statusClass(status: number) {
  if (status >= 500) return "text-danger";
  if (status >= 400) return "text-warning";
  return "text-success";
}

async function loadLogs() {
  loading.value = true;
  try {
    const res = await fetch("/api/logs");
    if (res.ok) {
      logs.value = await res.json();
    }
  } finally {
    loading.value = false;
  }
}

async function clearAllLogs() {
  const res = await fetch("/api/logs", { method: "DELETE" });
  if (res.ok) {
    logs.value = [];
    toast.success("Log aktivitas dibersihkan");
  }
}

onMounted(() => {
  loadLogs();
  timer = setInterval(() => {
    if (autoRefresh.value) loadLogs();
  }, 3000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>
