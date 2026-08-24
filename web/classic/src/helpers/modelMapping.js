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
