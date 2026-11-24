<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between pb-4 border-b border-subtle">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-primary">S3 Access Keys</h1>
        <p class="text-xs text-secondary mt-0.5">Kredensial otentikasi AWS Signature V4 untuk AWS CLI, rclone, dll.</p>
      </div>
      <button
        @click="showCreateModal = true"
        class="px-3.5 py-2 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-xs font-semibold rounded-lg shadow-xs flex items-center gap-2 transition-all"
      >
        <AppIcon name="plus" class="w-4 h-4" />
        <span>Buat Access Key</span>
      </button>
    </div>

    <!-- Keys Table -->
    <div class="bg-surface border border-subtle rounded-xl shadow-xs overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-canvas border-b border-subtle text-secondary font-mono text-xs">
          <tr>
            <th class="py-3 px-4 font-semibold">Access Key ID</th>
            <th class="py-3 px-4 font-semibold">Label</th>
            <th class="py-3 px-4 font-semibold">Dibuat Pada</th>
            <th class="py-3 px-4 font-semibold text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="k in keys" :key="k.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-3 px-4 font-mono font-medium text-primary">{{ k.accessKeyId }}</td>
            <td class="py-3 px-4 text-xs text-secondary">{{ k.label }}</td>
            <td class="py-3 px-4 font-mono text-xs text-muted">{{ new Date(k.createdAt).toLocaleDateString() }}</td>
            <td class="py-3 px-4 text-right">
              <button
                @click="deleteKey(k.id, k.accessKeyId)"
                class="px-2.5 py-1 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-md"
              >
                Hapus
              </button>
            </td>
          </tr>
          <tr v-if="keys.length === 0">
            <td colspan="4" class="py-10 text-center text-xs text-muted">
              Belum ada access key. Buat key untuk mulai menggunakan klien S3.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Secret Key Alert -->
    <div
      v-if="createdSecret"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div class="bg-surface border border-subtle rounded-xl p-6 max-w-md w-full shadow-md space-y-4">
        <div class="flex items-center gap-2 text-success">
          <AppIcon name="check" class="w-5 h-5" />
          <h2 class="font-bold text-base text-primary">Access Key Berhasil Dibuat</h2>
        </div>

        <p class="text-xs text-secondary">
          Simpan Secret Access Key ini sekarang. Kunci rahasia ini <strong>tidak akan ditampilkan lagi</strong>.
        </p>

        <div class="space-y-2 font-mono text-xs">
          <div class="p-2.5 bg-canvas border border-subtle rounded-lg">
            <div class="text-muted text-[10px] uppercase font-bold">Access Key ID</div>
            <div class="text-primary font-bold mt-0.5 select-all">{{ createdSecret.accessKeyId }}</div>
          </div>

          <div class="p-2.5 bg-canvas border border-subtle rounded-lg">
            <div class="text-muted text-[10px] uppercase font-bold">Secret Access Key</div>
            <div class="text-primary font-bold mt-0.5 select-all break-all">{{ createdSecret.secretKey }}</div>
          </div>
        </div>

        <div class="flex justify-end pt-2">
          <button
            @click="createdSecret = null"
            class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90"
          >
            Saya Sudah Menyimpannya
          </button>
        </div>
      </div>
    </div>

    <!-- Modal Create Key -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div class="bg-surface border border-subtle rounded-xl p-6 max-w-sm w-full shadow-md space-y-4">
        <h2 class="font-bold text-base text-primary">Buat S3 Access Key</h2>
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Label / Nama Perangkat</label>
          <input
            v-model="newKeyLabel"
            type="text"
            placeholder="rclone-backup-vps"
            class="w-full px-3 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            @click="showCreateModal = false"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
          >
            Batal
          </button>
          <button
            @click="createKey"
            class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90"
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
  if (!confirm(`Hapus Access Key '${accessKeyId}'?`)) return;
  const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Access Key dihapus");
    loadKeys();
  }
}

onMounted(() => {
  loadKeys();
});
</script>
