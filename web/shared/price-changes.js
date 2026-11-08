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
// Compare only settings in the pending save. Missing model entries represent
// deletions; omitted settings are outside this save and must stay untouched.
export function buildPriceChanges(before, after) {
  const changes = []
  for (const field of Object.keys(after).sort()) {
    if (field === 'ExposeRatioEnabled') {
      const previous = before[field] === true || before[field] === 'true'
      const next = after[field] === true || after[field] === 'true'
      if (previous !== next)
        changes.push({ field, model: '', before: previous, after: next })
      continue
    }
    const previous = parsePriceMap(before[field])
    const next = parsePriceMap(after[field])
    const models = new Set([...Object.keys(previous), ...Object.keys(next)])
    for (const model of [...models].sort()) {
      const previousValue = Object.hasOwn(previous, model)
        ? previous[model]
        : undefined
      const nextValue = Object.hasOwn(next, model) ? next[model] : undefined
      if (previousValue !== nextValue) {
        changes.push({ field, model, before: previousValue, after: nextValue })
      }
    }
  }
  return changes
}

function parsePriceMap(value) {
  const parsed =
    typeof value === 'string' ? JSON.parse(value || '{}') : (value ?? {})
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a price settings object')
  }
  return parsed
}
