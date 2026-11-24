<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between pb-4 border-b border-subtle">
      <div>
        <h1 class="text-xl font-bold tracking-tight text-primary">S3 Buckets</h1>
        <p class="text-xs text-secondary mt-0.5">Daftar namespace penyimpanan objek</p>
      </div>
      <button
        @click="showCreateModal = true"
        class="px-3.5 py-2 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-xs font-semibold rounded-lg shadow-xs flex items-center gap-2 transition-all"
      >
        <AppIcon name="plus" class="w-4 h-4" />
        <span>Buat Bucket</span>
      </button>
    </div>

    <!-- Buckets Table -->
    <div class="bg-surface border border-subtle rounded-xl shadow-xs overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-canvas border-b border-subtle text-secondary font-mono text-xs">
          <tr>
            <th class="py-3 px-4 font-semibold">Nama Bucket</th>
            <th class="py-3 px-4 font-semibold">Jumlah File</th>
            <th class="py-3 px-4 font-semibold">Total Ukuran</th>
            <th class="py-3 px-4 font-semibold">Dibuat Pada</th>
            <th class="py-3 px-4 font-semibold text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="b in buckets" :key="b.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-3 px-4">
              <RouterLink
                :to="`/buckets/${b.id}`"
                class="font-mono font-medium text-primary hover:underline flex items-center gap-2"
              >
                <AppIcon name="folder" class="w-4 h-4 text-brand" />
                <span>{{ b.name }}</span>
              </RouterLink>
              <div class="text-[10px] text-muted font-mono flex items-center gap-1 mt-0.5">
                <span>Folder Drive: G3 Storage/{{ b.name }}/</span>
              </div>
            </td>
            <td class="py-3 px-4 font-mono text-xs text-secondary">{{ b.objectsCount }} file</td>
            <td class="py-3 px-4 font-mono text-xs text-secondary">{{ formatBytes(b.totalSize) }}</td>
            <td class="py-3 px-4 font-mono text-xs text-muted">{{ new Date(b.createdAt).toLocaleDateString() }}</td>
            <td class="py-3 px-4 text-right space-x-2">
              <RouterLink
                :to="`/buckets/${b.id}`"
                class="px-2.5 py-1 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-primary"
              >
                Buka
              </RouterLink>
              <button
                @click="deleteBucket(b.id, b.name)"
                class="px-2.5 py-1 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-md"
              >
                Hapus
              </button>
            </td>
          </tr>
          <tr v-if="buckets.length === 0">
            <td colspan="5" class="py-10 text-center text-xs text-muted">
              Belum ada bucket. Buat bucket pertama untuk mulai menyimpan objek.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Create Bucket -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div class="bg-surface border border-subtle rounded-xl p-6 max-w-sm w-full shadow-md space-y-4">
        <h2 class="font-bold text-base text-primary">Buat Bucket Baru</h2>
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Nama Bucket (DNS Compliant)</label>
          <input
            v-model="newBucketName"
            type="text"
            placeholder="my-cool-bucket"
            class="w-full px-3 py-2 text-sm bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong"
          />
          <p class="text-[11px] text-muted">Hanya huruf kecil, angka, tanda minus (-), dan titik (.).</p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            @click="showCreateModal = false"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
          >
            Batal
          </button>
          <button
            @click="createBucket"
            class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90"
          >
            Simpan
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
const buckets = ref<any[]>([]);
const showCreateModal = ref(false);
const newBucketName = ref("");

async function loadBuckets() {
  const res = await fetch("/api/buckets");
  if (res.ok) buckets.value = await res.json();
}

async function createBucket() {
  if (!newBucketName.value) return;
  const res = await fetch("/api/buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newBucketName.value.trim().toLowerCase() }),
  });

  if (res.ok) {
    toast.success("Bucket berhasil dibuat");
    showCreateModal.value = false;
    newBucketName.value = "";
    loadBuckets();
  } else {
    const err = await res.json();
    toast.error(err.error || "Gagal membuat bucket");
  }
}

async function deleteBucket(id: string, name: string) {
  if (!confirm(`Hapus bucket '${name}'?`)) return;
  const res = await fetch(`/api/buckets/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Bucket dihapus");
    loadBuckets();
  } else {
    const err = await res.json();
    toast.error(err.error || "Gagal menghapus bucket");
  }
}

onMounted(() => {
  loadBuckets();
});
</script>
