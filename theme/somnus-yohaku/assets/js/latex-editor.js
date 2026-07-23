(function () {
    "use strict";

    var editor = document.querySelector("[data-latex-editor]");

    if (!editor) {
        return;
    }

    var input = editor.querySelector("[data-latex-input]");
    var preview = editor.querySelector("[data-latex-preview]");
    var status = editor.querySelector("[data-latex-status]");

    var debounceTimer;
    var renderQueue = Promise.resolve();

    function renderPreview() {
        var source = input.value;

        status.textContent = "渲染中…";

        renderQueue = renderQueue
            .then(function () {
                if (!window.MathJax || !window.MathJax.typesetPromise) {
                    throw new Error("MathJax 尚未加载");
                }

                /*
                 * 在替换内容前，先清理 MathJax 记录。
                 * 否则连续编辑可能累积已经失效的公式对象。
                 */
                window.MathJax.typesetClear([preview]);

                /*
                 * 使用 textContent，不使用 innerHTML。
                 * 这样输入的 HTML 或 script 只会显示为文字。
                 */
                preview.textContent = source;

                if (window.MathJax.texReset) {
                    window.MathJax.texReset();
                }

                return window.MathJax.typesetPromise([preview]);
            })
            .then(function () {
                status.textContent = "即时渲染";
            })
            .catch(function (error) {
                console.error(error);
                status.textContent = "公式有误";
            });
    }

    function scheduleRender() {
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(renderPreview, 280);
    }

    input.addEventListener("input", scheduleRender);

    function startRendering() {
        if (
            window.MathJax &&
            window.MathJax.startup &&
            window.MathJax.startup.promise
        ) {
            window.MathJax.startup.promise.then(renderPreview);
        } else {
            renderPreview();
        }
    }

    document.addEventListener("somnus:mathjax-ready", startRendering, {
        once: true
    });
    if (window.MathJax && window.MathJax.typesetPromise) {
        startRendering();
    }
})();
