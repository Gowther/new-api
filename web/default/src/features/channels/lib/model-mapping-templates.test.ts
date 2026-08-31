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
  applyModelMappingTemplate,
  reconcileModelsForMapping,
  upsertModelMappingTemplate,
  type ModelMappingTemplate,
} from './model-mapping-templates.ts'

describe('model mapping templates', () => {
  test('appends new mappings without replacing existing sources', () => {
    const result = applyModelMappingTemplate(
      { existing: 'existing-upstream', shared: 'keep-this-target' },
      { added: 'added-upstream', shared: 'do-not-use-this-target' }
    )

    assert.deepEqual(result.mapping, {
      existing: 'existing-upstream',
      shared: 'keep-this-target',
      added: 'added-upstream',
    })
    assert.deepEqual(result.addedMapping, { added: 'added-upstream' })
    assert.deepEqual(result.appliedMapping, {
      added: 'added-upstream',
      shared: 'keep-this-target',
    })
    assert.deepEqual(result.skipped, [])
  })

  test('skips entries whose target the channel does not serve', () => {
    const result = applyModelMappingTemplate(
      {},
      {
        'gpt-4o': 'gpt-4o-2024-11-20',
        'claude-sonnet-4': 'claude-sonnet-4-20250514',
      },
      ['gpt-4o-2024-11-20']
    )

    assert.deepEqual(result.mapping, { 'gpt-4o': 'gpt-4o-2024-11-20' })
    assert.deepEqual(result.addedMapping, { 'gpt-4o': 'gpt-4o-2024-11-20' })
    assert.deepEqual(result.skipped, [
      {
        source: 'claude-sonnet-4',
        target: 'claude-sonnet-4-20250514',
        reason: 'target-not-served',
      },
    ])
  })

  test('matches a target past a vendor prefix and case, storing the served name', () => {
    const result = applyModelMappingTemplate(
      {},
      { alias: 'gpt-4o', 'alias-cased': 'CLAUDE-OPUS-4' },
      ['openai/gpt-4o', 'claude-opus-4']
    )

    assert.deepEqual(result.mapping, {
      alias: 'openai/gpt-4o',
      'alias-cased': 'claude-opus-4',
    })
    assert.deepEqual(result.skipped, [])
  })

  test('refuses to guess when several served models match one target', () => {
    const result = applyModelMappingTemplate({}, { alias: 'gpt-4o' }, [
      'openai/gpt-4o',
      'azure/gpt-4o',
    ])

    assert.deepEqual(result.mapping, {})
    assert.deepEqual(result.skipped, [
      {
        source: 'alias',
        target: 'gpt-4o',
        reason: 'target-ambiguous',
        candidates: ['openai/gpt-4o', 'azure/gpt-4o'],
      },
    ])
  })

  test('writes no identity mapping when the channel serves the exposed name', () => {
    const result = applyModelMappingTemplate({}, { 'gpt-4o': 'gpt-4o' }, [
      'gpt-4o',
    ])

    assert.deepEqual(result.mapping, {})
    assert.deepEqual(result.appliedMapping, {})
    assert.deepEqual(result.skipped, [
      { source: 'gpt-4o', target: 'gpt-4o', reason: 'already-served' },
    ])
  })

  test('applies every entry when no served set is given', () => {
    const result = applyModelMappingTemplate({}, { alias: 'never-served' })

    assert.deepEqual(result.mapping, { alias: 'never-served' })
    assert.deepEqual(result.skipped, [])
  })

  test('hides new targets and appends missing sources to the model list', () => {
    const result = reconcileModelsForMapping(
      ['existing', 'added-upstream', 'shared', 'duplicate', 'duplicate'],
      {
        added: 'added-upstream',
        shared: 'upstream-only',
        chained: 'shared',
      },
      {
        added: 'added-upstream',
        shared: 'upstream-only',
        chained: 'shared',
        'existing-source': 'existing-target',
      }
    )

    assert.deepEqual(result, [
      'existing',
      'shared',
      'duplicate',
      'added',
      'chained',
    ])
  })

  test('keeps an existing source even when a new mapping targets it', () => {
    const result = reconcileModelsForMapping(
      ['existing-source', 'unused-target'],
      { added: 'existing-source', another: 'unused-target' },
      {
        'existing-source': 'existing-target',
        added: 'existing-source',
        another: 'unused-target',
      }
    )

    assert.deepEqual(result, ['existing-source', 'added', 'another'])
  })

  test('reconciles existing template keys with their retained targets', () => {
    const { mapping } = applyModelMappingTemplate(
      { shared: 'retained-target' },
      { shared: 'template-target' }
    )
    const appliedMapping = { shared: mapping.shared }

    assert.deepEqual(
      reconcileModelsForMapping(
        ['retained-target', 'template-target'],
        appliedMapping,
        mapping
      ),
      ['template-target', 'shared']
    )
  })

  test('renaming a template in place keeps its position and identity', () => {
    const templates: ModelMappingTemplate[] = [
      { id: 'a', name: 'first', mapping: { from: 'to' } },
      { id: 'b', name: 'second', mapping: { x: 'y' } },
    ]

    const result = upsertModelMappingTemplate(templates, {
      id: 'b',
      name: 'renamed',
      mapping: { x: 'z' },
    })

    assert.deepEqual(result, [
      { id: 'a', name: 'first', mapping: { from: 'to' } },
      { id: 'b', name: 'renamed', mapping: { x: 'z' } },
    ])
  })

  test('an unknown id is appended rather than replacing an existing template', () => {
    const templates: ModelMappingTemplate[] = [
      { id: 'a', name: 'first', mapping: { from: 'to' } },
    ]

    const result = upsertModelMappingTemplate(templates, {
      id: 'new',
      name: 'second',
      mapping: { x: 'y' },
    })

    assert.deepEqual(result, [
      { id: 'a', name: 'first', mapping: { from: 'to' } },
      { id: 'new', name: 'second', mapping: { x: 'y' } },
    ])
  })
})
