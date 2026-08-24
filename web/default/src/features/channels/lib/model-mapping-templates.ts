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
