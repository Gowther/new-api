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

import { buildPriceChanges } from './price-changes.js'

describe('price save review', () => {
  it('ignores whitespace/key ordering and settings outside the pending save', () => {
    assert.deepEqual(
      buildPriceChanges(
        { ModelRatio: '{"a":0,"b":2}', ModelPriceReference: '{"alias":"b"}' },
        { ModelRatio: '{ "b": 2, "a": 0 }' }
      ),
      []
    )
  })
  it('shows added, removed, zero-priced and changed entries without resolving references', () => {
    assert.deepEqual(
      buildPriceChanges(
        {
          ModelRatio: '{"removed":1,"changed":2}',
          ModelPriceReference: '{"alias":"source"}',
        },
        {
          ModelRatio: '{"added":0,"changed":3}',
          ModelPriceReference: '{"alias":"next"}',
        }
      ),
      [
        {
          field: 'ModelPriceReference',
          model: 'alias',
          before: 'source',
          after: 'next',
        },
        { field: 'ModelRatio', model: 'added', before: undefined, after: 0 },
        { field: 'ModelRatio', model: 'changed', before: 2, after: 3 },
        { field: 'ModelRatio', model: 'removed', before: 1, after: undefined },
      ]
    )
  })
  it('includes billing expressions and global visibility changes', () => {
    assert.deepEqual(
      buildPriceChanges(
        { BillingExpr: '{"m":"p * 2"}', ExposeRatioEnabled: 'true' },
        { BillingExpr: '{"m":"p * 3"}', ExposeRatioEnabled: false }
      ),
      [
        { field: 'BillingExpr', model: 'm', before: 'p * 2', after: 'p * 3' },
        { field: 'ExposeRatioEnabled', model: '', before: true, after: false },
      ]
    )
  })
  it('rejects invalid maps instead of presenting a misleading empty preview', () => {
    for (const value of ['{', '[]', 'null', '42']) {
      assert.throws(() => buildPriceChanges({}, { ModelRatio: value }))
    }
  })
})
