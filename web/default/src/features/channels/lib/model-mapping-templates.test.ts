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
  MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
  normalizeModelMappingTemplate,
  normalizeTemplateTargets,
  persistModelMappingTemplates,
  reconcileModelsForMapping,
  splitTemplateTargetText,
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

  test('folds every served candidate into the first hit for a multi-target entry', () => {
    const result = applyModelMappingTemplate(
      {},
      {
        'gemini-2.5-pro': [
          'gemini-2.5-pro-preview-05-06',
          'gemini-2.5-pro-exp-03-25',
        ],
      },
      ['gemini-2.5-pro-exp-03-25', 'gemini-2.5-pro-preview-05-06', 'other']
    )

    assert.deepEqual(result.mapping, {
      'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
    })
    assert.deepEqual(result.addedMapping, {
      'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
    })
    assert.deepEqual(result.folded, [
      'gemini-2.5-pro-preview-05-06',
      'gemini-2.5-pro-exp-03-25',
    ])
    assert.deepEqual(result.skipped, [])
  })

  test('folds renamed copies matched past vendor prefixes and case', () => {
    const result = applyModelMappingTemplate(
      {},
      { 'gpt-4o-alias': ['GPT-4O', 'gpt-4o'] },
      ['gpt-4o', 'openai/gpt-4o']
    )

    assert.deepEqual(result.mapping, { 'gpt-4o-alias': 'gpt-4o' })
    assert.deepEqual(result.folded, ['gpt-4o', 'openai/gpt-4o'])
    assert.deepEqual(result.skipped, [])
  })

  test('skips a multi-target entry when none of the candidates is served', () => {
    const result = applyModelMappingTemplate(
      {},
      { unified: ['upstream-a', 'upstream-b'] },
      ['unrelated']
    )

    assert.deepEqual(result.mapping, {})
    assert.deepEqual(result.folded, [])
    assert.deepEqual(result.skipped, [
      {
        source: 'unified',
        target: 'upstream-a, upstream-b',
        reason: 'target-not-served',
      },
    ])
  })

  test('a multi-target entry folds variants without redirecting an already-served name', () => {
    const result = applyModelMappingTemplate(
      {},
      { 'gpt-4o': ['gpt-4o-preview', 'gpt-4o'] },
      ['gpt-4o', 'gpt-4o-preview']
    )

    assert.deepEqual(result.mapping, {})
    assert.deepEqual(result.folded, ['gpt-4o-preview'])
    assert.deepEqual(result.skipped, [
      {
        source: 'gpt-4o',
        target: 'gpt-4o-preview, gpt-4o',
        reason: 'already-served',
      },
    ])
  })

  test('a multi-target entry folds variants while keeping the operator mapping', () => {
    const result = applyModelMappingTemplate(
      { 'gpt-4o': 'azure/gpt-4o' },
      { 'gpt-4o': ['gpt-4o-preview'] },
      ['gpt-4o-preview']
    )

    assert.deepEqual(result.mapping, { 'gpt-4o': 'azure/gpt-4o' })
    assert.deepEqual(result.addedMapping, {})
    assert.deepEqual(result.appliedMapping, { 'gpt-4o': 'azure/gpt-4o' })
    assert.deepEqual(result.folded, ['gpt-4o-preview'])
    assert.deepEqual(result.skipped, [])
  })

  test('without a served set an array target degrades to its first candidate', () => {
    const result = applyModelMappingTemplate(
      {},
      { unified: ['upstream-a', 'upstream-b'] }
    )

    assert.deepEqual(result.mapping, { unified: 'upstream-a' })
    assert.deepEqual(result.folded, [])
    assert.deepEqual(result.appliedMapping, { unified: 'upstream-a' })
  })

  test('reconcile also removes folded models from the model list', () => {
    assert.deepEqual(
      reconcileModelsForMapping(
        ['gpt-4o', 'gpt-4o-preview', 'gpt-4o-exp', 'unrelated'],
        { 'gpt-4o': 'gpt-4o-preview' },
        { 'gpt-4o': 'gpt-4o-preview' },
        ['gpt-4o-exp']
      ),
      ['gpt-4o', 'unrelated']
    )
  })

  test('a folded model that is another mapping source stays exposed', () => {
    assert.deepEqual(
      reconcileModelsForMapping(
        ['gpt-4o-preview'],
        {},
        { 'gpt-4o-preview': 'upstream' },
        ['gpt-4o-preview']
      ),
      ['gpt-4o-preview']
    )
  })

  test('normalising a template keeps candidate arrays trimmed and deduped', () => {
    const template = normalizeModelMappingTemplate({
      id: 't',
      name: 'renames',
      mapping: {
        unified: [' openai/pro ', 'openai/pro', 'PRO'],
        plain: 'upstream',
      },
    })

    assert.deepEqual(template?.mapping, {
      unified: ['openai/pro', 'PRO'],
      plain: 'upstream',
    })
  })

  test('an unusable target value still rejects the whole template', () => {
    assert.equal(
      normalizeModelMappingTemplate({
        id: 't',
        name: 'bad',
        mapping: { unified: ['x'], other: 42 },
      }),
      null
    )
    assert.equal(
      normalizeModelMappingTemplate({
        id: 't',
        name: 'empty candidates',
        mapping: { unified: ['   '] },
      }),
      null
    )
  })

  test('comma-separated editor text splits into one target or an array', () => {
    assert.equal(splitTemplateTargetText(' upstream '), 'upstream')
    assert.equal(splitTemplateTargetText(' upstream , '), 'upstream')
    assert.deepEqual(splitTemplateTargetText('a, b ,a'), ['a', 'b', 'a'])
    assert.deepEqual(normalizeTemplateTargets([' x ', 'x', 'y']), ['x', 'y'])
    assert.equal(normalizeTemplateTargets('upstream'), 'upstream')
    assert.equal(normalizeTemplateTargets(42), null)
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

  test('reports local storage failures instead of throwing or claiming success', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const writes: Array<[string, string]> = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          setItem(key: string, value: string) {
            writes.push([key, value])
          },
        },
      },
    })

    try {
      const templates: ModelMappingTemplate[] = [
        { id: 'saved', name: 'saved template', mapping: { from: 'to' } },
      ]
      assert.equal(persistModelMappingTemplates(templates), true)
      assert.equal(writes[0]?.[0], MODEL_MAPPING_TEMPLATES_STORAGE_KEY)
      assert.deepEqual(JSON.parse(writes[0]?.[1] || ''), {
        version: 1,
        templates,
      })

      window.localStorage.setItem = () => {
        throw new Error('storage denied')
      }
      assert.equal(persistModelMappingTemplates(templates), false)
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  })
})
