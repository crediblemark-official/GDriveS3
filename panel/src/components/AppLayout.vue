<template>
  <div class="h-screen w-full bg-canvas text-primary flex flex-col md:flex-row antialiased overflow-hidden">
    <!-- Desktop Sidebar (Docked Swiss Hairline Grid - Sticky Viewport Height) -->
    <aside class="hidden md:flex flex-col w-64 border-r border-subtle bg-surface select-none shrink-0 h-screen sticky top-0 z-30">
      <!-- Brand & Abstract Geometric Mark -->
      <div class="h-14 px-4 flex items-center justify-between border-b border-subtle shrink-0">
        <div class="flex items-center gap-2.5">
          <img src="/logo.svg" alt="GDriveS3" class="w-8 h-8 rounded-lg shadow-2xs shrink-0" />
          <div>
            <div class="font-bold text-sm tracking-tight leading-none text-primary">GDriveS3</div>
            <div class="text-[10px] text-muted font-mono leading-none mt-1">S3-over-Drive</div>
          </div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
          :class="[
            $route.path.startsWith(item.path)
              ? 'bg-surface-raised text-primary font-semibold shadow-2xs'
              : 'text-secondary hover:text-primary hover:bg-surface-raised/60'
          ]"
        >
          <AppIcon :name="item.icon" class="w-4 h-4 text-muted" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- Bottom Profile / Info -->
      <div class="p-3 border-t border-subtle space-y-2 shrink-0">
        <div class="p-2 rounded-lg bg-surface-raised/60 border border-subtle flex items-center justify-between gap-1">
          <button
            @click="showChangePassword = true"
            title="Ubah Password Admin"
            class="flex items-center gap-2 overflow-hidden text-left flex-1 rounded-md hover:bg-surface-raised p-1 -m-1 transition-colors"
          >
            <div class="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-xs font-mono font-semibold text-primary shrink-0 uppercase">
              {{ userInitial }}
            </div>
            <div class="truncate text-xs text-secondary font-mono">{{ currentUserEmail }}</div>
          </button>
          <button
            @click="logout"
            title="Keluar"
            class="text-muted hover:text-danger p-1 rounded-md hover:bg-danger-bg transition-colors shrink-0"
          >
            <AppIcon name="log-out" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content Area with Header-First Chrome -->
    <div class="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
      <!-- Universal Sticky Top Header (Single Source of Truth) -->
      <header class="h-14 shrink-0 border-b border-subtle bg-surface sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between">
        <div class="flex items-center gap-3 min-w-0">
          <button
            @click="showMobileMenu = !showMobileMenu"
            class="md:hidden p-1.5 -ml-1 rounded-lg border border-subtle text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
            aria-label="Menu Navigasi"
          >
            <AppIcon name="menu" class="w-4 h-4" />
          </button>
          
          <div class="flex items-center gap-2.5 min-w-0">
            <h1 class="font-bold text-base tracking-tight truncate text-primary">{{ currentTitle }}</h1>
            <span class="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-success-bg text-success border border-success-border">
              <span class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
              <span>S3 :9000</span>
            </span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Contextual Action Slot Teleport target -->
          <div id="header-actions" class="flex items-center gap-2"></div>

          <div class="h-4 w-px bg-subtle hidden sm:block"></div>

          <!-- Theme Toggle -->
          <button
            @click="toggle"
            :title="isDark ? 'Mode Terang' : 'Mode Gelap'"
            class="p-2 rounded-lg border border-subtle text-secondary hover:text-primary hover:bg-surface-raised hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <AppIcon :name="isDark ? 'moon' : 'sun'" class="w-4 h-4" />
          </button>
        </div>
      </header>

      <!-- Viewport App Workspace (Full-Width Viewport App Shell) -->
      <main class="flex-1 w-full overflow-y-auto">
        <div
          v-if="mustChangePassword && !dismissedPasswordBanner"
          class="bg-warning-bg border-b border-warning-border px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div class="flex items-center gap-2 text-warning font-medium">
            <AppIcon name="alert-triangle" class="w-4 h-4 shrink-0" />
            <span>Anda masih menggunakan password bawaan. Segera ubah password admin demi keamanan.</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="showChangePassword = true"
              class="px-2.5 py-1 rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 font-semibold text-[11px]"
            >
              Ubah Password
            </button>
            <button
              @click="dismissedPasswordBanner = true"
              class="px-1.5 py-1 text-muted hover:text-primary"
              aria-label="Tutup peringatan"
            >
              &times;
            </button>
          </div>
        </div>
        <RouterView v-if="headerMounted" />
      </main>
    </div>

    <!-- Mobile Navigation Drawer -->
    <BottomSheet v-if="showMobileMenu" v-model="showMobileMenu" @close="showMobileMenu = false">
      <div class="p-4 space-y-2">
        <div class="text-[11px] font-mono font-bold uppercase text-muted tracking-wider mb-2">Navigasi</div>
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          @click="showMobileMenu = false"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium"
          :class="[$route.path.startsWith(item.path) ? 'bg-surface-raised text-primary font-semibold' : 'text-secondary']"
        >
          <AppIcon :name="item.icon" class="w-4 h-4 text-muted" />
          <span>{{ item.label }}</span>
        </RouterLink>

        <div class="pt-4 border-t border-subtle space-y-1">
          <button
            @click="showMobileMenu = false; showChangePassword = true"
            class="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-secondary font-medium rounded-lg hover:bg-surface-raised transition-colors"
          >
            <AppIcon name="lock" class="w-4 h-4 text-muted" />
            <span>Ubah Password</span>
          </button>
          <button
            @click="logout"
            class="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-danger font-medium rounded-lg hover:bg-danger-bg transition-colors"
          >
            <AppIcon name="log-out" class="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </div>
    </BottomSheet>

    <!-- Change Password Modal -->
    <ChangePasswordModal
      v-if="showChangePassword"
      @changed="mustChangePassword = false"
      @close="showChangePassword = false"
    />

    <!-- Global Undo Toast System -->
    <AppToast />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import AppIcon from "./AppIcon.vue";
import AppToast from "./AppToast.vue";
import BottomSheet from "./BottomSheet.vue";
import ChangePasswordModal from "./ChangePasswordModal.vue";
import { useTheme } from "../composables/useTheme";

const router = useRouter();
const route = useRoute();
const { isDark, toggle, initTheme } = useTheme();
const showMobileMenu = ref(false);
const showChangePassword = ref(false);
const headerMounted = ref(false);
const currentUserEmail = ref("admin@gdrives3.local");
const mustChangePassword = ref(false);
const dismissedPasswordBanner = ref(false);

const userInitial = computed(() => (currentUserEmail.value[0] || "A").toUpperCase());

onMounted(async () => {
  initTheme();
  headerMounted.value = true;
  try {
    const res = await fetch("/api/me");
    if (res.ok) {
      const data = await res.json();
      if (data?.user?.email) currentUserEmail.value = data.user.email;
      mustChangePassword.value = Boolean(data?.user?.mustChangePassword);
    }
  } catch {
    // Ignore transient network errors
  }
});

const navItems = [
  { label: "Ringkasan", path: "/dashboard", icon: "dashboard" },
  { label: "Buckets & File", path: "/buckets", icon: "folder" },
  { label: "Google Drive Pool", path: "/accounts", icon: "database" },
  { label: "S3 Access Keys", path: "/keys", icon: "key" },
  { label: "Log Aktivitas", path: "/logs", icon: "terminal" },
  { label: "Pengaturan", path: "/settings", icon: "sliders" },
];

const currentTitle = computed(() => {
  const p = route.path;
  if (p === "/dashboard") return "Ringkasan";
  if (p === "/buckets") return "Buckets";
  if (p.startsWith("/buckets/")) return "File Manager";
  if (p === "/accounts") return "Google Drive Pool";
  if (p === "/keys") return "S3 Access Keys";
  if (p === "/logs") return "Log Aktivitas";
  if (p === "/settings") return "Pengaturan";
  return "GDriveS3";
});

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  router.push("/login");
}
</script>
