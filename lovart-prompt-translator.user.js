// ==UserScript==
// @name         Lovart Prompt Translator
// @namespace    https://lovart.ai/
// @version      0.2.10
// @description  Translate, compare, edit, and refill Chinese/English prompts in prompt input boxes.
// @author       Codex
// @homepageURL  https://github.com/wsbjj/lovart-prompt-translator
// @supportURL   https://github.com/wsbjj/lovart-prompt-translator/issues
// @updateURL    https://raw.githubusercontent.com/wsbjj/lovart-prompt-translator/main/lovart-prompt-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/wsbjj/lovart-prompt-translator/main/lovart-prompt-translator.user.js
// @match        https://lovart.ai/*
// @match        https://www.lovart.ai/*
// @match        https://*.lovart.ai/*
// @match        https://www.runninghub.cn/*
// @match        https://www.pinterest.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.openai.com
// @connect      api.deepl.com
// @connect      api-free.deepl.com
// @connect      translate.volcengineapi.com
// @connect      api.siliconflow.cn
// @connect      *
// ==/UserScript==

(function () {
  "use strict";

  const SCRIPT_ID = "lovart-prompt-translator";
  const STORE_KEY = "lovartPromptTranslatorConfig";
  const CONTENT_EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"])';
  const REAL_EDITABLE_SELECTOR = `${CONTENT_EDITABLE_SELECTOR}, textarea, input`;
  const EDITABLE_SELECTOR = `${REAL_EDITABLE_SELECTOR}, [role="textbox"]`;
  const AUTO_SHOW_TOOLBAR_HOSTS = new Set([
    "www.runninghub.cn",
    "www.pinterest.com"
  ]);

  const DEFAULT_CONFIG = {
    provider: "volcengine",
    openaiApiKey: "",
    openaiEndpoint: "https://api.openai.com/v1/responses",
    openaiModel: "gpt-4.1-mini",
    deeplApiKey: "",
    deeplPlan: "free",
    volcengineAccessKeyId: "",
    volcengineSecretAccessKey: "",
    volcengineRegion: "cn-north-1",
    keepStructure: true,
    autoOpenCompare: true,
    toolbarCollapsed: false,
    toolbarPosition: null
  };

  let config = loadConfig();
  let activeInput = null;
  let selectedTextCache = "";
  let hoverBubble = null;
  let toolbar = null;
  let suppressToolbarClick = false;
  let isFillingInput = false;
  let selectionTranslationToken = 0;
  let modalRoot = null;

  GM_addStyle(`
    #${SCRIPT_ID}-toolbar,
    #${SCRIPT_ID}-bubble,
    #${SCRIPT_ID}-modal {
      box-sizing: border-box;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #111827;
      z-index: 2147483647;
      --lpt-ink: #111827;
      --lpt-muted: #64748b;
      --lpt-line: #e5e7eb;
      --lpt-soft: #f8fafc;
      --lpt-soft-hover: #eef2f7;
      --lpt-primary: #111827;
      --lpt-primary-hover: #1f2937;
      --lpt-ring: rgba(17, 24, 39, 0.12);
    }

    #${SCRIPT_ID}-toolbar {
      position: fixed;
      right: 18px;
      bottom: 22px;
      display: none;
      gap: 6px;
      align-items: center;
      padding: 8px;
      border: 1px solid rgba(15, 23, 42, 0.1);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
      backdrop-filter: blur(14px);
      user-select: none;
      transition: box-shadow 160ms ease, padding 160ms ease, border-radius 160ms ease;
    }

    #${SCRIPT_ID}-toolbar.dragging {
      cursor: grabbing;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
    }

    #${SCRIPT_ID}-toolbar.collapsed {
      gap: 0;
      padding: 6px;
      border-radius: 999px;
      cursor: grab;
    }

    #${SCRIPT_ID}-toolbar .toolbar-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    #${SCRIPT_ID}-toolbar .toolbar-drag-handle {
      width: 24px;
      min-width: 24px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      background: transparent;
      color: #94a3b8;
      cursor: grab;
      box-shadow: none;
      font-size: 15px;
      letter-spacing: -2px;
    }

    #${SCRIPT_ID}-toolbar .toolbar-drag-handle:hover {
      background: #f1f5f9;
      color: #334155;
    }

    #${SCRIPT_ID}-toolbar .toolbar-drag-handle:active {
      cursor: grabbing;
    }

    #${SCRIPT_ID}-toolbar .toolbar-collapse {
      width: 34px;
      min-width: 34px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      background: #f1f5f9;
      color: #334155;
      box-shadow: none;
      font-size: 14px;
    }

    #${SCRIPT_ID}-toolbar .collapsed-label {
      display: none;
    }

    #${SCRIPT_ID}-toolbar.collapsed .toolbar-actions,
    #${SCRIPT_ID}-toolbar.collapsed .toolbar-drag-handle,
    #${SCRIPT_ID}-toolbar.collapsed .expanded-label {
      display: none;
    }

    #${SCRIPT_ID}-toolbar.collapsed .collapsed-label {
      display: inline;
    }

    #${SCRIPT_ID}-toolbar.collapsed .toolbar-collapse {
      width: 42px;
      min-width: 42px;
      height: 42px;
      border-radius: 999px;
      background: var(--lpt-primary);
      color: #ffffff;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.22);
    }

    #${SCRIPT_ID}-toolbar button,
    #${SCRIPT_ID}-bubble button,
    #${SCRIPT_ID}-modal button,
    #${SCRIPT_ID}-modal select,
    #${SCRIPT_ID}-modal input,
    #${SCRIPT_ID}-modal textarea {
      font: inherit;
    }

    #${SCRIPT_ID}-toolbar button,
    #${SCRIPT_ID}-bubble button,
    #${SCRIPT_ID}-modal button {
      min-height: 36px;
      border: 0;
      border-radius: 8px;
      background: var(--lpt-soft);
      color: var(--lpt-ink);
      cursor: pointer;
      line-height: 1;
      font-size: 13px;
      font-weight: 650;
      transition: background 160ms ease, color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }

    #${SCRIPT_ID}-toolbar button {
      height: 34px;
      padding: 0 12px;
      background: transparent;
      white-space: nowrap;
    }

    #${SCRIPT_ID}-toolbar button:hover,
    #${SCRIPT_ID}-bubble button:hover,
    #${SCRIPT_ID}-modal button:hover {
      background: var(--lpt-soft-hover);
    }

    #${SCRIPT_ID}-toolbar button:active,
    #${SCRIPT_ID}-bubble button:active,
    #${SCRIPT_ID}-modal button:active {
      transform: scale(0.98);
    }

    #${SCRIPT_ID}-toolbar button:focus-visible,
    #${SCRIPT_ID}-bubble button:focus-visible,
    #${SCRIPT_ID}-modal button:focus-visible,
    #${SCRIPT_ID}-modal input:focus-visible,
    #${SCRIPT_ID}-modal select:focus-visible,
    #${SCRIPT_ID}-modal textarea:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px var(--lpt-ring);
    }

    #${SCRIPT_ID}-toolbar .primary,
    #${SCRIPT_ID}-modal .primary {
      background: var(--lpt-primary);
      color: #ffffff;
      box-shadow: 0 10px 22px rgba(15, 23, 42, 0.18);
    }

    #${SCRIPT_ID}-toolbar .primary:hover,
    #${SCRIPT_ID}-modal .primary:hover {
      background: var(--lpt-primary-hover);
    }

    #${SCRIPT_ID}-modal .ghost {
      background: transparent;
      color: var(--lpt-muted);
      box-shadow: none;
    }

    #${SCRIPT_ID}-modal .ghost:hover {
      background: var(--lpt-soft-hover);
      color: var(--lpt-ink);
    }

    #${SCRIPT_ID}-modal .icon-button {
      width: 34px;
      height: 34px;
      min-height: 34px;
      display: inline-grid;
      place-items: center;
      padding: 0;
      background: #f1f5f9;
      color: #334155;
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
      box-shadow: none;
    }

    #${SCRIPT_ID}-bubble {
      position: fixed;
      display: none;
      max-width: min(460px, calc(100vw - 24px));
      padding: 8px;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.2);
      backdrop-filter: blur(14px);
    }

    #${SCRIPT_ID}-bubble .row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    #${SCRIPT_ID}-bubble button {
      min-height: 30px;
      padding: 0 11px;
      white-space: nowrap;
    }

    #${SCRIPT_ID}-bubble .preview {
      max-height: 120px;
      margin-top: 8px;
      padding: 8px;
      overflow: auto;
      border-radius: 7px;
      background: #f9fafb;
      color: #374151;
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    #${SCRIPT_ID}-modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(15, 23, 42, 0.36);
    }

    #${SCRIPT_ID}-modal .panel {
      width: min(1080px, 100%);
      max-height: min(780px, calc(100vh - 36px));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(17, 24, 39, 0.12);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
    }

    #${SCRIPT_ID}-modal .settings-panel {
      width: min(860px, calc(100vw - 28px));
    }

    #${SCRIPT_ID}-modal .head,
    #${SCRIPT_ID}-modal .foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--lpt-line);
    }

    #${SCRIPT_ID}-modal .foot {
      border-top: 1px solid var(--lpt-line);
      border-bottom: 0;
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    #${SCRIPT_ID}-modal .foot button {
      min-width: 76px;
      padding: 0 14px;
    }

    #${SCRIPT_ID}-modal .title {
      font-size: 14px;
      font-weight: 700;
      color: #111827;
    }

    #${SCRIPT_ID}-modal .subtitle {
      margin-top: 4px;
      color: var(--lpt-muted);
      font-size: 12px;
      line-height: 1.45;
    }

    #${SCRIPT_ID}-modal .body {
      padding: 16px;
      overflow: auto;
      background: #fbfbfc;
    }

    #${SCRIPT_ID}-modal .compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    #${SCRIPT_ID}-modal label {
      display: grid;
      gap: 7px;
      color: #374151;
      font-size: 12px;
      font-weight: 600;
    }

    #${SCRIPT_ID}-modal textarea {
      width: 100%;
      min-height: 320px;
      resize: vertical;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 7px;
      color: #111827;
      background: #ffffff;
      font-size: 13px;
      line-height: 1.6;
      outline: none;
    }

    #${SCRIPT_ID}-modal textarea:focus,
    #${SCRIPT_ID}-modal input:focus,
    #${SCRIPT_ID}-modal select:focus {
      border-color: #111827;
      box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
    }

    #${SCRIPT_ID}-modal .settings-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    #${SCRIPT_ID}-modal .settings-stack {
      display: grid;
      gap: 12px;
    }

    #${SCRIPT_ID}-modal .settings-section {
      padding: 12px;
      border: 1px solid var(--lpt-line);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    #${SCRIPT_ID}-modal .settings-section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      color: #111827;
      font-size: 13px;
      font-weight: 700;
    }

    #${SCRIPT_ID}-modal .settings-section-title small {
      color: var(--lpt-muted);
      font-size: 12px;
      font-weight: 500;
    }

    #${SCRIPT_ID}-modal .service-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    #${SCRIPT_ID}-modal .service-option {
      display: block;
      min-width: 0;
      cursor: pointer;
    }

    #${SCRIPT_ID}-modal .service-option input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    #${SCRIPT_ID}-modal .service-option span {
      display: grid;
      gap: 4px;
      min-height: 70px;
      padding: 10px;
      border: 1px solid var(--lpt-line);
      border-radius: 8px;
      background: #ffffff;
      transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
    }

    #${SCRIPT_ID}-modal .service-option span:hover {
      background: var(--lpt-soft);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
      transform: translateY(-1px);
    }

    #${SCRIPT_ID}-modal .service-option strong {
      color: #111827;
      font-size: 13px;
      line-height: 1.25;
    }

    #${SCRIPT_ID}-modal .service-option small {
      color: var(--lpt-muted);
      font-size: 11px;
      line-height: 1.35;
    }

    #${SCRIPT_ID}-modal .service-option input:checked + span {
      border-color: rgba(17, 24, 39, 0.22);
      background: #111827;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);
    }

    #${SCRIPT_ID}-modal .service-option input:checked + span strong {
      color: #ffffff;
    }

    #${SCRIPT_ID}-modal .service-option input:checked + span small {
      color: #cbd5e1;
    }

    #${SCRIPT_ID}-modal .provider-fields[hidden] {
      display: none;
    }

    #${SCRIPT_ID}-modal input,
    #${SCRIPT_ID}-modal select {
      height: 36px;
      padding: 0 12px;
      border: 1px solid var(--lpt-line);
      border-radius: 7px;
      color: #111827;
      background: var(--lpt-soft);
      outline: none;
      font-weight: 560;
    }

    #${SCRIPT_ID}-modal .note {
      margin-top: 12px;
      padding: 10px;
      border-radius: 7px;
      background: #f3f4f6;
      color: #4b5563;
      font-size: 12px;
      line-height: 1.6;
    }

    #${SCRIPT_ID}-toast {
      position: fixed;
      left: 50%;
      bottom: 82px;
      transform: translateX(-50%);
      display: none;
      max-width: min(560px, calc(100vw - 24px));
      padding: 10px 12px;
      border-radius: 8px;
      background: #111827;
      color: #ffffff;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.24);
      z-index: 2147483647;
    }

    @media (max-width: 720px) {
      #${SCRIPT_ID}-toolbar {
        left: 10px;
        right: 10px;
        bottom: 12px;
        justify-content: center;
        overflow-x: auto;
      }

      #${SCRIPT_ID}-modal {
        padding: 10px;
      }

      #${SCRIPT_ID}-modal .compare-grid,
      #${SCRIPT_ID}-modal .settings-grid,
      #${SCRIPT_ID}-modal .service-grid {
        grid-template-columns: 1fr;
      }

      #${SCRIPT_ID}-modal textarea {
        min-height: 220px;
      }
    }
  `);

  init();

  function init() {
    createToolbar();
    createBubble();
    createModalRoot();
    createToast();
    bindInputTracking();
    bindSelectionTracking();
    window.addEventListener("resize", applyToolbarState);
    registerMenus();
    if (shouldShowToolbarOnLoad()) {
      showToolbar();
    }
  }

  function registerMenus() {
    GM_registerMenuCommand("提示词翻译设置", openSettingsModal);
    GM_registerMenuCommand("翻译当前输入框", () => translateActive("auto"));
  }

  function shouldShowToolbarOnLoad() {
    return AUTO_SHOW_TOOLBAR_HOSTS.has(window.location.hostname);
  }

  function loadConfig() {
    const stored = GM_getValue(STORE_KEY, {});
    return Object.assign({}, DEFAULT_CONFIG, stored || {});
  }

  function saveConfig(nextConfig) {
    config = Object.assign({}, DEFAULT_CONFIG, nextConfig || {});
    GM_setValue(STORE_KEY, config);
  }

  function createToolbar() {
    toolbar = document.createElement("div");
    toolbar.id = `${SCRIPT_ID}-toolbar`;
    toolbar.innerHTML = `
      <button type="button" class="toolbar-drag-handle" data-role="drag-handle" title="拖动工具条" aria-label="拖动工具条">⋮⋮</button>
      <div class="toolbar-actions">
        <button type="button" class="primary" data-action="auto">自动翻译</button>
        <button type="button" data-action="en">中译英</button>
        <button type="button" data-action="zh">英译中</button>
        <button type="button" data-action="compare">对比</button>
        <button type="button" data-action="settings">设置</button>
      </div>
      <button type="button" class="toolbar-collapse" data-action="toggle-collapse" title="折叠/展开工具条" aria-label="折叠/展开工具条">
        <span class="expanded-label" aria-hidden="true">−</span>
        <span class="collapsed-label" aria-hidden="true">译</span>
      </button>
    `;
    document.documentElement.appendChild(toolbar);
    bindToolbarDrag();
    applyToolbarState();

    toolbar.addEventListener("click", (event) => {
      if (suppressToolbarClick) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const button = event.target.closest("button");
      if (!button) return;
      const action = button.dataset.action;

      if (action === "toggle-collapse") {
        toggleToolbarCollapsed();
        return;
      }

      if (action === "settings") {
        openSettingsModal();
        return;
      }

      if (action === "compare") {
        const text = getActiveText();
        if (!text) {
          toast("没有找到可翻译的输入内容。");
          return;
        }
        openCompareModal({
          sourceText: text,
          translatedText: "",
          targetLanguage: inferTargetLanguage(text),
          targetElement: activeInput
        });
        return;
      }

      translateActive(action);
    });
  }

  function bindToolbarDrag() {
    let dragState = null;

    toolbar.addEventListener("pointerdown", (event) => {
      const handle = event.target.closest('[data-role="drag-handle"]');
      const toggleButton = event.target.closest('[data-action="toggle-collapse"]');
      const isCollapsed = toolbar.classList.contains("collapsed");
      if (!handle && !(isCollapsed && toggleButton)) return;

      const rect = toolbar.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        startedCollapsed: isCollapsed,
        moved: false
      };

      toolbar.setPointerCapture(event.pointerId);
      toolbar.classList.add("dragging");
    });

    toolbar.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;

      if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 8) return;
      dragState.moved = true;
      event.preventDefault();
      setToolbarPosition(dragState.originX + deltaX, dragState.originY + deltaY);
    });

    toolbar.addEventListener("pointerup", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      finishToolbarDrag(dragState);
      dragState = null;
    });

    toolbar.addEventListener("pointercancel", () => {
      finishToolbarDrag(dragState);
      dragState = null;
    });
  }

  function finishToolbarDrag(state) {
    toolbar.classList.remove("dragging");
    if (!state) return;

    if (state.startedCollapsed && !state.moved) {
      toggleToolbarCollapsed(false);
      suppressNextToolbarClick();
      return;
    }

    if (!state.moved) return;

    const rect = toolbar.getBoundingClientRect();
    persistToolbarState({
      toolbarPosition: {
        x: Math.round(rect.left),
        y: Math.round(rect.top)
      }
    });
    suppressNextToolbarClick();
  }

  function suppressNextToolbarClick() {
    suppressToolbarClick = true;
    window.setTimeout(() => {
      suppressToolbarClick = false;
    }, 80);
  }

  function applyToolbarState() {
    if (!toolbar) return;

    toolbar.classList.toggle("collapsed", Boolean(config.toolbarCollapsed));

    if (config.toolbarPosition && Number.isFinite(config.toolbarPosition.x) && Number.isFinite(config.toolbarPosition.y)) {
      setToolbarPosition(config.toolbarPosition.x, config.toolbarPosition.y);
      return;
    }

    toolbar.style.left = "";
    toolbar.style.top = "";
    toolbar.style.right = "18px";
    toolbar.style.bottom = "22px";
  }

  function toggleToolbarCollapsed(collapsed) {
    const nextCollapsed = typeof collapsed === "boolean"
      ? collapsed
      : !config.toolbarCollapsed;
    persistToolbarState({ toolbarCollapsed: nextCollapsed });
    applyToolbarState();
  }

  function setToolbarPosition(x, y) {
    const margin = 8;
    const width = toolbar.offsetWidth || 48;
    const height = toolbar.offsetHeight || 48;
    const nextX = clamp(x, margin, Math.max(margin, window.innerWidth - width - margin));
    const nextY = clamp(y, margin, Math.max(margin, window.innerHeight - height - margin));

    toolbar.style.left = `${Math.round(nextX)}px`;
    toolbar.style.top = `${Math.round(nextY)}px`;
    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
  }

  function persistToolbarState(nextState) {
    config = Object.assign({}, config, nextState || {});
    GM_setValue(STORE_KEY, config);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function createBubble() {
    hoverBubble = document.createElement("div");
    hoverBubble.id = `${SCRIPT_ID}-bubble`;
    hoverBubble.innerHTML = `
      <div class="row">
        <button type="button" data-action="auto">翻译选中</button>
        <button type="button" data-action="compare">对比编辑</button>
        <button type="button" data-action="close">关闭</button>
      </div>
      <div class="preview"></div>
    `;
    document.documentElement.appendChild(hoverBubble);

    hoverBubble.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const action = button.dataset.action;

      if (action === "close") {
        hideBubble();
        return;
      }

      if (!selectedTextCache.trim()) {
        toast("请先选中一段文字。");
        hideBubble();
        return;
      }

      if (action === "compare") {
        hideBubble();
        openCompareModal({
          sourceText: selectedTextCache,
          translatedText: "",
          targetLanguage: inferTargetLanguage(selectedTextCache),
          targetElement: activeInput
        });
        return;
      }

      try {
        setBubblePreview("翻译中...");
        const targetLanguage = inferTargetLanguage(selectedTextCache);
        const translatedText = await translateText(selectedTextCache, targetLanguage);
        setBubblePreview(translatedText);
        openCompareModal({
          sourceText: selectedTextCache,
          translatedText,
          targetLanguage,
          targetElement: activeInput
        });
      } catch (error) {
        setBubblePreview(error.message || String(error));
      }
    });
  }

  function createModalRoot() {
    modalRoot = document.createElement("div");
    modalRoot.id = `${SCRIPT_ID}-modal`;
    document.documentElement.appendChild(modalRoot);

    modalRoot.addEventListener("click", (event) => {
      if (event.target === modalRoot) closeModal();
    });
  }

  function createToast() {
    const toastNode = document.createElement("div");
    toastNode.id = `${SCRIPT_ID}-toast`;
    document.documentElement.appendChild(toastNode);
  }

  function bindInputTracking() {
    const updateActiveFromEvent = (event) => {
      const target = getEditableRoot(event.target);
      if (!target) return;
      activeInput = target;
      showToolbar();
    };

    document.addEventListener("focusin", updateActiveFromEvent, true);
    document.addEventListener("click", updateActiveFromEvent, true);
    document.addEventListener("keyup", updateActiveFromEvent, true);

    const observer = new MutationObserver(() => {
      if (!activeInput || !document.contains(activeInput)) {
        activeInput = getEditableRoot(document.activeElement);
        if (activeInput) showToolbar();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function bindSelectionTracking() {
    document.addEventListener("mouseup", () => {
      window.setTimeout(() => {
        const selection = getSelectionInfo();
        if (!selection.text || selection.text.length < 2) {
          hideBubble();
          return;
        }

        selectionTranslationToken += 1;
        selectedTextCache = selection.text;
        if (selection.element) activeInput = selection.element;
        showBubble(selection.rect);
        if (shouldAutoTranslateSelection(selection)) {
          autoTranslateSelectionToChinese(selection.text, selectionTranslationToken);
        }
      }, 0);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideBubble();
        closeModal();
      }
    });
  }

  function showToolbar() {
    if (!toolbar) return;
    toolbar.style.display = "flex";
    applyToolbarState();
  }

  function showBubble(rect) {
    if (!hoverBubble || !rect) return;
    const margin = 10;
    const left = Math.min(
      Math.max(margin, rect.left),
      window.innerWidth - hoverBubble.offsetWidth - margin
    );
    const top = Math.min(
      Math.max(margin, rect.bottom + 8),
      window.innerHeight - hoverBubble.offsetHeight - margin
    );

    hoverBubble.style.left = `${left}px`;
    hoverBubble.style.top = `${top}px`;
    hoverBubble.style.display = "block";
    setBubblePreview(selectedTextCache);
  }

  function hideBubble() {
    selectionTranslationToken += 1;
    if (hoverBubble) hoverBubble.style.display = "none";
  }

  function setBubblePreview(text) {
    const preview = hoverBubble && hoverBubble.querySelector(".preview");
    if (preview) preview.textContent = text || "";
  }

  function shouldAutoTranslateSelection(selection) {
    return Boolean(
      selection &&
      !selection.element &&
      selection.text &&
      /[A-Za-z]/.test(selection.text)
    );
  }

  async function autoTranslateSelectionToChinese(text, token) {
    setBubblePreview("翻译中...");
    try {
      const translatedText = await translateText(text, "zh");
      if (token !== selectionTranslationToken || selectedTextCache !== text || !isBubbleVisible()) return;
      setBubblePreview(translatedText);
    } catch (error) {
      if (token !== selectionTranslationToken || selectedTextCache !== text || !isBubbleVisible()) return;
      setBubblePreview(error.message || String(error));
    }
  }

  function isBubbleVisible() {
    return Boolean(hoverBubble && hoverBubble.style.display !== "none");
  }

  async function translateActive(mode) {
    const text = getActiveText();
    if (!text) {
      toast("没有找到可翻译的输入内容。请先点一下 Lovart 输入框。");
      return;
    }

    const targetLanguage = mode === "auto" ? inferTargetLanguage(text) : mode;
    try {
      toast("正在翻译...");
      const translatedText = await translateText(text, targetLanguage);
      toast("翻译完成，可以在对比面板中修改后填充。");

      if (config.autoOpenCompare) {
        openCompareModal({
          sourceText: text,
          translatedText,
          targetLanguage,
          targetElement: activeInput
        });
      } else {
        fillActiveInput(translatedText, activeInput);
      }
    } catch (error) {
      toast(error.message || String(error));
    }
  }

  async function translateText(text, targetLanguage) {
    assertProviderReady();

    if (config.provider === "volcengine") {
      return translateWithVolcengine(text, targetLanguage);
    }

    if (config.provider === "deepl") {
      return translateWithDeepL(text, targetLanguage);
    }

    return translateWithOpenAI(text, targetLanguage);
  }

  async function translateWithOpenAI(text, targetLanguage) {
    const endpoint = (config.openaiEndpoint || DEFAULT_CONFIG.openaiEndpoint).trim();
    const targetName = targetLanguage === "zh" ? "Simplified Chinese" : "English";
    const structureRule = config.keepStructure
      ? "Preserve prompt structure, line breaks, comma-separated fragments, model/style tags, parameters, and weights."
      : "Make the translation natural and concise.";
    const model = (config.openaiModel || DEFAULT_CONFIG.openaiModel).trim();
    const usesChatCompletions = isChatCompletionsEndpoint(endpoint);
    const requestData = usesChatCompletions
      ? buildChatCompletionsPayload({ endpoint, model, text, targetName, structureRule })
      : {
          model,
          instructions: [
            "You are a professional prompt translator for AI image, design, and video generation.",
            "Translate only. Do not explain. Do not add markdown fences.",
            structureRule
          ].join(" "),
          input: `Translate this prompt to ${targetName}. Only output the translated prompt.\n\n${text}`,
          max_output_tokens: 1800
        };

    const response = await gmJsonRequest({
      method: "POST",
      url: endpoint,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey.trim()}`
      },
      data: requestData
    });

    const outputText = usesChatCompletions
      ? extractChatCompletionText(response)
      : extractOpenAIText(response);
    if (!outputText) {
      throw new Error("模型接口返回为空，请检查模型名称、Endpoint 或接口响应。");
    }
    return outputText.trim();
  }

  function isChatCompletionsEndpoint(endpoint) {
    return /\/chat\/completions\/?$/i.test(endpoint || "");
  }

  function buildChatCompletionsPayload({ endpoint, model, text, targetName, structureRule }) {
    const payload = {
      model,
      messages: buildPromptTranslationMessages(text, targetName, structureRule),
      stream: false,
      max_tokens: 1800,
      temperature: 0.2
    };

    if (/siliconflow\.cn/i.test(endpoint || "")) {
      payload.enable_thinking = false;
    }

    return payload;
  }

  function buildPromptTranslationMessages(text, targetName, structureRule) {
    return [
      {
        role: "system",
        content: [
          "You are a professional prompt translator for AI image, design, and video generation.",
          "Translate only. Do not explain. Do not add markdown fences.",
          structureRule
        ].join(" ")
      },
      {
        role: "user",
        content: `Translate this prompt to ${targetName}. Only output the translated prompt.\n\n${text}`
      }
    ];
  }

  async function translateWithDeepL(text, targetLanguage) {
    const host = config.deeplPlan === "pro" ? "https://api.deepl.com" : "https://api-free.deepl.com";
    const response = await gmJsonRequest({
      method: "POST",
      url: `${host}/v2/translate`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `DeepL-Auth-Key ${config.deeplApiKey.trim()}`
      },
      data: {
        text: [text],
        target_lang: targetLanguage === "zh" ? "ZH-HANS" : "EN-US"
      }
    });

    const translated = response && response.translations && response.translations[0];
    if (!translated || !translated.text) {
      throw new Error("DeepL 返回为空，请检查 API Key、套餐类型或目标语言。");
    }

    return translated.text.trim();
  }

  async function translateWithVolcengine(text, targetLanguage) {
    const body = JSON.stringify({
      TargetLanguage: targetLanguage === "zh" ? "zh" : "en",
      TextList: [text]
    });
    const url = "https://translate.volcengineapi.com/?Action=TranslateText&Version=2020-06-01";
    const headers = await signVolcengineRequest({
      accessKeyId: config.volcengineAccessKeyId.trim(),
      secretAccessKey: config.volcengineSecretAccessKey.trim(),
      region: (config.volcengineRegion || DEFAULT_CONFIG.volcengineRegion).trim(),
      service: "translate",
      host: "translate.volcengineapi.com",
      method: "POST",
      path: "/",
      query: "Action=TranslateText&Version=2020-06-01",
      body
    });

    const response = await gmJsonRequest({
      method: "POST",
      url,
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      data: body
    });

    const item = response && response.TranslationList && response.TranslationList[0];
    const translated = item && (item.Translation || item.TranslatedText || item.Text);
    if (!translated) {
      throw new Error("火山引擎返回为空，请检查 AK/SK、机器翻译服务权限或接口配额。");
    }

    return translated.trim();
  }

  async function signVolcengineRequest(options) {
    const xDate = formatVolcengineDate(new Date());
    const shortDate = xDate.slice(0, 8);
    const payloadHash = await sha256Hex(options.body || "");
    const signedHeaders = "host;x-content-sha256;x-date";
    const canonicalHeaders = [
      `host:${options.host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
      ""
    ].join("\n");
    const canonicalRequest = [
      options.method.toUpperCase(),
      options.path || "/",
      options.query || "",
      canonicalHeaders,
      signedHeaders,
      payloadHash
    ].join("\n");
    const credentialScope = `${shortDate}/${options.region}/${options.service}/request`;
    const stringToSign = [
      "HMAC-SHA256",
      xDate,
      credentialScope,
      await sha256Hex(canonicalRequest)
    ].join("\n");
    const signingKey = await getVolcengineSigningKey(
      options.secretAccessKey,
      shortDate,
      options.region,
      options.service
    );
    const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

    return {
      "X-Date": xDate,
      "X-Content-Sha256": payloadHash,
      Authorization: `HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
  }

  async function getVolcengineSigningKey(secretAccessKey, shortDate, region, service) {
    const dateKey = await hmacSha256(encodeUtf8(secretAccessKey), shortDate);
    const regionKey = await hmacSha256(dateKey, region);
    const serviceKey = await hmacSha256(regionKey, service);
    return hmacSha256(serviceKey, "request");
  }

  async function hmacSha256(keyBytes, message) {
    const subtle = getSubtleCrypto();
    const cryptoKey = await subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await subtle.sign("HMAC", cryptoKey, encodeUtf8(message));
    return new Uint8Array(signature);
  }

  async function sha256Hex(value) {
    const digest = await getSubtleCrypto().digest("SHA-256", encodeUtf8(value));
    return bytesToHex(new Uint8Array(digest));
  }

  function getSubtleCrypto() {
    const cryptoSource = globalThis.crypto || (typeof window !== "undefined" && window.crypto);
    if (!cryptoSource || !cryptoSource.subtle) {
      throw new Error("当前浏览器环境不支持 Web Crypto，无法生成火山引擎 API 签名。");
    }
    return cryptoSource.subtle;
  }

  function encodeUtf8(value) {
    if (value instanceof Uint8Array) return value;
    return new TextEncoder().encode(String(value));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function formatVolcengineDate(date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  }

  function gmJsonRequest(options) {
    return new Promise((resolve, reject) => {
      const requestData = typeof options.data === "string"
        ? options.data
        : JSON.stringify(options.data || {});

      GM_xmlhttpRequest({
        method: options.method,
        url: options.url,
        headers: options.headers || {},
        data: requestData,
        timeout: 60000,
        responseType: "json",
        onload: (response) => {
          const body = response.response || tryParseJson(response.responseText);
          if (response.status >= 200 && response.status < 300) {
            resolve(body);
            return;
          }

          const message = extractApiError(body) || response.responseText || response.statusText;
          reject(new Error(`请求失败 ${response.status}: ${message}`));
        },
        onerror: () => reject(new Error("网络请求失败，请检查 @connect 权限或网络环境。")),
        ontimeout: () => reject(new Error("翻译请求超时，请稍后重试。"))
      });
    });
  }

  function openCompareModal(payload) {
    const sourceText = payload.sourceText || "";
    const translatedText = payload.translatedText || "";
    const targetLanguage = payload.targetLanguage || inferTargetLanguage(sourceText);
    const targetElement = payload.targetElement || activeInput;

    modalRoot.innerHTML = `
      <section class="panel" role="dialog" aria-modal="true" aria-label="中英文提示词对比">
        <div class="head">
          <div class="title">中英文提示词对比</div>
          <button type="button" class="icon-button" data-action="close" title="关闭" aria-label="关闭">&times;</button>
        </div>
        <div class="body">
          <div class="compare-grid">
            <label>
              原文
              <textarea data-field="source"></textarea>
            </label>
            <label>
              译文
              <textarea data-field="translated"></textarea>
            </label>
          </div>
        </div>
        <div class="foot">
          <button type="button" class="ghost" data-action="retranslate">重新翻译</button>
          <button type="button" class="ghost" data-action="copy">复制译文</button>
          <button type="button" data-action="fill-bilingual">填充双语</button>
          <button type="button" class="primary" data-action="fill">填充译文</button>
        </div>
      </section>
    `;

    const sourceNode = modalRoot.querySelector('[data-field="source"]');
    const translatedNode = modalRoot.querySelector('[data-field="translated"]');
    sourceNode.value = sourceText;
    translatedNode.value = translatedText;

    modalRoot.onclick = async (event) => {
      if (event.target === modalRoot) {
        closeModal();
        return;
      }

      const button = event.target.closest("button");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "close") {
        closeModal();
        return;
      }

      if (action === "retranslate") {
        try {
          button.disabled = true;
          button.textContent = "翻译中...";
          translatedNode.value = await translateText(sourceNode.value, targetLanguage);
          toast("已重新翻译。");
        } catch (error) {
          toast(error.message || String(error));
        } finally {
          button.disabled = false;
          button.textContent = "重新翻译";
        }
        return;
      }

      if (action === "copy") {
        await copyText(translatedNode.value);
        toast("译文已复制。");
        return;
      }

      if (action === "fill-bilingual") {
        const bilingualText = buildBilingualPrompt(sourceNode.value, translatedNode.value);
        fillActiveInput(bilingualText, targetElement);
        closeModal();
        toast("已填充双语内容。");
        return;
      }

      if (action === "fill") {
        fillActiveInput(translatedNode.value, targetElement);
        closeModal();
        toast("已填充译文。");
      }
    };

    modalRoot.style.display = "flex";
    if (!translatedText) {
      translatedNode.focus();
    }
  }

  function openSettingsModal() {
    modalRoot.innerHTML = `
      <section class="panel settings-panel" role="dialog" aria-modal="true" aria-label="Lovart 翻译设置">
        <div class="head">
          <div>
            <div class="title">Lovart 翻译设置</div>
            <div class="subtitle">选择翻译服务，保存密钥后即可在 Lovart 输入框旁使用。</div>
          </div>
          <button type="button" class="icon-button" data-action="close" title="关闭" aria-label="关闭">&times;</button>
        </div>
        <div class="body">
          <div class="settings-stack">
            <section class="settings-section">
              <div class="settings-section-title">
                <span>翻译服务</span>
                <small>当前推荐国内直连：火山引擎</small>
              </div>
              <div class="service-grid">
                <label class="service-option">
                  <input data-field="provider" type="radio" name="provider" value="volcengine">
                  <span>
                    <strong>火山引擎</strong>
                    <small>机器翻译 API，国内网络更稳</small>
                  </span>
                </label>
                <label class="service-option">
                  <input data-field="provider" type="radio" name="provider" value="openai">
                  <span>
                    <strong>OpenAI/兼容</strong>
                    <small>支持硅基流动等 Chat Completions</small>
                  </span>
                </label>
                <label class="service-option">
                  <input data-field="provider" type="radio" name="provider" value="deepl">
                  <span>
                    <strong>DeepL</strong>
                    <small>适合常规中英翻译</small>
                  </span>
                </label>
              </div>
            </section>

            <section class="settings-section provider-fields" data-provider-section="volcengine">
              <div class="settings-section-title">
                <span>火山引擎密钥</span>
                <small>TranslateText / 2020-06-01</small>
              </div>
              <div class="settings-grid">
                <label>
                  Access Key ID
                  <input data-field="volcengineAccessKeyId" type="password" placeholder="AKLT..." autocomplete="off">
                </label>
                <label>
                  Secret Access Key
                  <input data-field="volcengineSecretAccessKey" type="password" placeholder="Secret Access Key" autocomplete="off">
                </label>
                <label>
                  Region
                  <input data-field="volcengineRegion" type="text" placeholder="cn-north-1">
                </label>
              </div>
            </section>

            <section class="settings-section provider-fields" data-provider-section="openai">
              <div class="settings-section-title">
                <span>OpenAI/兼容配置</span>
                <small>Responses 或 Chat Completions</small>
              </div>
              <div class="settings-grid">
                <label>
                  API Key
                  <input data-field="openaiApiKey" type="password" placeholder="sk-..." autocomplete="off">
                </label>
                <label>
                  模型
                  <input data-field="openaiModel" type="text" placeholder="gpt-4.1-mini">
                </label>
                <label>
                  Endpoint
                  <input data-field="openaiEndpoint" type="text" placeholder="https://api.openai.com/v1/responses">
                </label>
              </div>
            </section>

            <section class="settings-section provider-fields" data-provider-section="deepl">
              <div class="settings-section-title">
                <span>DeepL 配置</span>
                <small>Free / Pro 二选一</small>
              </div>
              <div class="settings-grid">
                <label>
                  API Key
                  <input data-field="deeplApiKey" type="password" placeholder="DeepL Auth Key" autocomplete="off">
                </label>
                <label>
                  套餐
                  <select data-field="deeplPlan">
                    <option value="free">Free: api-free.deepl.com</option>
                    <option value="pro">Pro: api.deepl.com</option>
                  </select>
                </label>
              </div>
            </section>

            <section class="settings-section">
              <div class="settings-section-title">
                <span>行为选项</span>
                <small>作用于全部服务</small>
              </div>
              <div class="settings-grid">
                <label>
                  保留提示词结构
                  <select data-field="keepStructure">
                    <option value="true">是</option>
                    <option value="false">否</option>
                  </select>
                </label>
                <label>
                  翻译后打开对比面板
                  <select data-field="autoOpenCompare">
                    <option value="true">是</option>
                    <option value="false">否，直接填充</option>
                  </select>
                </label>
              </div>
            </section>
          </div>
          <div class="note">
            注意：这是浏览器端直连方案，OpenAI Key、DeepL Key、火山 AK/SK 都会保存在 Tampermonkey 存储中。适合个人快速使用，不适合共享脚本或团队分发。
          </div>
        </div>
        <div class="foot">
          <button type="button" class="ghost" data-action="close">取消</button>
          <button type="button" class="primary" data-action="save">保存设置</button>
        </div>
      </section>
    `;

    setSettingsValue("provider", config.provider);
    setSettingsValue("deeplPlan", config.deeplPlan);
    setSettingsValue("openaiApiKey", config.openaiApiKey);
    setSettingsValue("openaiModel", config.openaiModel);
    setSettingsValue("openaiEndpoint", config.openaiEndpoint);
    setSettingsValue("deeplApiKey", config.deeplApiKey);
    setSettingsValue("volcengineAccessKeyId", config.volcengineAccessKeyId);
    setSettingsValue("volcengineSecretAccessKey", config.volcengineSecretAccessKey);
    setSettingsValue("volcengineRegion", config.volcengineRegion);
    setSettingsValue("keepStructure", String(Boolean(config.keepStructure)));
    setSettingsValue("autoOpenCompare", String(Boolean(config.autoOpenCompare)));
    syncProviderSections();

    modalRoot.onchange = (event) => {
      if (event.target && event.target.dataset.field === "provider") {
        syncProviderSections();
      }
    };

    modalRoot.onclick = (event) => {
      if (event.target === modalRoot) {
        closeModal();
        return;
      }

      const button = event.target.closest("button");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "close") {
        closeModal();
        return;
      }

      if (action === "save") {
        const nextConfig = {
          provider: getSettingsValue("provider"),
          deeplPlan: getSettingsValue("deeplPlan"),
          openaiApiKey: getSettingsValue("openaiApiKey"),
          openaiModel: getSettingsValue("openaiModel") || DEFAULT_CONFIG.openaiModel,
          openaiEndpoint: getSettingsValue("openaiEndpoint") || DEFAULT_CONFIG.openaiEndpoint,
          deeplApiKey: getSettingsValue("deeplApiKey"),
          volcengineAccessKeyId: getSettingsValue("volcengineAccessKeyId"),
          volcengineSecretAccessKey: getSettingsValue("volcengineSecretAccessKey"),
          volcengineRegion: getSettingsValue("volcengineRegion") || DEFAULT_CONFIG.volcengineRegion,
          keepStructure: getSettingsValue("keepStructure") === "true",
          autoOpenCompare: getSettingsValue("autoOpenCompare") === "true"
        };
        saveConfig(nextConfig);
        closeModal();
        toast("设置已保存。");
      }
    };

    modalRoot.style.display = "flex";
  }

  function setSettingsValue(field, value) {
    const nodes = Array.from(modalRoot.querySelectorAll(`[data-field="${field}"]`));
    if (nodes.length === 0) return;

    if (nodes.length > 1 && nodes[0].type === "radio") {
      nodes.forEach((node) => {
        node.checked = node.value === String(value);
      });
      return;
    }

    nodes[0].value = value == null ? "" : String(value);
  }

  function getSettingsValue(field) {
    const nodes = Array.from(modalRoot.querySelectorAll(`[data-field="${field}"]`));
    if (nodes.length === 0) return "";

    if (nodes.length > 1 && nodes[0].type === "radio") {
      const checked = nodes.find((node) => node.checked);
      return checked ? checked.value.trim() : "";
    }

    return nodes[0].value.trim();
  }

  function syncProviderSections() {
    const provider = getSettingsValue("provider") || DEFAULT_CONFIG.provider;
    modalRoot.querySelectorAll("[data-provider-section]").forEach((section) => {
      section.hidden = section.dataset.providerSection !== provider;
    });
  }

  function closeModal() {
    if (!modalRoot) return;
    modalRoot.onchange = null;
    modalRoot.style.display = "none";
    modalRoot.innerHTML = "";
  }

  function getActiveText() {
    if (!activeInput || !document.contains(activeInput)) {
      activeInput = getEditableRoot(document.activeElement);
    }

    if (!activeInput) return "";

    const selected = getSelectedTextInside(activeInput);
    if (selected) return selected;

    return readEditableValue(activeInput).trim();
  }

  function getSelectionInfo() {
    const active = getEditableRoot(document.activeElement);
    if (active && isTextControl(active)) {
      const text = getSelectedTextInside(active);
      if (!text) return { text: "", rect: null, element: active };
      return {
        text,
        rect: active.getBoundingClientRect(),
        element: active
      };
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return { text: "", rect: null, element: null };
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const element = getEditableRoot(range.commonAncestorContainer);
    const rect = getNonEmptyRect(range);
    return { text, rect, element };
  }

  function getSelectedTextInside(element) {
    if (isTextControl(element)) {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number" || start === end) return "";
      return element.value.slice(start, end).trim();
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
    const range = selection.getRangeAt(0);
    if (!element.contains(range.commonAncestorContainer)) return "";
    return selection.toString().trim();
  }

  function getNonEmptyRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width && rect.height);
    return rects[0] || range.getBoundingClientRect();
  }

  function readEditableValue(element) {
    if (!element) return "";
    const fillTarget = resolveFillTarget(element);
    if (fillTarget && fillTarget !== element) return readEditableValue(fillTarget);
    if (isTextControl(element)) return element.value || "";
    return element.innerText || element.textContent || "";
  }

  function fillActiveInput(text, targetElement) {
    if (isFillingInput) return;
    isFillingInput = true;

    const element = targetElement && document.contains(targetElement)
      ? targetElement
      : activeInput;
    const nextText = String(text || "");

    try {
      if (!element) {
        toast("没有找到可填充的输入框。");
        return;
      }

      const fillTarget = resolveFillTarget(element);
      if (!fillTarget) {
        toast("没有找到可填充的输入框。");
        return;
      }

      fillTarget.focus();

      if (isTextControl(fillTarget)) {
        setTextControlValue(fillTarget, nextText);
        return;
      }

      replaceContentEditableText(fillTarget, nextText);
    } finally {
      window.setTimeout(() => {
        isFillingInput = false;
      }, 0);
    }
  }

  function setTextControlValue(element, text) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }
    dispatchEditableEvents(element, text);

    if (!verifyFilledText(element, text)) {
      element.value = text;
      dispatchEditableEvents(element, text);
    }
  }

  function resolveFillTarget(element) {
    if (!element || !document.contains(element)) return null;
    if (isTextControl(element) || isContentEditableElement(element)) return element;

    const active = document.activeElement;
    if (
      active &&
      active !== element &&
      element.contains(active) &&
      (isTextControl(active) || isContentEditableElement(active)) &&
      isSupportedEditable(active)
    ) {
      return active;
    }

    return queryEditableDescendant(element) || element;
  }

  function queryEditableDescendant(element) {
    if (!element || !element.querySelectorAll) return null;
    const candidates = Array.from(element.querySelectorAll(REAL_EDITABLE_SELECTOR))
      .filter(isSupportedEditable);
    return candidates.find(isVisibleEditable) || candidates[0] || null;
  }

  function replaceContentEditableText(element, text) {
    const editable = resolveContentEditableTarget(element);
    editable.focus();
    if (replaceContentEditableViaSelection(editable, text)) return;

    clearContentEditableText(editable);
    insertContentEditableText(editable, text);

    if (!verifyFilledText(editable, text)) {
      hardReplaceContentEditableText(editable, text, "insertReplacementText");
    }
  }

  function resolveContentEditableTarget(element) {
    if (!element || !element.matches) return element;
    if (isContentEditableElement(element)) return element;
    const editable = queryEditableDescendant(element);
    return editable || element;
  }

  function replaceContentEditableViaSelection(element, text) {
    selectEditableContents(element);
    const deleted = document.execCommand("delete", false);
    if (!deleted || !verifyClearedText(element)) return false;
    const inserted = document.execCommand("insertText", false, text);
    return Boolean(inserted && verifyFilledText(element, text));
  }

  function clearContentEditableText(element) {
    selectEditableContents(element);
    const deleted = document.execCommand("delete", false);

    if (!deleted || !verifyClearedText(element)) {
      hardReplaceContentEditableText(element, "", "deleteContentBackward");
    }
  }

  function insertContentEditableText(element, text) {
    placeCaretAtEnd(element);
    const inserted = document.execCommand("insertText", false, text);

    if (!inserted || !verifyFilledText(element, text)) {
      hardReplaceContentEditableText(element, text, "insertReplacementText");
    }
  }

  function hardReplaceContentEditableText(element, text, inputType) {
    element.replaceChildren(document.createTextNode(text));
    placeCaretAtEnd(element);
    dispatchEditableEvents(element, "", inputType, { includeData: false });
  }

  function verifyFilledText(element, text) {
    return normalizeEditableText(readEditableValue(element)) === normalizeEditableText(text);
  }

  function verifyClearedText(element) {
    return normalizeEditableText(readEditableValue(element)) === "";
  }

  function normalizeEditableText(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function selectEditableContents(element) {
    element.focus();
    document.execCommand("selectAll", false);
    const selection = window.getSelection();
    if (!selection) return;
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (
        element.contains(range.commonAncestorContainer) ||
        range.commonAncestorContainer === element
      ) {
        return;
      }
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function dispatchEditableEvents(element, text, inputType = "insertText", options = {}) {
    const shouldIncludeData = options.includeData !== false && isTextControl(element);
    const eventInit = { bubbles: true, composed: true, inputType };
    if (shouldIncludeData) eventInit.data = text;
    element.dispatchEvent(new InputEvent("input", eventInit));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function getEditableRoot(node) {
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || !element.closest) return null;
    const editable = element.closest(EDITABLE_SELECTOR);
    if (!editable) return null;
    if (!isSupportedEditable(editable)) return null;
    return editable;
  }

  function isSupportedEditable(element) {
    if (!element) return false;
    if (element.matches("textarea")) return !element.disabled && !element.readOnly;
    if (element.matches("input")) {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      const supported = ["text", "search", "url", "email", ""].includes(type);
      return supported && !element.disabled && !element.readOnly;
    }
    if (isContentEditableElement(element)) return true;
    if (element.getAttribute("role") === "textbox") return true;
    return false;
  }

  function isTextControl(element) {
    return element && (element.matches("textarea") || element.matches("input"));
  }

  function isContentEditableElement(element) {
    return Boolean(element && element.matches && element.matches(CONTENT_EDITABLE_SELECTOR));
  }

  function isVisibleEditable(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function inferTargetLanguage(text) {
    return hasChinese(text) ? "en" : "zh";
  }

  function hasChinese(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text || "");
  }

  function buildBilingualPrompt(sourceText, translatedText) {
    const source = (sourceText || "").trim();
    const translated = (translatedText || "").trim();
    if (!source) return translated;
    if (!translated) return source;
    return `${source}\n\n${translated}`;
  }

  function assertProviderReady() {
    if (config.provider === "volcengine") {
      if (!config.volcengineAccessKeyId || !config.volcengineAccessKeyId.trim()) {
        openSettingsModal();
        throw new Error("请先在设置里填写火山引擎 Access Key ID。");
      }
      if (!config.volcengineSecretAccessKey || !config.volcengineSecretAccessKey.trim()) {
        openSettingsModal();
        throw new Error("请先在设置里填写火山引擎 Secret Access Key。");
      }
      return;
    }

    if (config.provider === "deepl") {
      if (!config.deeplApiKey || !config.deeplApiKey.trim()) {
        openSettingsModal();
        throw new Error("请先在设置里填写 DeepL API Key。");
      }
      return;
    }

    if (!config.openaiApiKey || !config.openaiApiKey.trim()) {
      openSettingsModal();
      throw new Error("请先在设置里填写 OpenAI API Key。");
    }
  }

  function extractOpenAIText(response) {
    if (!response) return "";
    if (typeof response.output_text === "string") return response.output_text;

    const chunks = [];
    if (Array.isArray(response.output)) {
      response.output.forEach((item) => {
        if (!Array.isArray(item.content)) return;
        item.content.forEach((content) => {
          if (typeof content.text === "string") chunks.push(content.text);
          if (typeof content.output_text === "string") chunks.push(content.output_text);
        });
      });
    }

    return chunks.join("\n").trim();
  }

  function extractChatCompletionText(response) {
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => item && (item.text || item.content || ""))
        .filter(Boolean)
        .join("\n")
        .trim();
    }
    return "";
  }

  function extractApiError(body) {
    if (!body) return "";
    if (typeof body === "string") return body;
    if (body.error && typeof body.error.message === "string") return body.error.message;
    if (body.message) return String(body.message);
    return "";
  }

  function tryParseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function toast(message) {
    const node = document.getElementById(`${SCRIPT_ID}-toast`);
    if (!node) return;
    node.textContent = message;
    node.style.display = "block";
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      node.style.display = "none";
    }, 2800);
  }
})();
