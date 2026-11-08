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
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toCsvLine, buildLogExportCsv } from './log-export.js'

const options = {
  isAdmin: false,
  t: (s) => s,
  formatQuota: String,
  formatTime: String,
}
const log = {
  id: 1,
  type: 2,
  created_at: 100,
  username: 'private-user',
  channel: 9,
  channel_name: 'private-provider',
  model_name: '=1+1',
  quota: 42,
  content: 'a,"b"\nc',
  other: JSON.stringify({
    cache_tokens: 10,
    cache_creation_tokens: 100,
    cache_creation_tokens_1h: 20,
    cache_creation_tokens_5m: 30,
  }),
}
const response =
  JSON.stringify(log) +
  '\n' +
  JSON.stringify({ success: true, data: { count: 1 } })

describe('log export CSV', () => {
  it('escapes delimiters and spreadsheet formulas including leading whitespace', () => {
    assert.equal(
      toCsvLine(['a,b', '"quoted"', '=1+1', '  @SUM(A1)', '\n+1', '-42']),
      '"a,b","""quoted""","\'=1+1","\'  @SUM(A1)","\'\n+1","-42"\r\n'
    )
  })
  it('keeps cache write remainder and only includes admin columns for admins', () => {
    const user = buildLogExportCsv(response, options)
    assert.equal(user.count, 1)
    assert.ok(user.lines[1].includes('"100","42"'))
    assert.ok(!user.lines.join('').includes('private-'))
    assert.ok(!user.lines[0].includes('"User"'))
    const admin = buildLogExportCsv(response, { ...options, isAdmin: true })
    assert.ok(admin.lines[1].includes('private-provider'))
    assert.ok(admin.lines[1].includes('private-user'))
  })
  it('rejects truncation, errors, incorrect counts and data after completion', () => {
    for (const text of [
      JSON.stringify(log),
      JSON.stringify({ success: false, message: 'failed' }),
      response.replace('count":1', 'count":2'),
      response + '\n' + JSON.stringify(log),
    ]) {
      assert.throws(() => buildLogExportCsv(text, options))
    }
  })
  it('exports an empty completed result as a header-only CSV', () => {
    const result = buildLogExportCsv(
      '{"success":true,"data":{"count":0}}',
      options
    )
    assert.equal(result.count, 0)
    assert.equal(result.lines.length, 1)
  })
})
