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

    <!-- Second 2-Column Docked Swiss Hairline Grid: Audit & Backup/Transparency -->
    <div class="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-subtle border-b border-subtle bg-surface">
      <!-- Section 3: Audit & Reconcile (Drive <-> SQLite) -->
      <div class="p-5 sm:p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3 gap-2">
          <div>
            <h2 class="font-bold text-sm text-primary">Audit Sinkronisasi (Drive &harr; SQLite)</h2>
            <p class="text-xs text-muted mt-0.5">Deteksi file yang dihapus manual di Drive atau file orphan yang memakan kuota.</p>
          </div>
          <button
            type="button"
            @click="runAudit"
            :disabled="auditing"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shrink-0"
          >
            {{ auditing ? "Memindai..." : "Audit Drive" }}
          </button>
        </div>

        <div v-if="auditResult" class="space-y-3 text-xs font-mono">
          <div class="grid grid-cols-3 gap-2">
            <div class="p-2.5 bg-canvas border border-subtle rounded-lg">
              <div class="text-muted text-[10px] uppercase">File di Drive</div>
              <div class="font-bold text-primary mt-0.5">{{ auditResult.driveFilesCount }}</div>
            </div>
            <div class="p-2.5 bg-canvas border border-subtle rounded-lg">
              <div class="text-muted text-[10px] uppercase">Hilang di Drive</div>
              <div class="font-bold mt-0.5" :class="auditResult.missingInDrive.length ? 'text-danger' : 'text-success'">
                {{ auditResult.missingInDrive.length }}
              </div>
            </div>
            <div class="p-2.5 bg-canvas border border-subtle rounded-lg">
              <div class="text-muted text-[10px] uppercase">Orphan di Drive</div>
              <div class="font-bold mt-0.5" :class="auditResult.orphanInDrive.length ? 'text-warning' : 'text-success'">
                {{ auditResult.orphanInDrive.length }}
              </div>
            </div>
          </div>

          <div v-if="auditResult.accountErrors.length > 0" class="p-2.5 bg-danger-bg border border-danger-border rounded-lg text-danger">
            <div v-for="ae in auditResult.accountErrors" :key="ae.accountId">
              {{ ae.email }}: {{ ae.error }}
            </div>
          </div>

          <div v-if="auditResult.missingInDrive.length > 0" class="p-3 bg-canvas border border-subtle rounded-lg space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-danger">Objek ada di DB tapi hilang di Drive ({{ auditResult.missingInDrive.length }})</span>
              <button
                type="button"
                @click="cleanMissingFromDb"
                :disabled="cleaningAudit"
                class="px-2.5 py-1 rounded border border-danger-border text-danger hover:bg-danger-bg text-[11px]"
              >
                Bersihkan DB
              </button>
            </div>
            <div class="max-h-24 overflow-y-auto space-y-1 text-[11px] text-secondary">
              <div v-for="m in auditResult.missingInDrive" :key="m.objectId" class="truncate">
                {{ m.bucketName }}/{{ m.key }} ({{ m.accountEmail }})
              </div>
            </div>
          </div>

          <div v-if="auditResult.orphanInDrive.length > 0" class="p-3 bg-canvas border border-subtle rounded-lg space-y-2">
            <div class="flex items-center justify-between">
              <span class="font-semibold text-warning">File orphan di Drive ({{ auditResult.orphanInDrive.length }})</span>
              <button
                type="button"
                @click="deleteOrphansFromDrive"
                :disabled="cleaningAudit"
                class="px-2.5 py-1 rounded border border-warning-border text-warning hover:bg-warning-bg text-[11px]"
              >
                Hapus dari Drive
              </button>
            </div>
            <div class="max-h-24 overflow-y-auto space-y-1 text-[11px] text-secondary">
              <div v-for="o in auditResult.orphanInDrive" :key="o.driveFileId" class="truncate">
                {{ o.folderName }}/{{ o.name }} ({{ formatBytes(o.size) }})
              </div>
            </div>
          </div>

          <div
            v-if="auditResult.missingInDrive.length === 0 && auditResult.orphanInDrive.length === 0 && auditResult.accountErrors.length === 0"
            class="p-2.5 bg-success-bg border border-success-border rounded-lg text-success"
          >
            Semua metadata SQLite dan file Google Drive sinkron.
          </div>
        </div>

        <!-- Antrean Hapus Tertunda -->
        <div class="pt-3 border-t border-subtle space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-secondary">Antrean Hapus Drive Tertunda ({{ pendingDeletes.length }})</span>
            <button
              v-if="pendingDeletes.length > 0"
              type="button"
              @click="retryPendingDeletes"
              :disabled="retryingDeletes"
              class="px-2.5 py-1 text-[11px] font-mono border border-subtle rounded-lg hover:bg-surface-raised text-primary"
            >
              {{ retryingDeletes ? "Memproses..." : "Coba Hapus Ulang" }}
            </button>
          </div>
          <div v-if="pendingDeletes.length === 0" class="text-[11px] font-mono text-muted">
            Tidak ada antrean hapus Drive yang gagal.
          </div>
          <div v-else class="max-h-24 overflow-y-auto bg-canvas border border-subtle rounded-lg p-2 space-y-1 text-[11px] font-mono text-secondary">
            <div v-for="pd in pendingDeletes" :key="pd.id" class="truncate">
              {{ pd.objectKey || pd.driveFileId }} &bull; {{ pd.accountEmail }} ({{ pd.attempts }}x: {{ pd.lastError }})
            </div>
          </div>
        </div>
      </div>

      <!-- Section 4: Backup Metadata & Transparansi Arsitektur -->
      <div class="p-5 sm:p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-subtle pb-3 gap-2">
          <div>
            <h2 class="font-bold text-sm text-primary">Backup Metadata &amp; Batasan Sistem</h2>
            <p class="text-xs text-muted mt-0.5">Unduh snapshot SQLite konsisten dan pahami batasan arsitektur Google Drive.</p>
          </div>
          <a
            href="/api/storage/backup"
            class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-subtle bg-canvas hover:bg-surface-raised text-primary hover:scale-[1.02] active:scale-[0.98] transition-all shrink-0"
          >
            Unduh Snapshot .db
          </a>
        </div>

        <div class="space-y-2.5 text-xs text-secondary leading-relaxed">
          <div class="p-3 bg-canvas border border-subtle rounded-xl space-y-1">
            <div class="font-semibold text-primary">1. Kunci Enkripsi Wajib Disimpan</div>
            <p class="text-[11px] text-muted">
              Snapshot <code>gdrives3.db</code> tidak dapat mendekripsi token OAuth atau S3 Secret Key tanpa <code>GDRIVES3_ENCRYPTION_KEY</code> (atau file <code>.enckey</code>). Simpan keduanya di lokasi terpisah.
            </p>
          </div>
          <div class="p-3 bg-canvas border border-subtle rounded-xl space-y-1">
            <div class="font-semibold text-primary">2. Token OAuth Mode Testing (7 Hari)</div>
            <p class="text-[11px] text-muted">
              Jika OAuth consent screen di Google Cloud masih berstatus <em>Testing</em>, Google mencabut refresh token tiap 7 hari. Ubah ke <em>In Production</em> (atau Internal Workspace) untuk pemakaian jangka panjang.
            </p>
          </div>
          <div class="p-3 bg-canvas border border-subtle rounded-xl space-y-1">
            <div class="font-semibold text-primary">3. Sifat Proxy &amp; Rate Limit Drive</div>
            <p class="text-[11px] text-muted">
              Semua transfer melewati server GDriveS3 dan tunduk pada kuota API Google Drive (750 GB/hari/akun). Lihat kartu <em>Throttle (429)</em> di Dashboard untuk memantau batas API.
            </p>
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
import { formatBytes } from "../lib/format";

const toast = useToast();
const saving = ref(false);
const testing = ref(false);
const auditing = ref(false);
const cleaningAudit = ref(false);
const retryingDeletes = ref(false);
const auditResult = ref<any | null>(null);
const pendingDeletes = ref<any[]>([]);

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
  const [wRes, cRes, pRes] = await Promise.all([
    fetch("/api/settings/webhook"),
    fetch("/api/settings/cors"),
    fetch("/api/storage/pending-deletes"),
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
  if (pRes.ok) {
    pendingDeletes.value = await pRes.json();
  }
}

async function runAudit() {
  auditing.value = true;
  try {
    const res = await fetch("/api/storage/audit", { method: "POST" });
    if (res.ok) {
      auditResult.value = await res.json();
      toast.success("Audit Google Drive selesai");
    } else {
      toast.error("Gagal menjalankan audit Google Drive");
    }
  } finally {
    auditing.value = false;
  }
}

async function cleanMissingFromDb() {
  if (!auditResult.value?.missingInDrive?.length) return;
  if (!confirm(`Hapus ${auditResult.value.missingInDrive.length} metadata objek yang hilang di Drive dari SQLite?`)) return;
  cleaningAudit.value = true;
  try {
    const res = await fetch("/api/storage/audit/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missingObjectIds: auditResult.value.missingInDrive.map((m: any) => m.objectId),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`${data.removedDbObjects} metadata dibersihkan dari SQLite`);
      await runAudit();
    }
  } finally {
    cleaningAudit.value = false;
  }
}

async function deleteOrphansFromDrive() {
  if (!auditResult.value?.orphanInDrive?.length) return;
  if (!confirm(`Hapus permanen ${auditResult.value.orphanInDrive.length} file orphan dari Google Drive?`)) return;
  cleaningAudit.value = true;
  try {
    const res = await fetch("/api/storage/audit/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orphanItems: auditResult.value.orphanInDrive.map((o: any) => ({
          accountId: o.accountId,
          driveFileId: o.driveFileId,
        })),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`${data.deletedDriveFiles} file orphan dihapus dari Google Drive`);
      await runAudit();
    }
  } finally {
    cleaningAudit.value = false;
  }
}

async function retryPendingDeletes() {
  retryingDeletes.value = true;
  try {
    const res = await fetch("/api/storage/pending-deletes/retry", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      toast.success(`Berhasil menghapus ${data.succeeded} file, tersisa ${data.remaining}`);
      const pRes = await fetch("/api/storage/pending-deletes");
      if (pRes.ok) pendingDeletes.value = await pRes.json();
    }
  } finally {
    retryingDeletes.value = false;
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
