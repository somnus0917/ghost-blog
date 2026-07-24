export function initEngagement({runWhenIdle}) {
  var engagement = document.querySelector("[data-post-engagement]");
  var localGhostPreview = /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (!engagement || localGhostPreview) return;

  var articleContent = document.querySelector(".article-content");
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
    if (data.likes !== null && data.likes !== undefined && likeButton) {
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
    if (data.online !== null && data.online !== undefined && Number(data.online) > 0) {
      renderPresence(data.online);
    }
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
