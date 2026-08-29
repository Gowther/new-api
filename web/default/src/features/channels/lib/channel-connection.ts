/*
Copyright (C) 2023-2026 QuantumNous

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
export const CHANNEL_CONN_CLIPBOARD_TYPE = 'newapi_channel_conn'

/**
 * Matches the Channel.Name / Channel.Remark column widths so a pasted value
 * never fails validation on submit.
 */
const CHANNEL_CONN_NAME_MAX = 191
const CHANNEL_CONN_REMARK_MAX = 255

export type ChannelConnectionConfig = {
  key: string
  url: string
  name?: string
  remark?: string
}

export function encodeChannelConnectionString(
  key: string,
  url: string,
  extra: { name?: string; remark?: string } = {}
): string {
  const payload: Record<string, string> = {
    _type: CHANNEL_CONN_CLIPBOARD_TYPE,
    key,
    url,
  }
  if (extra.name) payload.name = extra.name
  if (extra.remark) payload.remark = extra.remark
  return JSON.stringify(payload)
}

/**
 * Reads channel connection info out of clipboard text.
 *
 * `url` may be absent or empty — sharing only a key and letting the channel
 * type's own official address apply is a normal case. `name` and `remark` are
 * optional additions, so payloads carrying just key/url still parse.
 */
export function parseChannelConnectionString(
  text: string | null | undefined
): ChannelConnectionConfig | null {
  if (!text || typeof text !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const payload = parsed as Record<string, unknown>
  if (payload._type !== CHANNEL_CONN_CLIPBOARD_TYPE) return null
  if (typeof payload.key !== 'string') return null
  if (payload.url !== undefined && typeof payload.url !== 'string') return null

  const config: ChannelConnectionConfig = {
    key: payload.key,
    url: typeof payload.url === 'string' ? payload.url : '',
  }
  if (typeof payload.name === 'string' && payload.name.trim()) {
    config.name = payload.name.trim().slice(0, CHANNEL_CONN_NAME_MAX)
  }
  if (typeof payload.remark === 'string' && payload.remark.trim()) {
    config.remark = payload.remark.slice(0, CHANNEL_CONN_REMARK_MAX)
  }
  return config
}
