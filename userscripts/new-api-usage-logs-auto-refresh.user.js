// ==UserScript==
// @name         new-api 使用日志自动刷新（Default / Classic）
// @namespace    https://github.com/QuantumNous/new-api
// @version      1.0.0
// @description  自动刷新原版 new-api 的 default 与 classic 使用日志页面；安装前只需把 @match 的域名改成目标站点。
// @match        https://api.ark717.com/*
// @match        https://anyrouter.top/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
Copyright (C) 2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

(() => {
  "use strict";

  // 配置多个站点时，复制上方 @match 行并分别修改域名即可。
  const DEFAULT_INTERVAL_SECONDS = 10;
  const INTERVAL_OPTIONS = [0, 5, 10, 30, 60];
  const STORAGE_KEY = "new-api-userscript:usage-logs-auto-refresh-seconds";
  const NATIVE_STORAGE_KEYS = [
    "usage-logs:auto-refresh-seconds",
    "logs-auto-refresh-seconds",
  ];
  const CONTROL_ID = "new-api-usage-logs-auto-refresh";

  const normalizeText = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();

  const normalizedSet = (values) => new Set(values.map(normalizeText));
  const SEARCH_LABELS = normalizedSet([
    "Search",
    "Query",
    "Refresh",
    "搜索",
    "搜尋",
    "查询",
    "查詢",
    "刷新",
    "重新整理",
    "Rechercher",
    "Requête",
    "Actualiser",
    "Поиск",
    "Запрос",
    "Обновить",
    "検索",
    "更新",
    "Tìm kiếm",
    "Truy vấn",
    "Làm mới",
  ]);
  const TODAY_LABELS = normalizedSet([
    "Today",
    "今天",
    "Aujourd'hui",
    "Сегодня",
    "今日",
    "Hôm nay",
  ]);
  const AUTO_REFRESH_LABELS = normalizedSet([
    "Auto refresh",
    "Auto Refresh",
    "自动刷新",
    "自動刷新",
    "自動重新整理",
    "Actualisation automatique",
    "Автообновление",
    "自動更新",
    "Tự động làm mới",
  ]);

  let currentRoute = null;
  let currentRouteKey = "";
  let intervalSeconds = readIntervalSeconds();
  let refreshTimer = 0;
  let countdownTimer = 0;
  let deadline = 0;
  let refreshing = false;
  let refreshStatus = "idle";
  let preparedDay = "";
  let managesLiveRange = false;
  let nativeControlDetected = false;
  let control = null;

  initializeNativeStorage(intervalSeconds);
  syncRoute();

  window.setInterval(syncRoute, 500);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleNextRefresh();
    }
  });

  function readIntervalSeconds() {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      return INTERVAL_OPTIONS.includes(stored)
        ? stored
        : DEFAULT_INTERVAL_SECONDS;
    } catch {
      return DEFAULT_INTERVAL_SECONDS;
    }
  }

  function saveIntervalSeconds(seconds) {
    intervalSeconds = INTERVAL_OPTIONS.includes(seconds) ? seconds : 0;
    try {
      localStorage.setItem(STORAGE_KEY, String(intervalSeconds));
    } catch {
      // Storage can be blocked in hardened browser profiles.
    }
    syncNativeStorage(intervalSeconds);
    scheduleNextRefresh();
    updateControl();
  }

  function initializeNativeStorage(seconds) {
    try {
      NATIVE_STORAGE_KEYS.forEach((key) => {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, String(seconds));
        }
      });
    } catch {
      // The fallback userscript timer still works without storage access.
    }
  }

  function syncNativeStorage(seconds) {
    try {
      NATIVE_STORAGE_KEYS.forEach((key) => {
        localStorage.setItem(key, String(seconds));
      });
    } catch {
      // The fallback userscript timer still works without storage access.
    }
  }

  function getUsageLogsRoute() {
    const hashPath = location.hash.match(/^#(\/[^?]*)/u)?.[1];
    const paths = [location.pathname, hashPath].filter(Boolean);

    for (const path of paths) {
      if (/(?:^|\/)usage-logs(?:\/(?:common|drawing|task))?\/?$/u.test(path)) {
        return { theme: "default", path };
      }
      if (/(?:^|\/)console\/log\/?$/u.test(path)) {
        return { theme: "classic", path };
      }
    }

    return null;
  }

  function syncRoute() {
    const nextRoute = getUsageLogsRoute();
    const nextRouteKey = nextRoute
      ? `${nextRoute.theme}:${nextRoute.path}`
      : "";

    if (nextRouteKey !== currentRouteKey) {
      currentRoute = nextRoute;
      currentRouteKey = nextRouteKey;
      preparedDay = "";
      managesLiveRange = false;
      nativeControlDetected = false;
      refreshStatus = "idle";
      clearRefreshTimer();
    }

    if (!currentRoute) {
      removeControl();
      return;
    }

    ensureControl();
    updateControl();

    if (nativeAutoRefreshAvailable()) {
      clearRefreshTimer();
      return;
    }

    if (!refreshTimer && intervalSeconds > 0) {
      scheduleNextRefresh();
    }
  }

  function scheduleNextRefresh() {
    clearRefreshTimer();

    if (!currentRoute || intervalSeconds <= 0 || nativeAutoRefreshAvailable()) {
      updateControl();
      return;
    }

    deadline = Date.now() + intervalSeconds * 1000;
    refreshTimer = window.setTimeout(async () => {
      refreshTimer = 0;
      if (document.visibilityState === "visible") {
        await refreshLogs();
      }
      scheduleNextRefresh();
    }, intervalSeconds * 1000);
    updateControl();
  }

  function clearRefreshTimer() {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = 0;
    }
    deadline = 0;
  }

  async function refreshLogs() {
    if (refreshing || !currentRoute || nativeAutoRefreshAvailable()) {
      return false;
    }

    refreshing = true;
    refreshStatus = "busy";
    updateControl();

    try {
      await prepareLiveTimeRange(currentRoute.theme);

      const action = findSearchAction(currentRoute.theme);
      if (!action) {
        refreshStatus = "fallback";
        updateControl();
        location.reload();
        return true;
      }
      if (isDisabled(action.button)) {
        refreshStatus = "busy";
        return false;
      }

      if (action.form?.requestSubmit) {
        action.form.requestSubmit(action.button);
      } else {
        action.button.click();
      }
      refreshStatus = "ok";
      return true;
    } catch {
      refreshStatus = "error";
      return false;
    } finally {
      window.setTimeout(() => {
        refreshing = false;
        if (refreshStatus !== "error") {
          refreshStatus = "idle";
        }
        updateControl();
      }, 800);
    }
  }

  function findSearchAction(theme) {
    if (theme === "classic") {
      const form = findClassicLogForm();
      const button = form?.querySelector('button[type="submit"]');
      return button ? { button, form } : null;
    }

    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (button) =>
        isVisible(button) &&
        SEARCH_LABELS.has(normalizeText(button.textContent)),
    );
    return buttons[0] ? { button: buttons[0], form: null } : null;
  }

  function findClassicLogForm() {
    const forms = Array.from(document.querySelectorAll("form"));
    return (
      forms.find(
        (form) =>
          form.querySelector(".semi-datepicker") &&
          form.querySelector('button[type="submit"]'),
      ) || forms.find((form) => form.querySelector('button[type="submit"]'))
    );
  }

  function isDisabled(element) {
    return (
      Boolean(element.disabled) ||
      element.getAttribute("aria-disabled") === "true" ||
      element.classList.contains("semi-button-loading")
    );
  }

  async function prepareLiveTimeRange(theme) {
    const today = localDateKey(new Date());
    if (preparedDay === today) {
      return;
    }

    const result =
      theme === "classic"
        ? await prepareClassicLiveTimeRange()
        : await prepareDefaultLiveTimeRange();

    if (result === "prepared") {
      managesLiveRange = true;
      preparedDay = today;
    } else if (result === "custom" || result === "missing") {
      managesLiveRange = false;
      preparedDay = today;
    }
  }

  async function prepareDefaultLiveTimeRange() {
    const triggers = Array.from(document.querySelectorAll("button")).filter(
      (button) =>
        isVisible(button) &&
        button.querySelector(
          'svg.lucide-calendar-days, svg[class*="lucide-calendar"]',
        ),
    );
    const trigger =
      triggers.find((button) => extractDateKeys(button).length >= 2) ||
      triggers[0];

    if (!trigger) {
      return "missing";
    }
    if (!shouldManageLiveRange(trigger)) {
      return "custom";
    }

    trigger.click();
    const popover = await waitForElement(() =>
      Array.from(
        document.querySelectorAll('[data-slot="popover-content"]'),
      ).find(
        (element) =>
          isVisible(element) &&
          element.querySelector('input[type="datetime-local"]'),
      ),
    );
    if (!popover) {
      dispatchEscape();
      return "missing";
    }

    const buttons = Array.from(popover.querySelectorAll("button")).filter(
      isVisible,
    );
    const todayButton =
      buttons.find((button) =>
        TODAY_LABELS.has(normalizeText(button.textContent)),
      ) || buttons[0];

    if (!todayButton) {
      dispatchEscape();
      return "missing";
    }

    todayButton.click();
    await wait(50);
    return "prepared";
  }

  async function prepareClassicLiveTimeRange() {
    const form = findClassicLogForm();
    const picker = form?.querySelector(".semi-datepicker");
    if (!picker) {
      return "missing";
    }
    if (!shouldManageLiveRange(picker)) {
      return "custom";
    }

    const trigger = picker.querySelector("input") || picker;
    trigger.click();
    const quickControl = await waitForElement(() =>
      Array.from(
        document.querySelectorAll(".semi-datepicker-quick-control"),
      ).find(isVisible),
    );
    if (quickControl) {
      const buttons = Array.from(
        quickControl.querySelectorAll("button"),
      ).filter(isVisible);
      const todayButton =
        buttons.find((button) =>
          TODAY_LABELS.has(normalizeText(button.textContent)),
        ) ||
        buttons[1] ||
        buttons[0];

      if (todayButton) {
        todayButton.click();
        await wait(50);
        return "prepared";
      }
    }

    dispatchEscape();

    const inputs = Array.from(picker.querySelectorAll("input"));
    if (inputs.length < 2) {
      return "missing";
    }

    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const date = localDateKey(now);
    const values = [`${date} 00:00:00`, `${date} 23:59:59`];

    inputs.slice(0, 2).forEach((input, index) => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, values[index]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    inputs[1].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
      }),
    );
    inputs[1].blur();
    await wait(50);
    return "prepared";
  }

  function shouldManageLiveRange(element) {
    if (managesLiveRange) {
      return true;
    }

    const dates = extractDateKeys(element);
    if (dates.length < 2) {
      return true;
    }

    const today = localDateKey(new Date());
    const tomorrow = localDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
    return (
      dates[0] === today && [today, tomorrow].includes(dates[dates.length - 1])
    );
  }

  function extractDateKeys(element) {
    const inputValues = Array.from(element.querySelectorAll("input"))
      .map((input) => input.value)
      .join(" ");
    const matches = `${inputValues} ${element.textContent || ""}`.match(
      /\b\d{4}-\d{2}-\d{2}\b/gu,
    );
    return matches || [];
  }

  function localDateKey(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}`;
  }

  function waitForElement(getter, timeoutMs = 1000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        const element = getter();
        if (element || Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          resolve(element || null);
        }
      }, 25);
    });
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function dispatchEscape() {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  }

  function isVisible(element) {
    if (!element?.isConnected) {
      return false;
    }
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function hasNativeAutoRefreshControl() {
    const ariaControl = Array.from(
      document.querySelectorAll("[aria-label]"),
    ).find((element) =>
      AUTO_REFRESH_LABELS.has(
        normalizeText(element.getAttribute("aria-label")),
      ),
    );
    if (ariaControl) {
      return true;
    }

    return Array.from(document.querySelectorAll("span, label, p")).some(
      (element) => {
        if (!AUTO_REFRESH_LABELS.has(normalizeText(element.textContent))) {
          return false;
        }
        const scope = element.closest(".semi-space") || element.parentElement;
        return Boolean(
          scope?.querySelector('select, [role="combobox"], .semi-select'),
        );
      },
    );
  }

  function nativeAutoRefreshAvailable() {
    if (!nativeControlDetected) {
      nativeControlDetected = hasNativeAutoRefreshControl();
    }
    return nativeControlDetected;
  }

  function ensureControl() {
    if (control || !document.body) {
      return;
    }

    const host = document.createElement("div");
    host.id = CONTROL_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px;
          border: 1px solid rgba(127, 127, 127, 0.28);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.92);
          color: #18181b;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
          font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
          backdrop-filter: blur(12px);
        }
        button, select {
          height: 28px;
          border: 1px solid rgba(127, 127, 127, 0.3);
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
        }
        button {
          width: 30px;
          padding: 0;
          font-size: 17px;
        }
        select { padding: 0 6px; }
        .theme {
          min-width: 16px;
          color: #71717a;
          text-align: center;
          font-weight: 700;
        }
        .countdown {
          min-width: 25px;
          color: #71717a;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .panel[data-status='busy'] button { animation: spin 0.8s linear infinite; }
        .panel[data-status='error'] { border-color: rgba(239, 68, 68, 0.72); }
        .panel[data-status='ok'] { border-color: rgba(34, 197, 94, 0.72); }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-color-scheme: dark) {
          .panel {
            background: rgba(24, 24, 27, 0.92);
            color: #fafafa;
          }
          .theme, .countdown { color: #a1a1aa; }
        }
      </style>
      <div class="panel" data-status="idle" title="new-api usage logs auto refresh">
        <span class="theme" aria-hidden="true"></span>
        <button type="button" aria-label="Refresh usage logs now">↻</button>
        <select aria-label="Usage logs auto refresh interval">
          <option value="0">×</option>
          <option value="5">5s</option>
          <option value="10">10s</option>
          <option value="30">30s</option>
          <option value="60">60s</option>
        </select>
        <span class="countdown" aria-live="polite"></span>
      </div>
    `;

    document.body.appendChild(host);
    control = {
      host,
      panel: shadow.querySelector(".panel"),
      theme: shadow.querySelector(".theme"),
      button: shadow.querySelector("button"),
      select: shadow.querySelector("select"),
      countdown: shadow.querySelector(".countdown"),
    };
    control.select.value = String(intervalSeconds);
    control.select.addEventListener("change", (event) => {
      saveIntervalSeconds(Number(event.currentTarget.value));
    });
    control.button.addEventListener("click", async () => {
      await refreshLogs();
      scheduleNextRefresh();
    });

    if (!countdownTimer) {
      countdownTimer = window.setInterval(updateControl, 250);
    }
    updateControl();
  }

  function updateControl() {
    if (!control) {
      return;
    }

    control.host.hidden = !currentRoute || nativeControlDetected;
    control.panel.dataset.status = refreshStatus;
    control.theme.textContent = currentRoute?.theme === "classic" ? "C" : "D";
    control.select.value = String(intervalSeconds);

    if (intervalSeconds <= 0) {
      control.countdown.textContent = "×";
    } else if (refreshing) {
      control.countdown.textContent = "…";
    } else if (deadline > 0) {
      control.countdown.textContent = `${Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000),
      )}s`;
    } else {
      control.countdown.textContent = `${intervalSeconds}s`;
    }
  }

  function removeControl() {
    clearRefreshTimer();
    if (control) {
      control.host.remove();
      control = null;
    }
    if (countdownTimer) {
      window.clearInterval(countdownTimer);
      countdownTimer = 0;
    }
  }
})();
