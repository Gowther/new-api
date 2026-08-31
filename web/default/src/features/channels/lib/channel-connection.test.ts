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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  CHANNEL_CONN_CLIPBOARD_TYPE,
  channelConnectionPasteClaim,
  encodeChannelConnectionString,
  parseChannelConnectionString,
} from './channel-connection.ts'

const conn = (extra: Record<string, unknown>) =>
  JSON.stringify({ _type: CHANNEL_CONN_CLIPBOARD_TYPE, ...extra })

describe('channel connection clipboard payload', () => {
  test('round-trips key, url, name and remark', () => {
    const remark = 'https://linux.do/t/x/1\nhttps://linux.do/u/a/activity'
    const encoded = encodeChannelConnectionString(
      'sk-abc',
      'https://api.example.com',
      { name: 'shared channel', remark }
    )

    assert.deepEqual(parseChannelConnectionString(encoded), {
      key: 'sk-abc',
      url: 'https://api.example.com',
      name: 'shared channel',
      remark,
    })
  })

  test('omits name and remark when they are not supplied', () => {
    const encoded = encodeChannelConnectionString('sk-abc', 'https://a.com')

    assert.equal(encoded.includes('name'), false)
    assert.equal(encoded.includes('remark'), false)
    assert.deepEqual(parseChannelConnectionString(encoded), {
      key: 'sk-abc',
      url: 'https://a.com',
    })
  })

  test('accepts payloads that carry only key and url', () => {
    // Payloads written before name/remark existed must keep working.
    assert.deepEqual(
      parseChannelConnectionString(
        conn({ key: 'sk-abc', url: 'https://a.com' })
      ),
      { key: 'sk-abc', url: 'https://a.com' }
    )
  })

  test('treats a missing or empty url as "use the official address"', () => {
    assert.deepEqual(parseChannelConnectionString(conn({ key: 'sk-abc' })), {
      key: 'sk-abc',
      url: '',
    })
    assert.deepEqual(
      parseChannelConnectionString(conn({ key: 'sk-abc', url: '' })),
      { key: 'sk-abc', url: '' }
    )
  })

  test('drops blank name and remark rather than clearing values', () => {
    const parsed = parseChannelConnectionString(
      conn({ key: 'sk-abc', url: '', name: '   ', remark: '  ' })
    )

    assert.deepEqual(parsed, { key: 'sk-abc', url: '' })
  })

  test('clamps name and remark to the channel column widths', () => {
    const parsed = parseChannelConnectionString(
      conn({
        key: 'sk-abc',
        url: '',
        name: 'n'.repeat(300),
        remark: 'r'.repeat(400),
      })
    )

    assert.equal(parsed?.name?.length, 191)
    assert.equal(parsed?.remark?.length, 255)
  })

  test('rejects anything that is not a channel connection payload', () => {
    assert.equal(parseChannelConnectionString(''), null)
    assert.equal(parseChannelConnectionString(null), null)
    assert.equal(parseChannelConnectionString('sk-abc'), null)
    assert.equal(parseChannelConnectionString('{"key":"sk-abc"}'), null)
    assert.equal(parseChannelConnectionString('[1,2,3]'), null)
    assert.equal(
      parseChannelConnectionString(conn({ url: 'https://a.com' })),
      null
    )
    assert.equal(parseChannelConnectionString(conn({ key: '', url: '' })), null)
    assert.equal(
      parseChannelConnectionString(conn({ key: '  \n ', url: '' })),
      null
    )
    assert.equal(parseChannelConnectionString(conn({ key: 1, url: '' })), null)
    assert.equal(
      parseChannelConnectionString(conn({ key: 'sk', url: 9 })),
      null
    )
  })
})

describe('claiming a console-wide paste for channel creation', () => {
  const payload = encodeChannelConnectionString(
    'sk-abc',
    'https://api.example.com'
  )
  /** A paste target that reports matching the given selectors and nothing else. */
  const target = (matches: string[] = [], isContentEditable = false) => ({
    isContentEditable,
    closest: (selector: string) =>
      matches.some((match) => selector.includes(match)) ? {} : null,
  })

  test('claims connection info pasted outside any field', () => {
    assert.deepEqual(channelConnectionPasteClaim(payload, target()), {
      key: 'sk-abc',
      url: 'https://api.example.com',
    })
    // A paste can land on the document itself, with no element to inspect.
    assert.deepEqual(channelConnectionPasteClaim(payload, null), {
      key: 'sk-abc',
      url: 'https://api.example.com',
    })
  })

  test('leaves a paste aimed at a field the user is typing in', () => {
    assert.equal(channelConnectionPasteClaim(payload, target(['input'])), null)
    assert.equal(
      channelConnectionPasteClaim(payload, target(['textarea'])),
      null
    )
    assert.equal(
      channelConnectionPasteClaim(payload, target(['contenteditable'])),
      null
    )
    assert.equal(channelConnectionPasteClaim(payload, target([], true)), null)
  })

  test('stays out of an open dialog, which offers the clipboard itself', () => {
    assert.equal(
      channelConnectionPasteClaim(payload, target(['role="dialog"'])),
      null
    )
    assert.equal(
      channelConnectionPasteClaim(payload, target(['role="alertdialog"'])),
      null
    )
  })

  test('ignores a paste that is not connection info', () => {
    assert.equal(channelConnectionPasteClaim('just some text', target()), null)
    assert.equal(channelConnectionPasteClaim('', target()), null)
    assert.equal(channelConnectionPasteClaim(undefined, target()), null)
  })
})
