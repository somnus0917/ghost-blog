(function () {
  "use strict";

  var root = document.documentElement;
  var savedTheme = root.dataset.theme || "system";

  try {
    savedTheme = localStorage.getItem("somnus-theme") || savedTheme;
  } catch (error) {
    // Keep the server-provided system theme when storage is unavailable.
  }

  var boundCommentFrames = new WeakSet();

  function syncCommentFrame(frame) {
    var paper = getComputedStyle(root).getPropertyValue("--paper").trim();
    frame.style.backgroundColor = paper;
    try {
      var frameDocument = frame.contentDocument;
      if (!frameDocument || !frameDocument.documentElement || !frameDocument.body) return;
      // Ghost renders comments into a transparent srcdoc iframe. Set its canvas
      // explicitly so the browser's default white background cannot show through.
      frameDocument.documentElement.style.backgroundColor = paper;
      frameDocument.body.style.backgroundColor = paper;
    } catch (error) {
      // Future Ghost versions may use a cross-origin frame; auto mode still works.
    }
  }

  function bindCommentFrames() {
    document.querySelectorAll(".comments-shell iframe").forEach(function (frame) {
      if (!boundCommentFrames.has(frame)) {
        boundCommentFrames.add(frame);
        frame.addEventListener("load", function () { syncCommentFrame(frame); });
      }
      syncCommentFrame(frame);
    });
  }

  function applyTheme(theme) {
    var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = theme === "dark" || (theme === "system" && systemDark);
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "system" ? "light dark" : theme;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = dark ? "#171817" : "#fdfdfb";
    document.querySelectorAll(".comments-shell").forEach(function (shell) {
      // Ghost comments auto mode watches its parent class, not ancestor theme attributes.
      shell.classList.toggle("comments-dark", dark);
    });
    bindCommentFrames();
    document.querySelectorAll("[data-theme-icon]").forEach(function (icon) {
      icon.textContent = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐";
    });
    document.querySelectorAll("[data-set-theme]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.setTheme === theme);
    });
  }

  applyTheme(savedTheme);

  document.querySelectorAll(".comments-shell").forEach(function (shell) {
    new MutationObserver(bindCommentFrames).observe(shell, {childList: true, subtree: true});
  });

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (root.dataset.theme === "system") applyTheme("system");
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var current = root.dataset.theme || "system";
      var next = current === "system" ? "light" : current === "light" ? "dark" : "system";
      try { localStorage.setItem("somnus-theme", next); } catch (error) {}
      applyTheme(next);
    });
  });

  document.querySelectorAll("[data-set-theme]").forEach(function (button) {
    button.addEventListener("click", function () {
      try { localStorage.setItem("somnus-theme", button.dataset.setTheme); } catch (error) {}
      applyTheme(button.dataset.setTheme);
    });
  });

  var menuButton = document.querySelector("[data-menu-toggle]");
  var menu = document.querySelector("[data-menu]");
  if (menuButton && menu) {
    menuButton.addEventListener("click", function () {
      var open = menu.classList.toggle("is-open");
      menuButton.setAttribute("aria-expanded", String(open));
    });
  }

  var articleContent = document.querySelector(".article-content");
  var progressBar = document.querySelector("[data-reading-progress]");
  if (articleContent && progressBar) {
    var updateProgress = function () {
      var start = articleContent.getBoundingClientRect().top + window.scrollY;
      var distance = Math.max(articleContent.offsetHeight - window.innerHeight * 0.45, 1);
      var progress = Math.min(1, Math.max(0, (window.scrollY - start + 120) / distance));
      progressBar.style.transform = "scaleX(" + progress + ")";
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, {passive: true});
    window.addEventListener("resize", updateProgress);
  }

  var toc = document.querySelector("[data-article-toc]");
  if (toc && articleContent) {
    var headings = Array.from(articleContent.querySelectorAll("h2, h3"));
    var tocNav = toc.querySelector("nav");
    if (headings.length < 2) {
      toc.hidden = true;
    } else {
      headings.forEach(function (heading, index) {
        if (!heading.id) heading.id = "section-" + (index + 1);
        var link = document.createElement("a");
        link.href = "#" + heading.id;
        link.textContent = heading.textContent;
        link.className = heading.tagName === "H3" ? "is-sub" : "";
        tocNav.appendChild(link);
      });
      var tocLinks = Array.from(tocNav.querySelectorAll("a"));
      var updateActiveHeading = function () {
        var active = headings[0];
        headings.forEach(function (heading) {
          if (heading.getBoundingClientRect().top <= 190) active = heading;
        });
        tocLinks.forEach(function (link) {
          link.classList.toggle("is-active", link.hash === "#" + active.id);
        });
      };
      updateActiveHeading();
      window.addEventListener("scroll", updateActiveHeading, {passive: true});
    }
  }

  document.querySelectorAll("[data-copy-url]").forEach(function (button) {
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(window.location.href).then(function () {
        var old = button.textContent;
        button.textContent = "✓";
        window.setTimeout(function () { button.textContent = old; }, 1400);
      });
    });
  });

  function isMermaidCode(code) {
    if (!code) return false;
    if (code.matches("code[data-lang='mermaid'], code.language-mermaid")) return true;
    return /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context)\b/.test(
      code.textContent.trim()
    );
  }

  document.querySelectorAll(".gh-content pre").forEach(function (pre) {
    if (isMermaidCode(pre.querySelector("code"))) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = "Copy";
    button.addEventListener("click", function () {
      var code = pre.querySelector("code");
      navigator.clipboard.writeText(code ? code.innerText : pre.innerText).then(function () {
        button.textContent = "Copied";
        window.setTimeout(function () { button.textContent = "Copy"; }, 1400);
      });
    });
    pre.appendChild(button);
  });

  function renderMermaid() {
    var blocks = Array.from(document.querySelectorAll(".gh-content pre > code")).filter(isMermaidCode);
    if (!blocks.length || !window.mermaid) return;
    blocks.forEach(function (code) {
      var pre = code.parentElement;
      pre.className = "mermaid";
      pre.textContent = code.textContent;
    });
    window.mermaid.initialize({startOnLoad: false, theme: "neutral", securityLevel: "loose"});
    window.mermaid.run({querySelector: ".mermaid"});
  }

  renderMermaid();
})();
