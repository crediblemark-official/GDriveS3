<template>
  <div
    class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    @click.self="$emit('close')"
  >
    <div class="bg-surface border border-subtle rounded-xl p-6 max-w-lg w-full shadow-lg space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
      <div class="flex items-center justify-between pb-2 border-b border-subtle">
        <h3 class="font-bold text-sm text-primary flex items-center gap-2">
          <AppIcon name="external" class="w-4 h-4 text-brand" />
          <span>Bagikan Tautan Sementara (S3 Presigned URL)</span>
        </h3>
        <button @click="$emit('close')" class="text-muted hover:text-primary text-lg">&times;</button>
      </div>

      <p class="text-xs text-secondary leading-relaxed">
        Tautan langsung aman dengan otentikasi AWS SigV4 yang dapat diakses siapa saja tanpa perlu login ke panel hingga masa berlakunya habis.
      </p>

      <div class="space-y-3 font-mono text-xs">
        <div>
          <div class="text-[11px] text-muted mb-1">Objek:</div>
          <div class="p-2 bg-canvas border border-subtle rounded text-primary truncate select-all">{{ objectKey }}</div>
        </div>

        <div>
          <div class="text-[11px] text-muted mb-1">Masa Berlaku:</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="opt in expiryOptions"
              :key="opt.seconds"
              @click="generateLink(opt.seconds)"
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

        <div v-if="generatedUrl">
          <div class="text-[11px] text-muted mb-1">Tautan URL:</div>
          <div class="p-2.5 bg-neutral-950 text-neutral-200 border border-subtle rounded text-[11px] break-all select-all max-h-24 overflow-y-auto">
            {{ generatedUrl }}
          </div>
          <div class="text-[10px] text-muted mt-1">Kedaluwarsa pada: {{ expiresAt ? new Date(expiresAt).toLocaleString() : '-' }}</div>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-subtle">
        <button
          @click="$emit('close')"
          class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
        >
          Tutup
        </button>
        <button
          v-if="generatedUrl"
          @click="copyUrl"
          class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90 flex items-center gap-1.5"
        >
          <AppIcon name="copy" class="w-3.5 h-3.5" />
          <span>Salin Tautan</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AppIcon from "./AppIcon.vue";
import { useToast } from "../composables/useToast";

const props = defineProps<{
  objectKey: string;
  bucketId: string;
}>();

defineEmits<{
  (e: "close"): void;
}>();

const toast = useToast();
const selectedExpiry = ref(3600);
const generatedUrl = ref("");
const expiresAt = ref("");

const expiryOptions = [
  { label: "1 Jam", seconds: 3600 },
  { label: "24 Jam", seconds: 86400 },
  { label: "7 Hari", seconds: 604800 },
];

async function generateLink(seconds: number) {
  selectedExpiry.value = seconds;
  try {
    const res = await fetch(`/api/buckets/${props.bucketId}/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: props.objectKey,
        expiresIn: seconds,
        method: "GET",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      generatedUrl.value = data.url;
      expiresAt.value = data.expiresAt;
    } else {
      toast.error("Gagal membuat tautan presigned");
    }
  } catch {
    toast.error("Kesalahan jaringan saat membuat tautan");
  }
}

function copyUrl() {
  if (!generatedUrl.value) return;
  navigator.clipboard.writeText(generatedUrl.value);
  toast.success("Tautan presigned disalin ke clipboard!");
}

onMounted(() => {
  generateLink(3600);
});
</script>
