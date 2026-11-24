<template>
  <div class="space-y-0">
    <!-- Teleport primary action into Sticky Top Header -->
    <Teleport to="#header-actions">
      <div class="flex items-center gap-2">
        <button
          @click="saveAll"
          :disabled="saving"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 shadow-2xs disabled:opacity-50"
        >
          <AppIcon name="check" class="w-3.5 h-3.5" />
          <span>{{ saving ? "Menyimpan..." : "Simpan" }}</span>
        </button>
      </div>
    </Teleport>

    <!-- 2-Column Docked Swiss Hairline Settings Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-subtle border-b border-subtle bg-surface">
      <!-- Section 1: Webhook & Alerts -->
      <div class="p-5 sm:p-6 space-y-5">
        <div class="flex items-center justify-between border-b border-subtle pb-3">
          <div>
            <h2 class="font-bold text-sm text-primary">Webhook & Peringatan</h2>
            <p class="text-xs text-muted mt-0.5">Kirim notifikasi ke Discord, Slack, atau endpoint HTTP saat kuota menipis.</p>
          </div>
          <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-mono font-medium">
            <input
              v-model="webhook.enabled"
              type="checkbox"
              class="w-4 h-4 rounded border-subtle accent-neutral-900 dark:accent-white"
            />
            <span class="text-primary">{{ webhook.enabled ? "Aktif" : "Mati" }}</span>
          </label>
        </div>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-secondary">Webhook URL</label>
            <input
              v-model="webhook.url"
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              class="w-full px-3.5 py-2 text-xs bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-secondary">Batas Peringatan Kuota (%)</label>
            <div class="flex items-center gap-3">
              <input
                v-model.number="webhook.thresholdPercent"
                type="number"
                min="10"
                max="99"
                class="w-24 px-3 py-2 text-xs bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong"
              />
              <span class="text-xs text-muted font-mono">Picu alert saat pemakaian akun &ge; {{ webhook.thresholdPercent }}%</span>
            </div>
          </div>

          <div class="space-y-2 pt-1">
            <label class="flex items-center gap-2.5 text-xs text-secondary cursor-pointer">
              <input v-model="webhook.notifyOnQuota" type="checkbox" class="w-4 h-4 rounded border-subtle accent-neutral-900 dark:accent-white" />
              <span>Kirim peringatan saat kuota akun Google Drive melewati batas</span>
            </label>
            <label class="flex items-center gap-2.5 text-xs text-secondary cursor-pointer">
              <input v-model="webhook.notifyOnAuthError" type="checkbox" class="w-4 h-4 rounded border-subtle accent-neutral-900 dark:accent-white" />
              <span>Kirim peringatan saat token OAuth gagal di-refresh</span>
            </label>
          </div>

          <div class="pt-3 border-t border-subtle flex items-center justify-between gap-2">
            <span class="text-[11px] font-mono text-muted">Payload JSON kompatibel Discord &amp; Slack</span>
            <button
              type="button"
              @click="testWebhook"
              :disabled="testing || !webhook.url.trim()"
              class="px-3 py-1.5 text-xs font-medium border border-subtle rounded-lg bg-canvas hover:bg-surface-raised text-primary hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {{ testing ? "Mengirim..." : "Uji Webhook" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Section 2: S3 CORS Policy (:9000) -->
      <div class="p-5 sm:p-6 space-y-5">
        <div class="border-b border-subtle pb-3">
          <h2 class="font-bold text-sm text-primary">Kebijakan CORS S3 (:9000)</h2>
          <p class="text-xs text-muted mt-0.5">Atur origin browser yang diizinkan mengakses endpoint S3 secara langsung.</p>
        </div>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-secondary">Allowed Origins (satu per baris atau <code>*</code>)</label>
            <textarea
              v-model="originsText"
              rows="3"
              placeholder="*&#10;https://app.domainmu.com"
              class="w-full px-3.5 py-2 text-xs bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong focus:ring-2 focus:ring-indigo-500/15 transition-all"
            ></textarea>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-semibold text-secondary">Allowed Methods</label>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="m in allMethods"
                :key="m"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono cursor-pointer transition-colors"
                :class="cors.allowedMethods.includes(m) ? 'bg-surface-raised border-strong text-primary font-semibold' : 'bg-canvas border-subtle text-muted'"
              >
                <input
                  type="checkbox"
                  :value="m"
                  v-model="cors.allowedMethods"
                  class="hidden"
                />
                <span>{{ m }}</span>
              </label>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-secondary">Allowed Headers</label>
              <input
                v-model="headersText"
                type="text"
                placeholder="*"
                class="w-full px-3 py-2 text-xs bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong"
              />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-semibold text-secondary">Max-Age Preflight (detik)</label>
              <input
                v-model.number="cors.maxAgeSeconds"
                type="number"
                min="0"
                class="w-full px-3 py-2 text-xs bg-canvas border border-subtle rounded-lg font-mono text-primary focus:outline-none focus:border-border-strong"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import AppIcon from "../components/AppIcon.vue";
import { useToast } from "../composables/useToast";

const toast = useToast();
const saving = ref(false);
const testing = ref(false);

const allMethods = ["GET", "PUT", "POST", "DELETE", "HEAD"];

const webhook = ref({
  enabled: false,
  url: "",
  thresholdPercent: 85,
  notifyOnQuota: true,
  notifyOnAuthError: true,
});

const cors = ref({
  allowedOrigins: ["*"],
  allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
  allowedHeaders: ["*"],
  maxAgeSeconds: 3600,
});

const originsText = ref("*");
const headersText = ref("*");

async function loadSettings() {
  const [wRes, cRes] = await Promise.all([
    fetch("/api/settings/webhook"),
    fetch("/api/settings/cors"),
  ]);

  if (wRes.ok) {
    webhook.value = await wRes.json();
  }
  if (cRes.ok) {
    const data = await cRes.json();
    cors.value = data;
    originsText.value = (data.allowedOrigins || ["*"]).join("\n");
    headersText.value = (data.allowedHeaders || ["*"]).join(", ");
  }
}

async function saveAll() {
  saving.value = true;
  try {
    const allowedOrigins = originsText.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedHeaders = headersText.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const [wRes, cRes] = await Promise.all([
      fetch("/api/settings/webhook", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhook.value),
      }),
      fetch("/api/settings/cors", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cors.value,
          allowedOrigins: allowedOrigins.length ? allowedOrigins : ["*"],
          allowedHeaders: allowedHeaders.length ? allowedHeaders : ["*"],
        }),
      }),
    ]);

    if (!wRes.ok) {
      const err = await wRes.json().catch(() => ({}));
      toast.error(err.error || "Gagal menyimpan webhook");
      return;
    }
    if (!cRes.ok) {
      const err = await cRes.json().catch(() => ({}));
      toast.error(err.error || "Gagal menyimpan CORS");
      return;
    }

    toast.success("Pengaturan Webhook & CORS disimpan");
  } finally {
    saving.value = false;
  }
}

async function testWebhook() {
  testing.value = true;
  try {
    const res = await fetch("/api/settings/webhook/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhook.value.url }),
    });
    if (res.ok) {
      toast.success("Notifikasi uji berhasil dikirim!");
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Gagal mengirim uji webhook");
    }
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  loadSettings();
});
</script>
