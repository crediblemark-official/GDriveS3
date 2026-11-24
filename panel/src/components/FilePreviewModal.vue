<template>
  <div
    class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    @click.self="$emit('close')"
  >
    <div class="bg-surface border border-subtle rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-xl overflow-hidden max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0">
      <!-- Preview Header -->
      <div class="p-4 border-b border-subtle flex items-center justify-between">
        <div>
          <h3 class="font-bold text-sm text-primary font-mono truncate max-w-md">{{ item.displayName }}</h3>
          <p class="text-[11px] text-muted font-mono">{{ formatBytes(item.size) }} &bull; {{ item.contentType }}</p>
        </div>
        <button
          @click="$emit('close')"
          class="p-1 rounded-md text-muted hover:text-primary hover:bg-surface-raised text-lg leading-none"
        >
          &times;
        </button>
      </div>

      <!-- Preview Body -->
      <div class="p-4 flex-1 overflow-auto flex items-center justify-center bg-canvas">
        <!-- Image preview -->
        <img
          v-if="item.contentType.startsWith('image/')"
          :src="downloadUrl"
          class="max-w-full max-h-[60vh] object-contain rounded-lg border border-subtle shadow-xs"
          alt="Preview"
        />

        <!-- Text / Code preview -->
        <div
          v-else-if="isText"
          class="w-full text-xs font-mono p-3 bg-neutral-950 text-neutral-200 rounded-lg overflow-auto max-h-[50vh] whitespace-pre-wrap select-all"
        >
          {{ textContent || "Memuat konten..." }}
        </div>

        <!-- Generic preview fallback -->
        <div v-else class="text-center py-8 space-y-3">
          <AppIcon name="file" class="w-12 h-12 text-muted mx-auto" />
          <div class="text-xs text-muted">Pratinjau langsung tidak tersedia untuk format biner ini.</div>
          <a
            :href="downloadUrl"
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
        <span class="text-muted truncate max-w-xs select-all">s3://{{ bucketName }}/{{ item.key }}</span>
        <div class="flex items-center gap-2">
          <button
            @click="$emit('copyUri', item.key)"
            class="px-2.5 py-1 text-xs border border-subtle rounded-md hover:bg-surface-raised text-primary inline-flex items-center gap-1"
          >
            <AppIcon name="copy" class="w-3.5 h-3.5" />
            <span>Salin URI</span>
          </button>
          <a
            :href="downloadUrl"
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";
import { formatBytes } from "../lib/format";

const props = defineProps<{
  item: any;
  bucketId: string;
  bucketName: string;
}>();

defineEmits<{
  (e: "close"): void;
  (e: "copyUri", key: string): void;
}>();

const textContent = ref("");

const downloadUrl = computed(() => {
  return `/api/buckets/${props.bucketId}/download?key=${encodeURIComponent(props.item.key)}`;
});

const isText = computed(() => {
  const type = props.item.contentType || "";
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("xml")
  );
});

onMounted(async () => {
  if (isText.value && props.item.size < 500000) {
    try {
      const res = await fetch(downloadUrl.value);
      textContent.value = await res.text();
    } catch {
      textContent.value = "Gagal memuat pratinjau teks";
    }
  }
});
</script>
