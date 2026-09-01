// ==UserScript==
// @name         new-api 批量兑换码助手
// @namespace    https://github.com/QuantumNous/new-api
// @version      1.0.0
// @description  在 new-api 充值页严格提取并串行兑换多行兑换码，内置保守限速、失败暂停和风控停止保护。
// @author       shiki
// @match        http://*/console/*
// @match        https://*/console/*
// @grant        none
// @run-at       document-idle
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

/*
 * 源码依据
 * --------------------------------------------------------------------------
 * - controller/redemption.go 使用 common.GetUUID() 创建兑换码。
 * - common/utils.go 的 GetUUID() 创建 UUID v4 并移除连字符，因此真正的兑换码
 *   是 32 位十六进制 UUID v4。解析器也接受带连字符、空格或按 UUID 分组换行的
 *   写法，提交前统一还原成 32 位小写字符串。
 * - web/default/src/features/wallet/api.ts 通过 POST /api/user/topup 提交 { key }。
 * - middleware/auth.go 要求登录会话同时携带 New-Api-User 请求头。
 * - router/api-router.go 给兑换接口挂载 CriticalRateLimit；源码默认值是 20 次/20
 *   分钟，并与其他关键操作共享 IP 额度。脚本默认每次等待 90-120 秒、只发一个
 *   串行请求；遇到 401、403、429 或结果不确定时停止，不尝试绕过服务端保护。
 *
 * 使用时打开 new-api 的 /console/topup 页面，点击右下角“批量兑换”。脚本不会
 * 保存输入的兑换码，也不会自动重试结果不明的请求。
 */

(function initialize(factory) {
  "use strict";

  const core = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = core;
    return;
  }

  core.mount();
})(function createBatchRedemptionCore() {
  "use strict";

  const TOPUP_PATH_RE = /^\/console\/topup\/?$/;
  const GROUP_SEPARATOR = "(?:-|[ \\t]{1,3}|[ \\t]*\\r?\\n[ \\t]*)?";
  const UUID_V4_RE = new RegExp(
    "(^|[^0-9a-f])" +
      "([0-9a-f]{8})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{4})" +
      GROUP_SEPARATOR +
      "(4[0-9a-f]{3})" +
      GROUP_SEPARATOR +
      "([89ab][0-9a-f]{3})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{12})" +
      "(?=$|[^0-9a-f])",
    "gi",
  );
  const UUID_LIKE_RE = new RegExp(
    "(^|[^0-9a-f])" +
      "([0-9a-f]{8})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{4})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{4})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{4})" +
      GROUP_SEPARATOR +
      "([0-9a-f]{12})" +
      "(?=$|[^0-9a-f])",
    "gi",
  );
  const PACE_OPTIONS = Object.freeze({
    cautious: { minSeconds: 90, maxSeconds: 120, label: "稳妥" },
    safest: { minSeconds: 120, maxSeconds: 150, label: "最保守" },
    sourceLimit: { minSeconds: 65, maxSeconds: 80, label: "源码下限" },
  });
  const MAX_CONSECUTIVE_FAILURES = 3;

  function collectUuidLikeValues(text, regex) {
    const values = [];
    const source = String(text || "");
    regex.lastIndex = 0;

    let match;
    while ((match = regex.exec(source)) !== null) {
      values.push(
        `${match[2]}${match[3]}${match[4]}${match[5]}${match[6]}`.toLowerCase(),
      );
      if (match[0] === "") regex.lastIndex += 1;
    }

    return values;
  }

  function analyzeRedemptionText(text) {
    const codes = [];
    const seen = new Set();

    for (const code of collectUuidLikeValues(text, UUID_V4_RE)) {
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }

    const rejected = new Set();
    for (const candidate of collectUuidLikeValues(text, UUID_LIKE_RE)) {
      if (!seen.has(candidate)) rejected.add(candidate);
    }

    return {
      codes,
      rejectedCount: rejected.size,
    };
  }

  function extractRedemptionCodes(text) {
    return analyzeRedemptionText(text).codes;
  }

  function normalizeUserId(value) {
    const text = String(value ?? "").trim();
    return /^[1-9]\d*$/.test(text) ? text : null;
  }

  function getUserIdCandidates(storage) {
    const candidates = [];
    const seen = new Set();

    function addCandidate(value) {
      const normalized = normalizeUserId(value);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(normalized);
    }

    try {
      addCandidate(storage.getItem("uid"));
    } catch (_error) {
      // Storage can be unavailable in hardened browser contexts.
    }

    try {
      const classicUser = JSON.parse(storage.getItem("user") || "null");
      addCandidate(classicUser?.id);
    } catch (_error) {
      // Ignore malformed legacy state and let the preflight report login failure.
    }

    return candidates;
  }

  function maskCode(code) {
    if (typeof code !== "string" || code.length < 16) return String(code || "");
    return `${code.slice(0, 8)}...${code.slice(-4)}`;
  }

  function formatWait(seconds) {
    const safeSeconds = Math.max(0, Math.ceil(seconds));
    if (safeSeconds < 60) return `${safeSeconds} 秒`;
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return remainder === 0 ? `${minutes} 分钟` : `${minutes} 分 ${remainder} 秒`;
  }

  function randomDelayMs(pace) {
    const span = pace.maxSeconds - pace.minSeconds;
    return Math.round((pace.minSeconds + Math.random() * span) * 1000);
  }

  function readPace(value) {
    return PACE_OPTIONS[value] || PACE_OPTIONS.cautious;
  }

  function requestHeaders(userId, includeJson) {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-store",
      "New-Api-User": userId,
    };
    if (includeJson) headers["Content-Type"] = "application/json";
    return headers;
  }

  async function readResponsePayload(response) {
    let body;
    try {
      body = await response.text();
    } catch (_error) {
      return null;
    }
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch (_error) {
      return null;
    }
  }

  async function resolveSession(fetchImpl, storage) {
    const candidates = getUserIdCandidates(storage);
    if (candidates.length === 0) {
      throw new Error("未找到登录用户 ID，请先在当前站点登录 new-api。");
    }

    let lastMessage = "登录会话验证失败，请重新登录后再试。";
    for (const userId of candidates) {
      let response;
      try {
        response = await fetchImpl("/api/user/topup/info", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: requestHeaders(userId, false),
        });
      } catch (_error) {
        throw new Error("无法连接当前站点的 new-api 接口。");
      }

      const payload = await readResponsePayload(response);
      if (response.status === 401) {
        lastMessage = payload?.message || lastMessage;
        continue;
      }
      if (response.status === 429) {
        throw new Error("站点当前请求过于频繁，请稍后再开始。");
      }
      if (!response.ok || payload?.success !== true) {
        lastMessage = payload?.message || `会话检查失败（HTTP ${response.status}）。`;
        continue;
      }
      if (payload.data?.enable_redemption !== true) {
        throw new Error("当前站点未启用兑换码功能。");
      }

      return userId;
    }

    throw new Error(lastMessage);
  }

  async function redeemCode(fetchImpl, userId, code) {
    let response;
    try {
      response = await fetchImpl("/api/user/topup", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: requestHeaders(userId, true),
        body: JSON.stringify({ key: code }),
      });
    } catch (_error) {
      return {
        kind: "unknown",
        message: "网络异常，服务器是否已完成兑换无法确认。",
        stop: true,
      };
    }

    const payload = await readResponsePayload(response);
    if (response.status === 401) {
      return {
        kind: "blocked",
        message: payload?.message || "登录已失效。",
        stop: true,
      };
    }
    if (response.status === 403) {
      return {
        kind: "blocked",
        message: payload?.message || "请求被站点保护策略拒绝。",
        stop: true,
      };
    }
    if (response.status === 429) {
      return {
        kind: "blocked",
        message: "服务器返回 429，已停止。源码默认窗口为 20 分钟，请等待窗口恢复。",
        stop: true,
      };
    }
    if (!response.ok || !payload) {
      return {
        kind: "unknown",
        message: `响应异常（HTTP ${response.status}），兑换结果无法确认。`,
        stop: true,
      };
    }
    if (payload.success === true && Number.isFinite(Number(payload.data))) {
      return {
        kind: "success",
        quota: Number(payload.data),
        message: `成功，增加额度 ${payload.data}`,
        stop: false,
      };
    }

    return {
      kind: "failure",
      message: payload.message || "兑换失败。",
      stop: false,
    };
  }

  function mount() {
    if (typeof window === "undefined" || window.top !== window.self) return;

    let ui = null;
    const ensureUi = () => {
      const onTopupPage = TOPUP_PATH_RE.test(window.location.pathname);
      const hasLocalUser = getUserIdCandidates(window.localStorage).length > 0;
      if (!ui && onTopupPage && hasLocalUser) ui = createUi();
      if (!ui) return;
      ui.host.hidden = !onTopupPage && !ui.isBusy();
    };

    ensureUi();
    window.setInterval(ensureUi, 1000);
  }

  function createUi() {
    const host = document.createElement("div");
    host.id = "new-api-batch-redemption-host";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          color-scheme: light dark;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
        }
        * { box-sizing: border-box; }
        button, select, textarea { font: inherit; letter-spacing: 0; }
        button { cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: 0.48; }
        .launcher {
          position: fixed;
          right: 20px;
          bottom: 20px;
          z-index: 2147483646;
          min-width: 104px;
          height: 40px;
          border: 1px solid #087443;
          border-radius: 7px;
          padding: 0 14px;
          background: #07864d;
          color: #fff;
          font-weight: 700;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
        }
        .launcher:hover { background: #067342; }
        dialog {
          width: min(560px, calc(100vw - 24px));
          max-height: min(760px, calc(100vh - 24px));
          overflow: hidden;
          border: 1px solid #c8ccd2;
          border-radius: 8px;
          padding: 0;
          background: #fff;
          color: #1f252d;
          box-shadow: 0 24px 72px rgba(0, 0, 0, 0.3);
        }
        dialog::backdrop { background: rgba(19, 24, 31, 0.56); }
        .shell { display: flex; max-height: inherit; flex-direction: column; }
        .header {
          display: flex;
          min-height: 52px;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #e0e3e7;
          padding: 0 16px;
        }
        h2 { margin: 0; font-size: 17px; line-height: 1.35; }
        .close {
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: inherit;
          font-size: 24px;
          line-height: 1;
        }
        .close:hover { background: #eef0f2; }
        .body { overflow: auto; padding: 16px; }
        label { display: block; margin-bottom: 7px; font-size: 13px; font-weight: 700; }
        textarea {
          width: 100%;
          min-height: 170px;
          resize: vertical;
          border: 1px solid #bbc1c8;
          border-radius: 6px;
          padding: 10px 11px;
          background: #fff;
          color: #171b20;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px;
          line-height: 1.55;
        }
        textarea:focus, select:focus, button:focus-visible {
          outline: 2px solid #1686d9;
          outline-offset: 2px;
        }
        .analysis { min-height: 38px; padding-top: 8px; font-size: 12px; color: #58616d; }
        .analysis strong { color: #087443; }
        .analysis .warning { color: #a65309; }
        .preview { overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .settings {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
          gap: 12px;
          align-items: end;
          border-top: 1px solid #e0e3e7;
          padding-top: 14px;
        }
        select {
          width: 100%;
          height: 38px;
          border: 1px solid #bbc1c8;
          border-radius: 6px;
          padding: 0 9px;
          background: #fff;
          color: #171b20;
        }
        .estimate { min-height: 38px; display: flex; align-items: center; font-size: 12px; color: #58616d; }
        .run { margin-top: 14px; border-top: 1px solid #e0e3e7; padding-top: 14px; }
        .status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .status { min-height: 20px; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
        .count { flex: 0 0 auto; font-size: 12px; color: #58616d; }
        progress { width: 100%; height: 9px; margin-top: 9px; accent-color: #07864d; }
        .summary { min-height: 20px; margin-top: 6px; font-size: 12px; color: #58616d; }
        .logs {
          min-height: 84px;
          max-height: 174px;
          overflow: auto;
          margin: 10px 0 0;
          border: 1px solid #e0e3e7;
          border-radius: 6px;
          padding: 7px 9px;
          background: #f7f8f9;
          list-style: none;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 12px;
          line-height: 1.55;
        }
        .logs li { overflow-wrap: anywhere; }
        .logs .success { color: #087443; }
        .logs .failure { color: #a65309; }
        .logs .blocked, .logs .unknown { color: #b42318; }
        .actions, .secondary-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .actions { border-top: 1px solid #e0e3e7; padding: 14px 16px 16px; }
        .secondary-actions { margin-top: 10px; }
        .button {
          min-height: 36px;
          border: 1px solid #b8bec6;
          border-radius: 6px;
          padding: 0 13px;
          background: #fff;
          color: #252b33;
          font-weight: 650;
        }
        .button:hover { background: #f1f3f5; }
        .primary { border-color: #087443; background: #07864d; color: #fff; }
        .primary:hover { background: #067342; }
        .danger { border-color: #d2a4a0; color: #a52219; }
        @media (prefers-color-scheme: dark) {
          dialog { border-color: #414851; background: #181c21; color: #edf0f3; }
          .header, .settings, .run, .actions { border-color: #383f47; }
          .close:hover, .button:hover { background: #2a3037; }
          textarea, select, .button { border-color: #505964; background: #20252b; color: #f1f3f5; }
          .analysis, .estimate, .count, .summary { color: #aeb6c0; }
          .analysis strong, .logs .success { color: #58d39a; }
          .analysis .warning, .logs .failure { color: #ffb45f; }
          .logs { border-color: #383f47; background: #12161a; }
          .danger { border-color: #864944; color: #ff9288; }
        }
        @media (max-width: 520px) {
          .launcher { right: 12px; bottom: 12px; }
          .settings { grid-template-columns: 1fr; gap: 4px; }
          .body { padding: 14px; }
          .actions { padding: 12px 14px 14px; }
          .button { flex: 1 1 auto; }
        }
      </style>
      <button class="launcher" type="button" aria-haspopup="dialog">批量兑换</button>
      <dialog aria-labelledby="batch-redemption-title">
        <div class="shell">
          <header class="header">
            <h2 id="batch-redemption-title">批量兑换码</h2>
            <button class="close" type="button" title="关闭" aria-label="关闭">×</button>
          </header>
          <main class="body">
            <label for="redemption-input">兑换码文本</label>
            <textarea id="redemption-input" spellcheck="false" autocomplete="off" placeholder="粘贴多行兑换码或含兑换码的文本"></textarea>
            <div class="analysis" aria-live="polite"></div>
            <div class="settings">
              <div>
                <label for="redemption-pace">请求间隔</label>
                <select id="redemption-pace">
                  <option value="cautious" selected>稳妥：90-120 秒</option>
                  <option value="safest">最保守：120-150 秒</option>
                  <option value="sourceLimit">源码下限：65-80 秒</option>
                </select>
              </div>
              <div class="estimate"></div>
            </div>
            <section class="run" aria-label="兑换进度">
              <div class="status-row">
                <div class="status" aria-live="polite">等待输入</div>
                <div class="count">0 / 0</div>
              </div>
              <progress max="1" value="0"></progress>
              <div class="summary"></div>
              <ol class="logs" aria-live="polite"><li>尚未开始</li></ol>
              <div class="secondary-actions">
                <button class="button copy-failed" type="button" disabled>复制失败或未知项</button>
                <button class="button copy-remaining" type="button" disabled>复制未处理项</button>
              </div>
            </section>
          </main>
          <footer class="actions">
            <button class="button primary start" type="button" disabled>开始兑换</button>
            <button class="button pause" type="button" disabled>暂停</button>
            <button class="button danger stop" type="button" disabled>停止</button>
          </footer>
        </div>
      </dialog>
    `;
    document.documentElement.appendChild(host);

    const elements = {
      launcher: shadow.querySelector(".launcher"),
      dialog: shadow.querySelector("dialog"),
      close: shadow.querySelector(".close"),
      input: shadow.querySelector("textarea"),
      analysis: shadow.querySelector(".analysis"),
      pace: shadow.querySelector("select"),
      estimate: shadow.querySelector(".estimate"),
      status: shadow.querySelector(".status"),
      count: shadow.querySelector(".count"),
      progress: shadow.querySelector("progress"),
      summary: shadow.querySelector(".summary"),
      logs: shadow.querySelector(".logs"),
      start: shadow.querySelector(".start"),
      pause: shadow.querySelector(".pause"),
      stop: shadow.querySelector(".stop"),
      copyFailed: shadow.querySelector(".copy-failed"),
      copyRemaining: shadow.querySelector(".copy-remaining"),
    };
    const state = {
      codes: [],
      nextIndex: 0,
      results: [],
      running: false,
      paused: false,
      stopRequested: false,
      consecutiveFailures: 0,
      delayRemainingMs: 0,
    };

    function remainingCodes() {
      return state.codes.slice(state.nextIndex);
    }

    function failedOrUnknownCodes() {
      return state.results
        .filter(
          (result) =>
            result.kind === "failure" ||
            result.kind === "unknown" ||
            result.kind === "blocked",
        )
        .map((result) => result.code);
    }

    function setStatus(message) {
      elements.status.textContent = message;
      elements.launcher.textContent = state.running
        ? `兑换 ${state.nextIndex}/${state.codes.length}`
        : "批量兑换";
    }

    function renderSummary() {
      const succeeded = state.results.filter((result) => result.kind === "success").length;
      const failed = state.results.filter((result) => result.kind === "failure").length;
      const unknown = state.results.filter((result) => result.kind === "unknown").length;
      const blocked = state.results.filter((result) => result.kind === "blocked").length;
      elements.summary.textContent = `成功 ${succeeded}，失败 ${failed}，未知 ${unknown}，受限 ${blocked}`;
      elements.copyFailed.disabled = failedOrUnknownCodes().length === 0;
      elements.copyRemaining.disabled = remainingCodes().length === 0;
    }

    function renderProgress() {
      const total = state.codes.length;
      elements.count.textContent = `${state.nextIndex} / ${total}`;
      elements.progress.max = Math.max(1, total);
      elements.progress.value = state.nextIndex;
      renderSummary();
    }

    function appendLog(kind, message) {
      if (elements.logs.children.length === 1 && elements.logs.firstElementChild?.textContent === "尚未开始") {
        elements.logs.textContent = "";
      }
      const item = document.createElement("li");
      item.className = kind;
      item.textContent = message;
      elements.logs.appendChild(item);
      elements.logs.scrollTop = elements.logs.scrollHeight;
    }

    function renderInputAnalysis() {
      const analysis = analyzeRedemptionText(elements.input.value);
      const preview = analysis.codes.slice(0, 4).map(maskCode).join("，");
      elements.analysis.textContent = "";

      const count = document.createElement("strong");
      count.textContent = `识别到 ${analysis.codes.length} 个有效格式兑换码`;
      elements.analysis.appendChild(count);
      if (analysis.rejectedCount > 0) {
        const warning = document.createElement("span");
        warning.className = "warning";
        warning.textContent = `；忽略 ${analysis.rejectedCount} 个不符合 UUID v4 的 32 位字符串`;
        elements.analysis.appendChild(warning);
      }
      if (preview) {
        const previewLine = document.createElement("div");
        previewLine.className = "preview";
        previewLine.textContent = preview + (analysis.codes.length > 4 ? "，..." : "");
        elements.analysis.appendChild(previewLine);
      }

      elements.start.disabled = state.running || analysis.codes.length === 0;
      renderEstimate(analysis.codes.length);
    }

    function renderEstimate(codeCount = analyzeRedemptionText(elements.input.value).codes.length) {
      const pace = readPace(elements.pace.value);
      const minimumSeconds = Math.max(0, codeCount - 1) * pace.minSeconds;
      elements.estimate.textContent =
        codeCount <= 1
          ? "首个请求确认后立即发送"
          : `完成至少需要 ${formatWait(minimumSeconds)}`;
    }

    function setRunningControls(running) {
      elements.input.disabled = running;
      elements.pace.disabled = running;
      elements.pause.disabled = !running;
      elements.stop.disabled = !running;
      if (!running) elements.pause.textContent = "暂停";
      renderInputAnalysis();
    }

    function requestStop(message) {
      if (!state.running) return;
      state.stopRequested = true;
      state.paused = false;
      elements.pause.textContent = "暂停";
      setStatus(message || "将在当前请求结束后停止");
      elements.stop.disabled = true;
    }

    async function waitForNextRequest(delayMs) {
      state.delayRemainingMs = delayMs;
      let lastTick = Date.now();

      while (state.delayRemainingMs > 0) {
        if (state.stopRequested) return false;
        if (state.paused) {
          setStatus("已暂停");
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          lastTick = Date.now();
          continue;
        }

        const now = Date.now();
        state.delayRemainingMs -= now - lastTick;
        lastTick = now;
        setStatus(`下一个请求将在 ${formatWait(state.delayRemainingMs / 1000)} 后发送`);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }

      return !state.stopRequested;
    }

    async function waitWhilePaused(message) {
      while (state.paused && !state.stopRequested) {
        setStatus(message);
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }

    async function waitAfterFailureThreshold() {
      state.paused = true;
      elements.pause.textContent = "继续";
      appendLog("failure", `连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，已自动暂停。`);
      await waitWhilePaused("连续失败保护：请核对来源后再继续");
    }

    async function runBatch() {
      const analysis = analyzeRedemptionText(elements.input.value);
      if (analysis.codes.length === 0 || state.running) return;

      const pace = readPace(elements.pace.value);
      const minimumSeconds = Math.max(0, analysis.codes.length - 1) * pace.minSeconds;
      const confirmed = window.confirm(
        `将串行兑换 ${analysis.codes.length} 个代码，预计至少 ${formatWait(minimumSeconds)}。\n\n` +
          "兑换会直接增加当前账号额度，操作不可撤销。是否继续？",
      );
      if (!confirmed) return;

      state.codes = analysis.codes;
      state.nextIndex = 0;
      state.results = [];
      state.running = true;
      state.paused = false;
      state.stopRequested = false;
      state.consecutiveFailures = 0;
      elements.logs.textContent = "";
      setRunningControls(true);
      renderProgress();
      setStatus("正在验证登录会话");

      let userId;
      try {
        userId = await resolveSession(window.fetch.bind(window), window.localStorage);
      } catch (error) {
        appendLog("blocked", error instanceof Error ? error.message : "会话验证失败。");
        state.stopRequested = true;
      }

      while (!state.stopRequested && state.nextIndex < state.codes.length) {
        if (state.paused) {
          await waitWhilePaused("已暂停");
          if (state.stopRequested) break;
        }

        const code = state.codes[state.nextIndex];
        setStatus(`正在兑换 ${state.nextIndex + 1} / ${state.codes.length}`);
        const result = await redeemCode(window.fetch.bind(window), userId, code);
        state.results.push({ ...result, code });
        state.nextIndex += 1;

        if (result.kind === "success") {
          state.consecutiveFailures = 0;
          appendLog("success", `${maskCode(code)}：${result.message}`);
        } else {
          appendLog(result.kind, `${maskCode(code)}：${result.message}`);
          if (result.kind === "failure") state.consecutiveFailures += 1;
        }
        renderProgress();

        if (result.stop) {
          state.stopRequested = true;
          break;
        }
        if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          state.consecutiveFailures = 0;
          await waitAfterFailureThreshold();
          if (state.stopRequested) break;
        }
        if (state.nextIndex >= state.codes.length) break;

        const canContinue = await waitForNextRequest(randomDelayMs(pace));
        if (!canContinue) break;
      }

      const completed = state.nextIndex === state.codes.length && !state.stopRequested;
      state.running = false;
      state.paused = false;
      setRunningControls(false);
      renderProgress();
      setStatus(completed ? "批量兑换完成" : `已停止，剩余 ${remainingCodes().length} 个未处理`);
    }

    async function copyCodes(codes, successMessage) {
      if (codes.length === 0) return;
      const text = codes.join("\n");
      try {
        await navigator.clipboard.writeText(text);
      } catch (_error) {
        const helper = document.createElement("textarea");
        helper.value = text;
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      setStatus(successMessage);
    }

    elements.launcher.addEventListener("click", () => {
      if (!elements.dialog.open) elements.dialog.showModal();
    });
    elements.close.addEventListener("click", () => elements.dialog.close());
    elements.input.addEventListener("input", renderInputAnalysis);
    elements.pace.addEventListener("change", () => renderEstimate());
    elements.start.addEventListener("click", () => {
      runBatch().catch((error) => {
        appendLog("unknown", error instanceof Error ? error.message : "脚本发生未知错误。");
        state.stopRequested = true;
        state.paused = false;
        state.running = false;
        setRunningControls(false);
        renderProgress();
        setStatus("脚本异常，已停止");
      });
    });
    elements.pause.addEventListener("click", () => {
      if (!state.running) return;
      state.paused = !state.paused;
      elements.pause.textContent = state.paused ? "继续" : "暂停";
      setStatus(state.paused ? "已暂停" : "继续运行");
    });
    elements.stop.addEventListener("click", () => requestStop());
    elements.copyFailed.addEventListener("click", () => {
      copyCodes(failedOrUnknownCodes(), "已复制失败或未知项");
    });
    elements.copyRemaining.addEventListener("click", () => {
      copyCodes(remainingCodes(), "已复制未处理项");
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.running) return;
      event.preventDefault();
      event.returnValue = "";
    });

    renderInputAnalysis();
    renderProgress();

    return {
      host,
      isBusy: () => state.running,
    };
  }

  return {
    analyzeRedemptionText,
    extractRedemptionCodes,
    getUserIdCandidates,
    maskCode,
    readPace,
    redeemCode,
    resolveSession,
    mount,
  };
});
