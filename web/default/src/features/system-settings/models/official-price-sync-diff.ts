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
import type {
  OfficialPriceCandidate,
  OfficialPriceFieldValue,
  OfficialPriceMapping,
  OfficialPriceModelPreview,
} from '../types'
import { RATIO_TYPE_OPTIONS } from './constants'

const RATIO_PRICE_FIELDS = [
  'model_ratio',
  'completion_ratio',
  'cache_ratio',
  'create_cache_ratio',
  'image_ratio',
  'audio_ratio',
  'audio_completion_ratio',
]

const OFFICIAL_PRICE_FIELD_ORDER = [
  ...RATIO_PRICE_FIELDS,
  'model_price',
  'billing_mode',
  'billing_expr',
]

const EXTRA_FIELD_LABELS: Record<string, string> = {
  billing_mode: 'Billing mode',
}

export type OfficialPriceFieldChange = {
  field: string
  current: OfficialPriceFieldValue | undefined
  official: OfficialPriceFieldValue | undefined
}

export type SavedOfficialPriceChange = {
  modelName: string
  source: string
  upstreamModel: string
  fields: OfficialPriceFieldChange[]
}

export type SavedOfficialPriceComparison = {
  changes: SavedOfficialPriceChange[]
  savedCount: number
  skippedCount: number
  unchangedCount: number
}

export function getOfficialPriceFieldOrder(field: string): number {
  const index = OFFICIAL_PRICE_FIELD_ORDER.indexOf(field)
  return index === -1 ? OFFICIAL_PRICE_FIELD_ORDER.length : index
}

export function getOfficialPriceFieldLabelKey(field: string): string {
  return (
    RATIO_TYPE_OPTIONS.find((option) => option.value === field)?.label ||
    EXTRA_FIELD_LABELS[field] ||
    field
  )
}

function mappingKey(mapping: OfficialPriceMapping): string {
  return `${mapping.source}\u0000${mapping.provider || ''}\u0000${mapping.upstream_model}`
}

function mappingFromCandidate(
  candidate: OfficialPriceCandidate
): OfficialPriceMapping {
  return {
    source: candidate.source,
    provider: candidate.provider,
    upstream_model: candidate.upstream_model,
  }
}

function hasOwnField(
  fields: Record<string, OfficialPriceFieldValue>,
  field: string
): boolean {
  return Object.hasOwn(fields, field)
}

function projectOfficialPriceFields(
  current: Record<string, OfficialPriceFieldValue>,
  candidate: OfficialPriceCandidate
): Record<string, OfficialPriceFieldValue> {
  const next = { ...current }
  const hasModelPrice = hasOwnField(candidate.fields, 'model_price')
  const hasRatioPrice = Object.keys(candidate.fields).some(
    (field) =>
      field !== 'model_price' &&
      field !== 'billing_mode' &&
      field !== 'billing_expr'
  )

  if (hasModelPrice) {
    for (const field of RATIO_PRICE_FIELDS) {
      delete next[field]
    }
  }
  if (hasRatioPrice) {
    delete next.model_price
  }

  for (const [field, value] of Object.entries(candidate.fields)) {
    next[field] = value
  }
  return next
}

export function buildSavedOfficialPriceComparison(
  models: OfficialPriceModelPreview[]
): SavedOfficialPriceComparison {
  const changes: SavedOfficialPriceChange[] = []
  let savedCount = 0
  let skippedCount = 0
  let unchangedCount = 0

  for (const model of models) {
    if (!model.mapping) continue
    savedCount++

    const savedMappingKey = mappingKey(model.mapping)
    const candidate = model.candidates.find(
      (item) => mappingKey(mappingFromCandidate(item)) === savedMappingKey
    )
    if (!candidate) {
      skippedCount++
      continue
    }

    const projected = projectOfficialPriceFields(model.current, candidate)
    const fields = [
      ...new Set([...Object.keys(model.current), ...Object.keys(projected)]),
    ]
      .sort(
        (left, right) =>
          getOfficialPriceFieldOrder(left) - getOfficialPriceFieldOrder(right)
      )
      .flatMap((field) => {
        const current = model.current[field]
        const official = projected[field]
        if (current === official) return []
        return [{ field, current, official }]
      })

    if (fields.length === 0) {
      unchangedCount++
      continue
    }

    changes.push({
      modelName: model.model_name,
      source: candidate.source,
      upstreamModel: candidate.upstream_model,
      fields,
    })
  }

  return { changes, savedCount, skippedCount, unchangedCount }
}
