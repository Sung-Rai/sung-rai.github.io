(() => {
  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  const getStoredTheme = () => {
    try {
      return localStorage.getItem("theme");
    } catch (_) {
      return null;
    }
  };

  const storeTheme = (theme) => {
    try {
      localStorage.setItem("theme", theme);
    } catch (_) {
      // The toggle still works if browser storage is unavailable.
    }
  };

  const storedTheme = getStoredTheme();
  root.dataset.theme =
    storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : systemTheme.matches
        ? "dark"
        : "light";

  const initialiseToggle = () => {
    const toggle = document.querySelector(".theme-toggle");
    if (!toggle) return;

    const label = toggle.querySelector(".theme-toggle__label");

    const updateToggle = () => {
      const isDark = root.dataset.theme === "dark";

      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.setAttribute(
        "aria-label",
        `Switch to ${isDark ? "light" : "dark"} mode`
      );

      label.textContent = isDark ? "Light mode" : "Dark mode";
    };

    toggle.addEventListener("click", () => {
      const nextTheme =
        root.dataset.theme === "dark" ? "light" : "dark";

      root.dataset.theme = nextTheme;
      storeTheme(nextTheme);
      updateToggle();
    });

    const updateFromSystemTheme = (event) => {
      if (getStoredTheme()) return;

      root.dataset.theme = event.matches ? "dark" : "light";
      updateToggle();
    };

    if ("addEventListener" in systemTheme) {
      systemTheme.addEventListener("change", updateFromSystemTheme);
    } else {
      systemTheme.addListener(updateFromSystemTheme);
    }

    updateToggle();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseToggle, {
      once: true
    });
  } else {
    initialiseToggle();
  }
})();