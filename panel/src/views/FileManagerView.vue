<template>
  <div class="space-y-6">
    <!-- Header with Breadcrumbs & Actions -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle">
      <div>
        <div class="flex items-center gap-1.5 text-xs text-muted font-mono mb-1">
          <RouterLink to="/buckets" class="hover:text-primary transition-colors">Buckets</RouterLink>
          <span>/</span>
          <span class="text-primary font-semibold">{{ bucketName }}</span>
          <span class="text-muted">/</span>
          <span
            v-for="(crumb, idx) in breadcrumbs"
            :key="idx"
            class="flex items-center gap-1.5"
          >
            <button
              @click="navigateToPrefix(crumb.prefix)"
              class="hover:text-primary transition-colors underline-offset-2 hover:underline"
            >
              {{ crumb.name }}
            </button>
            <span class="text-muted">/</span>
          </span>
        </div>
        <h1 class="text-xl font-bold tracking-tight text-primary flex items-center gap-2">
          <span>File Manager</span>
          <span class="text-xs font-normal font-mono px-2 py-0.5 rounded-full bg-surface-raised border border-subtle text-secondary">
            {{ bucketName }}
          </span>
        </h1>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center flex-wrap gap-2">
        <button
          @click="showCreateFolderModal = true"
          class="px-3 py-2 bg-surface hover:bg-surface-raised border border-subtle text-primary text-xs font-medium rounded-lg shadow-xs flex items-center gap-1.5 transition-all"
        >
          <AppIcon name="folder" class="w-4 h-4 text-secondary" />
          <span>Buat Folder</span>
        </button>

        <label
          class="px-3.5 py-2 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-xs font-semibold rounded-lg shadow-xs flex items-center gap-2 cursor-pointer transition-all"
        >
          <AppIcon name="upload" class="w-4 h-4" />
          <span>{{ uploading ? "Mengunggah..." : "Unggah File" }}</span>
          <input
            type="file"
            multiple
            @change="handleFileInput"
            :disabled="uploading"
            class="hidden"
          />
        </label>
      </div>
    </div>

    <!-- Search & Filter Bar + Dropzone -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div class="relative flex-1 max-w-md">
        <AppIcon name="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari file dalam bucket ini..."
          class="w-full pl-9 pr-3 py-2 text-xs bg-surface border border-subtle rounded-lg text-primary placeholder-muted focus:outline-none focus:border-border-strong font-mono"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-primary"
        >
          &times;
        </button>
      </div>

      <div class="flex items-center gap-2 text-xs font-mono text-muted">
        <span>{{ filteredItems.length }} item</span>
        <span>&bull;</span>
        <span>Folder: {{ currentPrefix ? `/${currentPrefix}` : "/" }}</span>
      </div>
    </div>

    <!-- Drag & Drop Zone -->
    <div
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
      :class="[
        'border-2 border-dashed rounded-xl p-4 transition-all text-center flex items-center justify-center gap-3',
        isDragging
          ? 'border-brand bg-brand-subtle/20 text-brand'
          : 'border-subtle bg-surface/50 text-muted hover:border-border-strong',
      ]"
    >
      <AppIcon name="upload" class="w-5 h-5 shrink-0" />
      <span class="text-xs">
        Tarik & letakkan file di sini untuk mengunggah langsung ke <strong>{{ currentPrefix ? `/${currentPrefix}` : "root bucket" }}</strong>
      </span>
    </div>

    <!-- Objects & Folders Table -->
    <div class="bg-surface border border-subtle rounded-xl shadow-xs overflow-hidden">
      <table class="w-full text-left text-sm">
        <thead class="bg-canvas border-b border-subtle text-secondary font-mono text-xs">
          <tr>
            <th class="py-3 px-4 font-semibold">Nama Item</th>
            <th class="py-3 px-4 font-semibold">Tipe Konten</th>
            <th class="py-3 px-4 font-semibold">Ukuran</th>
            <th class="py-3 px-4 font-semibold">ETag</th>
            <th class="py-3 px-4 font-semibold">Diperbarui</th>
            <th class="py-3 px-4 font-semibold text-right">Aksi</th>
          </tr>
        </thead>

        <!-- Anti-CLS Skeleton Loading State -->
        <tbody v-if="loading" class="divide-y divide-subtle">
          <tr v-for="n in 5" :key="n" class="animate-pulse">
            <td class="py-3 px-4"><div class="h-4 bg-surface-raised rounded w-48"></div></td>
            <td class="py-3 px-4"><div class="h-4 bg-surface-raised rounded w-24"></div></td>
            <td class="py-3 px-4"><div class="h-4 bg-surface-raised rounded w-16"></div></td>
            <td class="py-3 px-4"><div class="h-4 bg-surface-raised rounded w-20"></div></td>
            <td class="py-3 px-4"><div class="h-4 bg-surface-raised rounded w-28"></div></td>
            <td class="py-3 px-4 text-right"><div class="h-4 bg-surface-raised rounded w-16 ml-auto"></div></td>
          </tr>
        </tbody>

        <tbody v-else class="divide-y divide-subtle">
          <!-- Back to Parent Row -->
          <tr
            v-if="currentPrefix"
            @click="navigateUp"
            class="hover:bg-surface-raised/50 cursor-pointer transition-colors"
          >
            <td colspan="6" class="py-2.5 px-4 font-mono text-xs text-primary flex items-center gap-2">
              <AppIcon name="folder" class="w-4 h-4 text-secondary" />
              <span class="font-bold">..</span>
              <span class="text-muted">(Kembali ke direktori atas)</span>
            </td>
          </tr>

          <!-- Items (Folders & Files) -->
          <tr
            v-for="item in filteredItems"
            :key="item.key"
            class="hover:bg-surface-raised/40 transition-colors"
          >
            <td class="py-3 px-4 font-mono font-medium text-primary">
              <button
                v-if="item.isFolder"
                @click="navigateToPrefix(item.folderPrefix)"
                class="flex items-center gap-2 hover:underline text-left"
              >
                <AppIcon name="folder" class="w-4 h-4 text-brand" />
                <span>{{ item.displayName }}/</span>
              </button>

              <div v-else class="flex items-center gap-2">
                <AppIcon name="file" class="w-4 h-4 text-muted shrink-0" />
                <span class="truncate max-w-[280px]" :title="item.key">{{ item.displayName }}</span>
              </div>
            </td>

            <td class="py-3 px-4 font-mono text-xs text-secondary">
              {{ item.isFolder ? "Folder Direktori" : item.contentType }}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-secondary">
              {{ item.isFolder ? "-" : formatBytes(item.size) }}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-muted truncate max-w-[120px]">
              {{ item.isFolder ? "-" : item.etag }}
            </td>
            <td class="py-3 px-4 font-mono text-xs text-muted">
              {{ item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-" }}
            </td>

            <!-- Actions -->
            <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
              <template v-if="!item.isFolder">
                <button
                  @click="previewItem = item"
                  title="Lihat Pratinjau"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="eye" class="w-3.5 h-3.5" />
                </button>

                <button
                  @click="copyS3Uri(item.key)"
                  title="Salin S3 URI (s3://bucket/key)"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="copy" class="w-3.5 h-3.5" />
                </button>

                <button
                  @click="presignKey = item.key"
                  title="Bagikan Tautan Sementara (Presigned URL)"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="external" class="w-3.5 h-3.5" />
                </button>

                <a
                  :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(item.key)}`"
                  target="_blank"
                  title="Unduh File"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="download" class="w-3.5 h-3.5" />
                </a>

                <button
                  @click="deleteObject(item.key)"
                  title="Hapus Objek"
                  class="p-1.5 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-md transition-colors inline-flex items-center"
                >
                  <AppIcon name="trash" class="w-3.5 h-3.5" />
                </button>
              </template>

              <template v-else>
                <button
                  @click="deleteFolder(item.folderPrefix)"
                  title="Hapus Penanda Folder"
                  class="p-1.5 text-xs font-medium border border-subtle text-muted hover:text-danger hover:border-danger-border rounded-md transition-colors inline-flex items-center"
                >
                  <AppIcon name="trash" class="w-3.5 h-3.5" />
                </button>
              </template>
            </td>
          </tr>

          <!-- Empty State -->
          <tr v-if="filteredItems.length === 0">
            <td colspan="6" class="py-12 text-center text-xs text-muted space-y-2">
              <AppIcon name="folder" class="w-8 h-8 text-muted mx-auto opacity-40" />
              <div>Tidak ada file atau folder dalam direktori ini.</div>
              <div class="text-[11px] text-muted">Gunakan tombol "Unggah File" atau "Buat Folder" di atas.</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modular Modals -->
    <CreateFolderModal
      v-if="showCreateFolderModal"
      :bucket-id="bucketId"
      :current-prefix="currentPrefix"
      @close="showCreateFolderModal = false"
      @created="loadData"
    />

    <FilePreviewModal
      v-if="previewItem"
      :item="previewItem"
      :bucket-id="bucketId"
      :bucket-name="bucketName"
      @close="previewItem = null"
      @copy-uri="copyS3Uri"
    />

    <PresignModal
      v-if="presignKey"
      :object-key="presignKey"
      :bucket-id="bucketId"
      @close="presignKey = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "../components/AppIcon.vue";
import CreateFolderModal from "../components/CreateFolderModal.vue";
import FilePreviewModal from "../components/FilePreviewModal.vue";
import PresignModal from "../components/PresignModal.vue";
import { useToast } from "../composables/useToast";
import { formatBytes } from "../lib/format";

const route = useRoute();
const toast = useToast();
const bucketId = route.params.id as string;

const bucketName = ref("Loading...");
const rawObjects = ref<any[]>([]);
const currentPrefix = ref("");
const searchQuery = ref("");
const loading = ref(true);
const uploading = ref(false);
const isDragging = ref(false);

const showCreateFolderModal = ref(false);
const previewItem = ref<any | null>(null);
const presignKey = ref<string | null>(null);

const breadcrumbs = computed(() => {
  if (!currentPrefix.value) return [];
  const parts = currentPrefix.value.replace(/\/$/, "").split("/");
  const crumbs: { name: string; prefix: string }[] = [];
  let accumulated = "";
  for (const part of parts) {
    accumulated += `${part}/`;
    crumbs.push({ name: part, prefix: accumulated });
  }
  return crumbs;
});

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const prefix = currentPrefix.value;

  if (query) {
    return rawObjects.value
      .filter((o) => o.key.toLowerCase().includes(query))
      .map((o) => ({
        ...o,
        isFolder: o.key.endsWith("/"),
        displayName: o.key,
        folderPrefix: o.key,
      }));
  }

  const foldersMap = new Map<string, any>();
  const files: any[] = [];

  for (const obj of rawObjects.value) {
    if (!obj.key.startsWith(prefix)) continue;
    const remaining = obj.key.slice(prefix.length);
    if (!remaining) continue;

    const slashIdx = remaining.indexOf("/");
    if (slashIdx >= 0) {
      const folderName = remaining.slice(0, slashIdx);
      const subPrefix = `${prefix}${folderName}/`;
      if (!foldersMap.has(subPrefix)) {
        foldersMap.set(subPrefix, {
          key: subPrefix,
          displayName: folderName,
          isFolder: true,
          folderPrefix: subPrefix,
          size: 0,
          contentType: "Directory",
          etag: "-",
          updatedAt: obj.updatedAt,
        });
      }
    } else {
      files.push({
        ...obj,
        displayName: remaining,
        isFolder: false,
      });
    }
  }

  const folderList = Array.from(foldersMap.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
  const fileList = files.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return [...folderList, ...fileList];
});

function navigateToPrefix(prefix: string) {
  currentPrefix.value = prefix;
  searchQuery.value = "";
}

function navigateUp() {
  if (!currentPrefix.value) return;
  const trimmed = currentPrefix.value.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  currentPrefix.value = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : "";
}

async function loadData() {
  loading.value = true;
  try {
    const bRes = await fetch("/api/buckets");
    if (bRes.ok) {
      const list = await bRes.json();
      const curr = list.find((b: any) => b.id === bucketId);
      if (curr) bucketName.value = curr.name;
    }

    const oRes = await fetch(`/api/buckets/${bucketId}/objects`);
    if (oRes.ok) {
      rawObjects.value = await oRes.json();
    }
  } catch {
    toast.error("Gagal memuat data objek");
  } finally {
    loading.value = false;
  }
}

async function uploadFileObject(file: File) {
  const fullKey = `${currentPrefix.value}${file.name}`;
  const res = await fetch(`/api/buckets/${bucketId}/upload?key=${encodeURIComponent(fullKey)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gagal mengunggah ${file.name}`);
  }
}

async function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;
  await uploadFiles(Array.from(input.files));
  input.value = "";
}

async function handleDrop(event: DragEvent) {
  isDragging.value = false;
  if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) return;
  await uploadFiles(Array.from(event.dataTransfer.files));
}

async function uploadFiles(files: File[]) {
  uploading.value = true;
  toast.info(`Mengunggah ${files.length} file ke Google Drive...`);

  let successCount = 0;
  for (const file of files) {
    try {
      await uploadFileObject(file);
      successCount++;
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (successCount > 0) {
    toast.success(`${successCount} file berhasil diunggah`);
    await loadData();
  }
  uploading.value = false;
}

async function deleteObject(key: string) {
  if (!confirm(`Hapus file '${key}' dari Google Drive?`)) return;
  const res = await fetch(`/api/buckets/${bucketId}/objects?key=${encodeURIComponent(key)}`, {
    method: "DELETE",
  });
  if (res.ok) {
    toast.success("File berhasil dihapus");
    loadData();
  } else {
    toast.error("Gagal menghapus file");
  }
}

async function deleteFolder(folderPrefix: string) {
  const inside = rawObjects.value.filter((o) => o.key.startsWith(folderPrefix) && o.key !== folderPrefix);
  if (inside.length > 0) {
    if (!confirm(`Folder ini berisi ${inside.length} item. Hapus semua file di dalam '${folderPrefix}'?`)) return;
    for (const obj of inside) {
      await fetch(`/api/buckets/${bucketId}/objects?key=${encodeURIComponent(obj.key)}`, { method: "DELETE" });
    }
  }
  await fetch(`/api/buckets/${bucketId}/objects?key=${encodeURIComponent(folderPrefix)}`, { method: "DELETE" });
  toast.success("Folder berhasil dihapus");
  loadData();
}

function copyS3Uri(key: string) {
  const uri = `s3://${bucketName.value}/${key}`;
  navigator.clipboard.writeText(uri);
  toast.success(`Disalin: ${uri}`);
}

onMounted(() => {
  loadData();
});
</script>
