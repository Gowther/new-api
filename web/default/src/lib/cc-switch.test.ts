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
import { describe, test } from 'node:test'

import {
  buildCCSwitchURL,
  getCCSwitchModelOptions,
  normalizeCCSwitchEndpoint,
} from './cc-switch.ts'

describe('CC Switch channel export', () => {
  test('normalizes Codex endpoints without duplicating the v1 suffix', () => {
    assert.equal(
      normalizeCCSwitchEndpoint('codex', 'https://api.example.com/'),
      'https://api.example.com/v1'
    )
    assert.equal(
      normalizeCCSwitchEndpoint('codex', 'https://api.example.com/v1/'),
      'https://api.example.com/v1'
    )
    assert.equal(
      normalizeCCSwitchEndpoint('claude', 'https://api.example.com/'),
      'https://api.example.com'
    )
  })

  test('keeps the direct upstream key and endpoint in the import URL', () => {
    const url = new URL(
      buildCCSwitchURL({
        app: 'codex',
        name: 'fallback channel',
        models: { model: 'gpt-5' },
        apiKey: 'upstream-key',
        endpoint: 'https://api.example.com',
      })
    )

    assert.equal(url.protocol, 'ccswitch:')
    assert.equal(url.searchParams.get('endpoint'), 'https://api.example.com/v1')
    assert.equal(url.searchParams.get('apiKey'), 'upstream-key')
    assert.equal(url.searchParams.get('model'), 'gpt-5')
  })

  test('exports mapped upstream model names and prefers the mapped test model', () => {
    const config = getCCSwitchModelOptions(
      'public-model,other-model',
      '{"public-model":"upstream-model"}',
      'public-model'
    )

    assert.deepEqual(config.options, [
      { value: 'upstream-model', label: 'public-model -> upstream-model' },
      { value: 'other-model', label: 'other-model' },
    ])
    assert.equal(config.defaultModel, 'upstream-model')
  })
})
