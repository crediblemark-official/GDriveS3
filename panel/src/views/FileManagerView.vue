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
            <td class="py-3 px-4">
              <div class="h-4 bg-surface-raised rounded w-48"></div>
            </td>
            <td class="py-3 px-4">
              <div class="h-4 bg-surface-raised rounded w-24"></div>
            </td>
            <td class="py-3 px-4">
              <div class="h-4 bg-surface-raised rounded w-16"></div>
            </td>
            <td class="py-3 px-4">
              <div class="h-4 bg-surface-raised rounded w-20"></div>
            </td>
            <td class="py-3 px-4">
              <div class="h-4 bg-surface-raised rounded w-28"></div>
            </td>
            <td class="py-3 px-4 text-right">
              <div class="h-4 bg-surface-raised rounded w-16 ml-auto"></div>
            </td>
          </tr>
        </tbody>

        <tbody v-else class="divide-y divide-subtle">
          <!-- Back to Parent Row (if in subfolder) -->
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
            <!-- Name with appropriate icon -->
            <td class="py-3 px-4 font-mono font-medium text-primary">
              <!-- Folder item -->
              <button
                v-if="item.isFolder"
                @click="navigateToPrefix(item.folderPrefix)"
                class="flex items-center gap-2 hover:underline text-left"
              >
                <AppIcon name="folder" class="w-4 h-4 text-brand" />
                <span>{{ item.displayName }}/</span>
              </button>

              <!-- File item -->
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
                <!-- Preview Button -->
                <button
                  @click="openPreview(item)"
                  title="Lihat Pratinjau"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="eye" class="w-3.5 h-3.5" />
                </button>

                <!-- Copy S3 URI -->
                <button
                  @click="copyS3Uri(item.key)"
                  title="Salin S3 URI (s3://bucket/key)"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="copy" class="w-3.5 h-3.5" />
                </button>

                <!-- Presigned URL Share -->
                <button
                  @click="openPresignModal(item.key)"
                  title="Bagikan Tautan Sementara (Presigned URL)"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="external" class="w-3.5 h-3.5" />
                </button>

                <!-- Download -->
                <a
                  :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(item.key)}`"
                  target="_blank"
                  title="Unduh File"
                  class="p-1.5 text-xs font-medium border border-subtle rounded-md hover:bg-surface-raised text-secondary hover:text-primary transition-colors inline-flex items-center"
                >
                  <AppIcon name="download" class="w-3.5 h-3.5" />
                </a>

                <!-- Delete -->
                <button
                  @click="deleteObject(item.key)"
                  title="Hapus Objek"
                  class="p-1.5 text-xs font-medium border border-danger-border text-danger hover:bg-danger-bg rounded-md transition-colors inline-flex items-center"
                >
                  <AppIcon name="trash" class="w-3.5 h-3.5" />
                </button>
              </template>

              <!-- Folder Actions -->
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

    <!-- Modal Create Folder -->
    <div
      v-if="showCreateFolderModal"
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div class="bg-surface border border-subtle rounded-xl p-6 max-w-sm w-full shadow-md space-y-4">
        <h2 class="font-bold text-base text-primary">Buat Folder Baru</h2>
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Nama Folder</label>
          <div class="flex items-center">
            <span v-if="currentPrefix" class="text-xs font-mono text-muted mr-1">/{{ currentPrefix }}</span>
            <input
              v-model="newFolderName"
              @keyup.enter="createFolder"
              type="text"
              placeholder="dokumen-2026"
              class="w-full px-3 py-2 text-sm bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong"
            />
          </div>
          <p class="text-[11px] text-muted">Folder akan dibuat sebagai penanda prefix S3.</p>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            @click="showCreateFolderModal = false"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
          >
            Batal
          </button>
          <button
            @click="createFolder"
            class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90"
          >
            Buat Folder
          </button>
        </div>
      </div>
    </div>

    <!-- Modal File Preview -->
    <div
      v-if="previewItem"
      class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      @click.self="previewItem = null"
    >
      <div class="bg-surface border border-subtle rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden">
        <!-- Preview Header -->
        <div class="p-4 border-b border-subtle flex items-center justify-between">
          <div>
            <h3 class="font-bold text-sm text-primary font-mono truncate max-w-md">{{ previewItem.displayName }}</h3>
            <p class="text-[11px] text-muted font-mono">{{ formatBytes(previewItem.size) }} &bull; {{ previewItem.contentType }}</p>
          </div>
          <button
            @click="previewItem = null"
            class="p-1 rounded-md text-muted hover:text-primary hover:bg-surface-raised text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <!-- Preview Body -->
        <div class="p-4 flex-1 overflow-auto flex items-center justify-center bg-canvas">
          <!-- Image preview -->
          <img
            v-if="previewItem.contentType.startsWith('image/')"
            :src="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(previewItem.key)}`"
            class="max-w-full max-h-[60vh] object-contain rounded-lg border border-subtle shadow-xs"
            alt="Preview"
          />

          <!-- Text / Code preview -->
          <div
            v-else-if="previewItem.contentType.startsWith('text/') || previewItem.contentType.includes('json') || previewItem.contentType.includes('javascript') || previewItem.contentType.includes('xml')"
            class="w-full text-xs font-mono p-3 bg-neutral-950 text-neutral-200 rounded-lg overflow-auto max-h-[50vh] whitespace-pre-wrap select-all"
          >
            {{ previewContent || "Memuat konten..." }}
          </div>

          <!-- Generic preview fallback -->
          <div v-else class="text-center py-8 space-y-3">
            <AppIcon name="file" class="w-12 h-12 text-muted mx-auto" />
            <div class="text-xs text-muted">Pratinjau langsung tidak tersedia untuk format biner ini.</div>
            <a
              :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(previewItem.key)}`"
              target="_blank"
              class="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-brand text-brand-contrast text-xs font-semibold rounded-lg shadow-xs hover:opacity-90"
            >
              <AppIcon name="download" class="w-4 h-4" />
              <span>Unduh File</span>
            </a>
          </div>
        </div>

        <!-- Preview Footer -->
        <div class="p-3 border-t border-subtle bg-surface flex items-center justify-between text-xs font-mono">
          <span class="text-muted truncate max-w-xs select-all">s3://{{ bucketName }}/{{ previewItem.key }}</span>
          <div class="flex items-center gap-2">
            <button
              @click="copyS3Uri(previewItem.key)"
              class="px-2.5 py-1 text-xs border border-subtle rounded-md hover:bg-surface-raised text-primary inline-flex items-center gap-1"
            >
              <AppIcon name="copy" class="w-3.5 h-3.5" />
              <span>Salin URI</span>
            </button>
            <a
              :href="`/api/buckets/${bucketId}/download?key=${encodeURIComponent(previewItem.key)}`"
              target="_blank"
              class="px-2.5 py-1 text-xs bg-brand text-brand-contrast rounded-md font-semibold hover:opacity-90 inline-flex items-center gap-1"
            >
              <AppIcon name="download" class="w-3.5 h-3.5" />
              <span>Unduh</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Presigned URL Generator -->
    <div
      v-if="presignModalKey"
      class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      @click.self="presignModalKey = null"
    >
      <div class="bg-surface border border-subtle rounded-xl p-6 max-w-lg w-full shadow-lg space-y-4">
        <div class="flex items-center justify-between pb-2 border-b border-subtle">
          <h3 class="font-bold text-sm text-primary flex items-center gap-2">
            <AppIcon name="external" class="w-4 h-4 text-brand" />
            <span>Bagikan Tautan Sementara (S3 Presigned URL)</span>
          </h3>
          <button @click="presignModalKey = null" class="text-muted hover:text-primary text-lg">&times;</button>
        </div>

        <p class="text-xs text-secondary leading-relaxed">
          Tautan langsung aman dengan otentikasi AWS SigV4 yang dapat diakses siapa saja tanpa perlu login ke panel hingga masa berlakunya habis.
        </p>

        <div class="space-y-3 font-mono text-xs">
          <div>
            <div class="text-[11px] text-muted mb-1">Objek:</div>
            <div class="p-2 bg-canvas border border-subtle rounded text-primary truncate select-all">{{ presignModalKey }}</div>
          </div>

          <div>
            <div class="text-[11px] text-muted mb-1">Masa Berlaku:</div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="opt in presignExpiryOptions"
                :key="opt.seconds"
                @click="generatePresignedLink(opt.seconds)"
                :class="[
                  'py-1.5 px-2 rounded border text-center text-xs transition-all',
                  selectedExpiry === opt.seconds
                    ? 'bg-brand/10 border-brand text-brand font-bold'
                    : 'bg-canvas border-subtle hover:bg-surface-raised text-secondary'
                ]"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="generatedPresignedUrl">
            <div class="text-[11px] text-muted mb-1">Tautan URL:</div>
            <div class="p-2.5 bg-neutral-950 text-neutral-200 border border-subtle rounded text-[11px] break-all select-all max-h-24 overflow-y-auto">
              {{ generatedPresignedUrl }}
            </div>
            <div class="text-[10px] text-muted mt-1">Kedaluwarsa pada: {{ presignExpiresAt ? new Date(presignExpiresAt).toLocaleString() : '-' }}</div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-subtle">
          <button
            @click="presignModalKey = null"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
          >
            Tutup
          </button>
          <button
            v-if="generatedPresignedUrl"
            @click="copyPresignedUrl"
            class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90 flex items-center gap-1.5"
          >
            <AppIcon name="copy" class="w-3.5 h-3.5" />
            <span>Salin Tautan</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";

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
const newFolderName = ref("");

const previewItem = ref<any | null>(null);
const previewContent = ref<string>("");

const presignModalKey = ref<string | null>(null);
const selectedExpiry = ref(3600);
const generatedPresignedUrl = ref("");
const presignExpiresAt = ref("");

const presignExpiryOptions = [
  { label: "1 Jam", seconds: 3600 },
  { label: "24 Jam", seconds: 86400 },
  { label: "7 Hari", seconds: 604800 },
];

// Breadcrumb calculation
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

// Virtual directory grouping based on currentPrefix
const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const prefix = currentPrefix.value;

  // If user searched across bucket, return flat matching objects
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
    if (!remaining) continue; // exact prefix match

    const slashIdx = remaining.indexOf("/");
    if (slashIdx >= 0) {
      // It belongs to a subfolder
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
      // It's a file in the current directory
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

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function navigateToPrefix(prefix: string) {
  currentPrefix.value = prefix;
  searchQuery.value = "";
}

function navigateUp() {
  if (!currentPrefix.value) return;
  const trimmed = currentPrefix.value.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash >= 0) {
    currentPrefix.value = trimmed.slice(0, lastSlash + 1);
  } else {
    currentPrefix.value = "";
  }
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
  } catch (err: any) {
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
  const files = Array.from(input.files);
  await uploadFiles(files);
  input.value = "";
}

async function handleDrop(event: DragEvent) {
  isDragging.value = false;
  if (!event.dataTransfer?.files || event.dataTransfer.files.length === 0) return;
  const files = Array.from(event.dataTransfer.files);
  await uploadFiles(files);
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

async function createFolder() {
  if (!newFolderName.value.trim()) return;
  try {
    const res = await fetch(`/api/buckets/${bucketId}/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderName: newFolderName.value.trim(),
        prefix: currentPrefix.value,
      }),
    });

    if (res.ok) {
      toast.success(`Folder '${newFolderName.value}' berhasil dibuat`);
      showCreateFolderModal.value = false;
      newFolderName.value = "";
      await loadData();
    } else {
      const err = await res.json();
      toast.error(err.error || "Gagal membuat folder");
    }
  } catch (err: any) {
    toast.error("Terjadi kesalahan jaringan");
  }
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
  // Check if any objects exist inside this folder
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

async function openPreview(item: any) {
  previewItem.value = item;
  previewContent.value = "";

  const isText =
    item.contentType.startsWith("text/") ||
    item.contentType.includes("json") ||
    item.contentType.includes("javascript") ||
    item.contentType.includes("xml");

  if (isText && item.size < 500000) {
    try {
      const res = await fetch(`/api/buckets/${bucketId}/download?key=${encodeURIComponent(item.key)}`);
      previewContent.value = await res.text();
    } catch {
      previewContent.value = "Gagal memuat pratinjau teks";
    }
  }
}

function openPresignModal(key: string) {
  presignModalKey.value = key;
  generatedPresignedUrl.value = "";
  presignExpiresAt.value = "";
  generatePresignedLink(3600);
}

async function generatePresignedLink(seconds: number) {
  selectedExpiry.value = seconds;
  if (!presignModalKey.value) return;
  try {
    const res = await fetch(`/api/buckets/${bucketId}/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: presignModalKey.value,
        expiresIn: seconds,
        method: "GET",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      generatedPresignedUrl.value = data.url;
      presignExpiresAt.value = data.expiresAt;
    } else {
      toast.error("Gagal membuat tautan presigned");
    }
  } catch {
    toast.error("Kesalahan jaringan");
  }
}

function copyPresignedUrl() {
  if (!generatedPresignedUrl.value) return;
  navigator.clipboard.writeText(generatedPresignedUrl.value);
  toast.success("Tautan presigned disalin ke clipboard!");
}

onMounted(() => {
  loadData();
});
</script>
