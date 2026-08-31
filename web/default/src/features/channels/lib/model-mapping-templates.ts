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
): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(
      MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
      JSON.stringify({ version: 1, templates })
    )
    return true
  } catch {
    return false
  }
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

/** Why a template entry did not become a mapping. */
export type ModelMappingTemplateSkipReason =
  /** No served model matches the entry's target, so exposing it would advertise
   *  a model the channel cannot answer. */
  | 'target-not-served'
  /** Normalising the target matched several served models, and picking one
   *  would be a guess about which upstream model the operator meant. */
  | 'target-ambiguous'
  /** The channel already serves the entry's source name, so the mapping
   *  would be an identity no-op. */
  | 'already-served'

export type ModelMappingTemplateSkip = {
  source: string
  target: string
  reason: ModelMappingTemplateSkipReason
  /** Set for 'target-ambiguous': the served models that all matched. */
  candidates?: string[]
}

export type ModelMappingTemplateApplication = {
  /** The whole mapping after the template was applied. */
  mapping: ModelMapping
  /** Surviving template sources against the target they now point at. */
  appliedMapping: ModelMapping
  /** Only what this application added, so callers can detect a no-op. */
  addedMapping: ModelMapping
  skipped: ModelMappingTemplateSkip[]
}

/** Everything after the last slash, so `openai/gpt-4o` and a bare `gpt-4o` can
 *  be compared. Used for matching only — never for the name we store. */
function stripVendorPrefix(model: string) {
  const separator = model.lastIndexOf('/')
  return separator === -1 ? model : model.slice(separator + 1)
}

// Tried in order, first tier with a match wins. Substring matching is
// deliberately absent: `gpt-4o` would match `gpt-4o-mini`, and a mapping that
// silently points at the wrong model is harder to notice than one that is
// missing. Each tier normalises both sides, so the vendor tier matches a
// prefixed template target against a bare served model and vice versa.
const TARGET_MATCH_TIERS: Array<(model: string) => string> = [
  (model) => model,
  (model) => model.toLowerCase(),
  (model) => stripVendorPrefix(model).toLowerCase(),
]

function resolveTemplateTarget(
  target: string,
  servedModels: string[]
): { model: string } | { candidates: string[] } {
  for (const normalize of TARGET_MATCH_TIERS) {
    const normalizedTarget = normalize(target)
    if (!normalizedTarget) continue
    const matches = servedModels.filter(
      (model) => normalize(model) === normalizedTarget
    )
    if (matches.length === 1) return { model: matches[0] }
    if (matches.length > 1) return { candidates: matches }
  }
  return { candidates: [] }
}

/**
 * Applies a template on top of the current mapping.
 *
 * `servedModels` is what the channel actually answers — the models fetched
 * from upstream and kept. A template is a reusable list of exposed names, so it
 * routinely names models a given channel does not have, and an entry whose
 * target is missing must not become a mapping: it would advertise a model the
 * channel cannot answer, and requests for it fail. Pass `undefined` to apply
 * every entry, which is what callers editing a mapping with no channel in
 * context (a tag, or the template's own mapping) need.
 *
 * The target is matched by name, not by identity, so an upstream that returns
 * `openai/gpt-4o` or `GPT-4o` still satisfies a template written against
 * `gpt-4o`. The stored target is always the served model's own name, because
 * that is what gets sent upstream.
 *
 * Sources already present in the current mapping are left alone and reported as
 * applied: they are the operator's own edits, not something this template is
 * introducing.
 */
export function applyModelMappingTemplate(
  currentMapping: ModelMapping,
  templateMapping: ModelMapping,
  servedModels?: string[]
): ModelMappingTemplateApplication {
  const mapping: ModelMapping = { ...currentMapping }
  const appliedMapping: ModelMapping = {}
  const addedMapping: ModelMapping = {}
  const skipped: ModelMappingTemplateSkip[] = []

  const served = servedModels
    ? [...new Set(servedModels.map((model) => model.trim()).filter(Boolean))]
    : null

  for (const [rawSource, rawTarget] of Object.entries(templateMapping)) {
    const source = rawSource.trim()
    const target = rawTarget.trim()
    if (!source) continue

    if (Object.hasOwn(currentMapping, source)) {
      appliedMapping[source] = currentMapping[source]
      continue
    }
    if (!target) continue

    if (!served) {
      mapping[source] = target
      addedMapping[source] = target
      appliedMapping[source] = target
      continue
    }

    const resolved = resolveTemplateTarget(target, served)
    if ('candidates' in resolved) {
      skipped.push({
        source,
        target,
        reason:
          resolved.candidates.length > 0
            ? 'target-ambiguous'
            : 'target-not-served',
        ...(resolved.candidates.length > 0
          ? { candidates: resolved.candidates }
          : {}),
      })
      continue
    }

    // The channel serves the exposed name itself, so it is already reachable
    // and the mapping would be an identity no-op.
    if (resolved.model === source) {
      skipped.push({ source, target, reason: 'already-served' })
      continue
    }

    mapping[source] = resolved.model
    addedMapping[source] = resolved.model
    appliedMapping[source] = resolved.model
  }

  return { mapping, appliedMapping, addedMapping, skipped }
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
