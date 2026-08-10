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

type OfficialClientPassthroughValues = {
  type: number
  header_override?: string
  automatic_channel_test_disabled?: boolean
}

export function supportsOfficialClientPassthrough(type: number): boolean {
  return type === 1 || type === 14
}

function parseHeaderOverride(
  value: string | undefined
): Record<string, unknown> | null {
  if (!value?.trim()) return {}

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function isOfficialClientPassthroughEnabled(
  values: OfficialClientPassthroughValues
): boolean {
  if (!supportsOfficialClientPassthrough(values.type)) return false

  const headerOverride = parseHeaderOverride(values.header_override)
  return Boolean(
    headerOverride &&
    Object.hasOwn(headerOverride, '*') &&
    values.automatic_channel_test_disabled
  )
}

export function updateOfficialClientPassthroughHeader(
  value: string | undefined,
  enabled: boolean
): string | null {
  const headerOverride = parseHeaderOverride(value)
  if (!headerOverride) return null

  if (enabled) {
    headerOverride['*'] = true
  } else {
    delete headerOverride['*']
  }

  if (Object.keys(headerOverride).length === 0) return ''
  return JSON.stringify(headerOverride, null, 2)
}
