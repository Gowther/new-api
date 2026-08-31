// ==UserScript==
// @name         new-api 最新调用日志横幅（跨标签页翻滚）
// @namespace    https://github.com/QuantumNous/new-api
// @version      1.1.0
// @description  在任意网页悬浮一条可拖动的横幅，翻滚展示 new-api 最新调用日志（成功/失败 / 模型 / 渠道 / Token / 耗时 / 费用）；点开看最近 N 条，失败可悬停看错误详情；多标签页共享同一份轮询结果。
// @author       shiki
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
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

/*
 * 用法
 * ──────────────────────────────────────────────
 * 1. 装好后随便打开一个网页，右下角会出现一个「◉」小圆点。点它 → 打开设置。
 *    （也可以从脚本管理器菜单里选「⚙ 打开设置」。）
 * 2. 设置里填三样东西：
 *      站点地址    你的 new-api 地址，例如 https://api.example.com
 *      用户 ID     new-api 里「个人设置」页显示的那个数字 ID
 *      访问令牌    「个人设置」→ 生成/复制「访问令牌」（不是 sk- 开头的 API 密钥）
 *    点「测试连接」确认能通，再点「保存」。
 * 3. 横幅开始一条一条翻滚最新调用。
 *      拖动     按住横幅（或收起后的小圆点）拖到任意位置，松手记住，跨标签页同步
 *      点击     展开最近 N 条列表（默认 10），再点收起
 *      悬停     暂停翻滚；失败行悬停「!」或错误文字看完整错误详情
 *      ‹ ›      往前 / 往后翻历史    ⏸/▶ 暂停/继续    ⚙ 设置    ◉ 收成小圆点
 *
 * 位置与展开方向
 * ──────────────────────────────────────────────
 * 装好即用，不需要先设置。「初始位置」只决定没拖动过时停在哪（默认右下）。
 * 列表往哪边展开是按横幅当前位置自动算的：横幅在视口下半 → 往上展开，上半 → 往下展开。
 * 实现上这件事的要害是锚定哪条边，而不是 flex 方向：容器锚 top 却用 column-reverse
 * 的话，容器会往下生长、横幅被列表高度整个推下去（贴着屏幕下沿时直接推出视口看不见）。
 * 所以向上展开时容器改成锚 bottom，横幅才会钉住不动。
 * 钳制范围按当前可见元素（横幅或圆点）算，不能按整个容器算 —— 容器高度含列表和设置
 * 面板，拿它算会让横幅贴不到屏幕下沿。窗口缩小后会自动重新钳制并重算展开方向。
 *
 * 成功与失败
 * ──────────────────────────────────────────────
 * 行首圆点：绿色 ✓ 是成功（消费日志 type=2），红色 ! 是失败（错误日志 type=5）。
 * 失败时整条横幅压一层红底，错误信息直接铺在行里，悬停出浮层显示完整内容 +
 * HTTP 状态码 / 错误类型 / 错误码 / 请求路径（取自 other 的 status_code、
 * error_type、error_code、request_path）。
 * 后端把失败的 tokens 和 quota 都写成 0，所以失败行不显示「↑0 ↓0 $0」，
 * 那块空间让给错误信息。
 *
 * 两个前提要知道：
 *   1. 错误日志受后端 ErrorLogEnabled 开关控制（controller/relay.go:373）。管理员
 *      关掉的话，数据库里根本没有错误行，横幅也就只能看到成功的调用。
 *   2. 一部分失败刻意不记错误日志（types.ErrOptionWithNoRecordErrorLog，例如额度
 *      不足），这类失败横幅上看不到。
 *
 * 翻滚规则
 * ──────────────────────────────────────────────
 * 空闲（没有新调用）时停在最新一条不动 —— 横幅的用途是"看最新一条"，
 * 不是把最近 20 条来回轮播；想看更早的按 ‹ 手动翻。
 * 有新调用时按时间顺序（旧→新）逐条播完，最后停在最新那条。
 * 队列消耗速度是固定的（每 rotateSeconds 一条），进货速度取决于站点流量，
 * 所以积压超过「积压最多补播几条」时只播最近这几条、中间的丢掉，徽标标出跳过多少。
 * 不这么做的话，流量一大队列就只涨不消，横幅会永久滞后且不会自己恢复。
 *
 * 关于访问令牌的一句实话
 * ──────────────────────────────────────────────
 * 访问令牌等价于你的 new-api 账号权限。本脚本为了能在任意标签页显示横幅而匹配了所有站点，
 * 令牌只会通过 GM_xmlhttpRequest 发往你配置的那一个站点，不会出现在当前网页的任何请求里，
 * 也不写进 document / localStorage。但它确实存在脚本管理器的存储中，请自行判断是否接受。
 * 如果只想在 new-api 站内看，把「认证方式」改成「Cookie」：不再需要令牌，靠站内登录态，
 * 代价是别的域名的标签页拿不到数据（横幅会显示等待 leader）。
 *
 * 渠道名的可见性
 * ──────────────────────────────────────────────
 * /api/log/self 对普通用户会清掉 channel_name（model/log.go:140），只剩数字渠道 ID，
 * 所以普通账号横幅上显示的是「#12」这种。管理员账号脚本会自动走 /api/log/ 管理端接口，
 * 能拿到真实渠道名；管理员还可以把「范围」改成「全站」，看所有人的调用。
 *
 * 去重说明
 * ──────────────────────────────────────────────
 * 接口返回的 log.id 是页内序号而非数据库主键（model/log.go:132 assignDisplayLogIds），
 * 不能用来去重。request_id 也不能单独当键：一个 HTTP 请求内的多次重试共用同一个
 * request_id，processChannelError（controller/relay.go:363）每次失败都记一条错误日志，
 * 重试后成功还会再记一条消费日志 —— 光看 request_id 会把「失败×N + 成功」压成一条。
 * 所以键是「类型 + request_id + 渠道 + 时间 + 内容指纹」；request_id 为空的旧日志
 * 再补上模型/令牌/配额/tokens 组合。
 *
 * 显示「成功 + 失败」时的查询方式
 * ──────────────────────────────────────────────
 * 成功和失败是两种 type，后端只能按单一 type 过滤，所以这个模式下查 type=0（全部）
 * 再本地筛掉登录/充值/系统等非调用日志。代价是「每次条数」是筛选前的数量，
 * 如果你的账号有大量非调用日志，实际进入横幅的条数会少于设定值，调大即可。
 *
 * 跨标签页
 * ──────────────────────────────────────────────
 * 所有标签页里只有一个「leader」真正轮询，结果写进 GM 存储广播给其它标签页，
 * 请求量与开了多少标签页无关。leader 关掉后 6 秒内其它标签页自动接管。
 * 需要脚本管理器支持 GM_xmlhttpRequest（Tampermonkey / Violentmonkey 都行）。
 * 缺少 GM_addValueChangeListener 的管理器会退化成轮询 GM 存储，功能不变，只是同步慢一点。
 */

(() => {
  "use strict";

  const SCRIPT_ID = "new-api-live-log-ticker";
  const CONFIG_KEY = `${SCRIPT_ID}:config`;
  const FEED_KEY = `${SCRIPT_ID}:feed`;
  const LEADER_KEY = `${SCRIPT_ID}:leader`;
  const HOST_ID = `${SCRIPT_ID}-host`;

  const LEADER_HEARTBEAT_MS = 2000;
  const LEADER_STALE_MS = 6000;
  const FOLLOWER_POLL_MS = 1500;
  const IDENTITY_TTL_MS = 5 * 60 * 1000;
  const SEEN_KEYS_MAX = 400;
  const FEED_ITEMS_MAX = 30;
  const DEFAULT_QUOTA_PER_UNIT = 500000;

  const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const LOG_TYPE_CONSUME = 2;
  const LOG_TYPE_ERROR = 5;

  const POSITIONS = {
    "top-left": "左上",
    "top-center": "上中",
    "top-right": "右上",
    "bottom-left": "左下",
    "bottom-center": "下中",
    "bottom-right": "右下",
  };

  const CALL_FILTERS = {
    both: "成功 + 失败",
    success: "只看成功",
    error: "只看失败",
  };

  const DRAG_THRESHOLD_PX = 4;
  const EDGE_MARGIN_PX = 6;

  const DEFAULT_CONFIG = {
    enabled: true,
    baseUrl: "",
    userId: "",
    accessToken: "",
    authMode: "token", // token | cookie
    scope: "self", // self | all（all 需要管理员）
    callFilter: "both", // both | success | error
    pollSeconds: 5,
    rotateSeconds: 4,
    pageSize: 20,
    backlogPlayMax: 5,
    listSize: 10,
    position: "bottom-right",
    // 拖动后记录的绝对坐标（px，相对视口左上角）；为 null 表示仍用 position 锚点。
    dragX: null,
    dragY: null,
    maxWidth: 620,
    opacity: 0.94,
    theme: "dark", // dark | light
    showChannel: true,
    showToken: true,
    showTokens: true,
    showLatency: true,
    showCost: true,
    showUsername: false,
    costUnit: "usd", // usd | quota
    collapsed: false,
    mutedHosts: [],
  };

  const hasFn = (name) => typeof globalThis[name] === "function";
  const canListen = hasFn("GM_addValueChangeListener");

  function readStore(key, fallback) {
    if (!hasFn("GM_getValue")) return fallback;
    try {
      const raw = GM_getValue(key, null);
      if (raw === null || raw === undefined) return fallback;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    if (!hasFn("GM_setValue")) return;
    try {
      GM_setValue(key, JSON.stringify(value));
    } catch {
      /* 存储不可用时静默降级：横幅仍能在本标签页工作 */
    }
  }

  const clampNumber = (value, min, max, fallback) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  };

  function normalizeConfig(raw) {
    const cfg = { ...DEFAULT_CONFIG, ...(raw && typeof raw === "object" ? raw : {}) };
    cfg.baseUrl = String(cfg.baseUrl || "").trim().replace(/\/+$/, "");
    cfg.userId = String(cfg.userId || "").trim();
    cfg.accessToken = String(cfg.accessToken || "").trim();
    cfg.authMode = cfg.authMode === "cookie" ? "cookie" : "token";
    cfg.scope = cfg.scope === "all" ? "all" : "self";
    // 1.0 版本存的是数字 logType，迁移成 callFilter，老配置不至于一升级就被重置。
    // 必须看原始对象里有没有 callFilter：cfg 已经被 DEFAULT_CONFIG 填过默认值，
    // 拿 cfg.callFilter 判断的话这段永远不会执行。
    const rawHasFilter = raw && typeof raw === "object" && "callFilter" in raw;
    if (!rawHasFilter || !CALL_FILTERS[cfg.callFilter]) {
      cfg.callFilter = Number(cfg.logType) === LOG_TYPE_ERROR ? "error" : DEFAULT_CONFIG.callFilter;
    }
    delete cfg.logType;
    cfg.pollSeconds = clampNumber(cfg.pollSeconds, 2, 300, DEFAULT_CONFIG.pollSeconds);
    cfg.rotateSeconds = clampNumber(cfg.rotateSeconds, 1, 60, DEFAULT_CONFIG.rotateSeconds);
    cfg.pageSize = clampNumber(cfg.pageSize, 5, 100, DEFAULT_CONFIG.pageSize);
    cfg.backlogPlayMax = clampNumber(cfg.backlogPlayMax, 1, 30, DEFAULT_CONFIG.backlogPlayMax);
    cfg.listSize = clampNumber(cfg.listSize, 3, FEED_ITEMS_MAX, DEFAULT_CONFIG.listSize);
    cfg.position = POSITIONS[cfg.position] ? cfg.position : DEFAULT_CONFIG.position;
    // 注意 Number(null) === 0 且 0 通过 isFinite：不先挡住 null / "" 的话，
    // 「回到锚点位置」清空坐标会被存成 0，横幅从此钉在左上角。
    const asCoord = (value) =>
      value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
        ? null
        : Number(value);
    cfg.dragX = asCoord(cfg.dragX);
    cfg.dragY = asCoord(cfg.dragY);
    cfg.maxWidth = clampNumber(cfg.maxWidth, 320, 1600, DEFAULT_CONFIG.maxWidth);
    cfg.opacity = clampNumber(cfg.opacity, 0.3, 1, DEFAULT_CONFIG.opacity);
    cfg.theme = cfg.theme === "light" ? "light" : "dark";
    cfg.costUnit = cfg.costUnit === "quota" ? "quota" : "usd";
    cfg.mutedHosts = Array.isArray(cfg.mutedHosts)
      ? cfg.mutedHosts.map((host) => String(host || "").trim()).filter(Boolean)
      : [];
    for (const flag of [
      "enabled",
      "showChannel",
      "showToken",
      "showTokens",
      "showLatency",
      "showCost",
      "showUsername",
      "collapsed",
    ]) {
      cfg[flag] = Boolean(cfg[flag]);
    }
    return cfg;
  }

  let config = normalizeConfig(readStore(CONFIG_KEY, null));

  function saveConfig(patch) {
    config = normalizeConfig({ ...config, ...patch });
    writeStore(CONFIG_KEY, config);
    return config;
  }

  const isConfigured = () =>
    Boolean(config.baseUrl) &&
    Boolean(config.userId) &&
    (config.authMode === "cookie" || Boolean(config.accessToken));

  // 后端的原始报错对着这个脚本的使用场景不够有指向性，补上该怎么改的提示。
  function explainApiError(message, cfg) {
    const text = String(message || "接口返回失败");
    if (/New-Api-User|不匹配|does not match/i.test(text)) {
      return cfg.authMode === "token"
        ? `${text}｜用户 ID 与令牌不是同一个账号；若该站点已在别的账号下登录，可能是脚本管理器忽略了 anonymous 选项，Cookie 覆盖了令牌`
        : `${text}｜Cookie 模式下用户 ID 必须与该站点当前登录账号一致`;
    }
    // auth.not_logged_in 的文案里也带 "access token"，必须先判它再判令牌无效。
    if (/未登录|未登入|not logged in/i.test(text)) {
      return cfg.authMode === "cookie"
        ? `${text}｜Cookie 模式需要先在该站点登录，或改用访问令牌`
        : `${text}｜令牌没被后端收到，检查站点地址是否指向同一个 new-api 实例`;
    }
    if (/access token/i.test(text)) {
      return `${text}｜请确认填的是「个人设置 → 访问令牌」，不是 sk- 开头的 API 密钥`;
    }
    return text;
  }

  function requestJson(url, cfg) {
    return new Promise((resolve, reject) => {
      if (!hasFn("GM_xmlhttpRequest")) {
        reject(new Error("脚本管理器不支持 GM_xmlhttpRequest"));
        return;
      }
      const headers = { Accept: "application/json", "New-Api-User": cfg.userId };
      if (cfg.authMode === "token") headers.Authorization = `Bearer ${cfg.accessToken}`;
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers,
        timeout: 20000,
        // token 模式下刻意不带 Cookie：否则同域已登录的 session 会盖掉 Authorization，
        // 若 session 用户与配置的用户 ID 不一致，后端会返回「用户 ID 不匹配」。
        anonymous: cfg.authMode === "token",
        onload: (res) => {
          if (res.status === 401 || res.status === 403) {
            reject(new Error(`认证失败（HTTP ${res.status}），请检查用户 ID 与访问令牌`));
            return;
          }
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status}`));
            return;
          }
          let payload;
          try {
            payload = JSON.parse(res.responseText);
          } catch {
            reject(new Error("响应不是合法 JSON，站点地址可能填错了"));
            return;
          }
          if (payload && payload.success === false) {
            reject(new Error(explainApiError(payload.message, cfg)));
            return;
          }
          resolve(payload);
        },
        onerror: () => reject(new Error("网络错误，站点地址可能不可达")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  let identity = null;

  async function loadIdentity(cfg, force = false) {
    if (!force && identity && Date.now() - identity.at < IDENTITY_TTL_MS) return identity;
    const self = await requestJson(`${cfg.baseUrl}/api/user/self`, cfg);
    const user = (self && self.data) || {};
    let quotaPerUnit = DEFAULT_QUOTA_PER_UNIT;
    try {
      const status = await requestJson(`${cfg.baseUrl}/api/status`, cfg);
      const unit = Number(status?.data?.quota_per_unit);
      if (Number.isFinite(unit) && unit > 0) quotaPerUnit = unit;
    } catch {
      /* /api/status 拿不到就用默认换算比例，不影响主功能 */
    }
    identity = {
      at: Date.now(),
      username: String(user.username || ""),
      role: Number(user.role) || 0,
      isAdmin: (Number(user.role) || 0) >= 10,
      quotaPerUnit,
    };
    return identity;
  }

  function buildLogsUrl(cfg, who) {
    const params = new URLSearchParams({ p: "1", page_size: String(cfg.pageSize) });
    // 成功和失败是两种 type，后端只能按单一 type 过滤，想同时要就得查全部再本地筛。
    if (cfg.callFilter === "success") params.set("type", String(LOG_TYPE_CONSUME));
    else if (cfg.callFilter === "error") params.set("type", String(LOG_TYPE_ERROR));
    // 管理员走管理端接口才能拿到 channel_name；范围为「本人」时用 username 收窄。
    if (who.isAdmin) {
      if (cfg.scope === "self" && who.username) params.set("username", who.username);
      return `${cfg.baseUrl}/api/log/?${params.toString()}`;
    }
    return `${cfg.baseUrl}/api/log/self?${params.toString()}`;
  }

  function hash32(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  // log.id 是页内序号不是主键（model/log.go:132 assignDisplayLogIds），不能用来去重。
  // request_id 也不足以单独做键：一个 HTTP 请求内的多次重试共用同一个 request_id，
  // processChannelError（controller/relay.go:363）每次失败都记一条错误日志，
  // 重试后成功还会再记一条消费日志。所以键里必须带上类型、渠道和内容指纹，
  // 否则同一请求的"失败×N + 成功"会互相吞掉，横幅上只剩一条。
  function dedupKey(log) {
    const parts = [log.type, log.request_id || "", log.channel, log.created_at];
    if (!log.request_id) {
      parts.push(
        log.model_name,
        log.token_name,
        log.quota,
        log.prompt_tokens,
        log.completion_tokens,
        log.use_time
      );
    }
    if (log.content) parts.push(hash32(String(log.content)));
    return parts.join("|");
  }

  function pickFields(log) {
    // other 是 JSON 字符串。frt（首字延迟，毫秒）和错误字段对普通用户都保留，
    // formatUserLogs（model/log.go:138）只剥掉 admin_info / audit_info / stream_status。
    let other = null;
    if (log.other) {
      try {
        other = JSON.parse(log.other);
      } catch {
        other = null;
      }
    }
    const type = Number(log.type) || 0;
    return {
      key: dedupKey(log),
      frt: Number(other?.frt) || 0,
      createdAt: Number(log.created_at) || 0,
      type,
      failed: type === LOG_TYPE_ERROR,
      model: String(log.model_name || ""),
      tokenName: String(log.token_name || ""),
      username: String(log.username || ""),
      channelId: Number(log.channel) || 0,
      // 错误日志把渠道名写进了 other（controller/relay.go:389），普通用户虽然拿不到
      // 顶层 channel_name，却能从这里读到，所以错误行也能显示真实渠道名。
      channelName: String(log.channel_name || other?.channel_name || ""),
      quota: Number(log.quota) || 0,
      promptTokens: Number(log.prompt_tokens) || 0,
      completionTokens: Number(log.completion_tokens) || 0,
      useTime: Number(log.use_time) || 0,
      isStream: Boolean(log.is_stream),
      content: String(log.content || ""),
      errorType: String(other?.error_type || ""),
      errorCode: other?.error_code === undefined ? "" : String(other.error_code),
      statusCode: Number(other?.status_code) || 0,
      requestPath: String(other?.request_path || ""),
    };
  }

  // 只保留"调用"相关的两类：消费=成功、错误=失败。查 type=0 会带回登录/充值/
  // 系统等噪音日志，横幅不该显示它们。
  const isCallLog = (item) => item.type === LOG_TYPE_CONSUME || item.type === LOG_TYPE_ERROR;

  async function pollOnce(cfg) {
    const who = await loadIdentity(cfg);
    const payload = await requestJson(buildLogsUrl(cfg, who), cfg);
    const items = payload?.data?.items;
    const logs = Array.isArray(items) ? items : [];
    return {
      items: logs.map(pickFields).filter(isCallLog),
      quotaPerUnit: who.quotaPerUnit,
      isAdmin: who.isAdmin,
      username: who.username,
    };
  }

  // rev 是单调递增的修订号，用它而不是时间戳做"这批我看过没"的判断：
  // 时间戳在同一毫秒内的两次发布会撞车，改系统时钟也会误判。
  // markFresh 为真时把 freshRev 一起推到当前 rev，让所有标签页知道这是新一批。
  function publishFeed(patch, markFresh = false) {
    const prev = readStore(FEED_KEY, {}) || {};
    const rev = (Number(prev.rev) || 0) + 1;
    const freshRev = markFresh ? rev : Number(prev.freshRev) || 0;
    writeStore(FEED_KEY, { ...prev, ...patch, rev, freshRev });
  }

  let leaderTimer = 0;
  let leaderPolling = false;
  let isLeader = false;

  function leaderRecord() {
    const record = readStore(LEADER_KEY, null);
    if (!record || typeof record !== "object") return null;
    return record;
  }

  const leaderIsFresh = (record) =>
    Boolean(record) && Date.now() - (Number(record.ts) || 0) < LEADER_STALE_MS;

  async function tryClaimLeadership() {
    const record = leaderRecord();
    if (leaderIsFresh(record) && record.tabId !== TAB_ID) return false;
    writeStore(LEADER_KEY, { tabId: TAB_ID, ts: Date.now() });
    // 两个标签页可能在同一 tick 抢锁：随机退避后复查，谁的写入留在最后谁当 leader。
    await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
    return leaderRecord()?.tabId === TAB_ID;
  }

  async function leaderTick() {
    if (!config.enabled || !isConfigured()) {
      isLeader = false;
      return;
    }
    if (!isLeader) {
      isLeader = await tryClaimLeadership();
      if (!isLeader) return;
    }
    writeStore(LEADER_KEY, { tabId: TAB_ID, ts: Date.now() });
    if (leaderPolling) return;
    const feed = readStore(FEED_KEY, {}) || {};
    const due = Date.now() - (Number(feed.polledAt) || 0) >= config.pollSeconds * 1000;
    if (!due) return;
    leaderPolling = true;
    try {
      const result = await pollOnce(config);
      // 请求期间可能发生 leader 交接，seen 要用此刻的最新值，别拿请求前的快照覆盖回去。
      const latest = readStore(FEED_KEY, {}) || {};
      const seen = Array.isArray(latest.seen) ? latest.seen : [];
      const seenSet = new Set(seen);
      // 接口按 id desc 返回，反转成旧→新推入队列，保证翻滚顺序符合时间。
      // 同一批次内也要去重：两行完全相同（同类型同渠道同内容同秒）时只留一条，
      // 否则 seen 会被灌进重复键，同一条还会被播两遍。
      const fresh = result.items
        .filter((item) => {
          if (seenSet.has(item.key)) return false;
          seenSet.add(item.key);
          return true;
        })
        .reverse();
      const nextSeen = [...seen, ...fresh.map((item) => item.key)].slice(-SEEN_KEYS_MAX);
      publishFeed(
        {
          polledAt: Date.now(),
          error: "",
          quotaPerUnit: result.quotaPerUnit,
          isAdmin: result.isAdmin,
          username: result.username,
          seen: nextSeen,
          items: result.items.slice(0, FEED_ITEMS_MAX),
          fresh,
        },
        fresh.length > 0
      );
    } catch (err) {
      publishFeed({ polledAt: Date.now(), error: err?.message || String(err) });
    } finally {
      leaderPolling = false;
    }
  }

  function startLeaderLoop() {
    if (leaderTimer) return;
    leaderTick();
    leaderTimer = setInterval(leaderTick, LEADER_HEARTBEAT_MS);
  }

  function releaseLeadership() {
    if (isLeader && leaderRecord()?.tabId === TAB_ID) {
      writeStore(LEADER_KEY, { tabId: TAB_ID, ts: 0 });
    }
    isLeader = false;
  }

  window.addEventListener("pagehide", releaseLeadership);
  window.addEventListener("beforeunload", releaseLeadership);

  const pad2 = (value) => String(value).padStart(2, "0");

  function formatClock(unixSeconds) {
    if (!unixSeconds) return "--:--:--";
    const date = new Date(unixSeconds * 1000);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function formatCount(value) {
    if (!Number.isFinite(value) || value <= 0) return "0";
    if (value < 1000) return String(value);
    if (value < 1000000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
    return `${(value / 1000000).toFixed(1)}M`;
  }

  function formatLatency(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
  }

  function formatCost(quota, quotaPerUnit) {
    if (config.costUnit === "quota") return String(quota);
    const unit = Number(quotaPerUnit) > 0 ? Number(quotaPerUnit) : DEFAULT_QUOTA_PER_UNIT;
    const usd = quota / unit;
    if (usd === 0) return "$0";
    if (usd < 0.000001) return "<$0.000001";
    return `$${usd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  }

  function channelLabel(item) {
    if (item.channelName) return `${item.channelName} #${item.channelId}`;
    return item.channelId ? `#${item.channelId}` : "";
  }

  // 用模型名/渠道名散列出一个稳定色，同一个模型每次出现颜色一致，扫一眼就能认出来。
  function hueOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) % 360;
    }
    return hash;
  }

  const state = {
    queue: [],
    history: [],
    cursor: -1,
    current: null,
    paused: false,
    hovering: false,
    quotaPerUnit: DEFAULT_QUOTA_PER_UNIT,
    error: "",
    lastRev: 0,
    lastFreshRev: 0,
    primed: false,
    skipped: 0,
    listOpen: false,
    dragging: false,
    rotateTimer: 0,
  };

  // 这三种情况都不该继续翻滚：用户点了暂停、鼠标停在横幅上、列表展开着。
  const isFrozen = () => state.paused || state.hovering || state.listOpen;

  function ingestFeed(feed) {
    if (!feed || typeof feed !== "object") return;
    if (Number(feed.quotaPerUnit) > 0) state.quotaPerUnit = Number(feed.quotaPerUnit);
    state.error = String(feed.error || "");
    const items = Array.isArray(feed.items) ? feed.items : [];
    if (items.length) state.history = items;

    const freshRev = Number(feed.freshRev) || 0;
    const fresh = Array.isArray(feed.fresh) ? feed.fresh : [];
    if (freshRev && freshRev !== state.lastFreshRev && fresh.length) {
      const firstSyncHere = !state.primed;
      state.lastFreshRev = freshRev;
      state.primed = true;
      // 每个标签页第一次同步只接管进度、不逐条高亮：新开的标签页不该把历史批次
      // 当成刚发生的调用闪一遍。
      if (!firstSyncHere) {
        const known = new Set(state.queue.map((item) => item.key));
        for (const item of fresh) {
          if (!known.has(item.key)) state.queue.push({ ...item, isNew: true });
        }
        trimQueue();
        // 新调用立刻顶上来，不等翻滚周期；并重置计时器让它拿到完整停留时间。
        if (state.queue.length && !isFrozen() && !config.collapsed) {
          advanceTicker();
          scheduleRotate();
        }
      }
    }
    if (!state.current) {
      if (state.queue.length) advanceTicker();
      else if (state.history.length) showItem({ ...state.history[0], isNew: false }, 0);
    }
    render();
  }

  function showItem(item, historyIndex, direction = 1) {
    state.current = item;
    state.cursor = Number.isInteger(historyIndex) ? historyIndex : -1;
    renderRow(item, direction);
    render();
  }

  // 积压超过上限时只保留最近几条，中间的直接丢掉。否则消耗速度（每 rotateSeconds
  // 一条）追不上进货速度，横幅会永久性地滞后于真实时间且不会自己恢复。
  function trimQueue() {
    const max = config.backlogPlayMax;
    if (state.queue.length <= max) return;
    state.skipped += state.queue.length - max;
    state.queue = state.queue.slice(-max);
  }

  // 自动推进：有新日志就按时间顺序逐条播，播完停在最新那条不再动。
  function advanceTicker() {
    if (state.queue.length) {
      trimQueue();
      const next = state.queue.shift();
      if (!state.queue.length) state.skipped = 0;
      const at = state.history.findIndex((item) => item.key === next.key);
      showItem(next, at, 1);
      return;
    }
    if (!state.history.length) return;
    // 已经停在最新一条就什么都不做，不做无意义的重绘动画。
    if (state.cursor === 0 && state.current) return;
    showItem({ ...state.history[0], isNew: false }, 0, 1);
  }

  function scheduleRotate() {
    clearInterval(state.rotateTimer);
    state.rotateTimer = setInterval(() => {
      if (isFrozen()) return;
      if (document.visibilityState === "hidden") return;
      if (config.collapsed) return;
      advanceTicker();
    }, config.rotateSeconds * 1000);
  }

  // 手动翻：在历史里按时间前后走，不消耗队列。olderBy 为正往回看，为负往最新看。
  function stepManual(olderBy) {
    state.paused = true;
    if (!state.history.length) return;
    const from = state.cursor < 0 ? 0 : state.cursor;
    const next = Math.min(state.history.length - 1, Math.max(0, from + olderBy));
    if (next === from && state.current) {
      render();
      return;
    }
    showItem({ ...state.history[next], isNew: false }, next, olderBy > 0 ? -1 : 1);
  }

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.wrap { position: fixed; z-index: 2147483647; pointer-events: auto; display: flex;
  flex-direction: column; gap: 8px; align-items: stretch; }
.wrap[data-pos="top-left"] { top: 12px; left: 12px; }
.wrap[data-pos="top-center"] { top: 12px; left: 50%; transform: translateX(-50%); }
.wrap[data-pos="top-right"] { top: 12px; right: 12px; }
.wrap[data-pos="bottom-left"] { bottom: 12px; left: 12px; }
.wrap[data-pos="bottom-center"] { bottom: 12px; left: 50%; transform: translateX(-50%); }
.wrap[data-pos="bottom-right"] { bottom: 12px; right: 12px; }
.bar { display: flex; align-items: stretch; height: 34px; border-radius: 17px; overflow: hidden;
  backdrop-filter: blur(12px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28); cursor: grab;
  user-select: none; transition: box-shadow 0.2s ease; }
.bar:hover { box-shadow: 0 8px 30px rgba(0, 0, 0, 0.38); }
.wrap[data-dragging="1"] .bar, .wrap[data-dragging="1"] .dot { cursor: grabbing;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.45); }
/* 失败行整条压一层红：扫一眼就知道这次调用挂了 */
.bar[data-failed="1"] { border-color: rgba(248, 81, 73, 0.55); }
:host([data-theme="dark"]) .bar[data-failed="1"] { background: rgba(52, 20, 22, 0.94); }
:host([data-theme="light"]) .bar[data-failed="1"] { background: rgba(255, 240, 240, 0.97); }
:host([data-theme="dark"]) .bar { background: rgba(18, 20, 26, 0.92); color: #e8eaf0;
  border: 1px solid rgba(255, 255, 255, 0.1); }
:host([data-theme="light"]) .bar { background: rgba(255, 255, 255, 0.94); color: #1d2129;
  border: 1px solid rgba(0, 0, 0, 0.1); }
.badge { display: flex; align-items: center; gap: 6px; padding: 0 10px 0 12px; flex: none;
  font-size: 11px; letter-spacing: 0.02em; opacity: 0.85; }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: #34d058; flex: none;
  box-shadow: 0 0 0 0 rgba(52, 208, 88, 0.7); }
.pulse[data-live="1"] { animation: pulse 2s ease-out infinite; }
.pulse[data-live="0"] { background: #8b949e; }
.pulse[data-live="err"] { background: #f85149; }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(52, 208, 88, 0.6); }
  70% { box-shadow: 0 0 0 7px rgba(52, 208, 88, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 208, 88, 0); }
}
.viewport { position: relative; overflow: hidden; flex: 1 1 auto; min-width: 0; height: 100%; }
.row { position: absolute; inset: 0; display: flex; align-items: center; gap: 8px;
  padding: 0 4px; white-space: nowrap; font-size: 12px; transition: transform 0.32s
  cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.32s ease; }
.row[data-phase="enter-down"] { transform: translateY(100%); opacity: 0; }
.row[data-phase="enter-up"] { transform: translateY(-100%); opacity: 0; }
.row[data-phase="live"] { transform: translateY(0); opacity: 1; }
.row[data-phase="leave-up"] { transform: translateY(-100%); opacity: 0; }
.row[data-phase="leave-down"] { transform: translateY(100%); opacity: 0; }
.pill { flex: none; padding: 2px 7px; border-radius: 9px; font-size: 11px; font-weight: 600;
  max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
/* 成功/失败标记 */
.mark { flex: none; width: 15px; height: 15px; border-radius: 50%; display: grid;
  place-items: center; font-size: 10px; font-weight: 800; line-height: 1; }
.mark[data-ok="1"] { background: rgba(52, 208, 88, 0.2); color: #34d058; }
.mark[data-ok="0"] { background: #f85149; color: #fff; cursor: help; }
.meta { flex: none; opacity: 0.72; font-size: 11px; font-variant-numeric: tabular-nums; }
.meta.grow { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.meta.err { color: #ff7b72; opacity: 1; max-width: 300px; overflow: hidden;
  text-overflow: ellipsis; }
.new { flex: none; font-size: 10px; font-weight: 700; color: #34d058; }
.nav { display: flex; align-items: center; flex: none; padding-right: 6px; gap: 2px; }
.nav button { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px; opacity: 0.55; line-height: 1; }
.nav button:hover { opacity: 1; background: rgba(127, 127, 127, 0.22); }
/* 暂停中的按钮高亮常亮，一眼看出当前是停着的 */
.nav button[data-active="1"] { opacity: 1; background: rgba(47, 111, 235, 0.3); color: #6ea8ff; }
.time { font-weight: 600; opacity: 0.9 !important; }
.dot { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  cursor: pointer; font-size: 13px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px); }
:host([data-theme="dark"]) .dot { background: rgba(18, 20, 26, 0.92); color: #e8eaf0;
  border: 1px solid rgba(255, 255, 255, 0.1); }
:host([data-theme="light"]) .dot { background: rgba(255, 255, 255, 0.94); color: #1d2129;
  border: 1px solid rgba(0, 0, 0, 0.1); }
.hidden { display: none !important; }

/* 最近 N 条列表：点横幅展开 */
.list { border-radius: 12px; overflow: hidden; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px); font-size: 12px; }
:host([data-theme="dark"]) .list { background: rgba(20, 22, 28, 0.97); color: #e8eaf0;
  border: 1px solid rgba(255, 255, 255, 0.12); }
:host([data-theme="light"]) .list { background: rgba(255, 255, 255, 0.98); color: #1d2129;
  border: 1px solid rgba(0, 0, 0, 0.12); }
.list-head { display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 11px; font-weight: 700; opacity: 0.75; }
.list-head button { all: unset; cursor: pointer; opacity: 0.55; font-size: 13px; }
.list-head button:hover { opacity: 1; }
.list-body { max-height: min(52vh, 420px); overflow-y: auto; }
.list-row { display: flex; align-items: center; gap: 8px; padding: 6px 12px; white-space: nowrap;
  border-top: 1px solid rgba(127, 127, 127, 0.14); }
.list-row[data-failed="1"] { background: rgba(248, 81, 73, 0.1); }
.list-row[data-current="1"] { box-shadow: inset 2px 0 0 #2f6feb; }
.list-empty { padding: 14px 12px; opacity: 0.6; font-size: 11px; }

/* 失败详情浮层：原生 title 延迟高且不能换行，自己画一个 */
.tip { position: fixed; z-index: 2147483647; max-width: 420px; padding: 8px 10px;
  border-radius: 9px; font-size: 11px; line-height: 1.5; white-space: pre-wrap;
  word-break: break-word; pointer-events: none; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.4); }
:host([data-theme="dark"]) .tip { background: rgba(30, 16, 18, 0.98); color: #ffd7d3;
  border: 1px solid rgba(248, 81, 73, 0.5); }
:host([data-theme="light"]) .tip { background: #fff5f5; color: #8b1a14;
  border: 1px solid rgba(248, 81, 73, 0.45); }
.tip b { display: block; margin-bottom: 3px; font-size: 11px; }
.tip code { opacity: 0.8; font-size: 10px; }
`;

  const PANEL_CSS = `
.panel { width: 360px; max-height: min(72vh, 620px); overflow-y: auto; border-radius: 14px;
  padding: 14px; font-size: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px); }
:host([data-theme="dark"]) .panel { background: rgba(20, 22, 28, 0.97); color: #e8eaf0;
  border: 1px solid rgba(255, 255, 255, 0.12); }
:host([data-theme="light"]) .panel { background: rgba(255, 255, 255, 0.98); color: #1d2129;
  border: 1px solid rgba(0, 0, 0, 0.12); }
.panel h2 { margin: 0 0 10px; font-size: 13px; font-weight: 700; display: flex;
  justify-content: space-between; align-items: center; }
.panel h2 button { all: unset; cursor: pointer; opacity: 0.5; font-size: 14px; }
.panel h2 button:hover { opacity: 1; }
.field { margin-bottom: 9px; }
.field > label { display: block; margin-bottom: 3px; opacity: 0.7; font-size: 11px; }
.field input[type="text"], .field input[type="password"], .field input[type="number"],
.field select { width: 100%; padding: 6px 8px; border-radius: 7px; font-size: 12px;
  font-family: inherit; }
:host([data-theme="dark"]) .field input, :host([data-theme="dark"]) .field select {
  background: rgba(255, 255, 255, 0.07); color: #e8eaf0;
  border: 1px solid rgba(255, 255, 255, 0.14); }
:host([data-theme="light"]) .field input, :host([data-theme="light"]) .field select {
  background: #fff; color: #1d2129; border: 1px solid rgba(0, 0, 0, 0.16); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin: 4px 0 10px; }
.checks label { display: flex; align-items: center; gap: 5px; font-size: 11px;
  opacity: 0.85; cursor: pointer; }
.checks input { margin: 0; }
.sep { height: 1px; margin: 10px 0; background: currentColor; opacity: 0.12; }
.hint { font-size: 10px; line-height: 1.5; opacity: 0.6; margin: 0 0 8px; }
.actions { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
.actions button { all: unset; cursor: pointer; padding: 6px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 600; text-align: center; }
.actions .primary { background: #2f6feb; color: #fff; }
.actions .primary:hover { background: #1f5cd8; }
.actions .ghost { border: 1px solid currentColor; opacity: 0.6; }
.actions .ghost:hover { opacity: 1; }
.status { font-size: 11px; margin-top: 8px; min-height: 15px; line-height: 1.4; }
.status[data-kind="ok"] { color: #34d058; }
.status[data-kind="err"] { color: #ff7b72; }
.status[data-kind="busy"] { opacity: 0.7; }
`;

  // 全程用 createElement 而非 innerHTML：部分站点开了 require-trusted-types-for，
  // innerHTML 赋值会直接抛错，整个横幅就挂了。
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === "text") node.textContent = value;
        else if (key === "class") node.className = value;
        else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
      }
    }
    for (const child of children || []) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  const ui = {
    host: null,
    wrap: null,
    bar: null,
    dot: null,
    badgeText: null,
    pulse: null,
    pauseButton: null,
    viewport: null,
    panel: null,
    list: null,
    tip: null,
    inputs: {},
    status: null,
  };

  function applyStyles(shadow) {
    const css = CSS + PANEL_CSS;
    if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet === "function") {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        return;
      } catch {
        /* 构造式样式表不可用时退回 <style> 元素 */
      }
    }
    shadow.appendChild(el("style", { text: css }));
  }

  // 拖动与点击共用 mousedown：位移不超过阈值算点击，超过才算拖。
  // 不用 HTML5 drag 事件，它在很多站点上被自身的 dragstart 处理器吞掉。
  function makeDraggable(handle, onClick) {
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const box = ui.wrap.getBoundingClientRect();
      const grabX = startX - box.left;
      const grabY = startY - box.top;
      let moved = false;
      event.preventDefault();

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        if (!moved) {
          moved = true;
          state.dragging = true;
          hideTip();
          // 拖动时收起列表：一是抓点坐标按横幅算，列表撑着会让钳制范围失真；
          // 二是拖到一半展开方向翻转，列表会在光标下跳来跳去。
          if (state.listOpen) toggleList(false);
          ui.wrap.setAttribute("data-dragging", "1");
        }
        placeBar(moveEvent.clientX - grabX, moveEvent.clientY - grabY);
      };
      const onUp = (upEvent) => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        if (!moved) {
          onClick?.();
          return;
        }
        state.dragging = false;
        ui.wrap.removeAttribute("data-dragging");
        const placed = placeBar(upEvent.clientX - grabX, upEvent.clientY - grabY);
        saveConfig({ dragX: placed.x, dragY: placed.y });
        render(); // 让 data-pos 立刻切到 free，不再依赖行内样式压住锚点 CSS
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    });
  }

  // 当前可见的那个元素（展开态是横幅，收起态是圆点）。钳制和锚定都以它为准，
  // 不能用整个容器：容器高度含列表/设置面板，拿它算会导致横幅贴不到屏幕下沿。
  const anchorBox = () =>
    (ui.bar.classList.contains("hidden") ? ui.dot : ui.bar).getBoundingClientRect();

  // 唯一的定位入口：给定横幅左上角的目标视口坐标，钳制进视口、决定锚定哪条边。
  function placeBar(x, y) {
    const box = anchorBox();
    const viewportW = window.innerWidth || 1024;
    const viewportH = window.innerHeight || 768;
    const width = box.width || config.maxWidth;
    const height = box.height || 34;
    const clamped = {
      x: Math.round(
        Math.min(Math.max(EDGE_MARGIN_PX, x), Math.max(EDGE_MARGIN_PX, viewportW - width - EDGE_MARGIN_PX))
      ),
      y: Math.round(
        Math.min(Math.max(EDGE_MARGIN_PX, y), Math.max(EDGE_MARGIN_PX, viewportH - height - EDGE_MARGIN_PX))
      ),
    };
    // 横幅中心落在视口下半就往上展开，上半就往下展开 —— 不需要用户去选锚点。
    applyAnchor(clamped.x, clamped.y, height, clamped.y + height / 2 > viewportH / 2);
    return clamped;
  }

  // 关键：向上展开时必须把容器锚在 bottom。容器锚 top 而内部用 column-reverse 的话，
  // 容器会往下生长、横幅被列表的高度整个推下去（甚至推出视口）。
  function applyAnchor(x, y, height, expandUp) {
    const style = ui.wrap.style;
    const viewportH = window.innerHeight || 768;
    style.left = `${x}px`;
    style.right = "auto";
    style.transform = "none";
    if (expandUp) {
      style.top = "auto";
      style.bottom = `${Math.max(0, viewportH - (y + height))}px`;
    } else {
      style.bottom = "auto";
      style.top = `${y}px`;
    }
    style.flexDirection = expandUp ? "column-reverse" : "column";
  }

  function layoutWrap() {
    if (config.dragX !== null && config.dragY !== null) {
      ui.wrap.setAttribute("data-pos", "free");
      placeBar(config.dragX, config.dragY);
      return;
    }
    // 预设锚点的 left/top/bottom 由 CSS 负责，这里只要让展开方向跟锚点一致：
    // 贴上边就往下展开，贴下边就往上展开。
    ui.wrap.setAttribute("data-pos", config.position);
    ui.wrap.style.flexDirection = config.position.startsWith("top") ? "column" : "column-reverse";
  }

  function buildBar() {
    ui.pulse = el("span", { class: "pulse", "data-live": "0" });
    ui.badgeText = el("span", { text: "new-api" });
    const badge = el("span", { class: "badge" }, [ui.pulse, ui.badgeText]);
    ui.viewport = el("div", { class: "viewport" });

    // nav 里的按钮各管一件事，别让 mousedown 冒到拖动处理器上。
    const action = (handler) => (event) => {
      event.stopPropagation();
      event.preventDefault();
      handler();
    };
    const navButton = (title, text, handler) => {
      const button = el("button", { title, text, onclick: action(handler) });
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      return button;
    };
    const nav = el("div", { class: "nav" }, [
      navButton("往前看（更早的调用）", "‹", () => stepManual(1)),
      navButton("往后看（更新的调用）", "›", () => stepManual(-1)),
      // 图标要反映当前状态，光有一个 ⏯ 点下去看不出到底停了没有。
      (ui.pauseButton = navButton("暂停翻滚", "⏸", () => {
        state.paused = !state.paused;
        render();
      })),
      navButton("设置", "⚙", () => togglePanel()),
      navButton("收起", "◉", () => setCollapsed(true)),
    ]);

    ui.bar = el(
      "div",
      {
        class: "bar",
        onmouseenter: () => {
          state.hovering = true;
          render();
        },
        onmouseleave: () => {
          state.hovering = false;
          render();
        },
      },
      [badge, ui.viewport, nav]
    );
    makeDraggable(ui.bar, () => toggleList());

    ui.dot = el("div", { class: "dot hidden", title: "展开 new-api 日志横幅（可拖动）", text: "◉" });
    makeDraggable(ui.dot, () => setCollapsed(false));
  }

  function buildList() {
    const close = el("button", { title: "关闭", text: "✕" });
    close.addEventListener("mousedown", (event) => event.stopPropagation());
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleList(false);
    });
    ui.list = el("div", { class: "list hidden" }, [
      el("div", { class: "list-head" }, [el("span", { class: "list-count" }), close]),
      el("div", { class: "list-body" }),
    ]);
    // 列表内部的滚动/点击不该触发拖动。
    ui.list.addEventListener("mousedown", (event) => event.stopPropagation());
  }

  function textField(key, label, value, opts) {
    const input = el("input", {
      type: opts?.password ? "password" : opts?.number ? "number" : "text",
      value: value === null || value === undefined ? "" : String(value),
      placeholder: opts?.placeholder || "",
      min: opts?.min,
      max: opts?.max,
      step: opts?.step,
      spellcheck: "false",
      autocomplete: "off",
    });
    // 显式赋值而不只依赖 value 属性反射：属性只决定默认值，用户输入过一次就不再同步。
    input.value = value === null || value === undefined ? "" : String(value);
    ui.inputs[key] = input;
    return el("div", { class: "field" }, [el("label", { text: label }), input]);
  }

  function selectField(key, label, value, options) {
    const select = el(
      "select",
      {},
      options.map(([optValue, optLabel]) =>
        el("option", { value: optValue, text: optLabel, ...(String(optValue) === String(value) ? { selected: "selected" } : {}) })
      )
    );
    select.value = String(value);
    ui.inputs[key] = select;
    return el("div", { class: "field" }, [el("label", { text: label }), select]);
  }

  function checkField(key, label, checked) {
    const input = el("input", { type: "checkbox" });
    input.checked = Boolean(checked);
    ui.inputs[key] = input;
    return el("label", {}, [input, el("span", { text: label })]);
  }

  function buildPanel() {
    ui.inputs = {};
    ui.status = el("div", { class: "status", "data-kind": "busy" });
    const host = location.hostname;
    const muted = config.mutedHosts.includes(host);

    const body = [
      el("h2", {}, [
        el("span", { text: "new-api 日志横幅设置" }),
        el("button", { title: "关闭", text: "✕", onclick: () => togglePanel(false) }),
      ]),
      textField("baseUrl", "站点地址", config.baseUrl, { placeholder: "https://api.example.com" }),
      el("div", { class: "grid2" }, [
        textField("userId", "用户 ID", config.userId, { placeholder: "个人设置页的数字 ID" }),
        selectField("authMode", "认证方式", config.authMode, [
          ["token", "访问令牌（全站可用）"],
          ["cookie", "Cookie（仅站内）"],
        ]),
      ]),
      textField("accessToken", "访问令牌", config.accessToken, {
        password: true,
        placeholder: "个人设置 → 访问令牌",
      }),
      el("p", {
        class: "hint",
        text: "访问令牌等价于账号权限，只会发往上面填的站点。Cookie 方式不需要令牌，但只有该站点自己的标签页能取到数据。",
      }),
      el("div", { class: "sep" }),
      el("div", { class: "grid3" }, [
        textField("pollSeconds", "轮询(秒)", config.pollSeconds, { number: true, min: 2, max: 300 }),
        textField("rotateSeconds", "翻滚(秒)", config.rotateSeconds, { number: true, min: 1, max: 60 }),
        textField("pageSize", "每次条数", config.pageSize, { number: true, min: 5, max: 100 }),
      ]),
      el("div", { class: "grid2" }, [
        textField("backlogPlayMax", "积压最多补播", config.backlogPlayMax, {
          number: true,
          min: 1,
          max: 30,
        }),
        textField("listSize", "列表显示条数", config.listSize, { number: true, min: 3, max: 30 }),
      ]),
      el("p", {
        class: "hint",
        text: "空闲时停在最新一条。攒了很多未播时只补播最近这几条，中间的跳过（徽标会标出跳过多少），保证横幅不滞后。",
      }),
      el("div", { class: "grid2" }, [
        selectField("callFilter", "显示", config.callFilter, Object.entries(CALL_FILTERS)),
        selectField("scope", "范围", config.scope, [
          ["self", "本人"],
          ["all", "全站（需管理员）"],
        ]),
      ]),
      el("div", { class: "grid3" }, [
        selectField("position", "初始位置", config.position, Object.entries(POSITIONS)),
        selectField("theme", "主题", config.theme, [
          ["dark", "深色"],
          ["light", "浅色"],
        ]),
        selectField("costUnit", "费用单位", config.costUnit, [
          ["usd", "美元"],
          ["quota", "配额"],
        ]),
      ]),
      el("div", { class: "grid2" }, [
        textField("maxWidth", "最大宽度(px)", config.maxWidth, { number: true, min: 320, max: 1600 }),
        textField("opacity", "不透明度", config.opacity, { number: true, min: 0.3, max: 1, step: 0.02 }),
      ]),
      el("div", { class: "checks" }, [
        checkField("showChannel", "显示渠道", config.showChannel),
        checkField("showToken", "显示令牌名", config.showToken),
        checkField("showTokens", "显示 tokens", config.showTokens),
        checkField("showLatency", "显示耗时", config.showLatency),
        checkField("showCost", "显示费用", config.showCost),
        checkField("showUsername", "显示用户名", config.showUsername),
      ]),
      el("div", { class: "sep" }),
      el("p", {
        class: "hint",
        text: "「初始位置」只决定没拖动过时停在哪，装好就能用、不需要先设置。横幅可以直接拖到任意位置；列表往哪边展开是自动算的 —— 横幅在屏幕下半就往上展开，上半就往下展开，不会把自己顶出视口。",
      }),
      el("div", { class: "actions" }, [
        el("button", { class: "primary", text: "保存", onclick: () => applyPanel(false) }),
        el("button", { class: "ghost", text: "测试连接", onclick: () => applyPanel(true) }),
        el("button", {
          class: "ghost",
          text: muted ? `在 ${host} 显示` : `在 ${host} 隐藏`,
          onclick: () => toggleMutedHost(host),
        }),
      ]),
      el("div", { class: "actions" }, [
        el("button", {
          class: "ghost",
          text: "回到初始位置",
          onclick: resetPosition,
        }),
      ]),
      ui.status,
    ];

    ui.panel = el("div", { class: "panel hidden" }, body);
  }

  function setStatus(kind, text) {
    if (!ui.status) return;
    ui.status.setAttribute("data-kind", kind);
    ui.status.textContent = text;
  }

  function collectPanel() {
    const read = (key) => ui.inputs[key]?.value ?? "";
    const checked = (key) => Boolean(ui.inputs[key]?.checked);
    return {
      baseUrl: read("baseUrl"),
      userId: read("userId"),
      accessToken: read("accessToken"),
      authMode: read("authMode"),
      scope: read("scope"),
      pollSeconds: Number(read("pollSeconds")),
      rotateSeconds: Number(read("rotateSeconds")),
      pageSize: Number(read("pageSize")),
      backlogPlayMax: Number(read("backlogPlayMax")),
      listSize: Number(read("listSize")),
      callFilter: read("callFilter"),
      position: read("position"),
      theme: read("theme"),
      costUnit: read("costUnit"),
      maxWidth: Number(read("maxWidth")),
      opacity: Number(read("opacity")),
      showChannel: checked("showChannel"),
      showToken: checked("showToken"),
      showTokens: checked("showTokens"),
      showLatency: checked("showLatency"),
      showCost: checked("showCost"),
      showUsername: checked("showUsername"),
    };
  }

  async function applyPanel(testOnly) {
    const patch = collectPanel();
    const candidate = normalizeConfig({ ...config, ...patch });
    if (!candidate.baseUrl) {
      setStatus("err", "请填写站点地址");
      return;
    }
    if (!/^https?:\/\//i.test(candidate.baseUrl)) {
      setStatus("err", "站点地址需要以 http:// 或 https:// 开头");
      return;
    }
    if (!candidate.userId) {
      setStatus("err", "请填写用户 ID");
      return;
    }
    if (candidate.authMode === "token" && !candidate.accessToken) {
      setStatus("err", "访问令牌为空；若只想站内使用，请把认证方式改为 Cookie");
      return;
    }
    setStatus("busy", "正在连接…");
    try {
      const who = await loadIdentity(candidate, true);
      const probe = await pollOnce(candidate);
      if (candidate.scope === "all" && !who.isAdmin) {
        candidate.scope = "self";
        setStatus("ok", `连接成功：${who.username || "未知用户"}（非管理员，范围已回退为本人）`);
      } else {
        const channelNote = who.isAdmin ? "含渠道名" : "仅渠道 ID（普通用户接口不返回渠道名）";
        setStatus("ok", `连接成功：${who.username || "未知用户"} · ${probe.items.length} 条 · ${channelNote}`);
      }
    } catch (err) {
      setStatus("err", `连接失败：${err?.message || err}`);
      if (testOnly) return;
    }
    if (testOnly) return;
    const before = { pollSeconds: config.pollSeconds, rotateSeconds: config.rotateSeconds };
    saveConfig(candidate);
    identity = null;
    // 轮询节奏由 feed.polledAt 驱动，间隔改小后强制下一 tick 立即拉一次。
    if (config.pollSeconds !== before.pollSeconds) publishFeed({ polledAt: 0 });
    if (config.rotateSeconds !== before.rotateSeconds) scheduleRotate();
    render();
  }

  function togglePanel(force) {
    if (!ui.panel) return;
    const show = typeof force === "boolean" ? force : ui.panel.classList.contains("hidden");
    if (show) {
      // 重建面板以反映最新配置，避免用旧值覆盖别处改过的设置。
      const rebuilt = ui.panel;
      buildPanel();
      rebuilt.replaceWith(ui.panel);
      ui.panel.classList.remove("hidden");
      setStatus("busy", isConfigured() ? "" : "填好三项后点「测试连接」");
    } else {
      ui.panel.classList.add("hidden");
    }
  }

  function toggleMutedHost(host) {
    const muted = config.mutedHosts.includes(host);
    const nextHosts = muted
      ? config.mutedHosts.filter((item) => item !== host)
      : [...config.mutedHosts, host];
    saveConfig({ mutedHosts: nextHosts });
    togglePanel(false);
    render();
  }

  function setCollapsed(collapsed) {
    saveConfig({ collapsed });
    if (collapsed) {
      togglePanel(false);
      toggleList(false);
    }
    render();
  }

  // 清掉拖动坐标，回到 position 锚点。行内样式必须一并抹掉，否则 CSS 的锚点规则被压住。
  function resetPosition() {
    saveConfig({ dragX: null, dragY: null });
    const style = ui.wrap.style;
    // flex-direction 不用清：下面 render → layoutWrap 会按预设锚点重新写一遍。
    for (const prop of ["left", "top", "right", "bottom", "transform"]) {
      style.removeProperty(prop);
    }
    render();
  }

  // 失败详情：把 content 和 other 里的错误定位信息拼成一段可读文本。
  function errorDetail(item) {
    const lines = [item.content || "（后端未记录错误内容）"];
    const meta = [];
    if (item.statusCode) meta.push(`HTTP ${item.statusCode}`);
    if (item.errorType) meta.push(item.errorType);
    if (item.errorCode) meta.push(item.errorCode);
    if (item.requestPath) meta.push(item.requestPath);
    return { text: lines[0], meta: meta.join(" · ") };
  }

  function statusMark(item) {
    const mark = el("span", {
      class: "mark",
      "data-ok": item.failed ? "0" : "1",
      text: item.failed ? "!" : "✓",
    });
    if (!item.failed) {
      mark.setAttribute("aria-label", "调用成功");
      return mark;
    }
    mark.setAttribute("aria-label", "调用失败");
    const detail = errorDetail(item);
    mark.addEventListener("mouseenter", () => showTip(mark, detail));
    mark.addEventListener("mouseleave", hideTip);
    return mark;
  }

  function buildRowContent(item) {
    const nodes = [statusMark(item)];
    if (item.isNew) nodes.push(el("span", { class: "new", text: "NEW" }));
    // 时间紧跟状态标记放在最前：横幅右侧可能被长模型名/错误信息挤掉，
    // 放最后容易看不到，而"这条是什么时候的"是判断新鲜度的第一信息。
    nodes.push(el("span", { class: "meta time", text: formatClock(item.createdAt) }));

    const modelHue = hueOf(item.model || "unknown");
    const modelPill = el("span", {
      class: "pill",
      text: item.model || "(无模型)",
      title: item.model || "",
    });
    modelPill.style.background = `hsla(${modelHue}, 70%, 52%, 0.22)`;
    modelPill.style.color = `hsl(${modelHue}, 78%, ${config.theme === "dark" ? "72%" : "34%"})`;
    nodes.push(modelPill);

    if (config.showChannel) {
      const label = channelLabel(item);
      if (label) {
        const hue = hueOf(item.channelName || String(item.channelId));
        const pill = el("span", { class: "pill", text: label, title: label });
        pill.style.background = `hsla(${hue}, 60%, 50%, 0.16)`;
        pill.style.color = `hsl(${hue}, 62%, ${config.theme === "dark" ? "76%" : "36%"})`;
        nodes.push(pill);
      }
    }

    if (config.showUsername && item.username) {
      nodes.push(el("span", { class: "meta", text: `@${item.username}` }));
    }
    // 失败的调用后端把 tokens 和 quota 都写成 0，显示「↑0 ↓0 $0」纯属噪音，
    // 那块横向空间让给错误信息。
    if (config.showTokens && !item.failed) {
      nodes.push(
        el("span", {
          class: "meta",
          title: `输入 ${item.promptTokens} / 输出 ${item.completionTokens}`,
          text: `↑${formatCount(item.promptTokens)} ↓${formatCount(item.completionTokens)}`,
        })
      );
    }
    if (config.showLatency) {
      // use_time 是秒，other.frt 是首字延迟毫秒；流式请求两个一起看才有意义。
      const total = formatLatency(item.useTime * 1000);
      const first = item.isStream ? formatLatency(item.frt) : "";
      const text = first ? `${first} / ${total}` : total;
      if (text) {
        nodes.push(
          el("span", {
            class: "meta",
            text,
            title: first ? "首字延迟 / 总耗时" : "总耗时",
          })
        );
      }
    }
    if (config.showCost && !item.failed) {
      nodes.push(el("span", { class: "meta", text: formatCost(item.quota, state.quotaPerUnit) }));
    }
    if (config.showToken && item.tokenName) {
      nodes.push(el("span", { class: "meta", text: item.tokenName, title: item.tokenName }));
    }
    if (item.failed) {
      const detail = errorDetail(item);
      const note = el("span", { class: "meta err grow", text: detail.text });
      note.addEventListener("mouseenter", () => showTip(note, detail));
      note.addEventListener("mouseleave", hideTip);
      nodes.push(note);
    }
    return nodes;
  }

  function showTip(anchor, detail) {
    if (!ui.wrap) return;
    hideTip();
    const tip = el("div", { class: "tip" }, [
      el("b", { text: detail.text }),
      detail.meta ? el("code", { text: detail.meta }) : null,
    ]);
    ui.wrap.appendChild(tip);
    ui.tip = tip;
    // 先放进 DOM 量出实际尺寸，再决定挂在锚点上方还是下方、左右是否需要回收。
    const box = anchor.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const viewportW = window.innerWidth || 1024;
    const viewportH = window.innerHeight || 768;
    const above = box.top > tipBox.height + 12;
    const top = above ? box.top - tipBox.height - 8 : box.bottom + 8;
    const left = Math.min(
      Math.max(EDGE_MARGIN_PX, box.left - 8),
      Math.max(EDGE_MARGIN_PX, viewportW - tipBox.width - EDGE_MARGIN_PX)
    );
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.min(Math.max(EDGE_MARGIN_PX, top), viewportH - tipBox.height - EDGE_MARGIN_PX)}px`;
  }

  function hideTip() {
    if (!ui.tip) return;
    ui.tip.remove();
    ui.tip = null;
  }

  function buildListRow(item, isCurrent) {
    const row = el("div", {
      class: "list-row",
      "data-failed": item.failed ? "1" : "0",
      "data-current": isCurrent ? "1" : "0",
    });
    for (const node of buildRowContent({ ...item, isNew: false })) row.appendChild(node);
    return row;
  }

  function renderList() {
    if (!ui.list) return;
    const items = state.history.slice(0, config.listSize);
    const body = ui.list.querySelectorAll(".list-body")[0];
    const head = ui.list.querySelectorAll(".list-count")[0];
    if (head) {
      const failed = items.filter((item) => item.failed).length;
      head.textContent = failed
        ? `最近 ${items.length} 条 · 失败 ${failed}`
        : `最近 ${items.length} 条`;
    }
    if (!body) return;
    if (!items.length) {
      body.replaceChildren(el("div", { class: "list-empty", text: "暂无调用记录" }));
      return;
    }
    const currentKey = state.current?.key;
    body.replaceChildren(...items.map((item) => buildListRow(item, item.key === currentKey)));
  }

  function toggleList(force) {
    if (!ui.list) return;
    const show = typeof force === "boolean" ? force : ui.list.classList.contains("hidden");
    ui.list.classList.toggle("hidden", !show);
    // 列表展开时冻结翻滚，否则一边看一边行内容在变。
    state.listOpen = show;
    if (!show) hideTip();
    render(); // render 里会按 listOpen 调 renderList，这里不用重复渲染
  }

  function renderRow(item, direction) {
    if (!ui.viewport) return;
    const next = el("div", { class: "row", "data-phase": direction >= 0 ? "enter-down" : "enter-up" });
    for (const node of buildRowContent(item)) next.appendChild(node);
    const previous = Array.from(ui.viewport.children);
    ui.viewport.appendChild(next);
    // 强制一次布局，让 enter 相位真正生效再切到 live，否则浏览器会合并成无动画。
    void next.offsetHeight;
    next.setAttribute("data-phase", "live");
    for (const row of previous) {
      row.setAttribute("data-phase", direction >= 0 ? "leave-up" : "leave-down");
      setTimeout(() => row.remove(), 400);
    }
  }

  function renderStatusRow(text, isError) {
    if (!ui.viewport) return;
    ui.viewport.replaceChildren(
      el("div", { class: "row", "data-phase": "live" }, [
        el("span", { class: isError ? "meta err grow" : "meta grow", text }),
      ])
    );
    state.current = null;
  }

  function render() {
    if (!ui.host || !ui.wrap) return;
    const hiddenHere = config.mutedHosts.includes(location.hostname);
    const panelOpen = ui.panel && !ui.panel.classList.contains("hidden");

    ui.host.setAttribute("data-theme", config.theme);
    ui.wrap.setAttribute("data-pos", config.position);
    ui.wrap.style.opacity = String(config.opacity);
    ui.bar.style.maxWidth = `${config.maxWidth}px`;
    ui.bar.style.width = `${config.maxWidth}px`;

    // 在本站隐藏时仍留下小圆点，否则用户没有入口把它调回来。
    const showBar = config.enabled && !config.collapsed && !hiddenHere;
    ui.bar.classList.toggle("hidden", !showBar);
    ui.dot.classList.toggle("hidden", showBar);
    if (!showBar && state.listOpen) toggleList(false);
    layoutWrap();

    if (!showBar && !panelOpen) return;

    const queued = state.queue.length;
    const frozen = isFrozen();
    if (!isConfigured()) {
      ui.pulse.setAttribute("data-live", "0");
      ui.badgeText.textContent = "未配置";
      renderStatusRow("点右侧 ⚙ 填写站点地址、用户 ID 和访问令牌", false);
      return;
    }
    if (state.error) {
      ui.pulse.setAttribute("data-live", "err");
      ui.badgeText.textContent = "异常";
      renderStatusRow(state.error, true);
      return;
    }
    ui.pulse.setAttribute("data-live", frozen ? "0" : "1");
    // 暂停按钮的图标和标题跟着状态走，点下去有明确反馈。
    ui.pauseButton.textContent = state.paused ? "▶" : "⏸";
    ui.pauseButton.title = state.paused ? "继续翻滚" : "暂停翻滚";
    ui.pauseButton.setAttribute("data-active", state.paused ? "1" : "0");
    // 状态在前，附注在后。附注彼此独立：可以同时"暂停"且"翻到了第 3 条前"。
    // 悬停是瞬时的、松开就恢复，不给它单独的文字状态：脉冲点变灰已经够了，
    // 每次划过都改一次文字反而让人以为切换了什么模式。
    const statusWord = state.listOpen ? "列表" : state.paused ? "暂停" : "实时";
    const parts = [statusWord];
    if (!queued && state.cursor > 0) parts.push(`第 ${state.cursor + 1} 条前`);
    if (queued) parts.push(`+${queued}`);
    if (state.skipped) parts.push(`跳过 ${state.skipped}`);
    ui.badgeText.textContent = parts.join(" ");
    // leader 身份是排查跨标签页行为时才需要的信息，放 hover 提示里不占横幅宽度。
    ui.bar.title = `${state.listOpen ? "点击收起列表" : "点击查看最近 " + config.listSize + " 条"}｜拖动可移动位置｜${
      isLeader ? "本标签页负责轮询" : "跟随其它标签页的轮询结果"
    }`;
    // 当前失败时整条横幅压红，扫一眼就知道最近这次调用挂了。
    ui.bar.setAttribute("data-failed", state.current?.failed ? "1" : "0");
    if (!state.current && !state.history.length) {
      renderStatusRow(state.lastRev ? "暂无日志" : "正在加载…", false);
    }
    if (state.listOpen) renderList();
  }

  function mount() {
    if (ui.host && ui.host.isConnected) return;
    ui.host = el("div", { id: HOST_ID });
    ui.host.setAttribute("data-theme", config.theme);
    // Shadow DOM 隔离样式：宿主站点的 CSS 进不来，横幅的样式也不会漏出去污染页面。
    const shadow = ui.host.attachShadow({ mode: "open" });
    applyStyles(shadow);
    buildBar();
    buildPanel();
    buildList();
    ui.wrap = el("div", { class: "wrap" }, [ui.bar, ui.dot, ui.list, ui.panel]);
    shadow.appendChild(ui.wrap);
    (document.body || document.documentElement).appendChild(ui.host);
    render();
  }

  function syncFromStore() {
    const feed = readStore(FEED_KEY, null);
    if (!feed) return;
    const rev = Number(feed.rev) || 0;
    if (rev && rev === state.lastRev) return;
    state.lastRev = rev;
    ingestFeed(feed);
  }

  function watchFeed() {
    if (canListen) {
      GM_addValueChangeListener(FEED_KEY, () => syncFromStore());
      GM_addValueChangeListener(CONFIG_KEY, (_key, _old, next, remote) => {
        if (!remote) return;
        try {
          config = normalizeConfig(typeof next === "string" ? JSON.parse(next) : next);
        } catch {
          return;
        }
        scheduleRotate();
        render();
      });
      // 监听器可用也保留一个低频兜底：个别管理器只在同源标签页间派发事件。
      setInterval(syncFromStore, 5000);
      return;
    }
    setInterval(syncFromStore, FOLLOWER_POLL_MS);
  }

  function registerMenu() {
    if (!hasFn("GM_registerMenuCommand")) return;
    GM_registerMenuCommand("⚙ 打开设置", () => {
      mount();
      if (config.collapsed) setCollapsed(false);
      togglePanel(true);
    });
    GM_registerMenuCommand("⏯ 启用 / 停用横幅", () => {
      saveConfig({ enabled: !config.enabled });
      render();
    });
    GM_registerMenuCommand(`🙈 在 ${location.hostname} 隐藏 / 显示`, () =>
      toggleMutedHost(location.hostname)
    );
  }

  function boot() {
    mount();
    syncFromStore();
    scheduleRotate();
    startLeaderLoop();
    watchFeed();
    registerMenu();

    // 窗口变小后原坐标可能已经在视口外，重新钳制一次并重算展开方向。
    window.addEventListener("resize", () => {
      if (!ui.wrap) return;
      if (config.dragX === null || config.dragY === null) return;
      const placed = placeBar(config.dragX, config.dragY);
      if (placed.x !== config.dragX || placed.y !== config.dragY) {
        saveConfig({ dragX: placed.x, dragY: placed.y });
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      // 回到前台：立刻补一次同步，并尝试接管已经失联的 leader。
      syncFromStore();
      leaderTick();
    });

    // 站点自己重写 DOM（SPA 路由、body 整体替换）后把宿主节点补回去。
    setInterval(() => {
      if (!ui.host || !ui.host.isConnected) {
        ui.host = null;
        mount();
      }
    }, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
