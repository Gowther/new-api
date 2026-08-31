/*
Copyright (C) 2025 QuantumNous

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

For commercial licensing, please contact support@quantumnous.com
*/

import { API } from './api';

/**
 * 按需获取单个令牌的真实 key
 * @param {number|string} tokenId
 * @returns {Promise<string>} 返回不带 sk- 前缀的真实 token key
 */
export async function fetchTokenKey(tokenId) {
  const response = await API.post(`/api/token/${tokenId}/key`);
  const { success, data, message } = response.data || {};
  if (!success || !data?.key) {
    throw new Error(message || 'Failed to fetch token key');
  }
  return data.key;
}

/**
 * 批量获取多个令牌的真实 key
 * @param {number[]} tokenIds
 * @returns {Promise<Record<number, string>>} 返回 {id: key} map，key 不带 sk- 前缀
 */
export async function fetchTokenKeysBatch(tokenIds) {
  const response = await API.post('/api/token/batch/keys', { ids: tokenIds });
  const { success, data, message } = response.data || {};
  if (!success || !data?.keys) {
    throw new Error(message || 'Failed to fetch token keys');
  }
  return data.keys;
}

/**
 * 获取可用的 token keys
 * @returns {Promise<string[]>} 返回 active 状态的不带 sk- 前缀的真实 token key 数组
 */
export async function fetchTokenKeys() {
  try {
    const response = await API.get('/api/token/?p=1&size=10');
    const { success, data } = response.data;
    if (!success) throw new Error('Failed to fetch token keys');

    const tokenItems = Array.isArray(data) ? data : data.items || [];
    const activeTokens = tokenItems.filter((token) => token.status === 1);
    const keyResults = await Promise.allSettled(
      activeTokens.map((token) => fetchTokenKey(token.id)),
    );
    return keyResults
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value);
  } catch (error) {
    console.error('Error fetching token keys:', error);
    return [];
  }
}

/**
 * 获取服务器地址
 * @returns {string} 服务器地址
 */
export function getServerAddress() {
  let status = localStorage.getItem('status');
  let serverAddress = '';

  if (status) {
    try {
      status = JSON.parse(status);
      serverAddress = status.server_address || '';
    } catch (error) {
      console.error('Failed to parse status from localStorage:', error);
    }
  }

  if (!serverAddress) {
    serverAddress = window.location.origin;
  }

  return serverAddress;
}

export const CHANNEL_CONN_CLIPBOARD_TYPE = 'newapi_channel_conn';

/** 与 Channel.Name / Channel.Remark 的列宽保持一致，避免粘贴出来的值提交时被后端拒掉 */
const CHANNEL_CONN_NAME_MAX = 191;
const CHANNEL_CONN_REMARK_MAX = 255;

/** 渠道在渠道管理页之外被创建时广播，让已经挂载的渠道表刷新 */
export const CHANNEL_CREATED_EVENT = 'newapi:channel-created';

/**
 * @param {string} key - 完整的 API key（含 sk- 前缀）
 * @param {string} url - 服务器地址
 * @param {{ name?: string, remark?: string }} [extra] - 可选的名称与备注
 * @returns {string} JSON 格式的连接字符串
 */
export function encodeChannelConnectionString(key, url, extra = {}) {
  const payload = {
    _type: CHANNEL_CONN_CLIPBOARD_TYPE,
    key,
    url,
  };
  if (extra.name) payload.name = extra.name;
  if (extra.remark) payload.remark = extra.remark;
  return JSON.stringify(payload);
}

/**
 * 只在读剪贴板不会打断用户时去读。
 *
 * readText() 可能弹权限框，而「切回标签页时突然弹权限框」正是最该避免的打断，
 * 所以没授权就不读，也不主动要。授权是靠点弹窗里那个粘贴按钮拿到的，
 * 拿到之后这里就能静默读出内容。
 *
 * 读不到就返回 null：没授权、浏览器没有这个权限项（Firefox）、页面不在焦点。
 *
 * @returns {Promise<string | null>}
 */
export async function readClipboardWhenAllowed() {
  if (!navigator?.clipboard?.readText) return null;
  try {
    const status = await navigator.permissions.query({
      name: 'clipboard-read',
    });
    if (status.state !== 'granted') return null;
    return await navigator.clipboard.readText();
  } catch {
    // 这个浏览器没有 clipboard-read 权限项，或者这次读被拒了
    return null;
  }
}

/**
 * 粘贴不该变成新建渠道的地方：用户正在输入的字段，以及任何已打开的弹窗
 * （编辑渠道弹窗本身就带了剪贴板入口）
 */
const PASTE_OPT_OUT_SELECTOR =
  'input, textarea, [contenteditable="true"], [role="dialog"], [role="alertdialog"]';

/**
 * 判断控制台里的一次粘贴该不该变成预填好的新建渠道表单。
 *
 * 抢走一次粘贴就打断了用户手上的事，所以只有剪贴板里确实是连接信息、
 * 且这次粘贴没落在输入框或弹窗里时才认。
 *
 * @param {string} text - 剪贴板文本
 * @param {{ isContentEditable?: boolean, closest?: (selector: string) => unknown } | null} target - 粘贴事件的目标元素
 * @returns {{ key: string, url: string, name?: string, remark?: string } | null}
 */
export function channelConnectionPasteClaim(text, target) {
  if (target?.isContentEditable) return null;
  if (target?.closest?.(PASTE_OPT_OUT_SELECTOR)) return null;
  return parseChannelConnectionString(text);
}

/**
 * 解析剪贴板里的渠道连接信息。
 *
 * url 允许缺省或为空串：只给密钥、让渠道类型自带的官方地址生效是常见用法。
 * name / remark 是可选扩展，老格式（只有 key/url）照样能解析。
 *
 * @param {string} text - 剪贴板文本
 * @returns {{ key: string, url: string, name?: string, remark?: string } | null}
 */
export function parseChannelConnectionString(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text.trim());
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed._type !== CHANNEL_CONN_CLIPBOARD_TYPE ||
      typeof parsed.key !== 'string' ||
      !parsed.key.trim() ||
      (parsed.url !== undefined && typeof parsed.url !== 'string')
    ) {
      return null;
    }
    const config = { key: parsed.key, url: parsed.url || '' };
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      config.name = parsed.name.trim().slice(0, CHANNEL_CONN_NAME_MAX);
    }
    if (typeof parsed.remark === 'string' && parsed.remark.trim()) {
      config.remark = parsed.remark.slice(0, CHANNEL_CONN_REMARK_MAX);
    }
    return config;
  } catch {
    // not valid JSON
  }
  return null;
}
