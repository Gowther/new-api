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

export const mergeModelMappingTemplate = (currentMapping, templateMapping) => {
  const currentEntries = Object.entries(currentMapping);
  const addedEntries = Object.entries(templateMapping).filter(
    ([source]) => !Object.prototype.hasOwnProperty.call(currentMapping, source),
  );

  return {
    mapping: Object.fromEntries([...currentEntries, ...addedEntries]),
    addedMapping: Object.fromEntries(addedEntries),
  };
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
