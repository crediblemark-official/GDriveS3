<template>
  <div class="min-h-screen bg-canvas flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-surface border border-subtle rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
      <!-- Abstract Geometric Logo & Brand -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 flex items-center justify-center shadow-xs shrink-0">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div>
          <h1 class="font-bold text-base tracking-tight text-primary leading-tight">GDriveS3</h1>
          <p class="text-xs text-muted font-mono leading-tight mt-0.5">S3-over-Drive Panel</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div v-if="errorMessage" class="p-3 text-xs bg-danger-bg text-danger border border-danger-border rounded-xl font-medium">
          {{ errorMessage }}
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Email Administrator</label>
          <input
            v-model="email"
            type="email"
            required
            placeholder="admin@gdrives3.local"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Password</label>
          <input
            v-model="password"
            type="password"
            required
            placeholder="••••••••••••"
            class="w-full px-3.5 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 px-4 bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 text-sm font-semibold rounded-lg shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
        >
          {{ loading ? "Memproses..." : "Masuk" }}
        </button>
      </form>

      <div class="pt-2 border-t border-subtle text-center text-[11px] text-muted font-mono">
        Default: admin@gdrives3.local / change-me-now
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";

const router = useRouter();
const toast = useToast();

const email = ref("admin@gdrives3.local");
const password = ref("change-me-now");
const loading = ref(false);
const errorMessage = ref("");

async function handleLogin() {
  loading.value = true;
  errorMessage.value = "";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, password: password.value }),
    });

    const data = await res.json();
    if (!res.ok) {
      errorMessage.value = data.error || "Login gagal";
      return;
    }

    toast.success("Berhasil masuk");
    router.push("/dashboard");
  } catch (err: any) {
    errorMessage.value = err.message || "Gagal menghubungi server";
  } finally {
    loading.value = false;
  }
}
</script>
