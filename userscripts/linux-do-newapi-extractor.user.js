// ==UserScript==
// @name         Linux.do → new-api 渠道提取器
// @namespace    https://linux.do/
// @version      0.3.0
// @description  解析 linux.do 楼层里的 API 地址与密钥（明文 / Base64 / 多重 Base64 / URL-safe / URL+Key 合并编码 / JSON 配置 / 仅密钥官方直连），一键复制成 new-api「添加渠道」可识别的剪贴板配置
// @author       shiki
// @match        https://linux.do/*
// @match        http://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 用法
 * ──────────────────────────────────────────────
 * 1. 打开任意 linux.do 帖子（/t/ 页面），右下角出现「🔑」悬浮按钮，角标是识别到的条数。
 * 2. 点开面板。每张卡都是一条工作流：
 *      原文/密文 → 选解密方式（自动 / 明文 / Base64 / Base64×2 / Base64×3 / AES口令）
 *      → 解出的 API地址 和 密钥（可手改）→ 备注三行预览 → 复制配置
 *    第一张卡是「手动粘贴」，常驻，自动识别不中时把密文直接粘进去。
 * 3. 回 new-api 打开「添加渠道」，顶部会提示「检测到剪贴板中的连接信息」，点「自动填入」，
 *    API 地址、密钥、名称、备注一次填好。
 * 4. 面板顶部可以存自己的 new-api 渠道页地址，之后用「复制并打开」少一步。
 *
 * 兼容性注意：脚本刻意不使用正则后行断言 (?<!...)。它在 Safari < 16.4 和部分
 * 脚本管理器内核上是解析期 SyntaxError，会导致整个脚本一行都不执行、且没有任何
 * 报错线索。改动本文件的正则时请不要重新引入。
 *
 * 备注固定三行，对应手动加渠道的习惯：
 *   第 1 行  帖子 URL
 *   第 2 行  发密钥那层楼作者的最近活动页
 *   第 3 行  API 地址（省略地址走官方时写「官方直连」）
 *
 * 覆盖的编码情况
 * ──────────────────────────────────────────────
 *   · 明文密钥：已知前缀（sk- / AIza / xai- / gsk_ …）、Bearer、`key: xxx` 标注、独立成块的 token
 *   · Base64 密钥：1～4 层，标准字母表和 URL-safe（-_）都认，缺 = 自动补齐
 *   · 密钥没有任何前缀时，整段解码结果本身像密钥也能认出来
 *   · URL + 密钥合并编码：解码后同时含地址和密钥，换行 / | / , / 空格 等分隔都行
 *   · JSON 配置：base_url / api_key 等常见字段名，明文或 Base64 之后都行
 *   · 只给密钥、地址省略走官方：地址留空并标记「官方直连」
 *   · 裸域名（api.xxx.com，不带 http://）自动补 https://
 *   · 地址自动去掉 /v1、/chat/completions 等后缀（new-api 会自己拼）
 *   · AES：手动选「AES（口令）」并填口令。走 CryptoJS 的 OpenSSL 兼容口令模式
 *     （密文是 base64 的 Salted__ 格式，linux.do 上分享贴最常见的那种）。
 *     还有「AES 后再 Base64」应对套两层的。要别的模式告诉我再加。
 *
 * 已知取舍：站内链接、图片、静态资源会被过滤掉；实在认不出的在面板里手填。
 */

(function () {
  'use strict';

  /* ═══════════════════ 解析核心（可在 Node 里 require 单测） ═══════════════════ */

  const CORE = (function () {
    'use strict';

    const MAX_B64_LAYERS = 4;
    const KEY_MIN = 12;
    const KEY_MAX = 512;

    /* ───────── URL ───────── */

    const URL_RE = /https?:\/\/[^\s"'`<>()\[\]{}|\\，。；、：！？（）【】《》「」]+/gi;

    /*
     * 裸域名：至少两段 + 常见 TLD，可带端口和路径。
     * 组 1 是前导边界字符，组 2 才是域名本体。
     * 这里刻意不用后行断言 (?<!...)：正则字面量里的不支持语法会在解析期
     * 直接抛 SyntaxError，整个脚本一行都执行不到（Safari < 16.4、部分脚本猫
     * 内核都会踩）。用「捕获边界字符 + 手动回退 lastIndex」等价实现。
     */
    const BARE_HOST_RE =
      /(^|[^\w.@\/-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|cn|net|org|io|ai|dev|app|xyz|top|site|fun|cc|me|co|vip|tech|online|space|store|icu|link|live|pro|work|run|club|world|now|sh|gg|one|plus|cloud|api|de|us|uk|jp|ru|eu|tv|info|biz|edu|gov|moe|zone|host|press|wiki|team|group|center|company|network|systems|tools|ninja|red|blue|pink|black|white|green|art|design|studio|agency|digital|solutions|services|support|email|chat|life|love|fans|shop|mall|market|game|games|video|music|photo|news|blog|page|web|net\.cn|com\.cn|org\.cn|gov\.cn|edu\.cn|co\.uk|co\.jp|com\.hk|com\.tw)(?::\d{2,5})?(?:\/[^\s"'`<>()\[\]{}|\\，。；、：！？（）【】《》「」]*)?)/gi;

    const BLOCKED_URL_RE =
      /(?:^|\/\/)(?:[^/]*\.)?(?:linux\.do|discourse\.org|github\.com|githubusercontent\.com|gravatar\.com|google\.com|bing\.com|baidu\.com|zhihu\.com|bilibili\.com|youtube\.com|twitter\.com|x\.com|t\.me|telegram\.me|qq\.com|weixin\.qq\.com|docs?\.[^/]+)\/|\/(?:u|t|c|latest|top|badges|search|g|uploads|assets|images?|avatar)\/|user_avatar|letter_avatar|\.(?:png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|mp4|mp3|wav|zip|tar|gz|pdf)(?:[?#]|$)/i;

    // new-api 会自己补 /v1 和具体端点，这些尾巴要去掉。
    // 反复套用，能把 /v1/chat/completions 一路剥到域名。
    // 注意不剥 /api：openrouter.ai/api 这类上游确实需要它。
    const API_SUFFIX_RE =
      /\/+(?:chat\/+completions?|completions?|responses|messages|embeddings|models|generateContent|streamGenerateContent|v\d+(?:beta\d*)?)\/*$/i;

    function cleanUrl(raw) {
      let u = String(raw || '')
        .trim()
        .replace(/&amp;/gi, '&')
        .replace(/^[<("'`【（]+/, '')
        .replace(/[\s ]+$/, '')
        .replace(/[.,;:!?'"`)\]}>]+$/g, '')
        .replace(/[，。；：！？”》】、）」]+$/g, '');
      if (!u) return '';
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
      return u;
    }

    /** 去掉尾部 /v1、/chat/completions 之类，交给 new-api 自己拼 */
    function normalizeBaseUrl(raw) {
      let u = cleanUrl(raw);
      if (!u) return '';
      for (let i = 0; i < 3; i++) {
        const next = u.replace(API_SUFFIX_RE, '');
        if (next === u) break;
        u = next;
      }
      return u.replace(/\/+$/, '');
    }

    function isUsefulUrl(u) {
      if (!/^https?:\/\//i.test(u)) return false;
      if (BLOCKED_URL_RE.test(u)) return false;
      const host = (u.match(/^https?:\/\/([^/:?#]+)/i) || [, ''])[1];
      if (!host || !host.includes('.')) return false; // localhost / 内网名对别人没意义
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && /^(?:127|10|192|172)\./.test(host)) return false;
      return true;
    }

    /** 裸域名要更谨慎：像 API 端点才收 */
    function bareHostLooksLikeApi(s) {
      const host = s.split('/')[0].toLowerCase();
      if (/^(?:api|gpt|ai|llm|oai|openai|claude|gemini|chat|proxy|relay|hub|one|new)[.-]/.test(host)) return true;
      if (/\b(?:api|gpt|ai|llm|proxy|relay)\b/.test(host.replace(/[.-]/g, ' '))) return true;
      return /\/(?:v\d|api)\b/i.test(s);
    }

    /**
     * 扫出文本里的 URL。返回 [{url, index, end}]，url 已归一化。
     */
    function extractUrls(text) {
      const out = [];
      const seen = new Set();
      const spans = [];

      const push = (raw, index, end) => {
        const u = normalizeBaseUrl(raw);
        if (!u || !isUsefulUrl(u) || seen.has(u)) return;
        seen.add(u);
        out.push({ url: u, index, end });
      };

      URL_RE.lastIndex = 0;
      let m;
      while ((m = URL_RE.exec(text)) !== null) {
        spans.push([m.index, m.index + m[0].length]);
        push(m[0], m.index, m.index + m[0].length);
      }

      BARE_HOST_RE.lastIndex = 0;
      let b;
      while ((b = BARE_HOST_RE.exec(text)) !== null) {
        const host = b[2];
        const start = b.index + b[1].length;
        // 别把前导边界字符吃掉，否则紧邻的下一个域名会被跳过
        BARE_HOST_RE.lastIndex = start + host.length;
        if (spans.some(([a, z]) => start >= a && start < z)) continue; // 已在完整 URL 里
        if (!bareHostLooksLikeApi(host)) continue;
        push(host, start, start + host.length);
      }

      return out;
    }

    /* ───────── 密钥 ───────── */

    // 已知供应商前缀 → 官方地址省略时的渠道类型提示
    const KEY_PREFIX_HINTS = [
      { re: /^sk-ant-[A-Za-z0-9_\-]{20,}$/, vendor: 'Anthropic', official: 'https://api.anthropic.com' },
      { re: /^sk-proj-[A-Za-z0-9_\-]{20,}$/, vendor: 'OpenAI', official: 'https://api.openai.com' },
      { re: /^sk-or-v1-[A-Za-z0-9_\-]{20,}$/, vendor: 'OpenRouter', official: 'https://openrouter.ai/api' },
      { re: /^AIza[0-9A-Za-z_\-]{30,}$/, vendor: 'Gemini', official: 'https://generativelanguage.googleapis.com' },
      { re: /^xai-[A-Za-z0-9]{40,}$/, vendor: 'xAI', official: 'https://api.x.ai' },
      { re: /^gsk_[A-Za-z0-9]{40,}$/, vendor: 'Groq', official: 'https://api.groq.com/openai' },
      { re: /^(?:nvapi|nv)-[A-Za-z0-9_\-]{40,}$/, vendor: 'NVIDIA', official: 'https://integrate.api.nvidia.com' },
      { re: /^(?:r8_)[A-Za-z0-9]{30,}$/, vendor: 'Replicate', official: 'https://api.replicate.com' },
      { re: /^(?:hf_)[A-Za-z0-9]{30,}$/, vendor: 'HuggingFace', official: 'https://api-inference.huggingface.co' },
      { re: /^(?:tvly|tgp_v1)-[A-Za-z0-9_\-]{20,}$/, vendor: 'Together', official: 'https://api.together.xyz' },
      { re: /^sk-[A-Za-z0-9]{48,}$/, vendor: 'OpenAI', official: 'https://api.openai.com' },
      { re: /^sk-[A-Za-z0-9_\-]{16,}$/, vendor: '', official: '' }, // 中转站最常见，认不出厂商
    ];

    function keyPrefixHint(key) {
      for (const h of KEY_PREFIX_HINTS) if (h.re.test(key)) return h;
      return null;
    }

    // 正文里找带前缀的明文密钥
    const PREFIX_KEY_RE =
      /\b(?:sk-ant-|sk-proj-|sk-or-v1-|sk-|pk-|AIza|xai-|gsk_|r8_|hf_|tvly-|tgp_v1-|nvapi-|nv-|ghp_|github_pat_|glpat-|dop_v1_|fk[0-9]*-|cpk_|csk-)[A-Za-z0-9_\-]{14,}/g;

    const BEARER_RE = /\bBearer\s+["'`]?([A-Za-z0-9_\-.=+/]{14,})["'`]?/gi;

    const LABELED_RE =
      /(?:api[\s_-]?key|apikey|api[\s_-]?token|access[\s_-]?token|auth[\s_-]?token|secret[\s_-]?key|secret|token|key|密钥|秘钥|口令|凭证)\s*(?:[:：=]|是|为)\s*["'`]?([A-Za-z0-9_\-.=+/]{14,})["'`]?/gi;

    function isLikelyKey(v) {
      if (typeof v !== 'string') return false;
      const s = v.trim();
      if (s.length < KEY_MIN || s.length > KEY_MAX) return false;
      if (!/[A-Za-z]/.test(s)) return false; // 纯数字不是密钥
      if (!/^[A-Za-z0-9_\-.~+/=]+$/.test(s)) return false;
      if (/^https?:/i.test(s)) return false;
      if (/\.(?:com|cn|net|org|io|ai|dev|app|xyz|top)$/i.test(s)) return false; // 域名误判
      if (/^(?:https?|www|api|null|undefined|example|your|xxx+|todo|placeholder)$/i.test(s)) return false;
      return true;
    }

    /* ───────── Base64 ───────── */

    /** URL-safe → 标准字母表，去空白，补齐 padding */
    function normalizeB64(raw) {
      let s = String(raw || '').replace(/[\s\r\n]+/g, '');
      if (!s) return '';
      s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
      if (!/^[A-Za-z0-9+/]+$/.test(s)) return '';
      const pad = s.length % 4;
      if (pad === 1) return ''; // 不可能是合法 base64
      if (pad) s += '='.repeat(4 - pad);
      return s;
    }

    function looksLikeB64(raw) {
      const s = normalizeB64(raw);
      return s.length >= 16 && s.length % 4 === 0;
    }

    /** base64 → UTF-8 字符串，失败返回 null */
    function decodeB64(raw) {
      const s = normalizeB64(raw);
      if (!s) return null;
      let bin;
      try {
        bin = atob(s);
      } catch (e) {
        return null;
      }
      // atob 得到的是字节串，按 UTF-8 重新解释，否则中文会乱码
      try {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (e) {
        return bin;
      }
    }

    /** 解码结果是否像人写的文本，用来判断这一层解对了没 */
    function isPrintable(s) {
      if (!s || s.length < 4) return false;
      if (s.includes('�')) return false; // UTF-8 解坏了
      let bad = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13) continue;
        if (c < 32 || c === 127) bad++;
      }
      return bad === 0;
    }

    /* ───────── JSON 配置 ───────── */

    const JSON_URL_FIELDS = [
      'base_url', 'baseUrl', 'baseURL', 'api_base', 'apiBase', 'api_url', 'apiUrl',
      'api_base_url', 'apiBaseUrl', 'endpoint', 'url', 'host', 'server', 'proxy_url',
      'API地址', '地址', '接口地址',
    ];
    const JSON_KEY_FIELDS = [
      'api_key', 'apiKey', 'apikey', 'API_KEY', 'key', 'access_token', 'accessToken',
      'auth_token', 'authToken', 'token', 'secret_key', 'secretKey', 'secret', 'sk',
      '密钥', '秘钥', 'Authorization', 'authorization',
    ];

    function parseJsonMaybe(text) {
      const t = String(text || '').trim();
      if (!/^[[{]/.test(t)) return null;
      try {
        return JSON.parse(t);
      } catch (e) {
        return null;
      }
    }

    /** 递归找 {url, key}，同一层对象里的字段优先配成一对 */
    function collectFromJson(node, depth, out) {
      if (depth > 5 || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const it of node) collectFromJson(it, depth + 1, out);
        return;
      }
      let url = '';
      let key = '';
      for (const f of JSON_URL_FIELDS) {
        const v = node[f];
        if (typeof v === 'string' && v.trim()) {
          const u = normalizeBaseUrl(v);
          if (u && isUsefulUrl(u)) {
            url = u;
            break;
          }
        }
      }
      for (const f of JSON_KEY_FIELDS) {
        const v = node[f];
        if (typeof v !== 'string') continue;
        const raw = v.trim().replace(/^Bearer\s+/i, '');
        if (isLikelyKey(raw)) {
          key = raw;
          break;
        }
      }
      if (url || key) out.push({ url, key });
      for (const v of Object.values(node)) collectFromJson(v, depth + 1, out);
    }

    /* ───────── 单段文本求值 ───────── */

    /** 从文本里挖明文密钥（不含 base64 猜解）。返回 [{value, index}] */
    function findPlainKeys(text) {
      const out = [];
      const seen = new Set();
      const spans = extractUrls(text).map((u) => [u.index, u.end]);
      const insideUrl = (i) => spans.some(([a, z]) => i >= a && i < z);

      const add = (value, index) => {
        const v = String(value || '').replace(/^["'`]+|["'`]+$/g, '');
        if (!isLikelyKey(v) || seen.has(v) || insideUrl(index)) return;
        seen.add(v);
        out.push({ value: v, index });
      };

      for (const re of [PREFIX_KEY_RE, BEARER_RE, LABELED_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) add(m[1] !== undefined ? m[1] : m[0], m.index);
      }
      return out;
    }

    /** 整段去掉 URL 后剩下的第一个 token，用于「地址和密钥同一行」 */
    function firstTokenAfterUrls(text) {
      let rest = text;
      for (const u of extractUrls(text)) rest = rest.split(u.url).join(' ');
      rest = rest.replace(URL_RE, ' ');
      const parts = rest.split(/[\s,|;、，]+|(?:^|\s)-{2,}(?:\s|$)/).filter(Boolean);
      for (const p of parts) {
        const v = p.replace(/^["'`(<\[]+|["'`)>\],.。]+$/g, '').replace(/^Bearer\s+/i, '');
        if (isLikelyKey(v)) return v;
      }
      return '';
    }

    /** 整段本身就是个独立 token（代码块里孤零零一行密钥） */
    function standaloneToken(text) {
      const t = String(text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
      if (t.includes('\n') || /\s/.test(t)) return '';
      return isLikelyKey(t) ? t : '';
    }

    /* ───────── 多层 Base64 ───────── */

    /**
     * 判断一段（已解码的）文本能给出什么。分数越高越可信，用于在多层之间挑最优解。
     * @returns {{url:string,key:string,score:number,shape:string}|null}
     */
    function evaluateLayer(text) {
      const t = String(text || '').trim();
      if (!t) return null;

      // JSON 配置最可信：字段名自己说明了身份
      const json = parseJsonMaybe(t);
      if (json) {
        const hits = [];
        collectFromJson(json, 0, hits);
        const paired = hits.find((h) => h.url && h.key) || hits.find((h) => h.key) || hits.find((h) => h.url);
        if (paired) {
          return {
            url: paired.url || '',
            key: paired.key || '',
            score: paired.url && paired.key ? 100 : 80,
            shape: 'JSON',
          };
        }
      }

      const urls = extractUrls(t);
      const plain = findPlainKeys(t);

      // 地址 + 带前缀/带标注的密钥
      if (urls.length && plain.length) return { url: urls[0].url, key: plain[0].value, score: 95, shape: 'URL+KEY' };

      // 地址 + 剩余 token 当密钥
      if (urls.length) {
        const tok = firstTokenAfterUrls(t);
        if (tok) return { url: urls[0].url, key: tok, score: 75, shape: 'URL+KEY' };
      }

      // 只有密钥
      if (plain.length) {
        const hinted = keyPrefixHint(plain[0].value);
        return { url: '', key: plain[0].value, score: hinted ? 90 : 70, shape: 'KEY' };
      }

      // 整段就是一个 token：认出前缀才算高分，否则只作为兜底候选
      const solo = standaloneToken(t);
      if (solo) {
        const hinted = keyPrefixHint(solo);
        return { url: '', key: solo, score: hinted ? 88 : 40, shape: 'KEY' };
      }

      if (urls.length) return { url: urls[0].url, key: '', score: 20, shape: 'URL' };
      return null;
    }

    /**
     * 对一个疑似 base64 的 token 逐层解码，在「原文 + 每一层解码结果」里挑最可信的一层。
     * 这样 base64(无前缀密钥) 和 base64(base64(密钥)) 都能落到正确的层，
     * 不会把编码后的字符串本身当密钥。
     * @returns {{url:string,key:string,layer:number,shape:string}|null}
     */
    function analyzeB64Token(token) {
      const layers = [String(token || '').trim()];
      let cur = layers[0];
      for (let i = 0; i < MAX_B64_LAYERS; i++) {
        if (!looksLikeB64(cur)) break;
        const dec = decodeB64(cur);
        if (dec === null || !isPrintable(dec) || dec.trim() === cur.trim()) break;
        layers.push(dec.trim());
        cur = dec.trim();
      }

      let best = null;
      for (let layer = 0; layer < layers.length; layer++) {
        const ev = evaluateLayer(layers[layer]);
        if (!ev || !ev.key) continue;
        // 第 0 层是没解码的原文，本身又像 base64 的话可信度打折
        const score = layer === 0 && looksLikeB64(layers[0]) && !keyPrefixHint(ev.key) ? ev.score - 30 : ev.score;
        // 同分取更深的层：外层往往只是内层的编码壳
        if (!best || score > best.score || (score === best.score && layer > best.layer)) {
          best = { ...ev, score, layer };
        }
      }
      if (!best) return null;

      const method =
        best.layer === 0
          ? best.shape === 'JSON'
            ? 'JSON 配置'
            : '明文'
          : `${best.shape === 'URL+KEY' ? 'URL+密钥合并 ' : best.shape === 'JSON' ? 'JSON ' : ''}Base64×${best.layer}`;

      return { url: best.url, key: best.key, layer: best.layer, shape: best.shape, method };
    }

    /* ───────── 楼层级分析 ───────── */

    // 长 token 候选：标准或 URL-safe 字母表，两端不能挨着别的 token 字符。
    // 同样避开后行断言，组 1 是前导边界，组 2 是 token 本体。
    const B64_CANDIDATE_RE =
      /(^|[^A-Za-z0-9+/=_-])([A-Za-z0-9+/_-]{16,}={0,2})(?![A-Za-z0-9+/=_-])/g;

    /** 收集一段文本里的所有结果 */
    function analyzeText(text, hintUrls) {
      const results = [];
      const urls = extractUrls(text);
      const urlSpans = urls.map((u) => [u.index, u.end]);
      const insideUrl = (i) => urlSpans.some(([a, z]) => i >= a && i < z);

      const pool = [];
      for (const u of urls) pool.push({ url: u.url, index: u.index });
      for (const h of hintUrls || []) {
        const u = normalizeBaseUrl(h);
        if (u && isUsefulUrl(u) && !pool.some((p) => p.url === u)) {
          pool.push({ url: u, index: Number.MAX_SAFE_INTEGER });
        }
      }

      // 1) 整段是 JSON 配置
      const whole = evaluateLayer(text);
      if (whole && whole.shape === 'JSON' && whole.key) {
        results.push({ url: whole.url, key: whole.key, method: 'JSON 配置', index: 0 });
      }

      // 2) 明文密钥
      for (const k of findPlainKeys(text)) {
        results.push({ url: '', key: k.value, method: '明文', index: k.index });
      }

      // 3) base64 候选逐个试解
      B64_CANDIDATE_RE.lastIndex = 0;
      let m;
      while ((m = B64_CANDIDATE_RE.exec(text)) !== null) {
        const token = m[2];
        const at = m.index + m[1].length;
        B64_CANDIDATE_RE.lastIndex = at + token.length;
        if (insideUrl(at)) continue;
        const res = analyzeB64Token(token);
        if (!res || !res.key) continue;
        if (res.layer === 0 && results.some((r) => r.key === res.key)) continue; // 明文阶段已收
        results.push({ url: res.url, key: res.key, method: res.method, index: at, raw: token });
      }

      return { results, pool };
    }

    /**
     * 分析一层楼。
     * @param {{text:string, codeBlocks?:string[], linkUrls?:string[]}} post
     * @returns {{url:string,key:string,method:string,official:boolean,vendor:string}[]}
     */
    function analyzePost(post) {
      const raw = [];
      const pool = [];

      const merge = (part) => {
        raw.push(...part.results);
        for (const p of part.pool) if (!pool.some((q) => q.url === p.url)) pool.push(p);
      };

      // 代码块单独跑一遍：整块常常就是一个 base64 或一段 JSON
      for (const block of post.codeBlocks || []) {
        const solo = analyzeB64Token(block);
        if (solo && solo.key) raw.push({ url: solo.url, key: solo.key, method: solo.method, index: -1 });
        merge(analyzeText(block, []));
      }
      merge(analyzeText(post.text || '', post.linkUrls));

      // 给缺地址的密钥配地址：优先同段落最近的，其次楼层里唯一的
      const out = [];
      const seen = new Set();
      for (const r of raw) {
        if (!r.key) continue;
        let url = r.url;
        if (!url && pool.length) {
          let best = null;
          let bestD = Infinity;
          for (const p of pool) {
            const d = r.index >= 0 && p.index !== Number.MAX_SAFE_INTEGER ? Math.abs(r.index - p.index) : 1e12;
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
          if (best) url = best.url;
        }

        const hint = keyPrefixHint(r.key);
        const official = !url && !!hint && !!hint.official;
        const sig = JSON.stringify([url, r.key]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({
          url: url || '',
          key: r.key,
          method: r.method + (official ? ' · 官方直连' : ''),
          official,
          vendor: hint ? hint.vendor : '',
          // 原文留着，面板里可以换解密方式重解
          raw: r.raw || r.key,
        });
      }
      return out;
    }

    /* ───────── 手动指定解密方式 ───────── */

    const DECODE_METHODS = [
      { id: 'auto', label: '自动识别', pass: false },
      { id: 'plain', label: '明文', pass: false },
      { id: 'b64', label: 'Base64', pass: false },
      { id: 'b64x2', label: 'Base64×2', pass: false },
      { id: 'b64x3', label: 'Base64×3', pass: false },
      { id: 'aes', label: 'AES（口令）', pass: true },
      { id: 'aes-b64', label: 'AES 后再 Base64', pass: true },
    ];

    /** CryptoJS 走 @require 引入；拿不到就明确报错，不要静默失败 */
    function aesDecrypt(text, passphrase) {
      const CJS = typeof CryptoJS !== 'undefined' ? CryptoJS : null;
      if (!CJS) return { error: 'CryptoJS 没加载成功，检查 @require 是否被网络拦了' };
      if (!passphrase) return { error: '请填 AES 口令' };
      try {
        const out = CJS.AES.decrypt(String(text).trim(), passphrase).toString(CJS.enc.Utf8);
        if (!out) return { error: '解密结果为空，口令可能不对' };
        return { text: out };
      } catch (e) {
        return { error: 'AES 解密失败：' + (e && e.message ? e.message : e) };
      }
    }

    function decodeLayers(text, n) {
      let cur = String(text || '').trim();
      for (let i = 0; i < n; i++) {
        const dec = decodeB64(cur);
        if (dec === null) return { error: `第 ${i + 1} 层不是合法 Base64` };
        if (!isPrintable(dec)) return { error: `第 ${i + 1} 层解出来是乱码` };
        cur = dec.trim();
      }
      return { text: cur };
    }

    /**
     * 按指定方式解一段原文，取出 URL 和密钥。
     * @returns {{url:string,key:string,plain:string,note:string,error:string}}
     */
    function decodeWith(raw, method, passphrase) {
      const src = String(raw || '').trim();
      const blank = { url: '', key: '', plain: '', note: '', error: '' };
      if (!src) return { ...blank, error: '' };

      if (method === 'auto') {
        const res = analyzeB64Token(src);
        if (!res) return { ...blank, plain: src, error: '自动识别没找到密钥，换个方式试试' };
        return { url: res.url, key: res.key, plain: src, note: res.method, error: '' };
      }

      let step = { text: src };
      if (method === 'b64') step = decodeLayers(src, 1);
      else if (method === 'b64x2') step = decodeLayers(src, 2);
      else if (method === 'b64x3') step = decodeLayers(src, 3);
      else if (method === 'aes') step = aesDecrypt(src, passphrase);
      else if (method === 'aes-b64') {
        step = aesDecrypt(src, passphrase);
        if (!step.error) step = decodeLayers(step.text, 1);
      }
      if (step.error) return { ...blank, plain: '', error: step.error };

      const ev = evaluateLayer(step.text);
      if (!ev || !ev.key) {
        return { ...blank, plain: step.text, error: '解出来了但没认出密钥，可以手填下面两个框' };
      }
      return { url: ev.url, key: ev.key, plain: step.text, note: ev.shape, error: '' };
    }

    /* ───────── 输出成 new-api 剪贴板格式 ───────── */

    const CHANNEL_CONN_TYPE = 'newapi_channel_conn';
    const REMARK_MAX = 255;
    const NAME_MAX = 64;

    function activityUrl(username) {
      const u = String(username || '').trim().replace(/^@/, '');
      return u ? `https://linux.do/u/${encodeURIComponent(u)}/activity` : '';
    }

    /**
     * 备注三行：帖子 URL / 发密钥那层楼作者的最近活动 / API 地址。
     * 超 255 字符时从后往前丢，保证第一行一定在。
     */
    function buildRemark(topicUrl, username, url, official) {
      const lines = [
        topicUrl || '',
        activityUrl(username),
        url || (official ? '官方直连' : ''),
      ].filter(Boolean);
      let out = lines.join('\n');
      while (out.length > REMARK_MAX && lines.length > 1) {
        lines.pop();
        out = lines.join('\n');
      }
      return out.slice(0, REMARK_MAX);
    }

    function buildName(title, floor, vendor) {
      const base = String(title || 'linux.do').replace(/\s+/g, ' ').trim();
      const tail = `${vendor ? ' ' + vendor : ''}${floor ? ' #' + floor : ''}`;
      return (base.slice(0, Math.max(0, NAME_MAX - tail.length)) + tail).trim().slice(0, NAME_MAX);
    }

    /** new-api「添加渠道」识别的剪贴板 JSON */
    function buildChannelJson(rec) {
      const obj = { _type: CHANNEL_CONN_TYPE, key: rec.key || '', url: rec.url || '' };
      if (rec.name) obj.name = rec.name;
      if (rec.remark) obj.remark = rec.remark;
      return JSON.stringify(obj);
    }

    return {
      CHANNEL_CONN_TYPE,
      cleanUrl, normalizeBaseUrl, extractUrls, isUsefulUrl,
      isLikelyKey, keyPrefixHint, findPlainKeys,
      normalizeB64, looksLikeB64, decodeB64, isPrintable,
      parseJsonMaybe, standaloneToken, firstTokenAfterUrls,
      evaluateLayer, analyzeB64Token, analyzeText, analyzePost,
      DECODE_METHODS, decodeWith, decodeLayers, aesDecrypt,
      activityUrl, buildRemark, buildName, buildChannelJson,
    };
  })();

  /*
   * Node 单测入口。
   * 必须先排除浏览器再看 module：Discourse 自带 AMD/CommonJS 风格的 loader，
   * 页面里全局 module 是存在的，只判断 module 会让脚本在真实页面上直接 return。
   */
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
    return;
  }

  /* ═══════════════════════════════ 页面部分 ═══════════════════════════════ */

  const TAG = '[ld→newapi]';
  const VERSION = '0.3.0'; // 与文件头 @version 保持一致
  const LS_TARGET = 'ld-napi-target-url';

  /** GM_* 优先，装在别的管理器/被禁权限时退回 localStorage */
  const store = {
    get() {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(LS_TARGET, '') || '';
      } catch (e) {}
      try {
        return localStorage.getItem(LS_TARGET) || '';
      } catch (e) {
        return '';
      }
    },
    set(v) {
      try {
        if (typeof GM_setValue === 'function') return GM_setValue(LS_TARGET, v);
      } catch (e) {}
      try {
        localStorage.setItem(LS_TARGET, v);
      } catch (e) {}
    },
  };

  const onTopicPage = () => /^\/t\//i.test(location.pathname);

  /* ───────── 页面信息抽取 ───────── */

  function getTopicUrl() {
    const segs = location.pathname.split('/').filter(Boolean);
    // /t/{slug}/{id}[/{楼层}] —— 末尾两段都是数字时去掉楼层
    if (segs[0] === 't' && segs.length >= 4 && /^\d+$/.test(segs[segs.length - 1]) && /^\d+$/.test(segs[segs.length - 2])) {
      segs.pop();
    }
    return location.origin + '/' + segs.join('/');
  }

  function getTopicTitle() {
    const el = document.querySelector('#topic-title h1 a.fancy-title, #topic-title h1, h1.fancy-title');
    return ((el ? el.textContent : document.title) || '').replace(/\s+/g, ' ').trim();
  }

  /** 楼层里的正文纯文本，块级标签之间补换行，避免相邻元素粘成一坨 */
  function cookedText(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
    clone.querySelectorAll('p,div,pre,li,blockquote,h1,h2,h3,h4,td,tr').forEach((el) => {
      el.insertBefore(document.createTextNode('\n'), el.firstChild);
      el.appendChild(document.createTextNode('\n'));
    });
    return (clone.textContent || '').replace(/ /g, ' ').replace(/\r/g, '');
  }

  /** 取发帖人用户名，优先 data-user-card，其次 /u/xxx 链接 */
  function postUsername(article) {
    const card = article.querySelector('.names [data-user-card], [data-user-card]');
    const fromCard = card && card.getAttribute('data-user-card');
    if (fromCard) return fromCard.trim();
    const link = article.querySelector('.topic-meta-data a[href^="/u/"], .names a[href^="/u/"], a[href^="/u/"]');
    if (link) {
      const m = (link.getAttribute('href') || '').match(/^\/u\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    const nameEl = article.querySelector('.first.username, .names .username');
    return nameEl ? (nameEl.textContent || '').trim() : '';
  }

  function collectPosts() {
    const nodes = document.querySelectorAll('article[data-post-id], .topic-post[data-post-id]');
    const out = [];
    const seen = new Set();
    for (const el of nodes) {
      const id = el.getAttribute('data-post-id') || el.id || '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const cooked = el.querySelector('.cooked');
      if (!cooked) continue;
      const floor =
        Number(
          el.getAttribute('data-post-number') ||
            (el.querySelector('[data-post-number]') || { getAttribute: () => null }).getAttribute('data-post-number') ||
            ((el.id || '').match(/\d+$/) || [])[0],
        ) || 0;
      out.push({ el, cooked, floor, username: postUsername(el) });
    }
    return out;
  }

  function scan() {
    const topicUrl = getTopicUrl();
    const title = getTopicTitle();
    const records = [];
    for (const post of collectPosts()) {
      const text = cookedText(post.cooked);
      if (!text.trim()) continue;
      const codeBlocks = [...post.cooked.querySelectorAll('pre code, code, .spoiler, details')]
        .map((el) => (el.textContent || '').trim())
        .filter((s) => s && s.length < 8000);
      const linkUrls = [...post.cooked.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
      for (const f of CORE.analyzePost({ text, codeBlocks, linkUrls })) {
        records.push({ ...f, floor: post.floor, username: post.username });
      }
    }
    // 同一 key 只留第一次出现的楼层
    const seen = new Set();
    const unique = records
      .sort((a, b) => (a.floor || 0) - (b.floor || 0))
      .filter((r) => {
        if (seen.has(r.key)) return false;
        seen.add(r.key);
        return true;
      });

    // 楼主用户名：手动卡没有归属楼层，用它兜底填备注第二行
    let opUsername = '';
    let minFloor = Infinity;
    for (const p of collectPosts()) {
      if (p.floor && p.floor < minFloor) {
        minFloor = p.floor;
        opUsername = p.username;
      }
    }
    return { records: unique, topicUrl, title, opUsername };
  }

  /* ───────── 剪贴板 / 提示 ───────── */

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('ld-napi-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 2200);
  }

  /* ───────── 面板 ───────── */

  let state = { records: [], topicUrl: '', title: '' };

  /**
   * 只填了域名就补默认渠道页路径；已经带路径的按原样用。
   * classic 主题是 /console/channel，default 主题是 /channels，两边路径不同，
   * 所以让用户直接存自己那套的完整地址最稳。
   */
  function channelPageUrl(raw) {
    let v = String(raw || '').trim();
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
    try {
      const u = new URL(v);
      if (u.pathname && u.pathname !== '/') return u.toString();
      u.pathname = '/console/channel';
      return u.toString();
    } catch (e) {
      return v;
    }
  }

  function recordJson(rec, url, key) {
    return CORE.buildChannelJson({
      key,
      url,
      name: CORE.buildName(state.title, rec.floor, rec.vendor),
      remark: CORE.buildRemark(state.topicUrl, rec.username, url, rec.official),
    });
  }

  /* 小工具 */

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function labeledInput(parent, label, value, placeholder) {
    const wrap = el('label', 'ld-napi-field');
    wrap.appendChild(el('span', null, label));
    const input = el('input');
    input.value = value || '';
    input.placeholder = placeholder || '';
    input.spellcheck = false;
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }

  /**
   * 一张工作卡：原文 → 选解密方式 → 解出的 URL/密钥 → 备注预览 → 复制。
   * @param {object} rec 自动扫描出的记录；手动卡传 {manual:true}
   */
  function renderRow(rec) {
    const row = el('div', 'ld-napi-row');

    const meta = el('div', 'ld-napi-meta');
    meta.appendChild(
      el('span', 'ld-napi-floor', rec.manual ? '手动粘贴' : `#${rec.floor || '?'}${rec.username ? ' @' + rec.username : ''}`),
    );
    const badge = el('span', 'ld-napi-badge' + (rec.official ? ' ld-napi-badge-official' : ''), rec.method || '待解密');
    meta.appendChild(badge);
    row.appendChild(meta);

    // ── 原文 ──
    const rawWrap = el('label', 'ld-napi-field');
    rawWrap.appendChild(el('span', null, '原文 / 密文'));
    const rawInput = el('textarea');
    rawInput.value = rec.raw || '';
    rawInput.rows = 2;
    rawInput.spellcheck = false;
    rawInput.placeholder = '把密文粘进来，下面选解密方式';
    rawWrap.appendChild(rawInput);
    row.appendChild(rawWrap);

    // ── 解密方式 + 口令 ──
    const ctrl = el('div', 'ld-napi-ctrl');
    const sel = el('select');
    for (const m of CORE.DECODE_METHODS) {
      const opt = el('option', null, m.label);
      opt.value = m.id;
      sel.appendChild(opt);
    }
    sel.value = 'auto';
    const pass = el('input', 'ld-napi-pass');
    pass.placeholder = 'AES 口令';
    pass.spellcheck = false;
    ctrl.append(sel, pass);
    row.appendChild(ctrl);

    const hint = el('div', 'ld-napi-hint');
    row.appendChild(hint);

    // ── 解出来的结果 ──
    const urlInput = labeledInput(row, 'API地址（对应 new-api「API地址」）', rec.url, '留空 = 用渠道类型的官方地址');
    const keyInput = labeledInput(row, '密钥（对应 new-api「密钥」）', rec.key);

    // ── 备注预览 ──
    const preview = el('div', 'ld-napi-preview');
    row.appendChild(preview);

    const syncPreview = () => {
      preview.textContent = CORE.buildRemark(
        state.topicUrl,
        rec.username,
        urlInput.value.trim(),
        !urlInput.value.trim() && rec.official,
      );
    };

    const syncPassVisibility = () => {
      const m = CORE.DECODE_METHODS.find((x) => x.id === sel.value);
      pass.style.display = m && m.pass ? '' : 'none';
    };

    /** 按当前选择重解一次，回填下面两个框 */
    const redecode = () => {
      const res = CORE.decodeWith(rawInput.value, sel.value, pass.value);
      if (res.error) {
        hint.textContent = '⚠ ' + res.error;
        hint.className = 'ld-napi-hint ld-napi-hint-bad';
        // 一定要清空：留着上一次的旧值 + 一条警告，很容易让人把错的 key 复制走。
        // 框里的内容必须始终对应当前选中的解密方式。
        urlInput.value = '';
        keyInput.value = '';
      } else {
        urlInput.value = res.url || '';
        keyInput.value = res.key || '';
        hint.textContent = res.plain && res.plain !== rawInput.value.trim() ? '明文：' + res.plain.slice(0, 120) : '';
        hint.className = 'ld-napi-hint';
        badge.textContent = res.note || sel.value;
      }
      syncPreview();
    };

    sel.addEventListener('change', () => {
      syncPassVisibility();
      redecode();
    });
    pass.addEventListener('input', redecode);
    rawInput.addEventListener('input', redecode);
    urlInput.addEventListener('input', syncPreview);
    syncPassVisibility();
    syncPreview();

    const actions = el('div', 'ld-napi-actions');
    const mk = (text, primary, handler) => {
      const b = el('button', primary ? 'ld-napi-primary' : null, text);
      b.addEventListener('click', handler);
      actions.appendChild(b);
    };

    const currentJson = () =>
      recordJson(
        { ...rec, official: !urlInput.value.trim() && rec.official },
        urlInput.value.trim(),
        keyInput.value.trim(),
      );

    mk('复制配置', true, async () => {
      if (!keyInput.value.trim()) return toast('密钥是空的，先解密或手填');
      toast((await copyText(currentJson())) ? '已复制，去 new-api 打开「添加渠道」点自动填入' : '复制失败');
    });
    mk('复制并打开', false, async () => {
      if (!keyInput.value.trim()) return toast('密钥是空的，先解密或手填');
      const ok = await copyText(currentJson());
      const target = store.get().trim();
      if (!ok) return toast('复制失败');
      if (!target) return toast('已复制。先在顶部填 new-api 渠道页地址才能直接打开');
      window.open(channelPageUrl(target), '_blank', 'noopener');
      toast('已复制并打开 new-api');
    });
    row.appendChild(actions);
    return row;
  }

  function renderPanel() {
    const head = document.getElementById('ld-napi-head');
    const list = document.getElementById('ld-napi-list');
    if (!head || !list) return;
    head.textContent = `自动识别到 ${state.records.length} 条 · ${state.title || state.topicUrl}`;
    list.textContent = '';

    // 手动卡常驻第一位：自动识别不中的时候，直接往这儿粘密文
    list.appendChild(
      renderRow({
        manual: true,
        raw: '',
        url: '',
        key: '',
        username: state.opUsername,
        official: false,
        vendor: '',
      }),
    );

    if (!state.records.length) {
      list.appendChild(
        el('div', 'ld-napi-empty', '自动识别没找到东西。用上面那张卡手动粘密文，或往下滚加载更多楼层后点「重新扫描」。'),
      );
      return;
    }
    for (const rec of state.records) list.appendChild(renderRow(rec));
  }

  const STYLE = `
#ld-napi-fab{position:fixed;right:24px;bottom:88px;z-index:2147483000;width:46px;height:46px;border-radius:50%;
 border:1px solid #4a5058;background:#2a2f36;color:#fff;font-size:20px;cursor:pointer;display:flex;
 align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.45);transition:transform .15s}
#ld-napi-fab:hover{transform:scale(1.08)}
#ld-napi-fab .ld-napi-count{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9px;
 background:#e5484d;color:#fff;font-size:11px;line-height:18px;text-align:center;padding:0 4px;display:none}
#ld-napi-panel{position:fixed;right:24px;bottom:142px;z-index:2147483001;width:440px;max-width:calc(100vw - 32px);
 max-height:74vh;display:none;flex-direction:column;background:#1f2328;color:#e6e6e6;border:1px solid #3a3f46;
 border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.5);overflow:hidden;
 font:13px/1.5 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
#ld-napi-panel.open{display:flex}
#ld-napi-head{padding:10px 12px;border-bottom:1px solid #33383e;font-weight:600;word-break:break-all}
#ld-napi-bar{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #33383e;flex-wrap:wrap;align-items:center}
#ld-napi-bar button{padding:4px 10px;border-radius:6px;border:1px solid #4a5058;background:#2a2f36;
 color:#e6e6e6;cursor:pointer;font-size:12px}
#ld-napi-bar button:hover{background:#343a41}
#ld-napi-target{flex:1;min-width:150px;background:#17191c;border:1px solid #3a3f46;color:#e6e6e6;
 border-radius:6px;padding:4px 8px;font-size:12px}
#ld-napi-list{overflow-y:auto;padding:4px 12px 12px}
.ld-napi-empty{padding:22px 8px;color:#9aa1a9;text-align:center;line-height:1.7}
.ld-napi-row{border-bottom:1px solid #2c3138;padding:10px 0}
.ld-napi-row:last-child{border-bottom:none}
.ld-napi-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.ld-napi-floor{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ld-napi-badge{background:#25374a;color:#7db3e8;border-radius:4px;padding:0 6px;font-size:11px;
 line-height:18px;white-space:nowrap}
.ld-napi-badge-official{background:#3d3320;color:#e0b352}
.ld-napi-field{display:block;margin-bottom:6px}
.ld-napi-field span{display:block;color:#9aa1a9;font-size:11px;margin-bottom:2px}
.ld-napi-field input,.ld-napi-field textarea{width:100%;box-sizing:border-box;background:#17191c;
 border:1px solid #3a3f46;color:#e6e6e6;border-radius:6px;padding:4px 8px;
 font:12px Menlo,Consolas,monospace;resize:vertical}
.ld-napi-ctrl{display:flex;gap:6px;margin-bottom:6px}
.ld-napi-ctrl select{flex:0 0 auto;background:#17191c;border:1px solid #3a3f46;color:#e6e6e6;
 border-radius:6px;padding:4px 6px;font-size:12px}
.ld-napi-ctrl .ld-napi-pass{flex:1;min-width:0;background:#17191c;border:1px solid #3a3f46;
 color:#e6e6e6;border-radius:6px;padding:4px 8px;font:12px Menlo,Consolas,monospace}
.ld-napi-hint{font-size:11px;line-height:1.6;color:#8b949e;margin-bottom:6px;word-break:break-all}
.ld-napi-hint:empty{display:none}
.ld-napi-hint-bad{color:#e0a34d}
.ld-napi-preview{background:#17191c;border:1px dashed #3a3f46;border-radius:6px;padding:4px 8px;margin-bottom:6px;
 color:#8b949e;font:11px/1.6 Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.ld-napi-actions{display:flex;gap:6px}
.ld-napi-actions button{flex:1;padding:5px 10px;border-radius:6px;border:1px solid #4a5058;background:#2a2f36;
 color:#e6e6e6;cursor:pointer;font-size:12px}
.ld-napi-actions button.ld-napi-primary{border-color:#3d6b3f;background:#223527;color:#8fd69a}
.ld-napi-actions button:hover{filter:brightness(1.25)}
#ld-napi-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:2147483002;
 background:rgba(0,0,0,.86);color:#fff;padding:8px 16px;border-radius:8px;opacity:0;transition:opacity .25s;
 pointer-events:none;max-width:80vw;text-align:center;
 font:13px -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}
`;

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'ld-napi-fab';
    fab.title = '提取 API 渠道 → new-api';
    fab.textContent = '🔑';
    const count = document.createElement('span');
    count.className = 'ld-napi-count';
    fab.appendChild(count);

    const panel = document.createElement('div');
    panel.id = 'ld-napi-panel';
    const head = document.createElement('div');
    head.id = 'ld-napi-head';
    const bar = document.createElement('div');
    bar.id = 'ld-napi-bar';

    const target = document.createElement('input');
    target.id = 'ld-napi-target';
    target.placeholder = 'new-api 渠道页地址（可选）';
    target.value = store.get();
    target.spellcheck = false;
    target.addEventListener('change', () => {
      store.set(target.value.trim());
      toast('已记住 new-api 地址');
    });
    bar.appendChild(target);

    const mkBarBtn = (text, handler) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', handler);
      bar.appendChild(b);
    };
    mkBarBtn('重新扫描', () => rescan());
    mkBarBtn('关闭', () => panel.classList.remove('open'));

    const list = document.createElement('div');
    list.id = 'ld-napi-list';
    panel.append(head, bar, list);

    const toastEl = document.createElement('div');
    toastEl.id = 'ld-napi-toast';
    document.body.append(fab, panel, toastEl);

    fab.addEventListener('click', () => {
      if (panel.classList.toggle('open')) rescan();
    });
  }

  function rescan() {
    state = scan();
    renderPanel();
    const count = document.querySelector('#ld-napi-fab .ld-napi-count');
    if (count) {
      count.textContent = String(state.records.length);
      count.style.display = state.records.length ? 'block' : 'none';
    }
  }

  /** 只在帖子页显示按钮；Discourse 是 SPA，路由一变就要重新决定挂不挂 */
  function syncMount() {
    const mounted = !!document.getElementById('ld-napi-fab');
    if (onTopicPage()) {
      if (!mounted) buildUI();
      rescan();
      // 楼层常常在 document-idle 之后才渲染完，补一次让角标数字准
      setTimeout(() => {
        if (document.getElementById('ld-napi-fab')) rescan();
      }, 1500);
    } else if (mounted) {
      ['ld-napi-fab', 'ld-napi-panel', 'ld-napi-toast'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
    }
  }

  function init() {
    console.log(`${TAG} 已加载 v${VERSION} · ${location.pathname}`);
    syncMount();

    // 路由变化：pushState / replaceState 不触发任何原生事件，只能包一层
    let routeTimer = null;
    const onRoute = () => {
      clearTimeout(routeTimer);
      routeTimer = setTimeout(syncMount, 400);
    };
    for (const fn of ['pushState', 'replaceState']) {
      const orig = history[fn];
      history[fn] = function () {
        const r = orig.apply(this, arguments);
        onRoute();
        return r;
      };
    }
    window.addEventListener('popstate', onRoute);

    // 楼层懒加载：面板开着时重扫
    let scanTimer = null;
    new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        const panel = document.getElementById('ld-napi-panel');
        if (panel && panel.classList.contains('open')) rescan();
      }, 900);
    }).observe(document.body, { childList: true, subtree: true });

    // 排查用：控制台执行 __ldNapi.scan() 看抓到什么。
    // 有 @grant 时脚本跑在沙箱里，挂到 unsafeWindow 才能在页面控制台访问到。
    const dbg = { CORE, scan, rescan, syncMount, onTopicPage };
    try {
      if (typeof unsafeWindow !== 'undefined') unsafeWindow.__ldNapi = dbg;
    } catch (e) {}
    window.__ldNapi = dbg;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
