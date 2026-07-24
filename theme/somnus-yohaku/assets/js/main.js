(function () {
  "use strict";

  var root = document.documentElement;
  var runtimeScript = document.currentScript;
  var runtimeAssets = runtimeScript ? runtimeScript.dataset : {};
  var savedTheme = root.dataset.theme || "system";

  try {
    savedTheme = localStorage.getItem("somnus-theme") || savedTheme;
  } catch (error) {
    // Keep the server-provided system theme when storage is unavailable.
  }

  document.querySelectorAll("[data-character-excerpt]").forEach(function (excerpt) {
    var maximumCharacters = Number(excerpt.dataset.characterExcerpt) || 80;
    var normalizedText = excerpt.textContent.trim().replace(/\s+/g, " ");
    var characters = Array.from(normalizedText);
    if (characters.length <= maximumCharacters) return;
    excerpt.textContent = characters.slice(0, maximumCharacters).join("").trimEnd() + "…";
  });

  function loadScriptOnce(id, source) {
    if (!source) return Promise.reject(new Error("Missing script source for " + id));
    var existing = document.getElementById(id);
    if (existing) {
      if (existing.dataset.loaded === "true") return Promise.resolve();
      return new Promise(function (resolve, reject) {
        existing.addEventListener("load", resolve, {once: true});
        existing.addEventListener("error", reject, {once: true});
      });
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.id = id;
      script.src = source;
      script.async = true;
      script.addEventListener("load", function () {
        script.dataset.loaded = "true";
        resolve();
      }, {once: true});
      script.addEventListener("error", reject, {once: true});
      document.head.appendChild(script);
    });
  }

  function runWhenIdle(callback, timeout) {
    if ("requestIdleCallback" in window) {
      return window.requestIdleCallback(callback, {timeout: timeout || 1500});
    }
    return window.setTimeout(callback, Math.min(timeout || 1500, 250));
  }

  var portalPromise;

  function loadPortal() {
    if (portalPromise) return portalPromise;
    var existing = document.getElementById("somnus-portal");
    if (existing) {
      portalPromise = Promise.resolve();
      return portalPromise;
    }
    portalPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.id = "somnus-portal";
      script.src = runtimeAssets.portalSrc;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-i18n", "true");
      script.setAttribute("data-ghost", runtimeAssets.portalGhost);
      script.setAttribute("data-api", runtimeAssets.portalApi);
      script.setAttribute("data-key", runtimeAssets.portalKey);
      script.setAttribute("data-locale", runtimeAssets.portalLocale || "zh");
      script.addEventListener("load", resolve, {once: true});
      script.addEventListener("error", reject, {once: true});
      document.head.appendChild(script);
    });
    return portalPromise;
  }

  function openPortal(action) {
    var targetHash = "#/portal/" + action;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    loadPortal()
      .then(function () {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      })
      .catch(function (error) {
        console.error("Ghost Portal failed to load", error);
      });
  }

  var searchPromise;
  var searchReady = false;

  function loadSearch() {
    if (searchPromise) return searchPromise;
    var existing = document.querySelector("script[data-sodo-search]");
    if (existing) {
      searchReady = existing.dataset.loaded === "true";
      searchPromise = Promise.resolve();
      return searchPromise;
    }
    searchPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.id = "somnus-search";
      script.src = runtimeAssets.searchSrc;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-key", runtimeAssets.searchKey);
      script.setAttribute("data-styles", runtimeAssets.searchStyles);
      script.setAttribute("data-sodo-search", runtimeAssets.searchRoot);
      script.setAttribute("data-locale", runtimeAssets.searchLocale || "zh");
      script.addEventListener("load", function () {
        script.dataset.loaded = "true";
        searchReady = true;
        resolve();
      }, {once: true});
      script.addEventListener("error", function (error) {
        script.remove();
        searchPromise = null;
        reject(error);
      }, {once: true});
      document.head.appendChild(script);
    });
    return searchPromise;
  }

  function removeSearchLoading(loading, frameContainer) {
    if (frameContainer) frameContainer.style.removeProperty("visibility");
    if (loading && loading.isConnected) loading.remove();
  }

  function showSearchLoading() {
    var existing = document.querySelector(".search-loading");
    if (existing) return existing;

    var loading = document.createElement("div");
    loading.className = "search-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.innerHTML = [
      '<div class="search-loading-panel">',
      '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">',
      '<path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"></path>',
      "</svg>",
      "<span>正在打开搜索…</span>",
      '<i class="search-loading-spinner" aria-hidden="true"></i>',
      "</div>"
    ].join("");
    document.body.appendChild(loading);
    return loading;
  }

  var searchBackdropObserver;

  function mountSearchBackdrop(searchFrame, darkTheme) {
    if (searchBackdropObserver) searchBackdropObserver.disconnect();

    var backdrop = document.querySelector(".search-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.className = "search-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(backdrop);
    }
    backdrop.classList.toggle("is-dark", darkTheme);

    searchBackdropObserver = new MutationObserver(function () {
      if (searchFrame.isConnected) return;
      backdrop.remove();
      searchBackdropObserver.disconnect();
      searchBackdropObserver = null;
    });
    searchBackdropObserver.observe(document.body, {childList: true, subtree: true});
  }

  function revealSearchInterface(loading) {
    var frameContainer = null;
    var startedAt = Date.now();
    var rootStyles = window.getComputedStyle(root);
    var selectedTheme = root.dataset.theme || "system";
    var darkTheme = selectedTheme === "dark"
      || (selectedTheme === "system"
        && window.matchMedia
        && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var searchPalette = {
      paper: rootStyles.getPropertyValue("--paper").trim(),
      raised: rootStyles.getPropertyValue("--paper-raised").trim(),
      soft: rootStyles.getPropertyValue("--paper-soft").trim(),
      ink: rootStyles.getPropertyValue("--ink").trim(),
      inkSoft: rootStyles.getPropertyValue("--ink-soft").trim(),
      inkFaint: rootStyles.getPropertyValue("--ink-faint").trim(),
      line: rootStyles.getPropertyValue("--line").trim()
    };

    function check() {
      var frames = document.querySelectorAll('.gh-root-frame iframe[title="portal-popup"]');
      var searchFrame = Array.from(frames).find(function (frame) {
        try {
          return Boolean(frame.contentDocument
            && frame.contentDocument.querySelector('link[href*="sodo-search"]'));
        } catch (error) {
          return false;
        }
      });

      if (searchFrame) {
        frameContainer = searchFrame.parentElement;
        if (frameContainer) frameContainer.style.visibility = "hidden";
        try {
          var frameDocument = searchFrame.contentDocument;
          var stylesheet = frameDocument
            && frameDocument.querySelector('link[href*="sodo-search"]');
          var input = frameDocument && frameDocument.querySelector("input");
          var pendingContent = frameDocument && frameDocument.querySelector(".ghost-display");

          if (input && stylesheet && stylesheet.sheet) {
            var overrides = frameDocument.getElementById("somnus-search-overrides");
            if (!overrides) {
              overrides = frameDocument.createElement("style");
              overrides.id = "somnus-search-overrides";
              frameDocument.head.appendChild(overrides);
            }
            overrides.textContent = [
              "html, body {",
              "  background: transparent !important;",
              "  color: " + searchPalette.ink + " !important;",
              "  color-scheme: " + (darkTheme ? "dark" : "light") + ";",
              "}",
              "body > div:first-child {",
              "  background: transparent !important;",
              "  backdrop-filter: none !important;",
              "}",
              ".bg-white { background-color: " + searchPalette.raised + " !important; }",
              ".bg-neutral-100 { background-color: " + searchPalette.soft + " !important; }",
              ".border-neutral-200 { border-color: " + searchPalette.line + " !important; }",
              ".text-neutral-800, .text-neutral-900 { color: " + searchPalette.ink + " !important; }",
              ".text-neutral-400 { color: " + searchPalette.inkSoft + " !important; }",
              ".text-neutral-500 { color: " + searchPalette.inkFaint + " !important; }",
              "input {",
              "  background: transparent !important;",
              "  color: " + searchPalette.ink + " !important;",
              "  caret-color: " + searchPalette.ink + " !important;",
              "}",
              "input::placeholder { color: " + searchPalette.inkFaint + " !important; }"
            ].join("\n");

            if (pendingContent) pendingContent.classList.remove("ghost-display");
            if (frameContainer) frameContainer.style.background = "transparent";
            searchFrame.style.background = "transparent";
            mountSearchBackdrop(searchFrame, darkTheme);
            removeSearchLoading(loading, frameContainer);
            window.requestAnimationFrame(function () { input.focus(); });
            return;
          }
        } catch (error) {
          removeSearchLoading(loading, frameContainer);
          return;
        }
      }

      if (Date.now() - startedAt > 5000) {
        removeSearchLoading(loading, frameContainer);
        return;
      }
      window.requestAnimationFrame(check);
    }

    window.requestAnimationFrame(check);
  }

  function pageContainsMath() {
    if (document.querySelector("[data-latex-editor]")) return true;
    var content = document.querySelector(".gh-content");
    if (!content) return false;
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    var node;
    var mathPattern = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|(^|[^\\])\$[^$\n]+\$/;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (parent && parent.closest("pre, code, script, style, textarea")) continue;
      if (mathPattern.test(node.textContent)) return true;
    }
    return false;
  }

  function loadMathJaxIfNeeded() {
    if (!pageContainsMath()) return;
    window.MathJax = {
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]]
      },
      options: {skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]}
    };
    loadScriptOnce("somnus-mathjax", runtimeAssets.mathjaxSrc)
      .then(function () {
        if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
          return window.MathJax.startup.promise;
        }
      })
      .then(function () {
        document.dispatchEvent(new CustomEvent("somnus:mathjax-ready"));
      })
      .catch(function (error) {
        console.error("MathJax failed to load", error);
      });
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
      if (!frameDocument.documentElement.dataset.somnusSignupBound) {
        frameDocument.documentElement.dataset.somnusSignupBound = "true";
        frameDocument.addEventListener("click", function (event) {
          var signupButton = event.target.closest && event.target.closest('[data-testid="signup-button"]');
          var signinButton = event.target.closest && event.target.closest('[data-testid="signin-button"]');
          if (signupButton) {
            event.preventDefault();
            event.stopImmediatePropagation();
            window.location.assign("/signup/");
          } else if (signinButton) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openPortal("signin");
          }
        }, true);
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

  function activateComments(shell) {
    if (shell.dataset.commentsState === "loading" || shell.dataset.commentsState === "loaded") {
      return;
    }
    var template = shell.querySelector("[data-comments-template]");
    var mount = shell.querySelector("[data-comments-mount]");
    var placeholder = shell.querySelector("[data-comments-placeholder]");
    var source = template && template.content.querySelector("script[data-ghost-comments]");
    if (!source || !mount) {
      if (placeholder) placeholder.textContent = "评论暂时不可用。";
      shell.dataset.commentsState = "error";
      return;
    }

    shell.dataset.commentsState = "loading";
    if (placeholder) {
      var message = placeholder.querySelector("span");
      if (message) message.textContent = "正在加载评论…";
      var button = placeholder.querySelector("button");
      if (button) button.disabled = true;
    }

    var script = document.createElement("script");
    Array.from(source.attributes).forEach(function (attribute) {
      if (attribute.name !== "defer") script.setAttribute(attribute.name, attribute.value);
    });
    script.async = true;
    script.addEventListener("load", function () {
      shell.dataset.commentsState = "loaded";
      if (placeholder) placeholder.hidden = true;
      applyTheme(root.dataset.theme || "system");
    }, {once: true});
    script.addEventListener("error", function () {
      shell.dataset.commentsState = "error";
      if (placeholder) {
        placeholder.hidden = false;
        placeholder.textContent = "评论加载失败，请刷新页面后重试。";
      }
    }, {once: true});
    template.remove();
    mount.appendChild(script);
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
    if (window.somnusRenderTurnstile) window.somnusRenderTurnstile();
  }

  applyTheme(savedTheme);

  document.querySelectorAll(".comments-shell").forEach(function (shell) {
    new MutationObserver(bindCommentFrames).observe(shell, {childList: true, subtree: true});
    var loadButton = shell.querySelector("[data-load-comments]");
    if (loadButton) {
      loadButton.addEventListener("click", function () { activateComments(shell); });
    }
    if ("IntersectionObserver" in window) {
      var commentsObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          activateComments(entry.target);
        });
      }, {rootMargin: "800px 0px"});
      commentsObserver.observe(shell);
    } else {
      activateComments(shell);
    }
  });

  if (window.location.hash === "#comments") {
    var linkedComments = document.querySelector(".comments-shell");
    if (linkedComments) activateComments(linkedComments);
  }

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

  document.addEventListener("click", function (event) {
    var portalLink = event.target.closest && event.target.closest('[data-portal], a[href^="#/portal/"]');
    if (!portalLink) return;
    var action = portalLink.dataset.portal
      || (portalLink.getAttribute("href") || "").replace(/^#\/portal\/?/, "");
    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "signup") {
      window.location.assign("/signup/");
      return;
    }
    if (action) openPortal(action);
  }, true);

  document.addEventListener("click", function (event) {
    var searchTrigger = event.target.closest && event.target.closest("[data-ghost-search]");
    if (!searchTrigger) return;
    if (searchReady) {
      window.requestAnimationFrame(function () { revealSearchInterface(null); });
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    var searchLoading = showSearchLoading();
    loadSearch()
      .then(function () {
        revealSearchInterface(searchLoading);
        searchTrigger.click();
      })
      .catch(function (error) {
        removeSearchLoading(searchLoading);
        console.error("Ghost Search failed to load", error);
      });
  }, true);

  document.querySelectorAll("[data-ghost-search]").forEach(function (searchTrigger) {
    var prewarmSearch = function () {
      loadSearch().catch(function () {
        // A click can retry after a transient preload failure.
      });
    };
    searchTrigger.addEventListener("pointerenter", prewarmSearch, {once: true, passive: true});
    searchTrigger.addEventListener("focus", prewarmSearch, {once: true, passive: true});
    searchTrigger.addEventListener("touchstart", prewarmSearch, {once: true, passive: true});
  });

  if (
    /^#\/portal(?:\/|$)/.test(window.location.hash)
    || new URLSearchParams(window.location.search).has("token")
  ) {
    loadPortal().catch(function (error) {
      console.error("Ghost Portal failed to load", error);
    });
  }

  var menuButton = document.querySelector("[data-menu-toggle]");
  var menu = document.querySelector("[data-menu]");
  if (menuButton && menu) {
    var setMenuOpen = function (open) {
      menu.classList.toggle("is-open", open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "关闭主导航" : "打开主导航");
    };
    menuButton.addEventListener("click", function () {
      setMenuOpen(!menu.classList.contains("is-open"));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !menu.classList.contains("is-open")) return;
      setMenuOpen(false);
      menuButton.focus();
    });
    document.addEventListener("click", function (event) {
      if (
        !menu.classList.contains("is-open")
        || menu.contains(event.target)
        || menuButton.contains(event.target)
      ) return;
      setMenuOpen(false);
    });
  }

  var articleContent = document.querySelector(".article-content");
  var progressBar = document.querySelector("[data-reading-progress]");
  if (articleContent && progressBar) {
    var articleStart = 0;
    var articleDistance = 1;
    var progressFrame = 0;
    var updateProgress = function () {
      progressFrame = 0;
      var progress = Math.min(1, Math.max(0, (window.scrollY - articleStart + 120) / articleDistance));
      progressBar.style.transform = "scaleX(" + progress + ")";
    };
    var scheduleProgress = function () {
      if (!progressFrame) progressFrame = window.requestAnimationFrame(updateProgress);
    };
    var measureArticle = function () {
      articleStart = articleContent.getBoundingClientRect().top + window.scrollY;
      articleDistance = Math.max(articleContent.offsetHeight - window.innerHeight * 0.45, 1);
      scheduleProgress();
    };
    measureArticle();
    window.addEventListener("scroll", scheduleProgress, {passive: true});
    window.addEventListener("resize", measureArticle);
    if ("ResizeObserver" in window) {
      new ResizeObserver(measureArticle).observe(articleContent);
    }
  }

  var toc = document.querySelector("[data-article-toc]");
  if (toc && articleContent) {
    var headings = Array.from(articleContent.querySelectorAll("h2, h3"));
    var tocNav = toc.querySelector("nav");
    if (headings.length < 2) {
      toc.hidden = true;
      var articleLayout = toc.closest(".article-layout");
      if (articleLayout) articleLayout.classList.add("article-layout--no-toc");
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
      var setActiveHeading = function (active) {
        tocLinks.forEach(function (link) {
          link.classList.toggle("is-active", link.hash === "#" + active.id);
        });
      };
      var initialActive = headings[0];
      headings.forEach(function (heading) {
        if (heading.getBoundingClientRect().top <= 190) initialActive = heading;
      });
      setActiveHeading(initialActive);
      if ("IntersectionObserver" in window) {
        var activeHeadingIndex = headings.indexOf(initialActive);
        var lastTocScrollY = window.scrollY;
        var headingObserver = new IntersectionObserver(function (entries) {
          var scrollingDown = window.scrollY >= lastTocScrollY;
          entries.forEach(function (entry) {
            var index = headings.indexOf(entry.target);
            if (scrollingDown && !entry.isIntersecting && entry.boundingClientRect.top < 190) {
              activeHeadingIndex = Math.max(activeHeadingIndex, index);
            } else if (!scrollingDown && entry.isIntersecting) {
              activeHeadingIndex = Math.max(0, index - 1);
            }
          });
          lastTocScrollY = window.scrollY;
          setActiveHeading(headings[activeHeadingIndex]);
        }, {rootMargin: "-190px 0px 0px 0px"});
        headings.forEach(function (heading) { headingObserver.observe(heading); });
      }
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

  var signupForm = document.querySelector("[data-turnstile-signup]");
  if (signupForm) {
    var signupEmail = signupForm.querySelector('input[name="email"]');
    var signupButton = signupForm.querySelector("[data-signup-submit]");
    var signupFeedback = signupForm.querySelector("[data-signup-feedback]");
    var signupWidget = signupForm.querySelector("[data-turnstile-widget]");
    var signupWidgetId = null;
    var signupWidgetTimer = null;

    function renderSignupTurnstile(attempt) {
      window.clearTimeout(signupWidgetTimer);
      if (!window.turnstile) {
        if ((attempt || 0) < 50) {
          signupWidgetTimer = window.setTimeout(function () {
            renderSignupTurnstile((attempt || 0) + 1);
          }, 100);
        }
        return;
      }
      if (signupWidgetId !== null) {
        try { window.turnstile.remove(signupWidgetId); } catch (error) {}
        signupWidgetId = null;
      }
      signupWidget.innerHTML = "";
      var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var currentTheme = root.dataset.theme || "system";
      var dark = currentTheme === "dark" || (currentTheme === "system" && systemDark);
      signupWidgetId = window.turnstile.render(signupWidget, {
        sitekey: signupWidget.dataset.sitekey,
        action: "member-signup",
        theme: dark ? "dark" : "light",
        language: "zh-cn",
        size: "flexible"
      });
    }

    window.somnusRenderTurnstile = function () {
      renderSignupTurnstile(0);
    };
    renderSignupTurnstile(0);

    function setSignupState(state, message) {
      signupForm.dataset.state = state;
      signupButton.disabled = state === "loading" || state === "success";
      signupEmail.disabled = state === "loading" || state === "success";
      signupFeedback.textContent = message || "";
    }

    signupForm.addEventListener("submit", function (event) {
      event.preventDefault();
      signupEmail.value = signupEmail.value.trim();
      if (!signupEmail.checkValidity()) {
        signupEmail.reportValidity();
        setSignupState("error", "请输入有效的邮箱地址。");
        return;
      }

      var turnstileToken = window.turnstile && signupWidgetId !== null
        ? window.turnstile.getResponse(signupWidgetId)
        : "";
      if (!turnstileToken) {
        setSignupState("error", "请先完成人机验证。");
        return;
      }

      setSignupState("loading", "正在发送，请稍候…");
      fetch("/members/api/integrity-token/", {
        method: "GET",
        credentials: "same-origin",
        headers: {"accept": "text/plain"}
      }).then(function (response) {
        if (!response.ok) throw new Error("integrity token unavailable");
        return response.text();
      }).then(function (integrityToken) {
        return fetch("/members/api/send-magic-link/", {
          method: "POST",
          credentials: "same-origin",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({
            email: signupEmail.value,
            emailType: "signup",
            autoRedirect: true,
            integrityToken: integrityToken,
            turnstileToken: turnstileToken
          })
        });
      }).then(function (response) {
        if (response.ok) return;
        return response.json().catch(function () { return {}; }).then(function (payload) {
          var error = payload && payload.errors && payload.errors[0];
          throw new Error(error && error.message ? error.message : "signup failed");
        });
      }).then(function () {
        signupEmail.value = "";
        setSignupState("success", "注册邮件已发送，请打开邮箱完成验证。");
      }).catch(function (error) {
        var tooMany = /too many|rate|频繁/i.test(error.message);
        setSignupState("error", tooMany ? "请求过于频繁，请稍后再试。" : "发送失败，请刷新页面后重试。");
        if (window.turnstile && signupWidgetId !== null) window.turnstile.reset(signupWidgetId);
      });
    });
  }

  var engagement = document.querySelector("[data-post-engagement]");
  var localGhostPreview = /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (engagement && !localGhostPreview) {
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
        body: JSON.stringify({position: readingPosition()}),
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
      return fetch(engagementEndpoint, {credentials: "same-origin"})
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
          body: JSON.stringify({liked: !liked}),
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

    runWhenIdle(function () {
      loadEngagement().then(function (available) {
        if (!available) return;
        sendPresence(false);
        presenceTimer = window.setInterval(function () { sendPresence(false); }, 30000);
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "visible") sendPresence(false);
        });
        window.addEventListener("pagehide", function () {
          window.clearInterval(presenceTimer);
          sendPresence(true);
        });
      });
    }, 1200);
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

  function renderMermaid(blocks) {
    if (!blocks.length || !window.mermaid) return;
    blocks.forEach(function (code) {
      var pre = code.parentElement;
      pre.className = "mermaid";
      pre.textContent = code.textContent;
    });
    window.mermaid.initialize({startOnLoad: false, theme: "neutral", securityLevel: "loose"});
    window.mermaid.run({querySelector: ".mermaid"});
  }

  var mermaidBlocks = Array.from(document.querySelectorAll(".gh-content pre > code")).filter(isMermaidCode);
  if (mermaidBlocks.length) {
    loadScriptOnce("somnus-mermaid", runtimeAssets.mermaidSrc)
      .then(function () { renderMermaid(mermaidBlocks); })
      .catch(function (error) {
        console.error("Mermaid failed to load", error);
      });
  }

  loadMathJaxIfNeeded();
})();
