/*
 * dsh-unicorn-background — browser side. (Served under the former
 * `/dsh-user-background` prefix, which the host half also keeps.)
 *
 * One self-contained script: it paints the wallpaper and builds the settings
 * panel that edits it. Served fresh by the host on every request, so editing
 * this file needs only a page refresh.
 *
 * Two facts drive the painting:
 *   1. The theme presenter writes the resolved --dsw-alias-* tokens as INLINE
 *      custom properties on <body>, so the overrides must carry `!important`
 *      (an important author declaration outranks a normal inline one).
 *   2. The Windows-titlebar frame and the sidebar paint --dsw-specific-sidebar-fill,
 *      not --dsw-alias-bg-base, so both tokens have to be released.
 */
(function () {
  // The client module re-injects this script on reload, so every run must first
  // undo the one before it instead of stacking a second panel.
  var previous = window.__dshUserBackground;
  if (previous && typeof previous.dispose === "function") {
    try {
      previous.dispose();
    } catch (error) {
      /* the previous instance is already gone */
    }
  }
  window.__dshUserBackgroundLoaded = true;

  var API = "/dsh-user-background";
  var STYLE_MARK = "data-dsh-user-background";
  var PANEL_STYLE_ID = "dsh-ub-panel-style";
  var PANEL_ID = "dsh-ub-panel";
  var BUTTON_ID = "dsh-ub-button";
  var BUTTON_KEY = "dsh-user-background/button";
  var DEFAULTS_KEY = "dsh-user-background/defaults";
  var LEGACY_POSITION_KEY = "dsh-user-background/position";

  /**
   * What "恢复默认" restores. FACTORY is the shipped baseline; "设为默认" records
   * the user's own baseline in localStorage, which then wins.
   */
  var FACTORY = {
    enabled: true,
    image: "CYP3A2_Happy_Launch_Day_to_HMS_Unicorn__13768138-muwqc0bu.png",
    sidebar: 20,
    center: 60,
    panel: 100,
    blur: 0,
    saturate: 160,
    anchor: "bl",
  };

  var state = {
    config: null,
    images: [],
    originals: null,
    styleEl: null,
    observer: null,
    paintTimer: null,
    saveTimer: null,
    painted: 0,
    controls: null,
    button: null,
    panelSize: null,
    listeners: null,
    namedImage: false,
    userDefaults: null,
  };

  // ---------------------------------------------------------------- utilities

  function token(name) {
    try {
      var inline = document.body && document.body.style.getPropertyValue(name);
      if (inline && inline.trim() !== "") return inline.trim();
    } catch (error) {
      /* fall through */
    }
    try {
      return (getComputedStyle(document.body).getPropertyValue(name) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function veil(color, percent) {
    if (!color || color === "transparent") return "transparent";
    return "color-mix(in srgb, " + color + " " + clamp(percent, 0, 100) + "%, transparent)";
  }

  function clamp(value, min, max) {
    var number = Number(value);
    if (!isFinite(number)) return min;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // ------------------------------------------------------- window placement

  /**
   * The button's dragged point lives in localStorage rather than the host config:
   * it is window chrome, not a wallpaper setting, and it must work even before
   * the host half of this plugin is reachable.
   */
  function readButtonPoint() {
    try {
      var raw = localStorage.getItem(BUTTON_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && isFinite(parsed.x) && isFinite(parsed.y)) {
        return { x: Number(parsed.x), y: Number(parsed.y) };
      }
    } catch (error) {
      /* a blocked or corrupt store just means "use the anchor" */
    }
    return null;
  }

  function writeButtonPoint() {
    try {
      if (state.button) localStorage.setItem(BUTTON_KEY, JSON.stringify(state.button));
    } catch (error) {
      /* the point simply does not survive this session */
    }
  }

  function clearButtonPoint() {
    state.button = null;
    try {
      localStorage.removeItem(BUTTON_KEY);
    } catch (error) {
      /* the anchor still applies for this session */
    }
  }

  /** Pin the button at a viewport point, kept fully on screen. */
  function placeButtonAt(x, y) {
    var button = document.getElementById(BUTTON_ID);
    if (!button) return;
    var size = button.offsetWidth || 32;
    var maxX = Math.max(8, window.innerWidth - size - 8);
    var maxY = Math.max(8, window.innerHeight - size - 8);
    var point = { x: clamp(x, 8, maxX), y: clamp(y, 8, maxY) };
    state.button = point;
    button.style.left = point.x + "px";
    button.style.top = point.y + "px";
    button.style.right = "auto";
    button.style.bottom = "auto";
  }

  /**
   * Park the panel beside the button: above it when the button sits in the lower
   * half of the window, below it otherwise, with the left edges aligned.
   */
  function placePanel() {
    var button = document.getElementById(BUTTON_ID);
    var panel = document.getElementById(PANEL_ID);
    if (!button || !panel) return;
    var rect = button.getBoundingClientRect();
    var size = state.panelSize || { width: 328, height: 420 };
    var maxX = Math.max(8, window.innerWidth - size.width - 8);
    var maxY = Math.max(8, window.innerHeight - size.height - 8);
    var gap = 10;
    var above = rect.top + rect.height / 2 > window.innerHeight / 2;
    var top = above ? rect.top - size.height - gap : rect.bottom + gap;
    panel.style.left = clamp(rect.left, 8, maxX) + "px";
    panel.style.top = clamp(top, 8, maxY) + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  /** Remember the panel's measured size, so the next placement is right while hidden. */
  function measurePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel || panel.hidden) return;
    if (panel.offsetWidth > 0 && panel.offsetHeight > 0) {
      state.panelSize = { width: panel.offsetWidth, height: panel.offsetHeight };
    }
  }

  function togglePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    measurePanel();
    placePanel();
  }

  /** Button from its remembered point (or the anchor corner), then the panel beside it. */
  function place() {
    var anchor = state.config.anchor || "bl";
    var bottom = anchor.charAt(0) === "b";
    var right = anchor.charAt(1) === "r";
    var button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.style.left = right ? "auto" : "14px";
    button.style.right = right ? "14px" : "auto";
    button.style.top = bottom ? "auto" : "14px";
    button.style.bottom = bottom ? "14px" : "auto";
    if (state.button) placeButtonAt(state.button.x, state.button.y);
    placePanel();
  }

  /**
   * The button is the drag handle: a press that moves is a drag, a press that
   * stays put is the open/close toggle.
   */
  function attachButtonDrag(button) {
    var drag = null;

    button.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      var rect = button.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        fromX: event.clientX,
        fromY: event.clientY,
        moved: false,
      };
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch (error) {
        /* capture is a nicety; the listeners below still receive the moves */
      }
    });

    button.addEventListener("pointermove", function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (!drag.moved) {
        var far = Math.abs(event.clientX - drag.fromX) >= 4 || Math.abs(event.clientY - drag.fromY) >= 4;
        if (!far) return;
        drag.moved = true;
      }
      placeButtonAt(event.clientX - drag.dx, event.clientY - drag.dy);
      placePanel();
    });

    function release(event) {
      if (!drag || event.pointerId !== drag.id) return;
      var moved = drag.moved;
      drag = null;
      try {
        button.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* already released */
      }
      if (moved) {
        writeButtonPoint();
        return;
      }
      togglePanel();
    }

    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", function (event) {
      if (drag && event.pointerId === drag.id) drag = null;
    });
  }

  // ----------------------------------------------------------------- painting

  /** The theme's own values; read with the sheet detached so we never read our own output. */
  function readOriginals() {
    if (state.styleEl && state.styleEl.parentNode) state.styleEl.parentNode.removeChild(state.styleEl);
    var values = {
      layer1: token("--dsw-alias-bg-layer-1") || "#ffffff",
      layer2: token("--dsw-alias-bg-layer-2") || token("--dsw-alias-bg-layer-1") || "#ffffff",
      layer3: token("--dsw-alias-bg-layer-3") || token("--dsw-alias-bg-layer-2") || "#ffffff",
      sidebarFill: token("--dsw-specific-sidebar-fill") || token("--dsw-alias-bg-base") || "#ffffff",
    };
    state.originals = values;
    return values;
  }

  function glass(fill, percent, blur, saturate) {
    var backdrop = "blur(" + clamp(blur, 0, 60) + "px) saturate(" + clamp(saturate, 0, 300) + "%)";
    return "background:" + veil(fill, percent) + " !important;"
      + "backdrop-filter:" + backdrop + " !important;"
      + "-webkit-backdrop-filter:" + backdrop + " !important;";
  }

  function imageSource(config) {
    const name = config.image || "default";
    // Per-name addressing skips the save race entirely: the sheet points at the
    // clicked file, not at whatever the host still has selected.
    if (state.namedImage) return API + "/image.jpg?name=" + encodeURIComponent(name);
    return API + "/image.jpg?v=" + encodeURIComponent(name) + "&t=" + encodeURIComponent(config.updatedAt || "0");
  }

  /** A short, readable label for a stored wallpaper's generated file name. */
  function shortName(name) {
    var text = String(name);
    var dot = text.lastIndexOf(".");
    if (dot > 0) text = text.slice(0, dot);
    var dash = text.lastIndexOf("-");
    if (dash > 4 && /^[a-z0-9]+$/.test(text.slice(dash + 1))) text = text.slice(0, dash);
    return text.length > 16 ? text.slice(0, 16) + "…" : text;
  }

  /**
   * One thumbnail's source. Without per-name addressing the host answers every
   * request with the selected wallpaper, so only that tile may show a preview —
   * the others would be showing a different file than they claim.
   */
  function thumbnailSource(image, config) {
    if (state.namedImage) return API + "/image.jpg?name=" + encodeURIComponent(image.name);
    if (image.name === config.image) return API + "/image.jpg?t=" + Date.now();
    return "";
  }

  function sheet() {
    var config = state.config;
    var theme = state.originals || readOriginals();
    var panel = clamp(config.panel, 0, 100);
    var layer2 = Math.min(100, panel + 10);
    var layer3 = Math.min(100, panel + 16);
    var glassArgs = [config.blur, config.saturate];
    return [
      ':root{background-image:url("' + imageSource(config) + '") !important;',
      "background-position:center center !important;",
      "background-repeat:no-repeat !important;",
      "background-size:cover !important;",
      "background-attachment:fixed !important;}",
      ":root body{background-color:transparent !important;}",
      ":root *{--dsw-alias-bg-base:transparent !important;",
      "--dsw-specific-sidebar-fill:transparent !important;",
      "--dsw-alias-bg-layer-1:" + veil(theme.layer1, panel) + " !important;",
      "--dsw-alias-bg-layer-2:" + veil(theme.layer2, layer2) + " !important;",
      "--dsw-alias-bg-layer-3:" + veil(theme.layer3, layer3) + " !important;}",
      // Column classes are CSS-module hashes; the local name is the stable half.
      '[class*="_sidebarCol"]{' + glass(theme.sidebarFill, config.sidebar, glassArgs[0], glassArgs[1]) + "}",
      '[class*="_centerCol"]{' + glass(theme.layer1, config.center, glassArgs[0], glassArgs[1]) + "}",
      '[class*="_rightbarCol"]{' + glass(theme.layer1, config.center, glassArgs[0], glassArgs[1]) + "}",
      // The Windows titlebar strip belongs to the frame, not to a column.
      '[class*="_frame"]:before{' + glass(theme.sidebarFill, config.sidebar, glassArgs[0], glassArgs[1]) + "}",
    ].join("");
  }

  function paint(reread) {
    if (!document.body) return false;
    if (!state.styleEl) {
      state.styleEl = document.createElement("style");
      state.styleEl.setAttribute(STYLE_MARK, "");
    }
    if (state.styleEl.parentNode) state.styleEl.parentNode.removeChild(state.styleEl);
    if (reread) readOriginals();
    if (state.config.enabled === false) {
      window.__dshUserBackgroundApplied = false;
      return true;
    }
    var css = sheet();
    state.styleEl.textContent = css;
    document.head.appendChild(state.styleEl);
    window.__dshUserBackgroundApplied = true;
    state.painted += 1;
    report();
    return true;
  }

  function scheduleRepaint(reread) {
    if (state.paintTimer !== null) return;
    state.paintTimer = setTimeout(function () {
      state.paintTimer = null;
      paint(reread);
    }, 40);
  }

  function report() {
    try {
      var sidebar = document.querySelector('[class*="_sidebarCol"]');
      var center = document.querySelector('[class*="_centerCol"]');
      var payload = [
        "applied=" + state.painted,
        "enabled=" + (state.config.enabled === false ? "0" : "1"),
        "image=" + state.config.image,
        "tags=" + document.querySelectorAll("style[" + STYLE_MARK + "]").length,
        "panel=" + (document.getElementById(PANEL_ID) ? "1" : "0"),
        "scheme=" + (document.body.hasAttribute("data-ds-dark-theme") ? "dark" : "light"),
        "sidebar=" + (sidebar ? getComputedStyle(sidebar).backgroundColor + "|" + getComputedStyle(sidebar).backdropFilter : "absent"),
        "center=" + (center ? getComputedStyle(center).backgroundColor + "|" + getComputedStyle(center).backdropFilter : "absent"),
      ].join(" ");
      var request = fetch(API + "/state?report=" + encodeURIComponent(payload), { cache: "no-store" });
      if (request && typeof request.catch === "function") request.catch(function () {});
    } catch (error) {
      /* diagnostics are best-effort */
    }
  }

  function watch() {
    if (state.observer || typeof MutationObserver === "undefined") return;
    try {
      state.observer = new MutationObserver(function () {
        scheduleRepaint(true);
      });
      state.observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-ds-dark-theme", "style"],
      });
    } catch (error) {
      /* a one-shot paint is still a valid result */
    }
  }

  // --------------------------------------------------------------- host calls

  /** The active baseline: the user's own "设为默认" if recorded, otherwise the shipped one. */
  function resolveDefaults() {
    return state.userDefaults || FACTORY;
  }

  function readUserDefaults() {
    try {
      var raw = localStorage.getItem(DEFAULTS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return Object.assign({}, FACTORY, parsed);
    } catch (error) {
      /* a blocked or corrupt store falls back to the shipped baseline */
    }
    return null;
  }

  function writeUserDefaults(values) {
    state.userDefaults = Object.assign({}, FACTORY, values);
    try {
      localStorage.setItem(DEFAULTS_KEY, JSON.stringify(state.userDefaults));
    } catch (error) {
      /* the baseline still applies for this session */
    }
  }

  function hasImage(name) {
    return state.images.some(function (image) { return image.name === name; });
  }

  /** Keep a config pointing at a wallpaper that still exists. */
  function ensureKnownImage(config) {
    if (!config.image || !hasImage(config.image)) config.image = "default";
    return config;
  }

  /** The baseline's image may have been deleted since it was recorded. */
  function resetTarget() {
    var target = Object.assign({}, resolveDefaults());
    return ensureKnownImage(target);
  }

  /** Report a failure to the host, so a broken panel is diagnosable instead of silent. */
  function fail(where, error) {
    try {
      var text = where + ": " + (error && error.stack ? error.stack : String(error));
      var request = fetch(API + "/state?report=" + encodeURIComponent("ERROR " + text.slice(0, 700)), { cache: "no-store" });
      if (request && typeof request.catch === "function") request.catch(function () {});
    } catch (inner) {
      /* nothing left to report with */
    }
  }

  function load() {
    return fetch(API + "/config", { cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        state.images = (data && data.images) || [];
        state.namedImage = !!(data && data.capabilities && data.capabilities.namedImage);
        state.config = ensureKnownImage(Object.assign({}, resolveDefaults(), (data && data.config) || {}));
      })
      .catch(function () {
        if (!state.config) state.config = Object.assign({}, resolveDefaults());
      });
  }

  function persist(immediate) {
    if (state.saveTimer !== null) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      state.saveTimer = null;
      fetch(API + "/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state.config),
        cache: "no-store",
      })
        .then(function (response) { return response.json(); })
        .then(function (data) {
          if (data && data.ok) {
            if (data.images) state.images = data.images;
            state.config = ensureKnownImage(Object.assign({}, resolveDefaults(), data.config));
            setStatus("已保存");
          } else {
            setStatus("保存失败");
          }
        })
        .catch(function () { setStatus("保存失败：无法连接宿主"); });
    }, immediate === true ? 0 : 300);
  }

  /** Apply a discrete change (not a slider drag) at once, then persist immediately. */
  function update(patch, reread) {
    Object.assign(state.config, patch);
    paint(reread === true);
    sync();
    persist(true);
  }

  // -------------------------------------------------------------- settings UI

  /*
   * The panel must stay readable even when the user drags a slider to 0%, and
   * the DSH surface tokens are exactly what this plugin overrides — so the panel
   * paints its own light/dark surfaces instead of consuming them.
   */
  var PANEL_CSS = [
    "#dsh-ub-button,#dsh-ub-panel{--dsh-ub-fill:rgba(250,250,252,.94);--dsh-ub-control:rgba(0,0,0,.06);",
    "--dsh-ub-control-hover:rgba(0,0,0,.1);--dsh-ub-line:rgba(0,0,0,.14);--dsh-ub-text:#16181d;--dsh-ub-accent:#3b82f6}",
    "body[data-ds-dark-theme] #dsh-ub-button,body[data-ds-dark-theme] #dsh-ub-panel{--dsh-ub-fill:rgba(26,28,32,.94);",
    "--dsh-ub-control:rgba(255,255,255,.08);--dsh-ub-control-hover:rgba(255,255,255,.14);--dsh-ub-line:rgba(255,255,255,.16);",
    "--dsh-ub-text:#e8eaed;--dsh-ub-accent:#7aaaff}",
    "#dsh-ub-button{position:fixed;z-index:2147483000;width:32px;height:32px;border-radius:50%;display:flex;",
    "align-items:center;justify-content:center;cursor:grab;touch-action:none;opacity:.5;",
    "transition:opacity .15s,transform .15s;",
    "background:var(--dsh-ub-fill);color:var(--dsh-ub-text);border:.5px solid var(--dsh-ub-line);",
    "backdrop-filter:blur(16px) saturate(160%);box-shadow:0 4px 14px rgba(0,0,0,.18)}",
    "#dsh-ub-button:hover{opacity:1}",
    "#dsh-ub-button:active{cursor:grabbing}",
    "#dsh-ub-panel{position:fixed;z-index:2147483000;width:328px;max-height:min(76vh,660px);overflow:auto;",
    "box-sizing:border-box;border-radius:16px;padding:14px;color:var(--dsh-ub-text);",
    "background:var(--dsh-ub-fill);border:.5px solid var(--dsh-ub-line);backdrop-filter:blur(26px) saturate(170%);",
    "box-shadow:0 12px 40px rgba(0,0,0,.3);",
    "font:13px/1.45 var(--dsw-font-family,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif)}",
    "#dsh-ub-panel[hidden]{display:none}",
    ".dsh-ub-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;",
    "user-select:none;-webkit-user-select:none}",
    ".dsh-ub-title{font-weight:600}",
    ".dsh-ub-close{cursor:pointer;border:0;background:transparent;color:inherit;font-size:16px;line-height:1;",
    "padding:2px 7px;border-radius:7px}",
    ".dsh-ub-close:hover{background:var(--dsh-ub-control)}",
    ".dsh-ub-section{margin:13px 0 7px;font-size:11.5px;opacity:.6;letter-spacing:.04em}",
    ".dsh-ub-row{display:flex;align-items:center;gap:9px;margin:8px 0}",
    ".dsh-ub-label{flex:0 0 58px;opacity:.82}",
    ".dsh-ub-value{flex:0 0 44px;text-align:right;font-variant-numeric:tabular-nums;opacity:.72}",
    ".dsh-ub-range{flex:1;min-width:0;accent-color:var(--dsh-ub-accent)}",
    ".dsh-ub-thumbs{display:flex;flex-wrap:wrap;gap:8px}",
    ".dsh-ub-thumb{position:relative;width:64px;height:64px;border-radius:9px;overflow:hidden;cursor:pointer;",
    "border:2px solid transparent;background:var(--dsh-ub-control)}",
    ".dsh-ub-thumb img{width:100%;height:100%;object-fit:cover;display:block}",
    ".dsh-ub-thumb-plain{display:flex;align-items:center;justify-content:center;padding:4px;",
    "box-sizing:border-box;font-size:10.5px;line-height:1.25;text-align:center;word-break:break-all;opacity:.8}",
    ".dsh-ub-thumb[data-active='1']{border-color:var(--dsh-ub-accent)}",
    ".dsh-ub-thumb b{position:absolute;left:0;right:0;bottom:0;font-size:10px;font-weight:400;text-align:center;",
    "background:rgba(0,0,0,.55);color:#fff;padding:1px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dsh-ub-del{position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;border:0;cursor:pointer;",
    "background:rgba(0,0,0,.62);color:#fff;font-size:11px;line-height:16px;padding:0;text-align:center;display:none}",
    ".dsh-ub-thumb:hover .dsh-ub-del{display:block}",
    ".dsh-ub-btn{cursor:pointer;border-radius:9px;padding:6px 12px;font-size:12.5px;color:inherit;",
    "border:.5px solid var(--dsh-ub-line);background:var(--dsh-ub-control)}",
    ".dsh-ub-btn:hover{background:var(--dsh-ub-control-hover)}",
    ".dsh-ub-anchors{display:flex;gap:6px}",
    ".dsh-ub-anchor{height:22px;border-radius:6px;cursor:pointer;padding:0 7px;font-size:11px;",
    "border:.5px solid var(--dsh-ub-line);background:var(--dsh-ub-control);color:inherit}",
    ".dsh-ub-anchor[data-active='1']{border-color:var(--dsh-ub-accent);color:var(--dsh-ub-accent)}",
    ".dsh-ub-foot{display:flex;align-items:center;gap:8px;margin-top:14px}",
    ".dsh-ub-status{flex:1;font-size:11.5px;opacity:.6;text-align:right;min-height:14px}",
  ].join("");

  var ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/>'
    + '<path d="M21 16l-5-5-4 4-2-2-7 7"/></svg>';

  function setStatus(text) {
    if (state.controls && state.controls.status) state.controls.status.textContent = text;
    if (!text) return;
    setTimeout(function () {
      if (state.controls && state.controls.status && state.controls.status.textContent === text) {
        state.controls.status.textContent = "";
      }
    }, 2400);
  }

  function slider(label, key, min, max, unit) {
    var row = make("div", "dsh-ub-row");
    row.appendChild(make("div", "dsh-ub-label", label));
    var input = document.createElement("input");
    input.type = "range";
    input.className = "dsh-ub-range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    var value = make("div", "dsh-ub-value", "");
    row.appendChild(input);
    row.appendChild(value);
    input.addEventListener("input", function () {
      // No full sync() here: writing back into a range input mid-drag can break the gesture.
      Object.assign(state.config, define(key, clamp(input.value, min, max)));
      value.textContent = input.value + unit;
      paint(false);
      persist();
    });
    return { row: row, input: input, value: value, unit: unit, key: key };
  }

  function define(key, value) {
    var patch = {};
    patch[key] = value;
    return patch;
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    if (!document.getElementById(PANEL_STYLE_ID)) {
      var style = document.createElement("style");
      style.id = PANEL_STYLE_ID;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }

    var button = make("div", null);
    button.id = BUTTON_ID;
    button.title = "背景设置 · 拖动可移动";
    button.innerHTML = ICON;
    attachButtonDrag(button);
    document.body.appendChild(button);

    var panel = make("div", null);
    panel.id = PANEL_ID;
    panel.hidden = true;

    var head = make("div", "dsh-ub-head");
    head.appendChild(make("div", "dsh-ub-title", "背景设置"));
    var close = make("button", "dsh-ub-close", "×");
    close.addEventListener("click", function () { panel.hidden = true; });
    head.appendChild(close);
    panel.appendChild(head);

    var enabledRow = make("div", "dsh-ub-row");
    var enabled = document.createElement("input");
    enabled.type = "checkbox";
    var enabledLabel = make("label", "dsh-ub-label");
    enabledLabel.style.flex = "1";
    enabledLabel.style.display = "flex";
    enabledLabel.style.alignItems = "center";
    enabledLabel.style.gap = "7px";
    enabledLabel.appendChild(enabled);
    enabledLabel.appendChild(make("span", null, "启用背景"));
    enabledRow.appendChild(enabledLabel);
    enabled.addEventListener("change", function () {
      update(define("enabled", enabled.checked), true);
    });
    panel.appendChild(enabledRow);

    panel.appendChild(make("div", "dsh-ub-section", "图片"));
    var thumbs = make("div", "dsh-ub-thumbs");
    panel.appendChild(thumbs);

    var uploadRow = make("div", "dsh-ub-row");
    uploadRow.style.marginTop = "10px";
    var uploadButton = make("button", "dsh-ub-btn", "上传新图片");
    var file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    uploadButton.addEventListener("click", function () { file.click(); });
    file.addEventListener("change", function () {
      var picked = file.files && file.files[0];
      file.value = "";
      if (picked) upload(picked);
    });
    uploadRow.appendChild(uploadButton);
    uploadRow.appendChild(file);
    panel.appendChild(uploadRow);

    panel.appendChild(make("div", "dsh-ub-section", "透明度与模糊"));
    var sidebar = slider("侧边栏", "sidebar", 0, 100, "%");
    var center = slider("对话栏", "center", 0, 100, "%");
    var content = slider("内容层", "panel", 0, 100, "%");
    var blur = slider("背景模糊", "blur", 0, 60, "px");
    panel.appendChild(sidebar.row);
    panel.appendChild(center.row);
    panel.appendChild(content.row);
    panel.appendChild(blur.row);

    panel.appendChild(make("div", "dsh-ub-section", "按钮位置（也可直接拖动图标）"));
    var anchors = make("div", "dsh-ub-anchors");
    var anchorButtons = [];
    [["tl", "左上"], ["tr", "右上"], ["bl", "左下"], ["br", "右下"]].forEach(function (pair) {
      var anchorButton = make("button", "dsh-ub-anchor", pair[1]);
      anchorButton.title = pair[1];
      anchorButton.addEventListener("click", function () {
        update(define("anchor", pair[0]));
        clearButtonPoint();
        place();
      });
      anchorButtons.push({ key: pair[0], node: anchorButton });
      anchors.appendChild(anchorButton);
    });
    panel.appendChild(anchors);

    var foot = make("div", "dsh-ub-foot");
    var remember = make("button", "dsh-ub-btn", "设为默认");
    remember.title = "把当前这套外观记成「恢复默认」的目标";
    remember.addEventListener("click", function () {
      writeUserDefaults(state.config);
      setStatus("已设为默认");
    });
    var reset = make("button", "dsh-ub-btn", "恢复默认");
    reset.addEventListener("click", function () {
      update(resetTarget(), true);
      clearButtonPoint();
      place();
      setStatus("已恢复默认");
    });
    var status = make("div", "dsh-ub-status", "");
    foot.appendChild(remember);
    foot.appendChild(reset);
    foot.appendChild(status);
    panel.appendChild(foot);

    document.body.appendChild(panel);

    // Click-outside collapses the panel back to its button. Capture phase, so a
    // handler deeper in the app cannot swallow the gesture first.
    var onOutside = function (event) {
      if (panel.hidden) return;
      var target = event.target;
      if (panel.contains(target) || button.contains(target)) return;
      panel.hidden = true;
    };
    var onKey = function (event) {
      if (event.key === "Escape" && !panel.hidden) panel.hidden = true;
    };
    var onResize = function () {
      place();
    };
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    state.listeners = [
      [document, "pointerdown", onOutside, true],
      [document, "keydown", onKey, false],
      [window, "resize", onResize, false],
    ];

    state.controls = {
      panel: panel,
      enabled: enabled,
      thumbs: thumbs,
      sidebar: sidebar,
      center: center,
      content: content,
      blur: blur,
      anchors: anchorButtons,
      status: status,
    };
  }

  function upload(file) {
    if (file.size > 24 * 1024 * 1024) {
      setStatus("图片过大（上限 24MB）");
      return;
    }
    setStatus("上传中…");
    fetch(API + "/upload?name=" + encodeURIComponent(file.name), {
      method: "POST",
      body: file,
      cache: "no-store",
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          setStatus("上传失败：" + ((data && data.error) || "未知错误"));
          return;
        }
        state.images = data.images || state.images;
        update(define("image", data.name), true);
        setStatus("已应用");
      })
      .catch(function () { setStatus("上传失败：无法连接宿主"); });
  }

  function remove(name) {
    fetch(API + "/remove?name=" + encodeURIComponent(name), { method: "POST", cache: "no-store" })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          setStatus("删除失败");
          return;
        }
        state.images = data.images || state.images;
        state.config = ensureKnownImage(Object.assign({}, resolveDefaults(), data.config));
        // A baseline pointing at the file just deleted would be unreachable.
        if (state.userDefaults && state.userDefaults.image === name) {
          state.userDefaults.image = "default";
          try {
            localStorage.setItem(DEFAULTS_KEY, JSON.stringify(state.userDefaults));
          } catch (error) {
            /* the in-memory baseline is corrected either way */
          }
        }
        paint(true);
        sync();
        setStatus("已删除");
      })
      .catch(function () { setStatus("删除失败：无法连接宿主"); });
  }

  /** Push the config into the existing controls without rebuilding them. */
  function sync() {
    var controls = state.controls;
    if (!controls || !state.config) return;
    var config = state.config;
    controls.enabled.checked = config.enabled !== false;
    controls.sidebar.input.value = String(config.sidebar);
    controls.sidebar.value.textContent = config.sidebar + "%";
    controls.center.input.value = String(config.center);
    controls.center.value.textContent = config.center + "%";
    controls.content.input.value = String(config.panel);
    controls.content.value.textContent = config.panel + "%";
    controls.blur.input.value = String(config.blur);
    controls.blur.value.textContent = config.blur + "px";
    controls.anchors.forEach(function (entry) {
      entry.node.setAttribute("data-active", entry.key === (config.anchor || "bl") ? "1" : "0");
    });

    controls.thumbs.textContent = "";
    state.images.forEach(function (image) {
      var thumb = make("div", "dsh-ub-thumb");
      thumb.setAttribute("data-active", image.name === config.image ? "1" : "0");
      thumb.title = image.name;
      var source = thumbnailSource(image, config);
      if (source) {
        var preview = document.createElement("img");
        preview.src = source;
        preview.alt = image.name;
        thumb.appendChild(preview);
      } else {
        // No trustworthy source for this file: name it rather than mislabel it.
        thumb.className += " dsh-ub-thumb-plain";
        if (!image.builtin) thumb.appendChild(make("span", null, shortName(image.name)));
      }
      if (image.builtin) thumb.appendChild(make("b", null, "内置"));
      else {
        var removeButton = make("button", "dsh-ub-del", "×");
        removeButton.title = "删除";
        removeButton.addEventListener("click", function (event) {
          event.stopPropagation();
          remove(image.name);
        });
        thumb.appendChild(removeButton);
      }
      thumb.addEventListener("click", function () {
        update(define("image", image.name), true);
      });
      controls.thumbs.appendChild(thumb);
    });
  }

  // -------------------------------------------------------------------- start

  function bootstrap() {
    // Before load(): it fills missing config keys from the active baseline.
    state.userDefaults = readUserDefaults();
    load().then(function () {
      try {
        mountPanel();
        // The previous build stored a panel point that no longer means anything.
        try {
          localStorage.removeItem(LEGACY_POSITION_KEY);
        } catch (error) {
          /* nothing to migrate */
        }
        state.button = readButtonPoint();
        place();
        sync();
      } catch (error) {
        fail("panel", error);
      }
      var tries = 0;
      (function attempt() {
        try {
          if (paint(true)) {
            watch();
            return;
          }
        } catch (error) {
          fail("paint", error);
          return;
        }
        if (tries++ < 60) {
          setTimeout(attempt, 250);
          return;
        }
        watch();
      })();
    }).catch(function (error) { fail("load", error); });
  }

  /** Undo everything this run created, so a reload can start clean. */
  function dispose() {
    try {
      if (state.observer) state.observer.disconnect();
      if (state.paintTimer !== null) clearTimeout(state.paintTimer);
      if (state.saveTimer !== null) clearTimeout(state.saveTimer);
      (state.listeners || []).forEach(function (entry) {
        entry[0].removeEventListener(entry[1], entry[2], entry[3]);
      });
      [PANEL_ID, BUTTON_ID, PANEL_STYLE_ID].forEach(function (id) {
        var node = document.getElementById(id);
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
      Array.prototype.forEach.call(document.querySelectorAll("style[" + STYLE_MARK + "]"), function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      window.__dshUserBackgroundApplied = false;
    } catch (error) {
      /* nothing left to undo */
    }
  }

  window.__dshUserBackground = { dispose: dispose };

  // A previous build injected its own sheet; drop it so only this one paints.
  Array.prototype.forEach.call(document.querySelectorAll("style[" + STYLE_MARK + "]"), function (node) {
    node.parentNode.removeChild(node);
  });

  window.addEventListener("error", function (event) {
    fail("window", (event && (event.error || event.message)) || "unknown");
  });

  if (document.body) bootstrap();
  else document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
})();
