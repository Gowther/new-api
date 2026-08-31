/*
Copyright (C) 2025 QuantumNous

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

export const MODEL_MAPPING_TEMPLATES_STORAGE_KEY =
  'new-api:model-mapping-templates:v1';
const LEGACY_DEFAULT_MODEL_MAPPING_TEMPLATE_ID = 'default-gpt-3.5-turbo';

export const normalizeModelMappingTemplate = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const mapping = value.mapping || value.value;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !mapping ||
    typeof mapping !== 'object' ||
    Array.isArray(mapping)
  ) {
    return null;
  }
  const normalizedMapping = {};
  for (const [key, item] of Object.entries(mapping)) {
    if (typeof item !== 'string') return null;
    const trimmedKey = String(key).trim();
    if (trimmedKey) normalizedMapping[trimmedKey] = item;
  }
  const name = value.name.trim();
  return name ? { id: value.id, name, mapping: normalizedMapping } : null;
};

export const persistModelMappingTemplates = (templates) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
    JSON.stringify({ version: 1, templates }),
  );
};

export const loadModelMappingTemplates = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(
      MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed)
      ? parsed
      : parsed?.version === 1 && Array.isArray(parsed.templates)
        ? parsed.templates
        : [];
    const templates = values
      .map(normalizeModelMappingTemplate)
      .filter(Boolean)
      .filter((item) => item.id !== LEGACY_DEFAULT_MODEL_MAPPING_TEMPLATE_ID);
    if (templates.length !== values.length) {
      persistModelMappingTemplates(templates);
    }
    return templates;
  } catch {
    return [];
  }
};

/** Upserts by id, so renaming a template in place keeps its identity. */
export const upsertModelMappingTemplate = (templates, next) => {
  const index = templates.findIndex((item) => item.id === next.id);
  if (index === -1) return [...templates, next];
  return templates.map((item) => (item.id === next.id ? next : item));
};

/** Everything after the last slash, so `openai/gpt-4o` and a bare `gpt-4o` can
 *  be compared. Used for matching only — never for the name we store. */
const stripVendorPrefix = (model) => {
  const separator = model.lastIndexOf('/');
  return separator === -1 ? model : model.slice(separator + 1);
};

// Tried in order, first tier with a match wins. Substring matching is
// deliberately absent: `gpt-4o` would match `gpt-4o-mini`, and a mapping that
// silently points at the wrong model is harder to notice than one that is
// missing. Each tier normalises both sides, so the vendor tier matches a
// prefixed template target against a bare served model and vice versa.
const TARGET_MATCH_TIERS = [
  (model) => model,
  (model) => model.toLowerCase(),
  (model) => stripVendorPrefix(model).toLowerCase(),
];

const resolveTemplateTarget = (target, servedModels) => {
  for (const normalize of TARGET_MATCH_TIERS) {
    const normalizedTarget = normalize(target);
    if (!normalizedTarget) continue;
    const matches = servedModels.filter(
      (model) => normalize(model) === normalizedTarget,
    );
    if (matches.length === 1) return { model: matches[0] };
    if (matches.length > 1) return { candidates: matches };
  }
  return { candidates: [] };
};

/**
 * Applies a template on top of the current mapping.
 *
 * `servedModels` is what the channel actually answers — the models fetched from
 * upstream and kept. A template is a reusable list of exposed names, so it
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
export const applyModelMappingTemplate = (
  currentMapping,
  templateMapping,
  servedModels,
) => {
  const mapping = { ...currentMapping };
  const appliedMapping = {};
  const addedMapping = {};
  const skipped = [];

  const served = servedModels
    ? [
        ...new Set(
          servedModels
            .map((model) => String(model || '').trim())
            .filter(Boolean),
        ),
      ]
    : null;

  for (const [rawSource, rawTarget] of Object.entries(templateMapping)) {
    const source = String(rawSource || '').trim();
    const target = String(rawTarget || '').trim();
    if (!source) continue;

    if (Object.prototype.hasOwnProperty.call(currentMapping, source)) {
      appliedMapping[source] = currentMapping[source];
      continue;
    }
    if (!target) continue;

    if (!served) {
      mapping[source] = target;
      addedMapping[source] = target;
      appliedMapping[source] = target;
      continue;
    }

    const resolved = resolveTemplateTarget(target, served);
    if (resolved.candidates) {
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
      });
      continue;
    }

    // The channel serves the exposed name itself, so it is already reachable and
    // the mapping would be an identity no-op.
    if (resolved.model === source) {
      skipped.push({ source, target, reason: 'already-served' });
      continue;
    }

    mapping[source] = resolved.model;
    addedMapping[source] = resolved.model;
    appliedMapping[source] = resolved.model;
  }

  return { mapping, appliedMapping, addedMapping, skipped };
};

export const reconcileModelsForMapping = (
  currentModels,
  appliedMapping,
  completeMapping = appliedMapping,
) => {
  const sourceModels = [
    ...new Set(Object.keys(appliedMapping).map((model) => model.trim())),
  ].filter(Boolean);
  const sourceSet = new Set(
    Object.keys(completeMapping)
      .map((model) => model.trim())
      .filter(Boolean),
  );
  const targetSet = new Set(
    Object.values(appliedMapping)
      .map((model) => model.trim())
      .filter((model) => model && !sourceSet.has(model)),
  );
  const nextModels = [];
  const seen = new Set();

  for (const rawModel of currentModels) {
    const model = String(rawModel || '').trim();
    if (!model || targetSet.has(model) || seen.has(model)) continue;
    seen.add(model);
    nextModels.push(model);
  }

  for (const source of sourceModels) {
    if (seen.has(source)) continue;
    seen.add(source);
    nextModels.push(source);
  }

  return nextModels;
};
