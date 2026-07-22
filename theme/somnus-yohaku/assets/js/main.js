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
  var commentFrameStyles = [
    '[data-testid="cta-box"] {',
    '  flex-direction: row !important;',
    '  align-items: center !important;',
    '  justify-content: flex-start !important;',
    '  gap: 12px !important;',
    '  padding: 10px 0 18px !important;',
    '}',
    '[data-testid="cta-box"] > h1,',
    '[data-testid="cta-box"] > p:first-of-type {',
    '  display: none !important;',
    '}',
    '[data-testid="signup-button"] {',
    '  margin: 0 !important;',
    '  padding: 10px 15px !important;',
    '  border-radius: 4px !important;',
    '  background: var(--somnus-comment-accent) !important;',
    '  font-size: 13px !important;',
    '}',
    '[data-testid="cta-box"] > p:last-of-type {',
    '  margin: 0 !important;',
    '  color: var(--somnus-comment-muted) !important;',
    '  font-size: 13px !important;',
    '  text-align: left !important;',
    '}',
    '[data-testid="cta-box"] > p:last-of-type span {',
    '  font-size: inherit !important;',
    '}',
    '[data-testid="signin-button"] {',
    '  color: var(--somnus-comment-accent) !important;',
    '  font-size: inherit !important;',
    '}',
    '@media (max-width: 479px) {',
    '  [data-testid="cta-box"] {',
    '    flex-wrap: wrap !important;',
    '    gap: 8px 12px !important;',
    '    padding-bottom: 14px !important;',
    '  }',
    '}'
  ].join("\n");

  function syncCommentFrame(frame) {
    var paper = getComputedStyle(root).getPropertyValue("--paper").trim();
    var accent = getComputedStyle(root).getPropertyValue("--accent").trim();
    var muted = getComputedStyle(root).getPropertyValue("--ink-soft").trim();
    frame.style.backgroundColor = paper;
    try {
      var frameDocument = frame.contentDocument;
      if (!frameDocument || !frameDocument.documentElement || !frameDocument.body) return;
      // Ghost renders comments into a transparent srcdoc iframe. Set its canvas
      // explicitly so the browser's default white background cannot show through.
      frameDocument.documentElement.style.backgroundColor = paper;
      frameDocument.documentElement.style.setProperty("--somnus-comment-accent", accent);
      frameDocument.documentElement.style.setProperty("--somnus-comment-muted", muted);
      frameDocument.body.style.backgroundColor = paper;
      if (frameDocument.head && !frameDocument.getElementById("somnus-comment-styles")) {
        var style = frameDocument.createElement("style");
        style.id = "somnus-comment-styles";
        style.textContent = commentFrameStyles;
        frameDocument.head.appendChild(style);
      }
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

  var engagement = document.querySelector("[data-post-engagement]");
  if (engagement) {
    var postUuid = engagement.dataset.postUuid;
    var engagementEndpoint = "/api/engagement/" + encodeURIComponent(postUuid);
    var viewsWrap = engagement.querySelector("[data-engagement-views-wrap]");
    var viewsValue = engagement.querySelector("[data-engagement-views]");
    var likesWrap = engagement.querySelector("[data-engagement-likes-wrap]");
    var likesValue = engagement.querySelector("[data-engagement-likes]");
    var presenceText = document.querySelector("[data-engagement-presence]");
    var likeButton = document.querySelector("[data-like-post]");
    var liked = false;
    var presenceTimer;

    function makeVisitorId() {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      return "visitor_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function readStorage(storage, key) {
      try { return storage.getItem(key) || ""; } catch (error) { return ""; }
    }

    function getPresenceVisitor() {
      var key = "somnus-presence-id";
      var value = readStorage(sessionStorage, key);
      if (!value) {
        value = makeVisitorId();
        try { sessionStorage.setItem(key, value); } catch (error) {}
      }
      return value;
    }

    function getLikeVisitor(create) {
      var key = "somnus-like-id";
      var value = readStorage(localStorage, key);
      if (!value && create) {
        value = makeVisitorId();
        try { localStorage.setItem(key, value); } catch (error) {}
      }
      return value;
    }

    function formatCount(value) {
      return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value) || 0));
    }

    function renderPresence(online) {
      if (!presenceText || online === null || online === undefined) return;
      var count = Math.max(1, Number(online) || 1);
      presenceText.textContent = count === 1
        ? "此刻，只有你在翻阅这一页。"
        : "此刻有 " + formatCount(count) + " 位读者正在翻阅这一页。";
      presenceText.hidden = false;
    }

    function renderEngagement(data) {
      var hasMetric = false;
      if (data.views !== null && data.views !== undefined) {
        viewsValue.textContent = formatCount(data.views);
        viewsWrap.hidden = false;
        hasMetric = true;
      }
      if (data.likes !== null && data.likes !== undefined) {
        likesValue.textContent = formatCount(data.likes);
        likesWrap.hidden = false;
        liked = Boolean(data.liked);
        likeButton.hidden = false;
        likeButton.classList.toggle("is-liked", liked);
        likeButton.textContent = liked ? "♥" : "♡";
        likeButton.setAttribute("aria-pressed", String(liked));
        likeButton.setAttribute("aria-label", liked ? "取消喜欢这篇文章" : "喜欢这篇文章");
        hasMetric = true;
      }
      engagement.hidden = !hasMetric;
      if (data.online !== null && data.online !== undefined && Number(data.online) > 0) renderPresence(data.online);
    }

    function readingPosition() {
      if (!articleContent) return 0;
      var start = articleContent.getBoundingClientRect().top + window.scrollY;
      var distance = Math.max(articleContent.offsetHeight - window.innerHeight, 1);
      return Math.min(1, Math.max(0, (window.scrollY - start) / distance));
    }

    function sendPresence(keepalive) {
      if (document.visibilityState === "hidden" && !keepalive) return;
      return fetch(engagementEndpoint + "/presence", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({visitor: getPresenceVisitor(), position: readingPosition()}),
        credentials: "same-origin",
        keepalive: Boolean(keepalive)
      }).then(function (response) {
        if (!response.ok) throw new Error("presence unavailable");
        return response.json();
      }).then(function (data) {
        renderPresence(data.online);
      }).catch(function () {});
    }

    function loadEngagement() {
      var likeVisitor = getLikeVisitor(false);
      var headers = likeVisitor ? {"x-like-visitor": likeVisitor} : {};
      return fetch(engagementEndpoint, {headers: headers, credentials: "same-origin"})
        .then(function (response) {
          if (!response.ok) throw new Error("engagement unavailable");
          return response.json();
        })
        .then(function (data) {
          renderEngagement(data);
          return true;
        })
        .catch(function () { return false; });
    }

    if (likeButton) {
      likeButton.addEventListener("click", function () {
        if (likeButton.disabled) return;
        likeButton.disabled = true;
        fetch(engagementEndpoint + "/like", {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({visitor: getLikeVisitor(true), liked: !liked}),
          credentials: "same-origin"
        }).then(function (response) {
          if (!response.ok) throw new Error("like unavailable");
          return response.json();
        }).then(function (data) {
          renderEngagement({likes: data.likes, liked: data.liked});
        }).catch(function () {}).finally(function () {
          likeButton.disabled = false;
        });
      });
    }

    loadEngagement().then(function (available) {
      if (!available) return;
      sendPresence(false);
      presenceTimer = window.setInterval(function () { sendPresence(false); }, 20000);
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") sendPresence(false);
      });
      window.addEventListener("pagehide", function () {
        window.clearInterval(presenceTimer);
        sendPresence(true);
      });
    });
  }

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
