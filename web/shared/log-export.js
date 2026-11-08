/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export function toCsvLine(cells) {
  return (
    cells
      .map((cell) => {
        let text = String(cell ?? '')
        if (
          (/^[\s\u0000]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) &&
          !/^-?\d+(\.\d+)?$/.test(text)
        )
          text = "'" + text
        return '"' + text.replaceAll('"', '""') + '"'
      })
      .join(',') + '\r\n'
  )
}

// Completion is part of the protocol: a truncated or failed response must
// never become a deceptively successful CSV file.
export function buildLogExportCsv(text, options) {
  const { isAdmin, t, formatQuota, formatTime } = options
  const headers = [
    t('Time'),
    t('Type'),
    ...(isAdmin ? [t('User')] : []),
    t('Token'),
    t('Group'),
    t('Model'),
    ...(isAdmin ? [t('Channel')] : []),
    t('Stream'),
    t('Input Tokens'),
    t('Output Tokens'),
    t('Cache Read'),
    t('Cache Write'),
    t('Cost'),
    t('Duration'),
    'IP',
    t('Request ID'),
    t('Upstream Request ID'),
    t('Details'),
  ]
  const lines = [toCsvLine(headers)]
  const types = {
    1: 'Top-up',
    2: 'Consume',
    3: 'Manage',
    4: 'System',
    5: 'Error',
    6: 'Refund',
    7: 'Login',
  }
  let count = 0
  let complete = false
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    if (complete) throw new Error('Incomplete log export')
    const entry = JSON.parse(line)
    if (typeof entry.success === 'boolean') {
      if (!entry.success)
        throw new Error(entry.message || 'Failed to export logs')
      if (entry.data?.count !== count) throw new Error('Incomplete log export')
      complete = true
      continue
    }
    if (!Number.isInteger(entry.type) || !Number.isFinite(entry.created_at))
      throw new Error('Incomplete log export')
    let other = {}
    try {
      other = JSON.parse(entry.other || '{}') || {}
    } catch {
      /* old logs may omit metadata */
    }
    const cacheWrite = Math.max(
      other.cache_creation_tokens || 0,
      (other.cache_creation_tokens_5m || 0) +
        (other.cache_creation_tokens_1h || 0)
    )
    lines.push(
      toCsvLine([
        formatTime(entry.created_at),
        t(types[entry.type] || 'Unknown'),
        ...(isAdmin ? [entry.username] : []),
        entry.token_name,
        entry.group,
        entry.model_name,
        ...(isAdmin
          ? [
              entry.channel_name
                ? `#${entry.channel} ${entry.channel_name}`
                : String(entry.channel || ''),
            ]
          : []),
        t(entry.is_stream ? 'Yes' : 'No'),
        entry.prompt_tokens ?? 0,
        entry.completion_tokens ?? 0,
        other.cache_tokens || 0,
        cacheWrite,
        formatQuota(entry.quota || 0),
        entry.use_time || 0,
        entry.ip,
        entry.request_id,
        entry.upstream_request_id,
        entry.content,
      ])
    )
    count++
  }
  if (!complete) throw new Error('Incomplete log export')
  return { lines, count }
}

export function downloadLogCsv(lines) {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', ...lines], { type: 'text/csv;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `usage-logs-${new Date().toISOString().replaceAll(':', '-')}.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
