<template>
  <div class="space-y-6">
    <!-- Header with Breadcrumbs -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
      <div>
        <div class="flex items-center gap-2 text-xs text-muted font-mono mb-1">
          <RouterLink to="/buckets" class="hover:underline">Buckets</RouterLink>
          <span>/</span>
          <span class="text-primary font-semibold">{{ bucketName }}</span>
        </div>
        <h1 class="text-xl font-bold tracking-tight text-primary">File Manager</h1>
      </div>

      <div class="flex items-center gap-2">
        <label
          class="px-3.5 py-2 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-xs font-semibold rounded-lg shadow-xs flex items-center gap-2 cursor-pointer transition-all"
        >
          <AppIcon name="upload" class="w-4 h-4" />
          <span>{{ uploading ? "Mengunggah..." : "Unggah File" }}</span>
          <input type="file" @change="uploadFile" :disabled="uploading" class="hidden" />
        </label>
      </div>
    </div>

    <!-- Objects Table -->
    <div class="bg-surface border border-subtle rounded-xl shadow-xs overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-canvas border-b border-subtle text-secondary font-mono text-xs">
          <tr>
            <th class="py-3 px-4 font-semibold">Nama Objek</th>
            <th class="py-3 px-4 font-semibold">Tipe Konten</th>
            <th class="py-3 px-4 font-semibold">Ukuran</th>
            <th class="py-3 px-4 font-semibold">ETag (MD5)</th>
            <th class="py-3 px-4 font-semibold">Diperbarui</th>
            <th class="py-3 px-4 font-semibold text-right">Aksi</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-subtle">
          <tr v-for="obj in objects" :key="obj.id" class="hover:bg-surface-raised/40 transition-colors">
            <td class="py-3 px-4 font-mono font-medium text-primary flex items-center gap-2">
              <AppIcon name="file" class="w-4 h-4 text-muted" />
              {{ obj.key }}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-secondary">{{ obj.contentType }}</td>
            <td class="py-3 px-4 font-mono text-xs text-secondary">{{ formatBytes(obj.size) }}</td>
            <td class="py-3 px-4 font-mono text-xs text-muted truncate max-w-[120px]">{{ obj.etag }}</td>
            <td class="py-3 px-4 font-mono text-xs text-muted">{{ new Date(obj.updatedAt).toLocaleString() }}</td>
            <td class="py-3 px-4 text-right space-x-2">
              <a
                :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(obj.key)}`"
                target="_blank"
                class="px-2.5 py-1 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-primary inline-flex items-center gap-1"
              >
                Unduh
              </a>
              <button
                @click="deleteObject(obj.key)"
                class="px-2.5 py-1 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-md"
              >
                Hapus
              </button>
            </td>
          </tr>
          <tr v-if="objects.length === 0">
            <td colspan="6" class="py-12 text-center text-xs text-muted">
              Bucket ini masih kosong. Klik "Unggah File" untuk memasukkan objek ke Google Drive.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";

const route = useRoute();
const toast = useToast();
const bucketId = route.params.id as string;

const bucketName = ref("Loading...");
const objects = ref<any[]>([]);
const uploading = ref(false);

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function loadData() {
  const bRes = await fetch("/api/buckets");
  if (bRes.ok) {
    const list = await bRes.json();
    const curr = list.find((b: any) => b.id === bucketId);
    if (curr) bucketName.value = curr.name;
  }

  const oRes = await fetch(`/api/buckets/${bucketId}/objects`);
  if (oRes.ok) objects.value = await oRes.json();
}

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  const file = input.files[0];

  uploading.value = true;
  toast.info(`Mengunggah ${file.name}...`);

  try {
    const res = await fetch(`/api/buckets/${bucketId}/upload?key=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });

    if (res.ok) {
      toast.success(`${file.name} berhasil diunggah ke Google Drive`);
      loadData();
    } else {
      const err = await res.json();
      toast.error(err.error || "Gagal mengunggah file");
    }
  } catch (err: any) {
    toast.error(err.message || "Error jaringan saat mengunggah");
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

async function deleteObject(key: string) {
  if (!confirm(`Hapus file '${key}' dari Drive?`)) return;
  const res = await fetch(`/api/buckets/${bucketId}/objects?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (res.ok) {
    toast.success("File berhasil dihapus");
    loadData();
  }
}

onMounted(() => {
  loadData();
});
</script>
