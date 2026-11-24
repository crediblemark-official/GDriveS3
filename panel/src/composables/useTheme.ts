import { ref } from "vue";

const isDark = ref(false);

export function useTheme() {
  function initTheme() {
    const saved = localStorage.getItem("g3_theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
    } else {
      setDark(false);
    }
  }

  function setDark(val: boolean) {
    isDark.value = val;
    if (val) {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("g3_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem("g3_theme", "light");
    }
  }

  function toggle() {
    setDark(!isDark.value);
  }

  return { isDark, toggle, initTheme };
}
