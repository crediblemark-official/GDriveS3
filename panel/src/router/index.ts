import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("../views/LoginView.vue"),
    },
    {
      path: "/",
      component: () => import("../components/AppLayout.vue"),
      children: [
        {
          path: "",
          redirect: "/dashboard",
        },
        {
          path: "dashboard",
          name: "dashboard",
          component: () => import("../views/DashboardView.vue"),
        },
        {
          path: "buckets",
          name: "buckets",
          component: () => import("../views/BucketsView.vue"),
        },
        {
          path: "buckets/:id",
          name: "file-manager",
          component: () => import("../views/FileManagerView.vue"),
        },
        {
          path: "accounts",
          name: "accounts",
          component: () => import("../views/AccountsView.vue"),
        },
        {
          path: "keys",
          name: "keys",
          component: () => import("../views/KeysView.vue"),
        },
        {
          path: "logs",
          name: "logs",
          component: () => import("../views/LogsView.vue"),
        },
      ],
    },
  ],
});

export default router;
