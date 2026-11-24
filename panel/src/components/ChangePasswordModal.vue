<template>
  <div
    class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
    @click.self="$emit('close')"
  >
    <div class="bg-surface border border-subtle rounded-2xl p-6 max-w-sm w-full shadow-md space-y-4 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-b-0 max-sm:p-5">
      <div class="sm:hidden w-10 h-1 rounded-full bg-border-subtle mx-auto -mt-1 mb-2"></div>

      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <AppIcon name="lock" class="w-4 h-4 text-secondary" />
          <h2 class="font-bold text-base text-primary">Ubah Password Admin</h2>
        </div>
        <button
          @click="$emit('close')"
          class="p-1 rounded-md text-muted hover:text-primary transition-colors"
        >
          &times;
        </button>
      </div>

      <form @submit.prevent="submit" class="space-y-3">
        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Password Lama</label>
          <input
            v-model="currentPassword"
            type="password"
            required
            autocomplete="current-password"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Password Baru</label>
          <input
            v-model="newPassword"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            placeholder="Minimal 8 karakter"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Konfirmasi Password</label>
          <input
            v-model="confirmPassword"
            type="password"
            required
            minlength="8"
            autocomplete="new-password"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <div class="flex justify-end gap-2 pt-2 border-t border-subtle">
          <button
            type="button"
            @click="$emit('close')"
            class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg hover:bg-surface-raised text-secondary transition-colors"
          >
            Batal
          </button>
          <button
            type="submit"
            :disabled="isSubmitting"
            class="px-4 py-1.5 text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {{ isSubmitting ? "Menyimpan..." : "Simpan" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import AppIcon from "./AppIcon.vue";
import { useToast } from "../composables/useToast";

const emit = defineEmits<{
  (e: "close"): void;
}>();

const toast = useToast();
const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const isSubmitting = ref(false);

async function submit() {
  if (newPassword.value !== confirmPassword.value) {
    toast.error("Konfirmasi password baru tidak cocok");
    return;
  }

  isSubmitting.value = true;
  try {
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    });

    if (res.ok) {
      toast.success("Password admin berhasil diperbarui");
      emit("close");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal mengubah password");
    }
  } catch {
    toast.error("Terjadi kesalahan jaringan");
  } finally {
    isSubmitting.value = false;
  }
}
</script>
