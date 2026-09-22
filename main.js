// ==UserScript==
// @name         云上成信文档下载助手
// @namespace    https://github.com/OpenCUIT/kczxDownloader
// @version      1.1.0
// @description  抓取云上成信课程中用ONLYOFFICE渲染的文件并提供下载选项
// @match        https://kczx.cuit.edu.cn/*
// @match        http://kczx-cuit-edu-cn-s.webvpn.cuit.edu.cn:8118/*
// @match        https://kczx-cuit-edu-cn-s.webvpn.cuit.edu.cn:8118/*
// @match        http://*.webvpn.cuit.edu.cn/*
// @run-at       document-end
// @homepageURL  https://github.com/OpenCUIT/kczxDownloader/
// @author       Pfolg, DeepSeek
// @license      MIT
// @icon         https://kczx.cuit.edu.cn/bucket-k/imagedata/User/2022/01/8a97000e8b78452f9ad2c843e6a0e112.png
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = true; // 调试开关，定位完可以改成 false

  const IS_TOP = window.top === window.self;
  const TAG = IS_TOP ? "[KCZX/TOP]" : "[KCZX/IFRAME]";
  const log = function () {
    try { console.log("%c" + TAG, "color:#2c7be5;font-weight:bold", ...arguments); } catch (e) {}
  };
  const dbg = function () { if (DEBUG) log.apply(null, arguments); };

  // ---------- 允许匹配的源：当前源 + 后端真实源 ----------
  const ALLOWED = [location.origin, "https://kczx.cuit.edu.cn"];
  function isSameOrBackend(abs) {
    for (let i = 0; i < ALLOWED.length; i++) if (abs.startsWith(ALLOWED[i])) return true;
    return false;
  }

  // ============================================================
  // 文档 URL 匹配（放宽版：不再强依赖 /documentserver/ 前缀）
  // ============================================================
  function matchDoc(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return null;
    if (rawUrl.startsWith("data:")) return null;
    let abs;
    try { abs = new URL(rawUrl, location.href).href; } catch (e) { return null; }

    // 放宽 1：只要是当前源或后端源就行
    if (!isSameOrBackend(abs)) return null;

    // 放宽 2：cache/files + md5（保留原逻辑，但不要求 documentserver 前缀）
    if (/cache\/files/i.test(abs) && /[?&]md5=/i.test(abs)) {
      dbg("matchDoc 命中[缓存]:", abs); return abs;
    }
    // 放宽 3：任何文件扩展名
    if (/\.(pdf|docx?|pptx?|xlsx?|xlsm|pptm|dotx|odt|ods|odp|txt|rtf)(\?|#|$)/i.test(abs)) {
      dbg("matchDoc 命中[扩展名]:", abs); return abs;
    }
    // 放宽 4：下载/附件参数
    if (/[?&](download|attachment|response-content-disposition)=/i.test(abs)) {
      dbg("matchDoc 命中[下载参数]:", abs); return abs;
    }
    // 放宽 5：webvpn 可能把原始 URL 塞进 query，尝试解码后再匹配
    try {
      const dec = decodeURIComponent(abs);
      if (/\.(pdf|docx?|pptx?|xlsx?)(\?|#|$)/i.test(dec)) {
        dbg("matchDoc 命中[webvpn编码]:", abs); return abs;
      }
    } catch (e) {}
    return null;
  }

  function extractRealName(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return "";
    try {
      const u = new URL(rawUrl, location.href);
      if (!/\/edudatacenter\/v1\/learning-note-service\/get/i.test(u.pathname)) return "";
      const rn = u.searchParams.get("resourceName") || "";
      const sn = u.searchParams.get("sectionName") || "";
      const pick = rn || sn;
      return pick ? decodeURIComponent(pick) : "";
    } catch (e) { return ""; }
  }

  function getKey(url) {
    try { return new URL(url).pathname; } catch (e) { return url; }
  }

  function getFileName(url) {
    try {
      const u = new URL(url);
      const fn = u.searchParams.get("filename");
      if (fn) return decodeURIComponent(fn);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last ? decodeURIComponent(last) : "document";
    } catch (e) { return "document"; }
  }

  // ============================================================
  // 网络 hook
  // ============================================================
  function hookNetwork(onUrl) {
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { onUrl(url); } catch (e) {}
        return origOpen.apply(this, arguments);
      };
    } catch (e) {}
    try {
      if (typeof window.fetch === "function") {
        const origFetch = window.fetch;
        window.fetch = function (input) {
          try {
            const u = typeof input === "string" ? input : (input && input.url) || "";
            onUrl(u);
          } catch (e) {}
          return origFetch.apply(this, arguments);
        };
      }
    } catch (e) {}
  }

  // ============================================================
  // iframe 侧
  // ============================================================
  if (!IS_TOP) {
    function readEditorConfigName() {
      try {
        const de = window.docEditor;
        if (!de || !de.config || !de.config.document) return "";
        return de.config.document.title || "";
      } catch (e) { return ""; }
    }

    let lastDocUrl = "";

    function report(rawUrl) {
      const hit = matchDoc(rawUrl);
      if (!hit) return;
      if (hit === lastDocUrl) return;
      lastDocUrl = hit;

      const editorName = readEditorConfigName();
      const displayName = editorName || getFileName(hit);

      dbg("上报文档:", hit, "->", displayName);
      try {
        window.top.postMessage(
          { __kczx_doc__: true, url: hit, name: displayName, key: getKey(hit) },
          "*" // webvpn 场景 origin 容易对不上，直接用 *
        );
      } catch (e) {}
    }

    hookNetwork(report);

    try {
      new MutationObserver(function (muts) {
        for (const m of muts) {
          if (!m.addedNodes) continue;
          for (const n of m.addedNodes) {
            if (!(n instanceof Element)) continue;
            const src = n.getAttribute && (n.getAttribute("src") || n.getAttribute("data") || n.getAttribute("href"));
            if (src) report(src);
          }
        }
      }).observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}

    // 兜底：docEditor 挂载晚于网络请求，配置就绪后补报真实名
    let lastReportedName = "";
    setInterval(function () {
      if (!lastDocUrl) return;
      const name = readEditorConfigName();
      if (!name || name === lastReportedName) return;
      lastReportedName = name;
      try {
        window.top.postMessage(
          { __kczx_doc__: true, url: lastDocUrl, name: name, key: getKey(lastDocUrl) },
          "*"
        );
      } catch (e) {}
    }, 1000);

    log("iframe 侧已就绪");
    return;
  }

  // ============================================================
  // 顶层
  // ============================================================
  if (document.getElementById("__kczx_doc_ui__")) return;

  const docs = new Map();
  let realName = "";
  let expanded = false;
  let lastSig = "";
  let ui = null;
  let clearTimer = null;

  hookNetwork(function (url) {
    const name = extractRealName(url);
    if (!name || name === realName) return;
    realName = name;
    log("捕获真实文件名:", realName);
    cancelClear();
    let changed = false;
    docs.forEach(function (v) {
      if (v.name !== realName) { v.name = realName; changed = true; }
    });
    if (changed) render(true);
  });

  // 路由变化：延迟清空（3 秒内如果有新文档进来就取消清空）
  function cancelClear() {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  }
  function scheduleClear() {
    cancelClear();
    clearTimer = setTimeout(function () {
      clearTimer = null;
      if (docs.size === 0 && !realName) return;
      docs.clear();
      realName = "";
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
    dbg("收到 iframe 上报:", d.name, d.url);
    cancelClear();
    const name = realName || d.name;
    upsert(d.key || getKey(d.url), d.url, name);
  });

  // 顶层 DOM 扫描
  try {
    new MutationObserver(function (muts) {
      for (const m of muts) {
        if (!m.addedNodes) continue;
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          const src = n.getAttribute && (n.getAttribute("src") || n.getAttribute("data") || n.getAttribute("href"));
          if (!src) continue;
          const hit = matchDoc(src);
          if (hit) upsert(getKey(hit), hit, realName || getFileName(hit));
        }
      }
    }).observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}

  function upsert(key, url, name) {
    const prev = docs.get(key);
    if (prev && prev.url === url && prev.name === name) return;
    docs.set(key, { url: url, name: name });
    log("加入/更新文档:", key, "->", name);
    render();
  }

  // ============================================================
  // UI（保持原样）
  // ============================================================
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
      return { key: kv[0], url: kv[1].url, name: kv[1].name };
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
        parts.push('<a class="kczx-dl" href="' + item.url.replace(/"/g, "&quot;") + '" target="_blank" rel="noopener" style="display:block;margin-top:6px;padding:8px 12px;background:#2c7be5;color:#fff;border-radius:6px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25);word-break:break-all;text-align:left;font-size:12px;line-height:1.4;max-width:280px;box-sizing:border-box;">' + SVG_DL + item.name + "</a>");
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