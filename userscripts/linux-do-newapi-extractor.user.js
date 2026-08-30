// ==UserScript==
// @name         Linux.do → new-api 渠道提取器
// @namespace    https://linux.do/
// @version      0.3.6
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
 *    自动识别有结果时这张卡默认收起，只留一行标题，免得每次都要滚过它才够得着自动结果；
 *    点那行标题可以随时展开或收起，自己点过之后重扫不会再改动它。
 *    地址那栏带下拉：帖子里没给地址（常见于只发密钥的官方号）时从预设里选一个官方地址，
 *    预设可以在面板里增删改，存在本地。想手打就选「— 手动填写 —」，选它不会清掉已填的值。
 *    注意同一个 key 可能对应多条地址，光看 key 分不出来，得知道对方发的是哪个套餐。
 *    OpenCode 就是这样：Zen（按量）和 Go（$10/月）共用一个 key，但网关和模型集不同。
 * 3. 回 new-api 打开「添加渠道」，顶部会提示「检测到剪贴板中的连接信息」，点「自动填入」，
 *    API 地址、密钥、名称、备注一次填好。
 * 4. 面板顶部可以存自己的 new-api 渠道页地址，之后用「复制并打开」少一步。
 *
 * 兼容性注意：脚本刻意不使用正则后行断言 (?<!...)。它在 Safari < 16.4 和部分
 * 脚本管理器内核上是解析期 SyntaxError，会导致整个脚本一行都不执行、且没有任何
 * 报错线索。改动本文件的正则时请不要重新引入。
 *
 * 渠道名格式：临时-<帖子标题> <厂商> #<楼层>，例如「临时-某站免费额度 OpenAI #3」。
 * 「临时-」前缀是固定的：论坛上捞的 key 随时会失效，靠名字前缀跟正式渠道区分开，
 * 列表按名字排序时也会自动聚成一堆，方便批量清理。标题过长会被截断，厂商和楼层号保留。
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
 *   · 被换行/空格拆开的密钥：前缀单独一行、密钥主体在下一行（sk- 换行 L94Rjw…）会自动拼回来，
 *     徽标写「已拼合换行」。拼合后被截断的那半截前缀不会再当成一条独立密钥
 *   · 只给密钥、地址省略走官方：仅当前缀能确定厂商时才填官方地址并标记「官方直连」。
 *     认得出的（sk-ant- / sk-proj- / AIza / xai- …）直接给地址；认不出厂商的裸密钥
 *     （OpenCode 的 sk- 加 64 位、各中转站）地址一律留空，不猜 —— 猜错的地址比空地址难查
 *   · 站内自建中转 hub.linux.do：密钥形如 ah- 加 64 位十六进制。这个前缀在 new-api 里
 *     没有对应渠道类型，地址留空会让 new-api 拿默认渠道类型的官方地址去请求，等于把
 *     密钥发给不相干的上游，所以地址由脚本按前缀补上，徽标写「已补网关地址」。
 *     这个地址也压过「同楼就近扫到的地址」——那只是就近猜的，猜到别的中转站上就把
 *     密钥发错了地方。帖子里给的是镜像域名时会被盖掉，在地址下拉的「本帖扫到的地址」
 *     里选回来即可
 *   · 插了中文干扰字的密钥：sk-0ZHm删IbHa除UNbcT我… 这种靠人眼读掉中文的反爬写法，
 *     自动剔掉中文再还原。明文、Base64 密文本身、以及解到第 1/2/3 层才出现中文的，
 *     每一层都会剔一次。剔了什么会写在卡片徽标和提示行里，方便核对
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
     *
     * TLD 里带 do 是为了站内自建的中转（hub.linux.do），帖子里多半不写 https://。
     * 看着像会把满页的 linux.do 链接一起捞进来，其实进不来：裸域名还要过
     * bareHostLooksLikeApi，linux.do / www.linux.do / connect.linux.do 都不像
     * API 端点，只有 hub. 这类前缀能过；带路径的（linux.do/t/123）由
     * BLOCKED_URL_RE 再兜一道。
     */
    const BARE_HOST_RE =
      /(^|[^\w.@\/-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|cn|net|org|io|ai|dev|do|app|xyz|top|site|fun|cc|me|co|vip|tech|online|space|store|icu|link|live|pro|work|run|club|world|now|sh|gg|one|plus|cloud|api|de|us|uk|jp|ru|eu|tv|info|biz|edu|gov|moe|zone|host|press|wiki|team|group|center|company|network|systems|tools|ninja|red|blue|pink|black|white|green|art|design|studio|agency|digital|solutions|services|support|email|chat|life|love|fans|shop|mall|market|game|games|video|music|photo|news|blog|page|web|net\.cn|com\.cn|org\.cn|gov\.cn|edu\.cn|co\.uk|co\.jp|com\.hk|com\.tw)(?::\d{2,5})?(?:\/[^\s"'`<>()\[\]{}|\\，。；、：！？（）【】《》「」]*)?)/gi;

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

    /* ───────── 干扰字 ───────── */

    /*
     * linux.do 上常见的反爬手法：往密钥/密文里插中文，靠人眼读掉。
     * 比如 sk-0ZHmIbHa删UNbcT除sHTWbuW我e9UfR2OoW44K删qcmzehxDEtDfgqbD删，
     * 插进去的字连起来往往就是「删除我」这种提示语。
     * 这类字符不可能出现在合法密钥或 base64 里，遇到就整段剔掉再判断。
     * 只对「单个 token」做剔除，绝不对整段正文做，否则中英混排的正文会被粘成一坨。
     *
     * 字符集用 \uXXXX 转义写，不要把这些字符原样贴进正则字面量：U+2028/U+2029 是行终止符，
     * 正则字面量里不允许出现，会变成解析期 SyntaxError，整个脚本一行都执行不到
     * （和文件头说的后行断言是同一类坑）。
     * 覆盖：中日韩文字与标点、全角形、谚文，以及零宽 / 双向控制 / BOM 这些隐形字符。
     */
    const NOISE_SRC =
      '[\\u00a0\\u00ad\\u180e\\u2000-\\u200f\\u2028-\\u202e\\u2060-\\u2064' +
      '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff' +
      '\\uac00-\\ud7af\\uf900-\\ufaff\\ufe0e\\ufe0f\\ufeff\\uff00-\\uffef]';
    const NOISE_RE = new RegExp(NOISE_SRC, 'g');

    function stripNoise(s) {
      return String(s || '').replace(NOISE_RE, '');
    }

    /** 被剔掉的字符，去重保序，用于在界面上说明「剔了什么」 */
    function noiseChars(raw) {
      const hits = String(raw || '').match(NOISE_RE);
      return hits ? [...new Set(hits)].join('') : '';
    }

    /* ───────── 密钥 ───────── */

    /*
     * 已知供应商前缀 → 地址省略时怎么补。两种补法，语义不同，别混：
     *
     *   official: new-api 自己有这个渠道类型，地址可以留空由它填。脚本只在备注里
     *             写「官方直连」做个记录，不往地址栏塞值。
     *   gateway:  前缀唯一对应一个第三方网关，而 new-api 没有对应渠道类型 ——
     *             地址留空会让 new-api 拿别的渠道类型的官方地址去请求（默认落到
     *             OpenAI），密钥就发给了不该发的人。这类必须由脚本把地址填出来。
     */
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
      /*
       * linux.do 站内自建的中转，密钥形如 ah- 加 64 位小写十六进制。
       * 卡 hex 而不是 [A-Za-z0-9]：`ah-` 是个太普通的字母组合，开区间会把
       * 「ah-hahahaha…」这类正文吃进来当密钥；hex 一卡，字母表里只剩 a-f，
       * 正常英文词过不了。长度写 {32,} 留点余量，样本只见过 64 位。
       */
      { re: /^ah-[0-9a-f]{32,}$/i, vendor: 'LinuxDo Hub', official: '', gateway: 'https://hub.linux.do' },
      /*
       * OpenAI 旧格式密钥是「sk- 加正好 48 位」，所以这里是 {48} 而不是 {48,}。
       * 写成开区间会把所有更长的裸 sk- 密钥一起吃掉（OpenCode 的是 sk- 加 64 位，
       * 中转站也随便发），然后按 OpenAI 官方直连处理：地址填 api.openai.com、
       * 渠道名尾巴加「OpenAI」、备注第三行写「官方直连」，全是错的且不好察觉。
       * 更长的裸 sk- 一律落到下面那条认不出厂商的兜底行，地址留空，交给地址下拉里的预设。
       */
      { re: /^sk-[A-Za-z0-9]{48}$/, vendor: 'OpenAI', official: 'https://api.openai.com' },
      { re: /^sk-[A-Za-z0-9_\-]{16,}$/, vendor: '', official: '' }, // 中转站最常见，认不出厂商
    ];

    function keyPrefixHint(key) {
      for (const h of KEY_PREFIX_HINTS) if (h.re.test(key)) return h;
      return null;
    }

    // 正文里找带前缀的明文密钥
    /*
     * 这里只管「像不像密钥的开头」，一律写宽。`ah-` 这种普通字母组合可能把
     * 「ah-hahahaha…」之类的正文捞进来，但那条候选拿不到 vendor 也拿不到 gateway
     * （KEY_PREFIX_HINTS 那边卡了 hex），最多在面板上多出一张空厂商的卡，
     * 不会把密钥发到错地址。收窄反而会漏 —— 前缀后面紧跟换行或干扰字时，
     * 任何「下一个字符必须是 hex」的断言都会让 SPLIT/NOISY 两条路径直接不匹配。
     */
    const KEY_PREFIX_SRC =
      '(?:sk-ant-|sk-proj-|sk-or-v1-|sk-|pk-|AIza|xai-|gsk_|r8_|hf_|tvly-|tgp_v1-|nvapi-|nv-|ghp_|github_pat_|glpat-|dop_v1_|fk[0-9]*-|cpk_|csk-|ah-)';
    const PREFIX_KEY_RE = new RegExp('\\b' + KEY_PREFIX_SRC + '[A-Za-z0-9_\\-]{14,}', 'g');

    /*
     * 带干扰字的明文密钥：前缀之后允许「密钥字符」和「短串干扰字」交替出现。
     * 干扰字每段最多 4 个，且后面必须还接着密钥字符 —— 这样密钥后面紧跟的
     * 整句中文说明不会被吃进来，匹配一定以密钥字符收尾。
     * 只是「候选」，还要 stripNoise 之后再过一遍 isLikelyKey + 前缀校验才算数。
     */
    const NOISY_PREFIX_KEY_RE = new RegExp(
      '\\b' + KEY_PREFIX_SRC + '[A-Za-z0-9_\\-]{1,}(?:' + NOISE_SRC + '{1,4}[A-Za-z0-9_\\-]{1,}){1,}',
      'g',
    );

    // 剔完干扰字必须整条就是「已知前缀 + 足够长的密钥体」，才认这是被插了字的密钥
    const WHOLE_PREFIX_KEY_RE = new RegExp('^' + KEY_PREFIX_SRC + '[A-Za-z0-9_\\-]{14,}$');

    /*
     * 前缀和密钥体被空白切开：
     *     sk-
     *     L94RjwBZdclpxlU3ehmVaTajTXPujxdu…
     * 帖子里换行贴、或者 cookedText 在块级标签之间补了换行，都会长这样。
     * 空白在正文里是真正的分隔符，不能像中文干扰字那样一概剔掉，所以单开一条规则：
     * 每段空白最多 8 个字符（够跨 <p> 补出来的连续换行），空白之后的每一段必须
     * ≥16 个字符 —— 正文里的词没这么长，「sk- 后面跟一句说明再跟个短单词」进不来。
     * 分行和插中文可能同时用上，所以段内也允许夹干扰字。但每段第一个字符必须是密钥字符：
     * 这样「sk- 然后一句中文说明」进不来，而「sk- 换行 L94Rjw删BZdcl…」认得出。
     */
    const SPLIT_CHUNK = '[A-Za-z0-9_\\-](?:[A-Za-z0-9_\\-]|' + NOISE_SRC + '){15,}';
    const SPLIT_PREFIX_KEY_RE = new RegExp(
      '\\b' + KEY_PREFIX_SRC + '[A-Za-z0-9_\\-]*(?:\\s{1,8}' + SPLIT_CHUNK + '){1,6}',
      'g',
    );

    /** 剔掉的量不能超过剔完长度的 40%，否则更像是把中文正文粘进来了 */
    function noiseWithinBudget(raw, cleaned) {
      return raw.length - cleaned.length <= cleaned.length * 0.4;
    }

    const BEARER_RE = /\bBearer\s+["'`]?([A-Za-z0-9_\-.=+/]{14,})["'`]?/gi;

    const LABELED_RE =
      /(?:api[\s_-]?key|apikey|api[\s_-]?token|access[\s_-]?token|auth[\s_-]?token|secret[\s_-]?key|secret|token|key|密钥|秘钥|口令|凭证)\s*(?:[:：=]|是|为)\s*["'`]?([A-Za-z0-9_\-.=+/]{14,})["'`]?/gi;

    function isLikelyKey(v) {
      if (typeof v !== 'string') return false;
      const s = v.trim();
      if (s.length < KEY_MIN || s.length > KEY_MAX) return false;
      if (!/[A-Za-z]/.test(s)) return false; // 纯数字不是密钥
      /*
       * 「几个字母 + 一长串数字」是截图文件名的形状，不是密钥：QQ_1788069516515、
       * IMG_20260830123045、Screenshot_1788069148417 都长这样。这里卡的是字母的绝对个数
       * 而不是字母占比 —— 纯十六进制密钥的字母占比能低到 25% 左右，按占比划线得在很窄的
       * 区间里取值，稍微一偏就开始杀真密钥；文件名前缀则集中在 2-4 个字母，两拨样本在
       * 绝对个数上隔着一条明显的空档，卡这里稳得多。
       */
      const letters = (s.match(/[A-Za-z]/g) || []).length;
      const digits = (s.match(/[0-9]/g) || []).length;
      if (letters <= 3 && digits >= 10) return false;
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
      let noise = '';
      for (const f of JSON_KEY_FIELDS) {
        const v = node[f];
        if (typeof v !== 'string') continue;
        const raw = v.trim().replace(/^Bearer\s+/i, '');
        if (isLikelyKey(raw)) {
          key = raw;
          break;
        }
        // 字段值里插了中文的也认，形状对得上才收
        const cleaned = stripNoise(raw);
        if (cleaned !== raw && WHOLE_PREFIX_KEY_RE.test(cleaned) && noiseWithinBudget(raw, cleaned)) {
          key = cleaned;
          noise = noiseChars(raw);
          break;
        }
      }
      if (url || key) out.push({ url, key, noise });
      for (const v of Object.values(node)) collectFromJson(v, depth + 1, out);
    }

    /* ───────── 单段文本求值 ───────── */

    /** 从文本里挖明文密钥（不含 base64 猜解）。返回 [{value, index, raw, noise}] */
    function findPlainKeys(text) {
      const out = [];
      const seen = new Set();
      const spans = extractUrls(text).map((u) => [u.index, u.end]);
      const insideUrl = (i) => spans.some(([a, z]) => i >= a && i < z);

      const add = (value, index, raw, split) => {
        const v = String(value || '').replace(/^["'`]+|["'`]+$/g, '');
        if (!isLikelyKey(v) || seen.has(v) || insideUrl(index)) return;
        seen.add(v);
        const src = raw === undefined ? v : raw;
        out.push({ value: v, index, raw: src, noise: noiseChars(src), split: !!split });
      };

      for (const re of [PREFIX_KEY_RE, BEARER_RE, LABELED_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) add(m[1] !== undefined ? m[1] : m[0], m.index);
      }

      /*
       * 插了中文的密钥。放在干净的几轮之后：万一同一段里两种形状都能匹配，
       * 先收的仍然是没动过的那条，剔字版本作为另一条候选并存，让用户自己挑。
       */
      NOISY_PREFIX_KEY_RE.lastIndex = 0;
      let n;
      while ((n = NOISY_PREFIX_KEY_RE.exec(text)) !== null) {
        const cleaned = stripNoise(n[0]);
        if (!WHOLE_PREFIX_KEY_RE.test(cleaned) || !noiseWithinBudget(n[0], cleaned)) continue;
        add(cleaned, n.index, n[0]);
      }

      /*
       * 前缀被空白切开的密钥。同样是拼完必须整条对得上形状才收。
       * 不拼的那条（只有密钥体、丢了前缀）另有来路，两条并存交给用户挑；
       * 实际上短的那条通常会被 analyzePost 的碎片规则丢掉，因为它是长的子串。
       */
      SPLIT_PREFIX_KEY_RE.lastIndex = 0;
      let s;
      while ((s = SPLIT_PREFIX_KEY_RE.exec(text)) !== null) {
        const nowsp = s[0].replace(/\s+/g, '');
        const joined = stripNoise(nowsp);
        if (!WHOLE_PREFIX_KEY_RE.test(joined) || !noiseWithinBudget(nowsp, joined)) continue;
        add(joined, s.index, s[0], true);
      }
      return out;
    }

    /**
     * 整段去掉 URL 后剩下的第一个 token，用于「地址和密钥同一行」。
     * @returns {{value:string, noise:string}}
     */
    function firstTokenAfterUrls(text) {
      let rest = text;
      for (const u of extractUrls(text)) rest = rest.split(u.url).join(' ');
      rest = rest.replace(URL_RE, ' ');
      const parts = rest.split(/[\s,|;、，]+|(?:^|\s)-{2,}(?:\s|$)/).filter(Boolean);
      for (const p of parts) {
        const v = p.replace(/^["'`(<\[]+|["'`)>\],.。]+$/g, '').replace(/^Bearer\s+/i, '');
        if (isLikelyKey(v)) return { value: v, noise: '' };
        // token 里插了中文：剔掉再看，形状对得上才认
        const cleaned = stripNoise(v);
        if (cleaned !== v && WHOLE_PREFIX_KEY_RE.test(cleaned) && noiseWithinBudget(v, cleaned)) {
          return { value: cleaned, noise: noiseChars(v) };
        }
      }
      return { value: '', noise: '' };
    }

    /**
     * 整段本身就是个独立 token（代码块里孤零零一行密钥）。
     * 插了中文的也算：这类整块密文/密钥剔字之后往往就直接是密钥了。
     * @returns {{value:string, noise:string}}
     */
    function standaloneToken(text) {
      const t = String(text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
      if (t.includes('\n') || /\s/.test(t)) return { value: '', noise: '' };
      if (isLikelyKey(t)) return { value: t, noise: '' };
      const cleaned = stripNoise(t);
      if (cleaned !== t && isLikelyKey(cleaned) && noiseWithinBudget(t, cleaned)) {
        return { value: cleaned, noise: noiseChars(t) };
      }
      return { value: '', noise: '' };
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
            noise: paired.noise || '',
          };
        }
      }

      const urls = extractUrls(t);
      const plain = findPlainKeys(t);

      // 地址 + 带前缀/带标注的密钥
      if (urls.length && plain.length) {
        return {
          url: urls[0].url,
          key: plain[0].value,
          score: 95,
          shape: 'URL+KEY',
          noise: plain[0].noise,
          split: plain[0].split,
        };
      }

      // 地址 + 剩余 token 当密钥
      if (urls.length) {
        const tok = firstTokenAfterUrls(t);
        if (tok.value) return { url: urls[0].url, key: tok.value, score: 75, shape: 'URL+KEY', noise: tok.noise };
      }

      // 只有密钥
      if (plain.length) {
        const hinted = keyPrefixHint(plain[0].value);
        return {
          url: '',
          key: plain[0].value,
          score: hinted ? 90 : 70,
          shape: 'KEY',
          noise: plain[0].noise,
          split: plain[0].split,
        };
      }

      // 整段就是一个 token：认出前缀才算高分，否则只作为兜底候选
      const solo = standaloneToken(t);
      if (solo.value) {
        const hinted = keyPrefixHint(solo.value);
        return { url: '', key: solo.value, score: hinted ? 88 : 40, shape: 'KEY', noise: solo.noise };
      }

      if (urls.length) return { url: urls[0].url, key: '', score: 20, shape: 'URL', noise: '' };
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
      // 每一层解出来都可能又被插了中文，所以每层都要先剔一次再当 base64 试解
      let stripped = '';
      let cur = layers[0];
      for (let i = 0; i < MAX_B64_LAYERS; i++) {
        let src = cur;
        if (!looksLikeB64(src)) {
          const cleaned = stripNoise(src);
          if (cleaned === src || !looksLikeB64(cleaned)) break;
          stripped += noiseChars(src);
          src = cleaned;
        }
        const dec = decodeB64(src);
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

      // 干扰字可能出现在密文层（上面剔的）也可能出现在最终密钥里（evaluateLayer 剔的）
      const noise = [...new Set((stripped + (best.noise || '')).split(''))].join('');
      return { url: best.url, key: best.key, layer: best.layer, shape: best.shape, method, noise };
    }

    /* ───────── 楼层级分析 ───────── */

    // 长 token 候选：标准或 URL-safe 字母表，两端不能挨着别的 token 字符。
    // 同样避开后行断言，组 1 是前导边界，组 2 是 token 本体。
    const B64_CANDIDATE_RE =
      /(^|[^A-Za-z0-9+/=_-])([A-Za-z0-9+/_-]{16,}={0,2})(?![A-Za-z0-9+/=_-])/g;

    /*
     * 插了中文的 base64 密文。上面那条会在第一个中文处断开，只截到一小段，
     * 所以另开一条允许跨中文的：base64 字符和短串干扰字交替，必须以 base64 字符收尾。
     */
    const NOISY_B64_CANDIDATE_RE = new RegExp(
      '(^|[^A-Za-z0-9+/=_-])((?:[A-Za-z0-9+/_-]{2,}' +
        NOISE_SRC +
        '{1,4}){1,}[A-Za-z0-9+/_-]{2,}={0,2})(?![A-Za-z0-9+/=_-])',
      'g',
    );

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
        results.push({ url: whole.url, key: whole.key, method: 'JSON 配置', index: 0, noise: whole.noise });
      }

      // 2) 明文密钥（含插了中文的、前缀被空白切开的）
      for (const k of findPlainKeys(text)) {
        results.push({
          url: '',
          key: k.value,
          method: '明文',
          index: k.index,
          raw: k.raw,
          noise: k.noise,
          split: k.split,
        });
      }

      // 3) base64 候选逐个试解，干净的和插了中文的各扫一遍
      for (const re of [B64_CANDIDATE_RE, NOISY_B64_CANDIDATE_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const token = m[2];
          const at = m.index + m[1].length;
          re.lastIndex = at + token.length;
          if (insideUrl(at)) continue;
          const res = analyzeB64Token(token);
          if (!res || !res.key) continue;
          if (res.layer === 0 && results.some((r) => r.key === res.key)) continue; // 明文阶段已收
          results.push({ url: res.url, key: res.key, method: res.method, index: at, raw: token, noise: res.noise });
        }
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
        if (solo && solo.key) {
          raw.push({ url: solo.url, key: solo.key, method: solo.method, index: -1, raw: block, noise: solo.noise });
        }
        merge(analyzeText(block, []));
      }
      merge(analyzeText(post.text || '', post.linkUrls));

      /*
       * 干扰字把密钥切成了几段，其中够长的那段自己也像个 token，会被当成独立密钥收进来
       * （比如 sk-…删qcmzehxDEtDfgqbD 的尾巴 qcmzehxDEtDfgqbD）。
       * 已经有更长的密钥包含它、它自己又认不出前缀，就是碎片，丢掉。
       */
      const allKeys = raw.map((r) => r.key).filter(Boolean);
      const isFragment = (key) =>
        !keyPrefixHint(key) && allKeys.some((k) => k.length > key.length && k.includes(key));

      /*
       * 前缀被空白切开时，第一段自己也可能够长、够形状，被当成一条独立密钥收进来
       * （sk-L94RjwBZdclpxlU3 换行 ehmVaTaj… 的第一段就是）。它是被截断的半截密钥，
       * 拿去用一定失败，所以直接丢掉。只丢「确实是某条拼合结果的第一段」的，
       * 不按「谁是谁的前缀」一概而论 —— 那样万一拼错了会把对的那条也带走。
       */
      const truncated = new Set();
      for (const r of raw) {
        if (!r.split || !r.raw) continue;
        const head = stripNoise(String(r.raw).split(/\s+/)[0] || '');
        if (head && head !== r.key) truncated.add(head);
      }

      // 给缺地址的密钥配地址：优先同段落最近的，其次楼层里唯一的
      const out = [];
      const seen = new Set();
      for (const r of raw) {
        if (!r.key || isFragment(r.key) || truncated.has(r.key)) continue;
        const hint = keyPrefixHint(r.key);
        let url = r.url;
        /*
         * 地址来源按可信度排：① 跟密钥结构上成对的（JSON 同层字段、合并编码同一段密文）
         * ② 前缀唯一对应的网关 ③ 楼层里就近的地址。
         *
         * 网关压过 ③ 而不是反过来。③ 的全部依据只是「这一楼里离得最近」，没有距离上限，
         * 一楼里另外提了个中转站，ah- 密钥就会被配到那个站去 —— 等于把密钥发给不相干的
         * 上游。而 ② 是密钥形状定死的，hub 的密钥发回 hub 最多是入口选得不对。
         *
         * 代价是帖子里给了镜像域名时会被网关盖掉。这个换不掉：明文密钥一律不带 url
         * （见 analyzeText 第 2 条），「同一行的地址」和「隔了三行的地址」在这里是同一个
         * 就近猜测，代码分不出哪个是这条密钥的。需要镜像的话，帖子里扫到的地址都在
         * 地址下拉的「本帖扫到的地址」分组里，选一下就好。
         */
        if (!url && hint && hint.gateway) url = hint.gateway;
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

        const official = !url && !!hint && !!hint.official;
        // 地址是脚本按前缀补的、不是帖子里写的，徽标要说出来，好让人核对
        const gatewayFilled = !r.url && !!hint && !!hint.gateway && url === hint.gateway;
        const sig = JSON.stringify([url, r.key]);
        if (seen.has(sig)) continue;
        seen.add(sig);
        const noise = r.noise || '';
        const split = !!r.split;
        out.push({
          url: url || '',
          key: r.key,
          method:
            r.method +
            (split ? ' · 已拼合换行' : '') +
            (noise ? ' · 已剔干扰字' : '') +
            (official ? ' · 官方直连' : '') +
            (gatewayFilled ? ' · 已补网关地址' : ''),
          official,
          vendor: hint ? hint.vendor : '',
          // 剔掉的干扰字，界面上要能看到剔了什么，好让人核对
          noise,
          split,
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

    /** 每层都先剔一次干扰字再解，返回一路上剔掉的字符 */
    function decodeLayers(text, n) {
      let cur = String(text || '').trim();
      let stripped = '';
      for (let i = 0; i < n; i++) {
        let src = cur;
        if (!looksLikeB64(src)) {
          const cleaned = stripNoise(src);
          if (cleaned !== src && looksLikeB64(cleaned)) {
            stripped += noiseChars(src);
            src = cleaned;
          }
        }
        const dec = decodeB64(src);
        if (dec === null) return { error: `第 ${i + 1} 层不是合法 Base64` };
        if (!isPrintable(dec)) return { error: `第 ${i + 1} 层解出来是乱码` };
        cur = dec.trim();
      }
      return { text: cur, noise: [...new Set(stripped.split(''))].join('') };
    }

    /**
     * 按指定方式解一段原文，取出 URL 和密钥。
     * @returns {{url:string,key:string,plain:string,note:string,error:string}}
     */
    function decodeWith(raw, method, passphrase) {
      const src = String(raw || '').trim();
      const blank = { url: '', key: '', plain: '', note: '', noise: '', split: false, error: '' };
      if (!src) return { ...blank, error: '' };

      if (method === 'auto') {
        // 整段可能就是「sk- 换行 密钥体」，analyzeB64Token 只看单 token，所以先直接问一遍整段
        const whole = evaluateLayer(src);
        if (whole && whole.key && whole.split) {
          return {
            url: whole.url,
            key: whole.key,
            plain: src,
            note: whole.shape,
            noise: whole.noise || '',
            split: true,
            error: '',
          };
        }
        const res = analyzeB64Token(src);
        if (!res) return { ...blank, plain: src, error: '自动识别没找到密钥，换个方式试试' };
        return {
          url: res.url,
          key: res.key,
          plain: src,
          note: res.method,
          noise: res.noise || '',
          split: false,
          error: '',
        };
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
      // 干扰字可能在密文层（decodeLayers 剔的）也可能在解出来的密钥里（evaluateLayer 剔的）
      const noise = [...new Set(((step.noise || '') + (ev.noise || '')).split(''))].join('');
      return { url: ev.url, key: ev.key, plain: step.text, note: ev.shape, noise, split: !!ev.split, error: '' };
    }

    /* ───────── API地址预设 ───────── */

    /*
     * 认不出厂商、或者厂商在 new-api 里压根没有对应渠道类型时，地址只能手打。
     * 这里给一份常用官方地址，界面上做成下拉直接选。
     * 地址一律填到「new-api 会自己往后拼 /v1/... 」的那一层：
     * new-api 是 baseURL + /v1/chat/completions 直接拼的，所以 OpenCode Zen 的
     * https://opencode.ai/zen/v1/chat/completions 这里要写成 https://opencode.ai/zen。
     *
     * OpenCode 有两个套餐，两条地址都要留：
     *   Zen（按量付费）https://opencode.ai/zen      → 官方 /zen/v1
     *   Go （$10/月订阅）https://opencode.ai/zen/go  → 官方 /zen/go/v1
     * Go 是挂在 zen 下面的独立网关，不是笔误：两边模型集不一样（Go 只有开源系那几十个，
     * 有一半 Zen 没有），但共用同一个 OPENCODE_API_KEY。所以光看 key 认不出该用哪条，
     * 只能让人自己选 —— 这也是这个下拉存在的理由。
     */
    const DEFAULT_URL_PRESETS = [
      { name: 'OpenAI', url: 'https://api.openai.com' },
      { name: 'Anthropic', url: 'https://api.anthropic.com' },
      { name: 'Gemini', url: 'https://generativelanguage.googleapis.com' },
      { name: 'OpenRouter', url: 'https://openrouter.ai/api' },
      { name: 'OpenCode Zen', url: 'https://opencode.ai/zen' },
      { name: 'OpenCode Go', url: 'https://opencode.ai/zen/go' },
      { name: 'xAI', url: 'https://api.x.ai' },
      { name: 'Groq', url: 'https://api.groq.com/openai' },
      { name: 'DeepSeek', url: 'https://api.deepseek.com' },
      { name: 'NVIDIA', url: 'https://integrate.api.nvidia.com' },
      { name: 'Together', url: 'https://api.together.xyz' },
      { name: 'Replicate', url: 'https://api.replicate.com' },
      { name: 'HuggingFace', url: 'https://api-inference.huggingface.co' },
      { name: 'LinuxDo Hub', url: 'https://hub.linux.do' },
    ];

    /** 一行一条「名称|地址」；只写地址就拿域名当名称。空行和 # 注释跳过 */
    function parsePresets(text) {
      const out = [];
      const seen = new Set();
      for (const line of String(text || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf('|');
        const rawUrl = i >= 0 ? t.slice(i + 1).trim() : t;
        const url = normalizeBaseUrl(rawUrl);
        if (!url) continue;
        /*
         * normalizeBaseUrl 会给任何东西补上 https://，所以随手写的一行中文也能"变成"地址。
         * 主机名必须带点，或者是 localhost（自建的中转常挂在 localhost:3000 这类地址上）。
         */
        const host = (url.match(/^https?:\/\/([^/:?#]+)/i) || [, ''])[1];
        if (!host || (!host.includes('.') && !/^localhost$/i.test(host))) continue;
        const name = (i >= 0 ? t.slice(0, i).trim() : '') || (url.match(/^https?:\/\/([^/:?#]+)/i) || [, url])[1];
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ name, url });
      }
      return out;
    }

    function serializePresets(list) {
      return (list || []).map((p) => `${p.name}|${p.url}`).join('\n');
    }

    /* ───────── 输出成 new-api 剪贴板格式 ───────── */

    const CHANNEL_CONN_TYPE = 'newapi_channel_conn';
    const REMARK_MAX = 255;
    const NAME_MAX = 64;
    /*
     * 从帖子里捞来的渠道一律挂「临时-」前缀：这些 key 是别人发在论坛上的，随时会被撤、
     * 会限流、会是钓鱼，跟自己买的正式渠道混在一张列表里分不清。前缀放最前面而不是尾巴，
     * 是因为渠道列表按名字排序，这样所有临时渠道自动聚成一堆，清理时一眼能全选。
     */
    const NAME_PREFIX = '临时-';

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
      // 前缀和尾巴都得先从 64 的预算里扣掉，不然长标题会把楼层号顶出去 —— 同一帖子多个楼层
      // 全靠 #N 区分，丢了就是几条同名渠道。内层 trim 处理标题被砍空的情况（别留下「临时- #3」）。
      const budget = Math.max(0, NAME_MAX - NAME_PREFIX.length - tail.length);
      return (NAME_PREFIX + (base.slice(0, budget) + tail).trim()).slice(0, NAME_MAX);
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
      stripNoise, noiseChars,
      isLikelyKey, keyPrefixHint, findPlainKeys,
      normalizeB64, looksLikeB64, decodeB64, isPrintable,
      parseJsonMaybe, standaloneToken, firstTokenAfterUrls,
      evaluateLayer, analyzeB64Token, analyzeText, analyzePost,
      DECODE_METHODS, decodeWith, decodeLayers, aesDecrypt,
      DEFAULT_URL_PRESETS, parsePresets, serializePresets,
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
  const VERSION = '0.3.6'; // 与文件头 @version 保持一致
  const LS_TARGET = 'ld-napi-target-url';
  const LS_PRESETS = 'ld-napi-url-presets';
  /*
   * 地址下拉里「— 手动填写 —」那一项的哨兵值。预设和扫到的地址都是 http(s) 开头的
   * 正规地址，撞不上这个值。不要用空白字符当哨兵：option 的 value 不保证保留前导空白，
   * 匹配不上时 select.value 会变成空串，change 处理器就会把手打的地址清掉。
   */
  const MANUAL_OPT = '__manual__';

  /** GM_* 优先，装在别的管理器/被禁权限时退回 localStorage */
  const store = {
    get(key) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, '') || '';
      } catch (e) {}
      try {
        return localStorage.getItem(key) || '';
      } catch (e) {
        return '';
      }
    },
    set(key, v) {
      try {
        if (typeof GM_setValue === 'function') return GM_setValue(key, v);
      } catch (e) {}
      try {
        localStorage.setItem(key, v);
      } catch (e) {}
    },
  };

  /** 存过就用存的那份，没存过用内置的。「恢复默认」= 清掉存的 */
  function loadPresets() {
    const saved = CORE.parsePresets(store.get(LS_PRESETS));
    return saved.length ? saved : CORE.DEFAULT_URL_PRESETS.slice();
  }

  const onTopicPage = () => /^\/t\//i.test(location.pathname);

  /**
   * 当前帖子 id。Discourse 在帖子内滚动时会不停 replaceState 把 URL 改成
   * /t/{slug}/{id}/{楼号}，末尾楼号一直变但帖子没换，所以只认 id。
   */
  function currentTopicId() {
    const m = location.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)/i);
    return m ? m[1] : '';
  }

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
    /*
     * Discourse 给每张图片配了一圈说明：<span class="filename">QQ_1788069148417</span>
     * <span class="informations">2096×520 46.6 KB</span>。这俩是相邻的行内元素，下面只在块级
     * 标签之间补换行补不到它们中间，于是文件名和图片宽度会粘成 QQ_17880691484172096 ——
     * 一个页面上根本不存在的 20 字符串，正好够长被 base64 扫描器当成候选密钥捞走。
     * 这些说明文字里不会有密钥，整块摘掉最干净。
     *
     * 不改成「所有行内元素之间都补分隔符」：代码高亮会把密钥切成一串 <span class="hljs-*">，
     * 在它们中间插东西会把真密钥撕开，那是比这个误报更严重的回归。
     */
    clone.querySelectorAll('.lightbox-wrapper .meta, .informations, .filename').forEach((m) => m.remove());
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
    // 帖子里出现过的地址，给「API地址」下拉当一个分组：同一帖多个密钥共用一个地址、
    // 或者地址和密钥隔了好几楼没配上的情况，选一下就好，不用手打
    const postUrls = [];
    const seenUrl = new Set();
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
      for (const u of CORE.extractUrls(text)) {
        if (!seenUrl.has(u.url)) {
          seenUrl.add(u.url);
          postUrls.push(u.url);
        }
      }
      for (const h of linkUrls) {
        const u = CORE.normalizeBaseUrl(h);
        if (u && CORE.isUsefulUrl(u) && !seenUrl.has(u)) {
          seenUrl.add(u);
          postUrls.push(u);
        }
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
    return { records: unique, topicUrl, title, opUsername, postUrls };
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

  let state = { records: [], topicUrl: '', title: '', opUsername: '', postUrls: [] };

  /*
   * 面板是增量渲染的：重扫只往列表尾部追加新出现的记录，已经在页面上的行一律不动。
   * 整表重建会把用户正在输入的 input、展开着的原生 select、手动卡里粘好的密文
   * 一起销毁（表现就是点一下输入框马上失焦、下拉框刚点开就收起），所以这里
   * 必须保持 DOM 稳定。renderedKeys 记住哪些 key 已经有行了。
   */
  const renderedKeys = new Set();
  let manualRow = null;
  // 手动卡的记录对象常驻，只有 username 会随扫描结果补上
  const manualRec = { manual: true, raw: '', url: '', key: '', username: '', official: false, vendor: '' };
  // 手动卡折叠状态：null = 还没人动过，由有没有自动结果决定；true/false = 用户自己点过，说话算话
  let manualFold = null;

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
    const badgeTips = [];
    if (rec.split) badgeTips.push('前缀和密钥体原文是分行的，已拼合');
    if (rec.noise) badgeTips.push('已剔除干扰字：' + rec.noise);
    if (badgeTips.length) badge.title = badgeTips.join('\n');
    meta.appendChild(badge);
    row.appendChild(meta);

    /*
     * 手动卡常驻在第一位，可自动识别出结果时它就是挡路的一整屏 —— 每次都得往下滚才够得着
     * 真正想复制的那几条。所以有自动结果时把它折起来，只留一行标题。
     *
     * 折叠只加 class 靠 CSS 藏 body，元素和输入框都留在 DOM 里：里面可能有半截没弄完的
     * 粘贴内容，折一下就没了不合理；展开后焦点和选中状态也还在原处。
     */
    if (rec.manual) {
      const toggle = el('span', 'ld-napi-fold', '收起');
      meta.insertBefore(toggle, badge);
      meta.classList.add('ld-napi-meta-foldable');
      meta.title = '点这行收起/展开手动粘贴';
      row.ldSetCollapsed = (flag) => {
        row.classList.toggle('ld-napi-row-folded', !!flag);
        toggle.textContent = flag ? '展开' : '收起';
      };
      meta.addEventListener('click', (e) => {
        // 徽标上挂着 tooltip，点它是想看说明，不该顺手把卡折了
        if (e.target === badge) return;
        manualFold = !row.classList.contains('ld-napi-row-folded');
        row.ldSetCollapsed(manualFold);
      });
    }

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

    /*
     * 地址预设下拉。认不出厂商、或厂商在 new-api 里没有对应渠道类型（OpenCode Zen
     * 就是）时，地址只能手打，这个下拉是为了省掉手打。
     * 分两组：内置/自定义预设，以及当前帖子里扫到的其它地址。
     * 地址框仍然可以随便手打，手打后下拉自动落到「手动填写」。
     */
    const urlSel = el('select', 'ld-napi-urlsel');
    const fillUrlOptions = () => {
      urlSel.textContent = '';
      const manual = el('option', null, '— 手动填写 —');
      manual.value = MANUAL_OPT;
      urlSel.appendChild(manual);

      const blank = el('option', null, '留空（用渠道类型的官方地址）');
      blank.value = '';
      urlSel.appendChild(blank);

      const presets = loadPresets();
      if (presets.length) {
        const g = el('optgroup');
        g.label = '预设';
        for (const p of presets) {
          const o = el('option', null, `${p.name} — ${p.url}`);
          o.value = p.url;
          g.appendChild(o);
        }
        urlSel.appendChild(g);
      }

      const known = new Set(presets.map((p) => p.url));
      const extras = (state.postUrls || []).filter((u) => !known.has(u));
      if (extras.length) {
        const g = el('optgroup');
        g.label = '本帖扫到的地址';
        for (const u of extras) {
          const o = el('option', null, u);
          o.value = u;
          g.appendChild(o);
        }
        urlSel.appendChild(g);
      }
    };

    /** 下拉跟着地址框走：框里的值在选项里就选中它，否则落到「手动填写」 */
    const syncUrlSel = () => {
      const v = urlInput.value.trim();
      const hit = [...urlSel.options].some((o) => o.value === v);
      urlSel.value = hit ? v : MANUAL_OPT;
    };

    const urlSelWrap = el('div', 'ld-napi-urlsel-wrap');
    urlSelWrap.appendChild(urlSel);
    row.appendChild(urlSelWrap);

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
        // 剔了干扰字、拼了换行都要说出来，否则用户没法核对密钥是不是被动坏了
        const parts = [];
        if (res.split) parts.push('已拼合分行的前缀');
        if (res.noise) parts.push('已剔除干扰字「' + res.noise + '」');
        if (res.plain && res.plain !== rawInput.value.trim()) parts.push('明文：' + res.plain.slice(0, 120));
        hint.textContent = parts.join('　');
        hint.className = 'ld-napi-hint';
        badge.textContent =
          (res.note || sel.value) + (res.split ? ' · 已拼合换行' : '') + (res.noise ? ' · 已剔干扰字' : '');
        const tips = [];
        if (res.split) tips.push('前缀和密钥体原文是分行的，已拼合');
        if (res.noise) tips.push('已剔除干扰字：' + res.noise);
        badge.title = tips.join('\n');
      }
      syncPreview();
    };

    // 增量渲染时不重建行，楼主用户名晚一步扫到就靠这个刷新备注预览
    row.ldRefreshRemark = syncPreview;

    /*
     * 改完预设、或者重扫带出新的帖内地址之后，重建这一行的下拉选项。
     * 不能重建整行：那会把正在编辑的输入框和展开的下拉一起销毁。
     * 地址框里的值原样保留，重填完再对齐选中项。
     */
    row.ldRefreshUrlOptions = () => {
      fillUrlOptions();
      syncUrlSel();
    };

    sel.addEventListener('change', () => {
      syncPassVisibility();
      redecode();
    });
    pass.addEventListener('input', redecode);
    rawInput.addEventListener('input', redecode);
    urlInput.addEventListener('input', () => {
      syncUrlSel();
      syncPreview();
    });
    urlSel.addEventListener('change', () => {
      if (urlSel.value === MANUAL_OPT) return; // 这项只是个状态显示，不改地址
      urlInput.value = urlSel.value;
      syncPreview();
    });
    syncPassVisibility();
    fillUrlOptions();
    /*
     * 刻意不按厂商猜测自动填地址。厂商是从密钥前缀猜的，`sk-` + 48 位以上一律算 OpenAI，
     * 而中转站和 OpenCode Zen 这类也发同样形状的密钥 —— 自动填等于把一个错地址塞进去，
     * 比留空更难发现。留空时 new-api 用渠道类型自带的官方地址，本来就是合法用法。
     */
    syncUrlSel();
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
      const target = store.get(LS_TARGET).trim();
      if (!ok) return toast('复制失败');
      if (!target) return toast('已复制。先在顶部填 new-api 渠道页地址才能直接打开');
      window.open(channelPageUrl(target), '_blank', 'noopener');
      toast('已复制并打开 new-api');
    });
    row.appendChild(actions);
    return row;
  }

  /**
   * 把扫描结果并进面板，只追加没见过的记录。
   * @returns {number} 本次新增的行数
   */
  function renderPanel() {
    const head = document.getElementById('ld-napi-head');
    const list = document.getElementById('ld-napi-list');
    if (!head || !list) return 0;

    // 手动卡常驻第一位：自动识别不中的时候，直接往这儿粘密文。只建一次。
    manualRec.username = state.opUsername;
    if (!manualRow || !manualRow.isConnected) {
      manualRow = renderRow(manualRec);
      list.appendChild(manualRow);
    } else if (manualRow.ldRefreshRemark) {
      manualRow.ldRefreshRemark();
    }

    let added = 0;
    for (const rec of state.records) {
      if (renderedKeys.has(rec.key)) continue;
      renderedKeys.add(rec.key);
      list.appendChild(renderRow(rec));
      added++;
    }

    // 重扫可能带出新的帖内地址，已有卡片的下拉也要跟着更新（只换选项，不重建行）
    refreshUrlOptions();

    /*
     * 有自动结果就把手动卡折起来，让第一条自动结果落在首屏；一条都没扫到时它是唯一能用的
     * 东西，得开着。用户自己点过就不再自动改（manualFold 不为 null），已经往里粘了东西也不
     * 折 —— 那多半正弄到一半，Discourse 随便一个 DOM 变动都会触发重扫，折了就是打断。
     */
    if (manualRow && manualRow.ldSetCollapsed) {
      const dirty = [...manualRow.querySelectorAll('input,textarea')].some((f) => f.value.trim());
      manualRow.ldSetCollapsed(manualFold === null ? renderedKeys.size > 0 && !dirty : manualFold);
    }

    // 已经追加过的行不会被撤掉（Discourse 会卸载滚出视野的楼层，撤掉等于白扫），
    // 所以计数和空提示都看面板上实际有多少张卡。
    head.textContent = `自动识别到 ${renderedKeys.size} 条 · ${state.title || state.topicUrl}`;

    const emptyHint = list.querySelector('.ld-napi-empty');
    if (renderedKeys.size) {
      if (emptyHint) emptyHint.remove();
    } else if (!emptyHint) {
      list.appendChild(
        el('div', 'ld-napi-empty', '自动识别没找到东西。用上面那张卡手动粘密文，或往下滚加载更多楼层后点「重新扫描」。'),
      );
    }
    return added;
  }

  /** 改完预设 / 重扫带出新地址后，就地刷新每张卡的地址下拉，不重建行 */
  function refreshUrlOptions() {
    const list = document.getElementById('ld-napi-list');
    if (!list) return;
    for (const row of list.querySelectorAll('.ld-napi-row')) {
      if (row.ldRefreshUrlOptions) row.ldRefreshUrlOptions();
    }
  }

  /** 换帖子了才清空重来 */
  function resetPanel() {
    renderedKeys.clear();
    manualRow = null;
    manualFold = null; // 折叠状态是针对上一个帖子的选择，换帖重新按有没有结果来定
    const list = document.getElementById('ld-napi-list');
    if (list) list.textContent = '';
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
.ld-napi-meta-foldable{cursor:pointer;user-select:none}
/* margin-left:auto 把「收起」推到右边跟徽标挨着，不然 space-between 会把它甩到正中间 */
.ld-napi-fold{margin-left:auto;color:#8b949e;font-size:11px;white-space:nowrap}
.ld-napi-meta-foldable:hover .ld-napi-fold{color:#d5dae0}
/* 折起来只藏 body，元素全留在 DOM 里：里面可能有粘了一半的密文，展开后还得在 */
.ld-napi-row-folded > *:not(.ld-napi-meta){display:none}
.ld-napi-row-folded{padding:8px 0}
.ld-napi-row-folded .ld-napi-meta{margin-bottom:0}
.ld-napi-badge{background:#25374a;color:#7db3e8;border-radius:4px;padding:0 6px;font-size:11px;
 line-height:18px;white-space:nowrap}
.ld-napi-badge-official{background:#3d3320;color:#e0b352}
.ld-napi-field{display:block;margin-bottom:6px}
.ld-napi-field span{display:block;color:#9aa1a9;font-size:11px;margin-bottom:2px}
.ld-napi-field input,.ld-napi-field textarea{width:100%;box-sizing:border-box;background:#17191c;
 border:1px solid #3a3f46;color:#e6e6e6;border-radius:6px;padding:4px 8px;
 font:12px Menlo,Consolas,monospace;resize:vertical}
.ld-napi-urlsel-wrap{margin:-2px 0 6px}
.ld-napi-urlsel{width:100%;box-sizing:border-box;background:#17191c;border:1px solid #3a3f46;color:#9aa1a9;
 border-radius:6px;padding:3px 6px;font-size:11px}
#ld-napi-presets{display:none;flex-direction:column;gap:6px;padding:8px 12px;border-bottom:1px solid #33383e;
 background:#1b1e22}
#ld-napi-presets.open{display:flex}
.ld-napi-preset-hint{color:#8b949e;font-size:11px;line-height:1.6}
#ld-napi-presets textarea{width:100%;box-sizing:border-box;background:#17191c;border:1px solid #3a3f46;
 color:#e6e6e6;border-radius:6px;padding:4px 8px;font:11px/1.6 Menlo,Consolas,monospace;resize:vertical}
.ld-napi-preset-btns{display:flex;gap:6px}
.ld-napi-preset-btns button{flex:1;padding:4px 10px;border-radius:6px;border:1px solid #4a5058;background:#2a2f36;
 color:#e6e6e6;cursor:pointer;font-size:12px}
.ld-napi-preset-btns button.ld-napi-primary{border-color:#3d6b3f;background:#223527;color:#8fd69a}
.ld-napi-preset-btns button:hover{filter:brightness(1.25)}
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
    target.value = store.get(LS_TARGET);
    target.spellcheck = false;
    target.addEventListener('change', () => {
      store.set(LS_TARGET, target.value.trim());
      toast('已记住 new-api 地址');
    });
    bar.appendChild(target);

    const mkBarBtn = (text, handler) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', handler);
      bar.appendChild(b);
    };
    mkBarBtn('重新扫描', () => {
      const added = rescan();
      toast(added ? `新增 ${added} 条` : '没有新的，往下滚加载更多楼层再试');
    });

    /* ── 预设编辑器：一行一条「名称|地址」，改完刷新每张卡的下拉 ── */
    const editor = document.createElement('div');
    editor.id = 'ld-napi-presets';
    const editorHint = el('div', 'ld-napi-preset-hint', '一行一条，格式「名称|地址」。只写地址就拿域名当名称，# 开头是注释。');
    const editorArea = document.createElement('textarea');
    editorArea.rows = 8;
    editorArea.spellcheck = false;
    const editorBtns = el('div', 'ld-napi-preset-btns');
    editor.append(editorHint, editorArea, editorBtns);

    const mkEditorBtn = (text, primary, handler) => {
      const b = el('button', primary ? 'ld-napi-primary' : null, text);
      b.addEventListener('click', handler);
      editorBtns.appendChild(b);
    };
    mkEditorBtn('保存', true, () => {
      const parsed = CORE.parsePresets(editorArea.value);
      store.set(LS_PRESETS, CORE.serializePresets(parsed));
      editorArea.value = CORE.serializePresets(loadPresets());
      refreshUrlOptions();
      toast(`已保存 ${parsed.length} 条预设`);
    });
    mkEditorBtn('恢复默认', false, () => {
      store.set(LS_PRESETS, '');
      editorArea.value = CORE.serializePresets(loadPresets());
      refreshUrlOptions();
      toast('已恢复内置预设');
    });
    mkEditorBtn('收起', false, () => editor.classList.remove('open'));

    mkBarBtn('预设', () => {
      if (editor.classList.toggle('open')) editorArea.value = CORE.serializePresets(loadPresets());
    });
    mkBarBtn('关闭', () => panel.classList.remove('open'));

    const list = document.createElement('div');
    list.id = 'ld-napi-list';
    panel.append(head, bar, editor, list);

    const toastEl = document.createElement('div');
    toastEl.id = 'ld-napi-toast';
    document.body.append(fab, panel, toastEl);

    fab.addEventListener('click', () => {
      if (panel.classList.toggle('open')) rescan();
    });
  }

  /** @returns {number} 本次新增的行数 */
  function rescan() {
    state = scan();
    const added = renderPanel();
    const count = document.querySelector('#ld-napi-fab .ld-napi-count');
    if (count) {
      count.textContent = String(renderedKeys.size);
      count.style.display = renderedKeys.size ? 'block' : 'none';
    }
    return added;
  }

  /*
   * 面板开着才重扫。楼层懒加载和帖子内滚动都走这里，debounce 掉抖动。
   */
  let scanTimer = null;
  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const panel = document.getElementById('ld-napi-panel');
      if (panel && panel.classList.contains('open')) rescan();
    }, 900);
  }

  /** 只在帖子页显示按钮；Discourse 是 SPA，路由一变就要重新决定挂不挂 */
  let mountedTopicId = '';
  function syncMount() {
    const mounted = !!document.getElementById('ld-napi-fab');
    if (onTopicPage()) {
      if (!mounted) buildUI();
      const topicId = currentTopicId();
      if (mounted && topicId && topicId === mountedTopicId) {
        // 同一个帖子：滚动时 Discourse 会不停 replaceState，这里不能重建面板，
        // 否则正在编辑的输入框和展开的下拉框会被连带销毁。
        scheduleScan();
        return;
      }
      mountedTopicId = topicId;
      resetPanel();
      rescan();
      // 楼层常常在 document-idle 之后才渲染完，补一次让角标数字准
      setTimeout(() => {
        if (document.getElementById('ld-napi-fab') && currentTopicId() === mountedTopicId) rescan();
      }, 1500);
    } else if (mounted) {
      ['ld-napi-fab', 'ld-napi-panel', 'ld-napi-toast'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      mountedTopicId = '';
      resetPanel();
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

    /*
     * 楼层懒加载：面板开着时重扫。
     * 关键是要过滤掉脚本自己造成的 DOM 变更 —— 面板、悬浮按钮、toast 都挂在
     * document.body 下，追加卡片 / 改角标数字 / 改 toast 文字全都会被这个
     * 观察器捕获。不过滤就是自激循环：渲染 → 触发观察器 → 900ms 后再渲染，
     * 面板每 900ms 重建一次，点输入框立刻失焦、下拉框刚点开就收起。
     */
    const OWN_SELECTOR = '#ld-napi-fab,#ld-napi-panel,#ld-napi-toast';
    // 用 closest 是否存在来判断元素，不用 instanceof Element：脚本管理器的沙箱和
    // 页面可能不共享同一个 Element 构造器，跨 realm 的 instanceof 会假阴性。
    const isOwnMutation = (t) => {
      const e = t && typeof t.closest === 'function' ? t : t && t.parentElement;
      return !!(e && typeof e.closest === 'function' && e.closest(OWN_SELECTOR));
    };

    new MutationObserver((records) => {
      if (records.every((r) => isOwnMutation(r.target))) return;
      scheduleScan();
    }).observe(document.body, { childList: true, subtree: true });

    // 排查用：控制台执行 __ldNapi.scan() 看抓到什么。
    // 有 @grant 时脚本跑在沙箱里，挂到 unsafeWindow 才能在页面控制台访问到。
    // cookedText 也挂出来：面板报出页面上看不见的字符串时（比如图片说明被粘成一串），
    // 先看扫描器读到的到底是什么文本，比盯着识别结果猜快得多。
    const dbg = { CORE, scan, rescan, syncMount, onTopicPage, cookedText };
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
