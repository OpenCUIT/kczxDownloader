// ==UserScript==
// @name         云上成信文档下载助手
// @namespace    https://github.com/PfolgCodeDump/kczxDownloader
// @version      1.1.0
// @description  抓取云上成信课程中用ONLYOFFICE渲染的文件并提供下载选项
// @match        https://kczx.cuit.edu.cn/*
// @match        http://kczx-cuit-edu-cn-s.webvpn.cuit.edu.cn:8118/*
// @match        https://kczx-cuit-edu-cn-s.webvpn.cuit.edu.cn:8118/*
// @match        http://*.webvpn.cuit.edu.cn/*
// @run-at       document-end
// @homepageURL  https://github.com/PfolgCodeDump/kczxDownloader/kczxDownloader
// @author       Pfolg, DeepSeek
// @license      MIT
// @icon         https://kczx.cuit.edu.cn/bucket-k/imagedata/User/2022/01/8a97000e8b78452f9ad2c843e6a0e112.png
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const IS_TOP = window.top === window.self;
  const TAG = IS_TOP ? "[KCZX/TOP]" : "[KCZX/IFRAME]";
  const log = function () {
    try { console.log("%c" + TAG, "color:#2c7be5;font-weight:bold", ...arguments); } catch (e) {}
  };

  function makeBatcher(fn, delay) {
    let queue = [];
    let timer = null;
    return function (item) {
      queue.push(item);
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        const arr = queue;
        queue = [];
        try { fn(arr); } catch (e) {}
      }, delay);
    };
  }

  const ALLOWED = [location.origin, "https://kczx.cuit.edu.cn"];
  function isSameOrBackend(abs) {
    for (let i = 0; i < ALLOWED.length; i++) if (abs.startsWith(ALLOWED[i])) return true;
    return false;
  }

  const docCache = new Map();
  function matchDoc(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return null;
    const hit = docCache.get(rawUrl);
    if (hit !== undefined) return hit;
    const r = matchDocImpl(rawUrl);
    if (docCache.size > 800) docCache.clear();
    docCache.set(rawUrl, r);
    return r;
  }
  function matchDocImpl(rawUrl) {
    if (rawUrl.startsWith("data:")) return null;
    let abs;
    try { abs = new URL(rawUrl, location.href).href; } catch (e) { return null; }
    if (!isSameOrBackend(abs)) return null;
    if (/cache\/files/i.test(abs) && /[?&]md5=/i.test(abs)) return abs;
    if (/\.(pdf|docx?|pptx?|xlsx?|xlsm|pptm|dotx|odt|ods|odp|txt|rtf)(\?|#|$)/i.test(abs)) return abs;
    if (/[?&](download|attachment|response-content-disposition)=/i.test(abs)) return abs;
    try {
      const dec = decodeURIComponent(abs);
      if (/\.(pdf|docx?|pptx?|xlsx?)(\?|#|$)/i.test(dec)) return abs;
    } catch (e) {}
    return null;
  }

  function getKey(url) {
    try { return new URL(url).pathname; } catch (e) { return url; }
  }

  function getFileName(url) {
    try {
      const u = new URL(url);
      const fn = u.searchParams.get("filename");
      if (fn) return decodeURIComponent(fn);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last !== "origin.pdf") return decodeURIComponent(last);
      return "文档";
    } catch (e) { return "文档"; }
  }

  function hookNetwork(onUrl) {
    const flush = makeBatcher(function (arr) {
      for (let i = 0; i < arr.length; i++) {
        try { onUrl(arr[i]); } catch (e) {}
      }
    }, 30);

    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        flush(url);
        return origOpen.apply(this, arguments);
      };
    } catch (e) {}
    try {
      if (typeof window.fetch === "function") {
        const origFetch = window.fetch;
        window.fetch = function (input) {
          const u = typeof input === "string" ? input : (input && input.url) || "";
          flush(u);
          return origFetch.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  function scanDom(handler) {
    let pending = new Set();
    let timer = null;
    function flush() {
      timer = null;
      const nodes = pending;
      pending = new Set();
      nodes.forEach(function (n) {
        try { handler(n); } catch (e) {}
      });
    }
    try {
      new MutationObserver(function (muts) {
        for (let i = 0; i < muts.length; i++) {
          const nodes = muts[i].addedNodes;
          if (!nodes) continue;
          for (let j = 0; j < nodes.length; j++) {
            const n = nodes[j];
            if (n && n.nodeType === 1) pending.add(n);
          }
        }
        if (pending.size && !timer) {
          timer = setTimeout(function () {
            if (typeof requestIdleCallback === "function") {
              requestIdleCallback(flush, { timeout: 500 });
            } else {
              flush();
            }
          }, 100);
        }
      }).observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (!IS_TOP) {
    let lastDocUrl = "";

    function report(rawUrl) {
      const hit = matchDoc(rawUrl);
      if (!hit || hit === lastDocUrl) return;
      lastDocUrl = hit;
      try {
        window.top.postMessage(
          { __kczx_doc__: true, url: hit, key: getKey(hit) },
          "*"
        );
      } catch (e) {}
    }

    hookNetwork(report);

    scanDom(function (n) {
      const src = n.getAttribute && (n.getAttribute("src") || n.getAttribute("data") || n.getAttribute("href"));
      if (src) report(src);
    });

    log("iframe 侧已就绪");
    return;
  }

  if (document.getElementById("__kczx_doc_ui__")) return;

  const docs = new Map();
  let expanded = false;
  let lastSig = "";
  let ui = null;
  let clearTimer = null;

  function cancelClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }
  function scheduleClear() {
    cancelClear();
    clearTimer = setTimeout(function () {
      clearTimer = null;
      if (docs.size === 0) return;
      docs.clear();
      expanded = false;
      log("路由变化，已清空文档列表");
      render(true);
    }, 3000);
  }

  ["pushState", "replaceState"].forEach(function (name) {
    const orig = history[name];
    if (typeof orig === "function") {
      history[name] = function () {
        const ret = orig.apply(this, arguments);
        scheduleClear();
        return ret;
      };
    }
  });
  window.addEventListener("popstate", scheduleClear);
  window.addEventListener("hashchange", scheduleClear);

  window.addEventListener("message", function (e) {
    const d = e.data;
    if (!d || !d.__kczx_doc__ || !d.url) return;
    cancelClear();
    upsert(d.key || getKey(d.url), d.url);
  });

  function upsert(key, url) {
    const prev = docs.get(key);
    if (prev && prev.url === url) return;
    docs.set(key, { url: url });
    log("加入文档:", key);
    render();
  }

  const SVG_DL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M8 2v8"/><path d="M5 7l3 3 3-3"/><path d="M3 13h10"/></svg>';
  const SVG_DOC = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>';
  const SVG_CHEV_DOWN = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-left:6px;"><path d="M4 6l4 4 4-4"/></svg>';
  const SVG_CHEV_UP = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-left:6px;"><path d="M4 10l4-4 4 4"/></svg>';

  function ensureUI() {
    if (ui && ui.parentNode) return ui;
    ui = document.createElement("div");
    ui.id = "__kczx_doc_ui__";
    ui.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;display:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;font-size:13px;color:#fff;";
    const parent = document.body || document.documentElement;
    if (!parent) return null;
    parent.appendChild(ui);
    return ui;
  }

  function render(force) {
    const u = ensureUI();
    if (!u) { setTimeout(function () { render(force); }, 100); return; }
    const list = Array.from(docs.entries()).map(function (kv) {
      return { key: kv[0], url: kv[1].url };
    });
    const sig = JSON.stringify({ list: list, expanded: expanded });
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (!list.length) { u.style.display = "none"; u.innerHTML = ""; return; }
    u.style.display = "block";

    const parts = [];
    if (expanded) {
      parts.push('<div id="kczx-body" style="position:absolute;bottom:100%;right:0;margin-bottom:8px;display:flex;flex-direction:column;align-items:flex-end;">');
      list.forEach(function (item) {
        const name = getFileName(item.url);
        parts.push('<a class="kczx-dl" href="' + item.url.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener" style="display:block;margin-top:6px;padding:8px 12px;background:#2c7be5;color:#fff;border-radius:6px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25);word-break:break-all;text-align:left;font-size:12px;line-height:1.4;max-width:280px;box-sizing:border-box;">' + SVG_DL + name + "</a>");
      });
      parts.push("</div>");
    }
    parts.push('<div id="kczx-head" style="display:inline-flex;align-items:center;background:rgba(0,0,0,.78);padding:8px 12px;border-radius:6px;cursor:pointer;font-size:12px;user-select:none;box-sizing:border-box;white-space:nowrap;"><span>' + SVG_DOC + "可下载文档 (" + list.length + ")</span><span>" + (expanded ? SVG_CHEV_DOWN : SVG_CHEV_UP) + "</span></div>");
    u.innerHTML = parts.join("");

    const head = u.querySelector("#kczx-head");
    if (head) {
      head.addEventListener("click", function () { expanded = !expanded; render(true); });
      head.addEventListener("mouseenter", function () { head.style.background = "rgba(0,0,0,.9)"; });
      head.addEventListener("mouseleave", function () { head.style.background = "rgba(0,0,0,.78)"; });
    }
    u.querySelectorAll(".kczx-dl").forEach(function (a) {
      a.addEventListener("mouseenter", function () { a.style.background = "#1b5fbd"; });
      a.addEventListener("mouseleave", function () { a.style.background = "#2c7be5"; });
    });
  }

  (function attach() {
    if (!document.body && !document.documentElement) { setTimeout(attach, 100); return; }
    if (!ensureUI()) { setTimeout(attach, 100); return; }
    render(true);
  })();

  log("顶层已就绪");
})();