<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between pb-4 border-b border-subtle">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-primary">Pool Akun Google Drive</h1>
        <p class="text-xs text-secondary mt-0.5">Kelola akun Google yang menjadi backend penyimpanan objek</p>
      </div>
      <button
        @click="connectAccount"
        class="px-3.5 py-2 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-xs font-semibold rounded-lg shadow-xs flex items-center gap-2 transition-all"
      >
        <AppIcon name="plus" class="w-4 h-4" />
        <span>Tautkan Akun Google</span>
      </button>
    </div>

    <!-- Accounts Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="acc in accounts"
        :key="acc.id"
        class="bg-surface border border-subtle rounded-xl p-5 shadow-xs flex flex-col justify-between"
      >
        <div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-canvas border border-subtle flex items-center justify-center font-mono text-xs font-bold text-primary">
                G
              </div>
              <div>
                <div class="font-mono text-xs font-bold text-primary">{{ acc.email }}</div>
                <div class="text-[11px] text-muted">Ditautkan: {{ new Date(acc.createdAt).toLocaleDateString() }}</div>
              </div>
            </div>
            <span class="px-2 py-0.5 text-[11px] font-mono rounded-full font-medium bg-success-bg text-success border border-success-border">
              {{ acc.status }}
            </span>
          </div>

          <!-- Quota bar -->
          <div class="mt-4 space-y-1.5">
            <div class="flex justify-between text-xs font-mono">
              <span class="text-secondary">Penyimpanan Terpakai:</span>
              <span class="text-primary font-medium">{{ formatBytes(acc.storageUsage) }} / {{ formatBytes(acc.storageLimit) }}</span>
            </div>
            <div class="w-full h-2 bg-canvas rounded-full overflow-hidden border border-subtle">
              <div
                class="h-full bg-brand transition-all duration-300"
                :style="{ width: `${getPercent(acc.storageUsage, acc.storageLimit)}%` }"
              ></div>
            </div>
          </div>

          <!-- Daily Upload Limit (750GB cap) -->
          <div class="mt-3 p-2.5 bg-canvas rounded-lg border border-subtle text-xs font-mono flex justify-between items-center">
            <span class="text-muted">Upload Hari Ini (Maks 750GB):</span>
            <span class="text-primary font-medium">{{ formatBytes(acc.dailyBytes) }}</span>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-subtle flex justify-end">
          <button
            @click="deleteAccount(acc.id, acc.email)"
            class="px-3 py-1.5 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-lg transition-colors"
          >
            Putuskan Akun
          </button>
        </div>
      </div>

      <div v-if="accounts.length === 0" class="col-span-2 p-12 text-center bg-surface border border-subtle rounded-xl text-xs text-muted">
        Belum ada akun Google Drive yang ditautkan. Klik tombol "Tautkan Akun Google" di atas untuk menambahkan kuota.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";

const toast = useToast();
const accounts = ref<any[]>([]);

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getPercent(usage: number, limit: number) {
  if (!limit || limit === 0) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

async function loadAccounts() {
  const res = await fetch("/api/accounts");
  if (res.ok) accounts.value = await res.json();
}

async function connectAccount() {
  const res = await fetch("/api/accounts/connect");
  if (res.ok) {
    const data = await res.json();
    window.location.href = data.url;
  } else {
    const err = await res.json();
    toast.error(err.error || "Gagal menghubungkan Google Drive");
  }
}

async function deleteAccount(id: string, email: string) {
  if (!confirm(`Putuskan akun '${email}' dari pool G3?`)) return;
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
