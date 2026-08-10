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
  isOfficialClientPassthroughEnabled,
  updateOfficialClientPassthroughHeader,
} from './official-client-passthrough.ts'

describe('official client passthrough preset', () => {
  test('adds wildcard passthrough without replacing custom headers', () => {
    const updated = updateOfficialClientPassthroughHeader(
      '{"x-trace-id":"fixed"}',
      true
    )

    assert.deepEqual(JSON.parse(updated || '{}'), {
      '*': true,
      'x-trace-id': 'fixed',
    })
  })

  test('removes only the wildcard passthrough rule', () => {
    const updated = updateOfficialClientPassthroughHeader(
      '{"*":true,"x-trace-id":"fixed"}',
      false
    )

    assert.deepEqual(JSON.parse(updated || '{}'), {
      'x-trace-id': 'fixed',
    })
  })

  test('does not overwrite invalid header override JSON', () => {
    assert.equal(updateOfficialClientPassthroughHeader('{', true), null)
    assert.equal(updateOfficialClientPassthroughHeader('[]', true), null)
  })

  test('is enabled only when every preset setting is active', () => {
    assert.equal(
      isOfficialClientPassthroughEnabled({
        type: 1,
        header_override: '{"*":true}',
        pass_through_body_enabled: true,
        automatic_channel_test_disabled: true,
      }),
      true
    )
    assert.equal(
      isOfficialClientPassthroughEnabled({
        type: 14,
        header_override: '{"*":""}',
        pass_through_body_enabled: true,
        automatic_channel_test_disabled: false,
      }),
      false
    )
    assert.equal(
      isOfficialClientPassthroughEnabled({
        type: 8,
        header_override: '{"*":true}',
        pass_through_body_enabled: true,
        automatic_channel_test_disabled: true,
      }),
      false
    )
  })
})
