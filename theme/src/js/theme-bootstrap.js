try {
  const theme = localStorage.getItem("somnus-theme") || "system";
  const isDark = theme === "dark"
    || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const themeColor = document.querySelector('meta[name="theme-color"]');

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "system" ? "light dark" : theme;
  if (themeColor) themeColor.content = isDark ? "#171817" : "#fdfdfb";
} catch {
  document.documentElement.dataset.theme = "system";
  document.documentElement.style.colorScheme = "light dark";
}
