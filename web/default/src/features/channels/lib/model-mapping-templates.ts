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

type ModelMapping = Record<string, string>

export type ModelMappingTemplate = {
  id: string
  name: string
  mapping: ModelMapping
}

export const MODEL_MAPPING_TEMPLATES_STORAGE_KEY =
  'new-api:model-mapping-templates:v1'
const LEGACY_DEFAULT_MODEL_MAPPING_TEMPLATE_ID = 'default-gpt-3.5-turbo'

export function normalizeModelMappingTemplate(
  value: unknown
): ModelMappingTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null
  }
  if (
    !candidate.mapping ||
    typeof candidate.mapping !== 'object' ||
    Array.isArray(candidate.mapping)
  ) {
    return null
  }
  const mapping: ModelMapping = {}
  for (const [from, to] of Object.entries(candidate.mapping)) {
    if (typeof to !== 'string') return null
    const source = from.trim()
    if (source) mapping[source] = to
  }
  const name = candidate.name.trim()
  if (!name) return null
  return { id: candidate.id, name, mapping }
}

export function loadModelMappingTemplates(): ModelMappingTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(MODEL_MAPPING_TEMPLATES_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    const persisted = parsed as { version?: unknown; templates?: unknown }
    let values: unknown[] = []
    if (Array.isArray(parsed)) {
      values = parsed
    } else if (persisted.version === 1 && Array.isArray(persisted.templates)) {
      values = persisted.templates
    }
    const templates = values
      .map(normalizeModelMappingTemplate)
      .filter((template): template is ModelMappingTemplate => template !== null)
      .filter(
        (template) => template.id !== LEGACY_DEFAULT_MODEL_MAPPING_TEMPLATE_ID
      )
    if (templates.length !== values.length) {
      persistModelMappingTemplates(templates)
    }
    return templates
  } catch {
    return []
  }
}

export function persistModelMappingTemplates(
  templates: ModelMappingTemplate[]
) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
    JSON.stringify({ version: 1, templates })
  )
}

/** Upserts by id, so renaming a template in place keeps its identity. */
export function upsertModelMappingTemplate(
  templates: ModelMappingTemplate[],
  next: ModelMappingTemplate
): ModelMappingTemplate[] {
  const index = templates.findIndex((template) => template.id === next.id)
  if (index === -1) return [...templates, next]
  return templates.map((template) =>
    template.id === next.id ? next : template
  )
}

export function mergeModelMappingTemplate(
  currentMapping: ModelMapping,
  templateMapping: ModelMapping
): { mapping: ModelMapping; addedMapping: ModelMapping } {
  const currentEntries = Object.entries(currentMapping)
  const addedEntries = Object.entries(templateMapping).filter(
    ([source]) => !Object.hasOwn(currentMapping, source)
  )

  return {
    mapping: Object.fromEntries([...currentEntries, ...addedEntries]),
    addedMapping: Object.fromEntries(addedEntries),
  }
}

export function reconcileModelsForMapping(
  currentModels: string[],
  appliedMapping: ModelMapping,
  completeMapping: ModelMapping = appliedMapping
): string[] {
  const sourceModels = [
    ...new Set(Object.keys(appliedMapping).map((model) => model.trim())),
  ].filter(Boolean)
  const sourceSet = new Set(
    Object.keys(completeMapping)
      .map((model) => model.trim())
      .filter(Boolean)
  )
  const targetSet = new Set(
    Object.values(appliedMapping)
      .map((model) => model.trim())
      .filter((model) => model && !sourceSet.has(model))
  )
  const nextModels: string[] = []
  const seen = new Set<string>()

  for (const rawModel of currentModels) {
    const model = rawModel.trim()
    if (!model || targetSet.has(model) || seen.has(model)) continue
    seen.add(model)
    nextModels.push(model)
  }

  for (const source of sourceModels) {
    if (seen.has(source)) continue
    seen.add(source)
    nextModels.push(source)
  }

  return nextModels
}
