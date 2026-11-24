<template>
  <div class="space-y-0">
    <!-- Teleport primary actions into Sticky Top Header -->
    <Teleport to="#header-actions">
      <button
        @click="connectAccount"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-2xs"
      >
        <AppIcon name="plus" class="w-3.5 h-3.5" />
        <span>Tautkan Akun</span>
      </button>
    </Teleport>

    <!-- Accounts List (Swiss Hairline Docked) -->
    <div class="bg-surface border-b border-subtle divide-y divide-subtle">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="p-5 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-surface-raised/20 transition-colors"
      >
        <div class="flex-1 min-w-0 space-y-2.5">
          <!-- Row 1: Email, Status & Quota Summary -->
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-canvas border border-subtle flex items-center justify-center font-mono text-xs font-bold text-primary shrink-0">
                G
              </div>
              <div class="font-mono text-sm font-bold text-primary truncate">{{ acc.email }}</div>
            </div>

            <div class="flex items-center gap-2">
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-mono rounded-full font-medium border"
                :class="acc.status === 'connected' ? 'bg-success-bg text-success border-success-border' : acc.status === 'revoked' ? 'bg-danger-bg text-danger border-danger-border' : 'bg-warning-bg text-warning border-warning-border'"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :class="acc.status === 'connected' ? 'bg-success' : acc.status === 'revoked' ? 'bg-danger' : 'bg-warning'"
                ></span>
                <span class="capitalize">{{ acc.status }}</span>
              </span>
            </div>
          </div>

          <!-- Quota Hairline Progress Bar -->
          <div class="space-y-1">
            <div class="w-full h-1.5 bg-canvas rounded-full overflow-hidden border border-subtle">
              <div
                class="h-full transition-all duration-500"
                :class="getBarColor(acc.storageUsage, acc.storageLimit)"
                :style="{ width: `${getPercent(acc.storageUsage, acc.storageLimit)}%` }"
              ></div>
            </div>
          </div>

          <!-- Row 2: Secondary Metadata (Single Line with Middle Dots) -->
          <div class="text-[11px] font-mono text-muted flex items-center flex-wrap gap-2">
            <span>Penyimpanan: <strong class="text-secondary font-medium">{{ formatBytes(acc.storageUsage) }}</strong> / {{ formatBytes(acc.storageLimit) }} ({{ getPercent(acc.storageUsage, acc.storageLimit) }}%)</span>
            <span>&bull;</span>
            <span>Upload Hari Ini: <strong class="text-secondary font-medium">{{ formatBytes(acc.dailyBytes) }}</strong> (Maks 750GB)</span>
            <span>&bull;</span>
            <span>Ditautkan: {{ new Date(acc.createdAt).toLocaleDateString() }}</span>
          </div>
        </div>

        <!-- Row Actions (Icon & Compact Tactile Buttons) -->
        <div class="flex items-center justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-subtle">
          <button
            @click="syncAccount(acc.id, acc.email)"
            :disabled="syncingId === acc.id"
            aria-label="Sinkronisasi Kuota"
            title="Sinkronisasi Kuota Google Drive"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-subtle text-secondary hover:text-primary hover:bg-surface-raised rounded-lg hover:scale-[1.01] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            <AppIcon name="refresh" class="w-3.5 h-3.5" :class="{ 'animate-spin': syncingId === acc.id }" />
            <span>{{ syncingId === acc.id ? "Menyinkronkan..." : "Sinkronisasi" }}</span>
          </button>
          <button
            @click="deleteAccount(acc.id, acc.email)"
            aria-label="Putuskan Akun"
            title="Putuskan Akun Google Drive"
            class="px-3 py-1.5 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-lg hover:scale-[1.01] active:scale-[0.98] transition-all"
          >
            Putuskan
          </button>
        </div>
      </div>

      <!-- Dignified Empty State -->
      <div v-if="accounts.length === 0" class="p-16 text-center">
        <div class="max-w-xs mx-auto space-y-3">
          <div class="w-10 h-10 rounded-xl bg-surface-raised border border-subtle flex items-center justify-center mx-auto text-muted">
            <AppIcon name="database" class="w-5 h-5 opacity-60" />
          </div>
          <div class="text-xs text-secondary font-medium">Belum ada akun Google Drive</div>
          <p class="text-[11px] text-muted">Hubungkan akun Google Drive untuk menyediakan kuota penyimpanan bagi S3.</p>
          <button
            @click="connectAccount"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <AppIcon name="plus" class="w-3.5 h-3.5" />
            <span>Tautkan Akun</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modal Petunjuk Setup Google OAuth (Concentric Radius) -->
    <div
      v-if="showOauthHelp"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    >
      <div class="bg-surface border border-subtle rounded-2xl p-6 max-w-lg w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
        <div class="sm:hidden w-10 h-1 rounded-full bg-border-subtle mx-auto -mt-1 mb-2"></div>

        <div class="flex items-center gap-2.5 text-warning">
          <AppIcon name="alert-triangle" class="w-5 h-5" />
          <h2 class="font-bold text-base text-primary">Konfigurasi Google OAuth</h2>
        </div>

        <p class="text-xs text-secondary leading-relaxed">
          GDriveS3 memerlukan <strong>Google OAuth 2.0 Client Credentials</strong> agar dapat mengakses Google Drive API atas izin akun Anda.
        </p>

        <div class="space-y-2 bg-canvas p-3.5 rounded-xl border border-subtle text-xs font-mono">
          <div class="text-muted text-[10px] font-bold uppercase tracking-wider">Langkah Konfigurasi:</div>
          <ol class="list-decimal list-inside space-y-1 text-primary">
            <li>Buka <a href="https://console.cloud.google.com" target="_blank" class="text-studio underline">Google Cloud Console</a>.</li>
            <li>Aktifkan <strong>Google Drive API</strong>.</li>
            <li>Buat OAuth Client ID (Web App) dengan Redirect URI:</li>
            <li class="p-1.5 bg-surface-raised border border-subtle rounded text-[11px] select-all break-all">http://localhost:8787/api/accounts/callback</li>
            <li>Salin kredensial ke file <strong>.env</strong> di root folder:</li>
          </ol>
          <div class="p-2.5 bg-neutral-950 text-neutral-100 rounded-lg text-[11px] select-all">
            GDRIVES3_GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"<br/>
            GDRIVES3_GOOGLE_CLIENT_SECRET="GOCSPX-xxx"<br/>
            GDRIVES3_GOOGLE_REDIRECT_URI="http://localhost:8787/api/accounts/callback"
          </div>
        </div>

        <div class="flex justify-end pt-2 border-t border-subtle">
          <button
            @click="showOauthHelp = false"
            class="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Mengerti
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";
import { formatBytes } from "../lib/format";

const toast = useToast();
const accounts = ref<any[]>([]);
const showOauthHelp = ref(false);
const syncingId = ref<string | null>(null);

function getPercent(usage: number, limit: number) {
  if (!limit || limit === 0) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

function getBarColor(usage: number, limit: number) {
  const p = getPercent(usage, limit);
  if (p >= 90) return "bg-rose-500";
  if (p >= 75) return "bg-amber-500";
  return "bg-neutral-900 dark:bg-white";
}

async function loadAccounts() {
  const res = await fetch("/api/accounts");
  if (res.ok) accounts.value = await res.json();
}

async function syncAccount(id: string, email: string) {
  syncingId.value = id;
  toast.info(`Menyinkronkan kuota ${email}...`);
  try {
    const res = await fetch(`/api/accounts/${id}/sync`, { method: "POST" });
    if (res.ok) {
      toast.success("Kuota akun berhasil disinkronkan");
      await loadAccounts();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal sinkronisasi kuota");
    }
  } catch {
    toast.error("Kesalahan jaringan saat sinkronisasi");
  } finally {
    syncingId.value = null;
  }
}

async function connectAccount() {
  const res = await fetch("/api/accounts/connect");
  if (res.ok) {
    const data = await res.json();
    window.location.href = data.url;
  } else {
    const err = await res.json().catch(() => ({}));
    showOauthHelp.value = true;
    toast.error(err.error || "Gagal menghubungkan Google Drive");
  }
}

async function deleteAccount(id: string, email: string) {
  if (!confirm(`Putuskan akun '${email}' dari pool GDriveS3?`)) return;
  const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Akun berhasil diputuskan");
    loadAccounts();
  }
}

onMounted(() => {
  loadAccounts();
});
</script>
