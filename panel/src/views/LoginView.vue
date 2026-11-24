<template>
  <div class="min-h-screen bg-canvas flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-surface border border-subtle rounded-2xl p-6 md:p-8 shadow-sm">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-brand-contrast font-mono font-bold text-base shadow-xs">
          G3
        </div>
        <div>
          <h1 class="font-bold text-lg tracking-tight text-primary">G3 Storage</h1>
          <p class="text-xs text-muted">S3 Object Storage over Google Drive</p>
        </div>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div v-if="errorMessage" class="p-3 text-xs bg-danger-bg text-danger border border-danger-border rounded-lg">
          {{ errorMessage }}
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Email Administrator</label>
          <input
            v-model="email"
            type="email"
            required
            placeholder="admin@g3.local"
            class="w-full px-3 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong transition-colors"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-semibold text-secondary">Password</label>
          <input
            v-model="password"
            type="password"
            required
            placeholder="••••••••••••"
            class="w-full px-3 py-2 text-sm bg-canvas border border-subtle rounded-lg text-primary focus:outline-none focus:border-border-strong transition-colors"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 px-4 bg-brand hover:opacity-90 active:scale-[0.99] text-brand-contrast text-sm font-semibold rounded-lg shadow-xs transition-all disabled:opacity-50"
        >
          {{ loading ? "Memproses..." : "Masuk ke Panel" }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "../composables/useToast";

const router = useRouter();
const toast = useToast();

const email = ref("admin@g3.local");
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
