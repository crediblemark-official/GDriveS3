<template>
  <div class="space-y-0">
    <!-- Teleport primary actions into Sticky Top Header -->
    <Teleport to="#header-actions">
      <button
        @click="showCreateModal = true"
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-2xs"
      >
        <AppIcon name="plus" class="w-3.5 h-3.5" />
        <span>Buat Bucket</span>
      </button>
    </Teleport>

    <!-- Buckets Table (Swiss Hairline Docked) -->
    <div class="bg-surface border-b border-subtle overflow-x-auto">
      <table class="w-full text-left text-sm border-collapse">
        <thead class="bg-canvas border-b border-subtle text-muted font-mono text-[11px] uppercase tracking-wider">
          <tr>
            <th class="py-3 px-4 sm:px-6 font-semibold">Nama Bucket & Metadata</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden md:table-cell">Jumlah File</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden md:table-cell">Total Ukuran</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden lg:table-cell">Dibuat Pada</th>
            <th class="py-3 px-4 sm:px-6 font-semibold text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="b in buckets" :key="b.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-3 px-4 sm:px-6 align-middle">
              <RouterLink
                :to="`/buckets/${b.id}`"
                class="font-mono font-semibold text-sm text-primary hover:underline inline-flex items-center gap-2"
              >
                <AppIcon name="folder" class="w-4 h-4 text-secondary shrink-0" />
                <span class="truncate">{{ b.name }}</span>
              </RouterLink>
              <div class="text-[11px] text-muted font-mono flex items-center gap-1.5 mt-0.5 truncate">
                <span>G3 Storage/{{ b.name }}/</span>
                <span class="md:hidden">&bull;</span>
                <span class="md:hidden">{{ b.objectsCount }} file</span>
                <span class="md:hidden">&bull;</span>
                <span class="md:hidden">{{ formatBytes(b.totalSize) }}</span>
              </div>
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-secondary hidden md:table-cell align-middle">
              {{ b.objectsCount }} file
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-secondary hidden md:table-cell align-middle">
              {{ formatBytes(b.totalSize) }}
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-muted hidden lg:table-cell align-middle">
              {{ new Date(b.createdAt).toLocaleDateString() }}
            </td>
            <td class="py-3 px-4 sm:px-6 text-right align-middle">
              <div class="flex items-center justify-end gap-1">
                <RouterLink
                  :to="`/buckets/${b.id}`"
                  aria-label="Buka File Manager"
                  title="Buka File Manager"
                  class="p-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-raised hover:scale-[1.05] active:scale-[0.95] transition-all inline-flex items-center"
                >
                  <AppIcon name="folder" class="w-4 h-4" />
                </RouterLink>
                <button
                  @click="deleteBucket(b.id, b.name)"
                  aria-label="Hapus Bucket"
                  title="Hapus Bucket"
                  class="p-2 rounded-lg text-secondary hover:text-danger hover:bg-danger-bg hover:scale-[1.05] active:scale-[0.95] transition-all inline-flex items-center"
                >
                  <AppIcon name="trash" class="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>

          <!-- Dignified Empty State -->
          <tr v-if="buckets.length === 0">
            <td colspan="5" class="py-16 text-center">
              <div class="max-w-xs mx-auto space-y-3">
                <div class="w-10 h-10 rounded-xl bg-surface-raised border border-subtle flex items-center justify-center mx-auto text-muted">
                  <AppIcon name="folder" class="w-5 h-5 opacity-60" />
                </div>
                <div class="text-xs text-secondary font-medium">Belum ada bucket penyimpanan</div>
                <p class="text-[11px] text-muted">Buat bucket pertama untuk mulai menyimpan dan mengelola objek S3.</p>
                <button
                  @click="showCreateModal = true"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
                >
                  <AppIcon name="plus" class="w-3.5 h-3.5" />
                  <span>Buat Bucket</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Create Bucket (Concentric Radius + Mobile Bottom Sheet) -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    >
      <div class="bg-surface border border-subtle rounded-2xl p-6 max-w-sm w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
        <!-- Mobile drag handle indicator -->
        <div class="sm:hidden w-10 h-1 rounded-full bg-border-subtle mx-auto -mt-1 mb-2"></div>

        <div class="flex items-center justify-between">
          <h2 class="font-bold text-base text-primary">Buat Bucket Baru</h2>
          <button
            @click="showCreateModal = false"
            class="p-1 rounded-md text-muted hover:text-primary transition-colors"
          >
            &times;
          </button>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Nama Bucket (DNS Compliant)</label>
          <input
            v-model="newBucketName"
            type="text"
            placeholder="my-cool-bucket"
            @keyup.enter="createBucket"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
          <p class="text-[11px] text-muted">Hanya huruf kecil, angka, tanda minus (-), dan titik (.).</p>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-subtle">
          <button
            @click="showCreateModal = false"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary transition-colors"
          >
            Batal
          </button>
          <button
            @click="createBucket"
            class="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
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
  if (!confirm(`Hapus bucket '${name}'? Seluruh data objek di dalamnya akan dihapus.`)) return;
  const res = await fetch(`/api/buckets/${id}`, { method: "DELETE" });
  if (res.ok) {
    toast.success("Bucket berhasil dihapus");
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
