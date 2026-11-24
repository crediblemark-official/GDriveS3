<template>
  <div class="min-h-screen bg-canvas text-primary flex flex-col md:flex-row antialiased">
    <!-- Desktop Sidebar -->
    <aside class="hidden md:flex flex-col w-64 border-r border-subtle bg-surface select-none shrink-0">
      <div class="h-14 px-4 flex items-center justify-between border-b border-subtle">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-brand-contrast font-mono font-bold text-sm shadow-xs">
            G3
          </div>
          <div>
            <div class="font-semibold text-sm tracking-tight leading-none text-primary">G3 Storage</div>
            <div class="text-[11px] text-muted font-mono leading-none mt-1">S3-over-Drive</div>
          </div>
        </div>
      </div>

      <!-- Navigation Links -->
      <nav class="flex-1 p-3 space-y-1 overflow-y-auto">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          :class="[
            $route.path.startsWith(item.path)
              ? 'bg-surface-raised text-primary shadow-xs'
              : 'text-secondary hover:text-primary hover:bg-surface-raised/50'
          ]"
        >
          <AppIcon :name="item.icon" class="w-4 h-4 text-muted" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <!-- Bottom Profile / Info -->
      <div class="p-3 border-t border-subtle space-y-2">
        <button
          @click="toggle"
          class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
        >
          <div class="flex items-center gap-2">
            <AppIcon :name="isDark ? 'moon' : 'sun'" class="w-4 h-4 text-muted" />
            <span>{{ isDark ? 'Mode Gelap' : 'Mode Terang' }}</span>
          </div>
          <span class="text-[10px] font-mono text-muted px-1.5 py-0.5 rounded bg-canvas border border-subtle">
            {{ isDark ? 'Dark' : 'Light' }}
          </span>
        </button>

        <div class="p-2 rounded-lg bg-surface-raised/60 border border-subtle flex items-center justify-between">
          <div class="flex items-center gap-2 overflow-hidden">
            <div class="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-xs font-mono font-semibold text-primary shrink-0">
              A
            </div>
            <div class="truncate text-xs text-secondary font-mono">admin@g3.local</div>
          </div>
          <button
            @click="logout"
            title="Keluar"
            class="text-muted hover:text-danger p-1 rounded transition-colors"
          >
            <AppIcon name="log-out" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Mobile Top Bar -->
      <header class="md:hidden h-14 border-b border-subtle bg-surface px-4 flex items-center justify-between sticky top-0 z-20">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-md bg-brand flex items-center justify-center text-brand-contrast font-mono font-bold text-xs">
            G3
          </div>
          <span class="font-semibold text-sm">G3 Storage</span>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            @click="toggle"
            class="p-1.5 rounded-lg border border-subtle text-secondary hover:text-primary"
            :title="isDark ? 'Mode Terang' : 'Mode Gelap'"
          >
            <AppIcon :name="isDark ? 'moon' : 'sun'" class="w-4 h-4" />
          </button>
          <button
            @click="showMobileMenu = !showMobileMenu"
            class="p-1.5 rounded-lg border border-subtle text-secondary hover:text-primary"
          >
            <AppIcon name="menu" class="w-5 h-5" />
          </button>
        </div>
      </header>

      <!-- View Container -->
      <main class="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <!-- Mobile Navigation Drawer -->
    <BottomSheet v-if="showMobileMenu" v-model="showMobileMenu" @close="showMobileMenu = false">
      <div class="p-4 space-y-2">
        <div class="text-xs font-semibold uppercase text-muted tracking-wider mb-2">Navigasi</div>
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          @click="showMobileMenu = false"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium"
          :class="[$route.path.startsWith(item.path) ? 'bg-surface-raised text-primary' : 'text-secondary']"
        >
          <AppIcon :name="item.icon" class="w-4 h-4 text-muted" />
          <span>{{ item.label }}</span>
        </RouterLink>
        <div class="pt-4 border-t border-subtle">
          <button
            @click="logout"
            class="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-danger font-medium rounded-lg hover:bg-danger/10"
          >
            <AppIcon name="log-out" class="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </div>
    </BottomSheet>

    <!-- Global Undo Toast System -->
    <AppToast />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import AppIcon from "./AppIcon.vue";
import AppToast from "./AppToast.vue";
import BottomSheet from "./BottomSheet.vue";
import { useTheme } from "../composables/useTheme";

const router = useRouter();
const { isDark, toggle, initTheme } = useTheme();
const showMobileMenu = ref(false);

onMounted(() => {
  initTheme();
});

const navItems = [
  { label: "Ringkasan", path: "/dashboard", icon: "dashboard" },
  { label: "Buckets & File", path: "/buckets", icon: "folder" },
  { label: "Google Drive Pool", path: "/accounts", icon: "database" },
  { label: "S3 Access Keys", path: "/keys", icon: "key" },
];

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  router.push("/login");
}
</script>
