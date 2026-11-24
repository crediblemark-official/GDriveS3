<template>
  <div class="bg-surface overflow-hidden">
    <div class="p-4 sm:px-6 border-b border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="font-bold text-sm text-primary flex items-center gap-2">
          <AppIcon name="code" class="w-4 h-4 text-secondary" />
          <span>Koneksi Klien AWS S3</span>
        </h2>
        <p class="text-xs text-muted mt-0.5">Contoh siap pakai untuk menghubungkan aplikasi Anda ke G3 Storage</p>
      </div>

      <!-- Language / Tool Tabs -->
      <div class="flex items-center gap-1 bg-canvas p-1 rounded-lg border border-subtle">
        <button
          v-for="tab in snippetTabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'px-2.5 py-1 text-xs font-mono font-medium rounded-md transition-all hover:scale-[1.01] active:scale-[0.98]',
            activeTab === tab.id
              ? 'bg-surface text-primary shadow-2xs font-semibold'
              : 'text-muted hover:text-primary',
          ]"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- Code Box with High-Contrast Well -->
    <div class="p-4 sm:px-6 bg-neutral-950 text-neutral-100 font-mono text-xs overflow-x-auto relative group">
      <button
        @click="copySnippet"
        class="absolute top-3 right-4 sm:right-6 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md text-[11px] transition-all flex items-center gap-1.5 opacity-90 hover:opacity-100 hover:scale-[1.02] active:scale-[0.98] shadow-2xs"
      >
        <AppIcon name="copy" class="w-3 h-3" />
        <span>Salin</span>
      </button>
      <pre class="leading-relaxed select-all"><code>{{ activeCode }}</code></pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import AppIcon from "./AppIcon.vue";
import { useToast } from "../composables/useToast";

const props = withDefaults(
  defineProps<{
    endpoint?: string;
  }>(),
  {
    endpoint: "http://localhost:9000",
  }
);

const toast = useToast();
const activeTab = ref("aws-cli");

const snippetTabs = [
  { id: "aws-cli", label: "AWS CLI" },
  { id: "nodejs", label: "Node.js (AWS SDK v3)" },
  { id: "python", label: "Python (boto3)" },
  { id: "rclone", label: "rclone.conf" },
];

const activeCode = computed(() => {
  const ep = props.endpoint || "http://localhost:9000";
  switch (activeTab.value) {
    case "aws-cli":
      return `# Konfigurasi AWS CLI menggunakan endpoint G3
export AWS_ACCESS_KEY_ID="G3_YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="G3_YOUR_SECRET_KEY"

# List semua bucket
aws s3 ls --endpoint-url ${ep}

# Unggah file ke bucket
aws s3 cp myfile.zip s3://testos/myfile.zip --endpoint-url ${ep}`;

    case "nodejs":
      return `import { S3Client, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: "${ep}",
  region: "us-east-1",
  credentials: {
    accessKeyId: "G3_YOUR_ACCESS_KEY_ID",
    secretAccessKey: "G3_YOUR_SECRET_KEY",
  },
  forcePathStyle: true, // Wajib true untuk path-style endpoint
});

// Unggah file
await s3.send(new PutObjectCommand({
  Bucket: "testos",
  Key: "data.json",
  Body: JSON.stringify({ hello: "world" }),
  ContentType: "application/json",
}));`;

    case "python":
      return `import boto3

s3 = boto3.client(
    's3',
    endpoint_url='${ep}',
    aws_access_key_id='G3_YOUR_ACCESS_KEY_ID',
    aws_secret_access_key='G3_YOUR_SECRET_KEY',
    region_name='us-east-1'
)

# List bucket
response = s3.list_buckets()
for b in response['Buckets']:
    print(b['Name'])`;

    case "rclone":
      return `[g3]
type = s3
provider = Other
env_auth = false
access_key_id = G3_YOUR_ACCESS_KEY_ID
secret_access_key = G3_YOUR_SECRET_KEY
endpoint = ${ep}
force_path_style = true`;

    default:
      return "";
  }
});

function copySnippet() {
  navigator.clipboard.writeText(activeCode.value);
  toast.success("Snippet disalin ke clipboard!");
}
</script>
