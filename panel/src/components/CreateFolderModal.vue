<template>
  <div
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    @click.self="$emit('close')"
  >
    <div class="bg-surface border border-subtle rounded-xl p-6 max-w-sm w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
      <h2 class="font-bold text-base text-primary">Buat Folder Baru</h2>
      <div class="space-y-1.5">
        <label class="text-xs font-semibold text-secondary">Nama Folder</label>
        <div class="flex items-center">
          <span v-if="currentPrefix" class="text-xs font-mono text-muted mr-1">/{{ currentPrefix }}</span>
          <input
            v-model="folderName"
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
          @click="$emit('close')"
          class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary"
        >
          Batal
        </button>
        <button
          @click="createFolder"
          :disabled="isSubmitting || !folderName.trim()"
          class="px-4 py-1.5 text-xs font-semibold bg-brand text-brand-contrast rounded-lg shadow-xs hover:opacity-90 disabled:opacity-50"
        >
          {{ isSubmitting ? "Membuat..." : "Buat Folder" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useToast } from "../composables/useToast";

const props = defineProps<{
  bucketId: string;
  currentPrefix: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "created"): void;
}>();

const toast = useToast();
const folderName = ref("");
const isSubmitting = ref(false);

async function createFolder() {
  const clean = folderName.value.trim();
  if (!clean) return;

  isSubmitting.value = true;
  try {
    const res = await fetch(`/api/buckets/${props.bucketId}/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderName: clean,
        prefix: props.currentPrefix,
      }),
    });

    if (res.ok) {
      toast.success(`Folder '${clean}' berhasil dibuat`);
      emit("created");
      emit("close");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal membuat folder");
    }
  } catch {
    toast.error("Terjadi kesalahan jaringan");
  } finally {
    isSubmitting.value = false;
  }
}
</script>
