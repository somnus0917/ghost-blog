(function () {
  "use strict";

  var root = document.documentElement;
  var savedTheme = localStorage.getItem("somnus-theme") || "system";

  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "system" ? "light dark" : theme;
    document.querySelectorAll("[data-theme-icon]").forEach(function (icon) {
      icon.textContent = theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐";
    });
    document.querySelectorAll("[data-set-theme]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.setTheme === theme);
    });
  }

  applyTheme(savedTheme);

  document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var current = root.dataset.theme || "system";
      var next = current === "system" ? "light" : current === "light" ? "dark" : "system";
      localStorage.setItem("somnus-theme", next);
      applyTheme(next);
    });
  });

  document.querySelectorAll("[data-set-theme]").forEach(function (button) {
    button.addEventListener("click", function () {
      localStorage.setItem("somnus-theme", button.dataset.setTheme);
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

  function localizeCommentSignup(frame) {
    var doc;
    try {
      doc = frame.contentDocument;
    } catch (error) {
      return;
    }
    if (!doc || !doc.body) return;
    doc.querySelectorAll("p").forEach(function (paragraph) {
      if (/^成为.+的会员以开始评论。$/.test(paragraph.textContent.trim())) {
        paragraph.textContent = "注册一个免费账号即可评论，无需付费或订阅。";
      }
    });
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue.trim();
      if (/^成为.+的会员以开始评论。$/.test(value)) {
        node.nodeValue = node.nodeValue.replace(value, "注册一个免费账号即可评论，无需付费或订阅。");
      } else if (value === "立刻注册") {
        node.nodeValue = node.nodeValue.replace(value, "免费注册");
      } else if (value === "已经是会员？") {
        node.nodeValue = node.nodeValue.replace(value, "已有账号？");
      }
    }
  }

  var boundCommentFrames = new WeakSet();
  function bindCommentFrames() {
    document.querySelectorAll(".comments-shell iframe").forEach(function (frame) {
      if (boundCommentFrames.has(frame)) return;
      boundCommentFrames.add(frame);
      var applyCommentCopy = function () { localizeCommentSignup(frame); };
      frame.addEventListener("load", applyCommentCopy);
      applyCommentCopy();
      var attempts = 0;
      var poll = window.setInterval(function () {
        applyCommentCopy();
        attempts += 1;
        if (attempts >= 40) window.clearInterval(poll);
      }, 500);
    });
  }
  bindCommentFrames();
  new MutationObserver(bindCommentFrames).observe(document.body, {childList: true, subtree: true});

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
