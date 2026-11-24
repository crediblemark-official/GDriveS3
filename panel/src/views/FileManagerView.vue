<template>
  <div class="space-y-0">
    <!-- Teleport primary actions into Sticky Top Header -->
    <Teleport to="#header-actions">
      <div class="flex items-center gap-2">
        <button
          @click="showCreateFolderModal = true"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-raised border border-subtle text-primary text-xs font-medium rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all"
          title="Buat Folder / Prefix"
        >
          <AppIcon name="folder" class="w-3.5 h-3.5 text-secondary" />
          <span class="hidden sm:inline">Folder</span>
        </button>

        <label
          class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] cursor-pointer transition-all disabled:opacity-50"
        >
          <AppIcon name="upload" class="w-3.5 h-3.5" />
          <span>{{ uploading ? "Mengunggah..." : "Unggah" }}</span>
          <input
            type="file"
            multiple
            @change="handleFileInput"
            :disabled="uploading"
            class="hidden"
          />
        </label>
      </div>
    </Teleport>

    <!-- Breadcrumb Navigation Bar (Swiss Hairline Docked) -->
    <div class="p-3 sm:px-6 bg-surface border-b border-subtle flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
      <div class="flex items-center gap-1.5 flex-wrap min-w-0">
        <RouterLink to="/buckets" class="text-secondary hover:text-primary transition-colors">Buckets</RouterLink>
        <span class="text-muted">/</span>
        <span class="text-primary font-bold">{{ bucketName }}</span>
        <span class="text-muted">/</span>
        <span
          v-for="(crumb, idx) in breadcrumbs"
          :key="idx"
          class="flex items-center gap-1.5"
        >
          <button
            @click="navigateToPrefix(crumb.prefix)"
            class="text-secondary hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            {{ crumb.name }}
          </button>
          <span class="text-muted">/</span>
        </span>
      </div>

      <div class="flex items-center gap-2 text-muted text-[11px]">
        <span>{{ filteredItems.length }} item</span>
        <span>&bull;</span>
        <span class="truncate max-w-[180px]">Prefix: {{ currentPrefix ? `/${currentPrefix}` : "/" }}</span>
      </div>
    </div>

    <!-- Search & Dropzone Strip (Swiss Hairline Docked) -->
    <div class="p-3 sm:px-6 bg-canvas border-b border-subtle flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
      <div class="relative flex-1 max-w-md">
        <AppIcon name="search" class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari file dalam bucket ini..."
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

      <!-- Drag & Drop Zone + Opt-in Image Optimization -->
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-subtle bg-surface text-xs">
          <label class="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              v-model="imageOpt.enabled"
              type="checkbox"
              class="w-3.5 h-3.5 rounded border-subtle accent-neutral-900 dark:accent-white"
            />
            <span class="font-medium text-primary">Optimasi Gambar</span>
          </label>
          <template v-if="imageOpt.enabled">
            <select
              v-model.number="imageOpt.maxWidth"
              aria-label="Resolusi Maksimal"
              class="bg-canvas border border-subtle rounded px-1.5 py-0.5 text-[11px] font-mono text-primary focus:outline-none"
            >
              <option :value="0">Resolusi Asli</option>
              <option :value="1920">Maks 1920px</option>
              <option :value="1280">Maks 1280px</option>
            </select>
            <label class="inline-flex items-center gap-1 cursor-pointer text-[11px] font-mono text-secondary">
              <input v-model="imageOpt.toWebp" type="checkbox" class="w-3 h-3 accent-neutral-900 dark:accent-white" />
              <span>WebP</span>
            </label>
          </template>
        </div>

        <div
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
          :class="[
            'px-4 py-2 border border-dashed rounded-lg transition-all text-center flex items-center justify-center gap-2 text-xs',
            isDragging
              ? 'border-brand bg-brand-subtle text-primary ring-1 ring-brand'
              : 'border-subtle bg-surface text-muted hover:border-border-strong',
          ]"
        >
          <AppIcon name="upload" class="w-3.5 h-3.5 shrink-0" />
          <span class="text-[11px]">
            Tarik & letakkan file ke <strong>{{ currentPrefix ? `/${currentPrefix}` : "root" }}</strong>
          </span>
        </div>
      </div>
    </div>

    <!-- Objects & Folders Table (Swiss Hairline Docked) -->
    <div class="bg-surface border-b border-subtle overflow-x-auto">
      <table class="w-full text-left text-sm border-collapse">
        <thead class="bg-canvas border-b border-subtle text-muted font-mono text-[11px] uppercase tracking-wider">
          <tr>
            <th class="py-3 px-4 sm:px-6 font-semibold">Nama Item & Metadata</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden md:table-cell">Tipe</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden md:table-cell">Ukuran</th>
            <th class="py-3 px-4 sm:px-6 font-semibold hidden lg:table-cell">Diperbarui</th>
            <th class="py-3 px-4 sm:px-6 font-semibold text-right">Aksi</th>
          </tr>
        </thead>

        <!-- Anti-CLS Skeleton Loading State -->
        <tbody v-if="loading" class="divide-y divide-subtle">
          <tr v-for="n in 5" :key="n" class="animate-pulse">
            <td class="py-3 px-4 sm:px-6"><div class="h-4 bg-surface-raised rounded w-48"></div></td>
            <td class="py-3 px-4 sm:px-6 hidden md:table-cell"><div class="h-4 bg-surface-raised rounded w-24"></div></td>
            <td class="py-3 px-4 sm:px-6 hidden md:table-cell"><div class="h-4 bg-surface-raised rounded w-16"></div></td>
            <td class="py-3 px-4 sm:px-6 hidden lg:table-cell"><div class="h-4 bg-surface-raised rounded w-28"></div></td>
            <td class="py-3 px-4 sm:px-6 text-right"><div class="h-4 bg-surface-raised rounded w-16 ml-auto"></div></td>
          </tr>
        </tbody>

        <tbody v-else class="divide-y divide-subtle">
          <!-- Back to Parent Directory Row -->
          <tr
            v-if="currentPrefix"
            @click="navigateUp"
            class="hover:bg-surface-raised/50 cursor-pointer transition-colors"
          >
            <td colspan="5" class="py-2.5 px-4 sm:px-6 font-mono text-xs text-primary flex items-center gap-2">
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
            <!-- Column 1: Name + Secondary Metadata (Max 2 Lines per Row) -->
            <td class="py-3 px-4 sm:px-6 align-middle font-mono font-medium text-primary">
              <button
                v-if="item.isFolder"
                @click="navigateToPrefix(item.folderPrefix)"
                class="flex items-center gap-2 hover:underline text-left"
              >
                <AppIcon name="folder" class="w-4 h-4 text-secondary shrink-0" />
                <span class="truncate max-w-[280px] sm:max-w-md font-semibold">{{ item.displayName }}/</span>
              </button>

              <div v-else class="flex items-center gap-2 min-w-0">
                <AppIcon name="file" class="w-4 h-4 text-muted shrink-0" />
                <span class="truncate max-w-[240px] sm:max-w-md" :title="item.key">{{ item.displayName }}</span>
              </div>

              <!-- Line 2: Compact Secondary Metadata with Middle Dots -->
              <div class="text-[11px] text-muted font-mono flex items-center gap-1.5 mt-0.5 truncate">
                <span v-if="!item.isFolder">{{ formatBytes(item.size) }}</span>
                <span v-if="!item.isFolder">&bull;</span>
                <span v-if="!item.isFolder" class="md:hidden">{{ item.contentType }}</span>
                <span v-if="!item.isFolder" class="md:hidden">&bull;</span>
                <span v-if="item.updatedAt">{{ new Date(item.updatedAt).toLocaleString() }}</span>
                <span v-if="item.isFolder">Direktori S3</span>
              </div>
            </td>

            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-secondary hidden md:table-cell align-middle truncate max-w-[160px]">
              {{ item.isFolder ? "Folder" : item.contentType }}
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-secondary hidden md:table-cell align-middle">
              {{ item.isFolder ? "-" : formatBytes(item.size) }}
            </td>
            <td class="py-3 px-4 sm:px-6 font-mono text-xs text-muted hidden lg:table-cell align-middle">
              {{ item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "-" }}
            </td>

            <!-- Column: Icon-Only Action Buttons (Strictly Following One-Word/Icon-Only Rule) -->
            <td class="py-3 px-4 sm:px-6 text-right align-middle whitespace-nowrap">
              <template v-if="!item.isFolder">
                <div class="flex items-center justify-end gap-1">
                  <!-- Preview -->
                  <button
                    @click="previewItem = item"
                    aria-label="Lihat Pratinjau"
                    title="Lihat Pratinjau"
                    class="p-1.5 text-secondary hover:text-primary hover:bg-surface-raised rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                  >
                    <AppIcon name="eye" class="w-3.5 h-3.5" />
                  </button>

                  <!-- Copy URI -->
                  <button
                    @click="copyS3Uri(item.key)"
                    aria-label="Salin S3 URI"
                    title="Salin S3 URI (s3://bucket/key)"
                    class="p-1.5 text-secondary hover:text-primary hover:bg-surface-raised rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                  >
                    <AppIcon name="copy" class="w-3.5 h-3.5" />
                  </button>

                  <!-- Presign URL -->
                  <button
                    @click="presignKey = item.key"
                    aria-label="Bagikan Tautan Sementara"
                    title="Bagikan Tautan Sementara (Presigned URL)"
                    class="p-1.5 text-secondary hover:text-primary hover:bg-surface-raised rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                  >
                    <AppIcon name="share" class="w-3.5 h-3.5" />
                  </button>

                  <!-- Download -->
                  <a
                    :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(item.key)}`"
                    target="_blank"
                    aria-label="Unduh File"
                    title="Unduh File"
                    class="p-1.5 text-secondary hover:text-primary hover:bg-surface-raised rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                  >
                    <AppIcon name="download" class="w-3.5 h-3.5" />
                  </a>

                  <!-- Delete -->
                  <button
                    @click="deleteObject(item.key)"
                    aria-label="Hapus Objek"
                    title="Hapus Objek"
                    class="p-1.5 text-secondary hover:text-danger hover:bg-danger-bg rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                  >
                    <AppIcon name="trash" class="w-3.5 h-3.5" />
                  </button>
                </div>
              </template>

              <template v-else>
                <button
                  @click="deleteFolder(item.folderPrefix)"
                  aria-label="Hapus Folder"
                  title="Hapus Penanda Folder"
                  class="p-1.5 text-secondary hover:text-danger hover:bg-danger-bg rounded-lg hover:scale-105 active:scale-95 transition-all inline-flex items-center"
                >
                  <AppIcon name="trash" class="w-3.5 h-3.5" />
                </button>
              </template>
            </td>
          </tr>

          <!-- Dignified Empty State -->
          <tr v-if="filteredItems.length === 0">
            <td colspan="5" class="py-16 text-center">
              <div class="max-w-xs mx-auto space-y-3">
                <div class="w-10 h-10 rounded-xl bg-surface-raised border border-subtle flex items-center justify-center mx-auto text-muted">
                  <AppIcon name="folder" class="w-5 h-5 opacity-60" />
                </div>
                <div class="text-xs text-secondary font-medium">Tidak ada file atau folder</div>
                <p class="text-[11px] text-muted">Gunakan tombol "Unggah" di header atau tarik berkas ke dropzone.</p>
              </div>
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
import { optimizeImageFile } from "../lib/imageOptimizer";

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
const imageOpt = ref({
  enabled: false,
  maxWidth: 1920,
  quality: 0.85,
  toWebp: true,
});

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
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunk threshold

  if (file.size <= CHUNK_SIZE) {
    const res = await fetch(`/api/buckets/${bucketId}/upload?key=${encodeURIComponent(fullKey)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Gagal mengunggah ${file.name}`);
    }
    return;
  }

  // Large files (> 10MB): Chunked S3 Multipart Upload with progress
  const totalParts = Math.ceil(file.size / CHUNK_SIZE);
  toast.info(`Mengunggah ${file.name} (${formatBytes(file.size)}) dalam ${totalParts} pecahan...`);

  const initRes = await fetch(`/api/buckets/${bucketId}/multipart/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: fullKey,
      contentType: file.type || "application/octet-stream",
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({}));
    throw new Error(err.error || "Gagal menginisialisasi multipart upload");
  }

  const { uploadId } = await initRes.json();

  try {
    for (let partNum = 1; partNum <= totalParts; partNum++) {
      const start = (partNum - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const partRes = await fetch(
        `/api/buckets/${bucketId}/multipart/part?uploadId=${uploadId}&partNumber=${partNum}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        }
      );

      if (!partRes.ok) {
        throw new Error(`Gagal mengunggah part ${partNum}/${totalParts}`);
      }

      const percent = Math.round((partNum / totalParts) * 100);
      toast.info(`Progress ${file.name}: ${percent}% (${partNum}/${totalParts})`);
    }

    const compRes = await fetch(`/api/buckets/${bucketId}/multipart/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: fullKey, uploadId }),
    });

    if (!compRes.ok) {
      const err = await compRes.json().catch(() => ({}));
      throw new Error(err.error || "Gagal menyelesaikan multipart upload");
    }
  } catch (err) {
    await fetch(`/api/buckets/${bucketId}/multipart/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    }).catch(() => {});
    throw err;
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
  let totalSavedBytes = 0;
  for (const rawFile of files) {
    try {
      const optRes = await optimizeImageFile(rawFile, imageOpt.value);
      totalSavedBytes += optRes.savedBytes;
      await uploadFileObject(optRes.file);
      successCount++;
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  if (successCount > 0) {
    const savedSuffix = totalSavedBytes > 0 ? ` (hemat ${formatBytes(totalSavedBytes)})` : "";
    toast.success(`${successCount} file berhasil diunggah${savedSuffix}`);
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
