<template>
  <div class="space-y-0">
    <!-- Teleport primary actions into Sticky Top Header -->
    <Teleport to="#header-actions">
      <button
        @click="showCreateModal = true"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-2xs"
      >
        <AppIcon name="plus" class="w-3.5 h-3.5" />
        <span>Buat Key</span>
      </button>
    </Teleport>

    <!-- Keys Table (Swiss Hairline Docked) -->
    <div class="bg-surface border-b border-subtle overflow-x-auto">
      <table class="w-full text-left text-sm border-collapse">
        <thead class="bg-canvas border-b border-subtle text-muted font-mono text-[11px] uppercase tracking-wider">
          <tr>
            <th class="py-3 px-4 sm:px-6 font-semibold">Access Key ID & Label</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden md:table-cell">Label</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden sm:table-cell">Dibuat Pada</th>
            <th class="py-3 px-4 sm:px-6 font-semibold text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="k in keys" :key="k.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-3 px-4 sm:px-6 align-middle">
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-sm text-primary tracking-wide">{{ k.accessKeyId }}</span>
                <button
                  @click="copyKey(k.accessKeyId)"
                  title="Salin Access Key ID"
                  aria-label="Salin Access Key ID"
                  class="p-1 rounded-md text-muted hover:text-primary hover:bg-surface-raised hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                >
                  <AppIcon name="copy" class="w-3.5 h-3.5" />
                </button>
              </div>
              <div class="text-[11px] text-muted font-mono flex items-center gap-1.5 mt-0.5 truncate">
                <span>Label: {{ k.label }}</span>
                <span class="sm:hidden">&bull;</span>
                <span class="sm:hidden">{{ new Date(k.createdAt).toLocaleDateString() }}</span>
              </div>
            </td>
            <td class="py-3 px-4 sm:px-6 text-xs text-secondary hidden md:table-cell align-middle">
              {{ k.label }}
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-muted hidden sm:table-cell align-middle">
              {{ new Date(k.createdAt).toLocaleDateString() }}
            </td>
            <td class="py-3 px-4 sm:px-6 text-right align-middle">
              <button
                @click="deleteKey(k.id, k.accessKeyId)"
                aria-label="Hapus Access Key"
                title="Hapus Access Key"
                class="p-2 rounded-lg text-secondary hover:text-danger hover:bg-danger-bg hover:scale-[1.05] active:scale-[0.95] transition-all inline-flex items-center"
              >
                <AppIcon name="trash" class="w-4 h-4" />
              </button>
            </td>
          </tr>

          <!-- Dignified Empty State -->
          <tr v-if="keys.length === 0">
            <td colspan="4" class="py-16 text-center">
              <div class="max-w-xs mx-auto space-y-3">
                <div class="w-10 h-10 rounded-xl bg-surface-raised border border-subtle flex items-center justify-center mx-auto text-muted">
                  <AppIcon name="key" class="w-5 h-5 opacity-60" />
                </div>
                <div class="text-xs text-secondary font-medium">Belum ada Access Key</div>
                <p class="text-[11px] text-muted">Buat kunci akses untuk mengotentikasi klien S3 (AWS CLI, SDK, rclone).</p>
                <button
                  @click="showCreateModal = true"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  <AppIcon name="plus" class="w-3.5 h-3.5" />
                  <span>Buat Key</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Secret Key Alert (Concentric Radius & One-Word Button Rule) -->
    <div
      v-if="createdSecret"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    >
      <div class="bg-surface border border-subtle rounded-2xl p-6 max-w-md w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
        <div class="sm:hidden w-10 h-1 rounded-full bg-border-subtle mx-auto -mt-1 mb-2"></div>

        <div class="flex items-center gap-2 text-success">
          <AppIcon name="check" class="w-5 h-5" />
          <h2 class="font-bold text-base text-primary">Kredensial S3 Dibuat</h2>
        </div>

        <p class="text-xs text-secondary leading-relaxed">
          Simpan Secret Access Key ini sekarang. Kunci rahasia ini <strong>tidak akan ditampilkan lagi</strong> demi keamanan.
        </p>

        <div class="space-y-2.5 font-mono text-xs">
          <!-- Access Key ID Block -->
          <div class="p-3 bg-canvas border border-subtle rounded-xl flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-muted text-[10px] uppercase font-bold tracking-wider">Access Key ID</div>
              <div class="text-primary font-bold mt-0.5 select-all truncate">{{ createdSecret.accessKeyId }}</div>
            </div>
            <button
              @click="copyKey(createdSecret.accessKeyId)"
              title="Salin ID"
              class="p-1.5 rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors shrink-0"
            >
              <AppIcon name="copy" class="w-4 h-4" />
            </button>
          </div>

          <!-- Secret Key Block -->
          <div class="p-3 bg-canvas border border-subtle rounded-xl flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-muted text-[10px] uppercase font-bold tracking-wider">Secret Access Key</div>
              <div class="text-primary font-bold mt-0.5 select-all break-all">{{ createdSecret.secretKey }}</div>
            </div>
            <button
              @click="copySecret(createdSecret.secretKey)"
              title="Salin Secret"
              class="p-1.5 rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors shrink-0"
            >
              <AppIcon name="copy" class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="flex justify-end pt-2 border-t border-subtle">
          <button
            @click="createdSecret = null"
            class="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>

    <!-- Modal Create Key (Concentric Radius) -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    >
      <div class="bg-surface border border-subtle rounded-2xl p-6 max-w-sm w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
        <div class="sm:hidden w-10 h-1 rounded-full bg-border-subtle mx-auto -mt-1 mb-2"></div>

        <div class="flex items-center justify-between">
          <h2 class="font-bold text-base text-primary">Buat Access Key</h2>
          <button
            @click="showCreateModal = false"
            class="p-1 rounded-md text-muted hover:text-primary transition-colors"
          >
            &times;
          </button>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Label / Nama Perangkat</label>
          <input
            v-model="newKeyLabel"
            type="text"
            placeholder="rclone-backup-vps"
            @keyup.enter="createKey"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-subtle">
          <button
            @click="showCreateModal = false"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary transition-colors"
          >
            Batal
          </button>
          <button
            @click="createKey"
            class="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            Buat
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

const toast = useToast();
const keys = ref<any[]>([]);
const showCreateModal = ref(false);
const newKeyLabel = ref("");
const createdSecret = ref<{ accessKeyId: string; secretKey: string } | null>(null);

async function loadKeys() {
  const res = await fetch("/api/keys");
  if (res.ok) keys.value = await res.json();
}

function copyKey(val: string) {
  navigator.clipboard.writeText(val);
  toast.success("Access Key ID disalin ke clipboard");
}

function copySecret(val: string) {
  navigator.clipboard.writeText(val);
  toast.success("Secret Access Key disalin ke clipboard");
}

async function createKey() {
  const res = await fetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: newKeyLabel.value || "Default Key" }),
  });

  if (res.ok) {
    const data = await res.json();
    createdSecret.value = {
      accessKeyId: data.accessKeyId,
      secretKey: data.secretKey,
    };
    showCreateModal.value = false;
    newKeyLabel.value = "";
    loadKeys();
  } else {
    toast.error("Gagal membuat Access Key");
  }
}

async function deleteKey(id: string, accessKeyId: string) {
  if (!confirm(`Hapus Access Key '${accessKeyId}'? Klien yang menggunakan kunci ini tidak akan bisa mengakses S3 lagi.`)) return;
  const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Access Key berhasil dihapus");
    loadKeys();
  }
}

onMounted(() => {
  loadKeys();
});
</script>
