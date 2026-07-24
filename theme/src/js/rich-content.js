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

function isMermaidCode(code) {
  if (!code) return false;
  if (code.matches("code[data-lang='mermaid'], code.language-mermaid")) return true;
  return /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context)\b/.test(
    code.textContent.trim()
  );
}

export function initRichContent({runtimeAssets, loadScriptOnce}) {
  if (pageContainsMath()) {
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
}
