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

export const CC_SWITCH_APP_CONFIGS = {
  claude: {
    label: 'Claude',
    defaultName: 'My Claude',
    modelFields: [
      { key: 'model', labelKey: 'Primary Model', required: true },
      { key: 'haikuModel', labelKey: 'Haiku Model', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet Model', required: false },
      { key: 'opusModel', labelKey: 'Opus Model', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', labelKey: 'Primary Model', required: true }],
  },
} as const

export type CCSwitchApp = keyof typeof CC_SWITCH_APP_CONFIGS

export interface CCSwitchModelOption {
  value: string
  label: string
}

export function normalizeCCSwitchEndpoint(
  app: CCSwitchApp,
  endpoint: string
): string {
  const normalized = endpoint.trim().replace(/\/+$/, '')
  if (app === 'codex' && normalized && !/\/v1$/i.test(normalized)) {
    return `${normalized}/v1`
  }
  return normalized
}

export function getRecommendedCCSwitchApp(channelType: number): CCSwitchApp {
  if (channelType === 14) return 'claude'
  if (channelType === 24) return 'gemini'
  return 'codex'
}

export function getCCSwitchModelOptions(
  models: string | null | undefined,
  modelMapping: string | null | undefined,
  testModel: string | null | undefined
): { options: CCSwitchModelOption[]; defaultModel: string } {
  let mapping: Record<string, string> = {}
  if (modelMapping?.trim()) {
    try {
      const parsed = JSON.parse(modelMapping)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        mapping = Object.fromEntries(
          Object.entries(parsed).filter(
            ([, value]) => typeof value === 'string' && value.trim()
          )
        ) as Record<string, string>
      }
    } catch {
      // A malformed mapping should not prevent exporting the channel models.
    }
  }

  const modelNames = (models ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
  const options: CCSwitchModelOption[] = []
  const seen = new Set<string>()
  for (const model of modelNames) {
    const upstreamModel = mapping[model]?.trim() || model
    if (seen.has(upstreamModel)) continue
    seen.add(upstreamModel)
    options.push({
      value: upstreamModel,
      label: upstreamModel === model ? model : `${model} -> ${upstreamModel}`,
    })
  }

  const testModelName = testModel?.trim() || ''
  const defaultModel = testModelName
    ? mapping[testModelName]?.trim() || testModelName
    : options[0]?.value || ''
  return { options, defaultModel }
}

export function buildCCSwitchURL({
  app,
  name,
  models,
  apiKey,
  endpoint,
  homepage,
}: {
  app: CCSwitchApp
  name: string
  models: Record<string, string>
  apiKey: string
  endpoint: string
  homepage?: string
}): string {
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', app)
  params.set('name', name.trim())
  params.set('endpoint', normalizeCCSwitchEndpoint(app, endpoint))
  params.set('apiKey', apiKey)
  for (const [key, value] of Object.entries(models)) {
    if (value?.trim()) params.set(key, value.trim())
  }
  if (homepage?.trim()) params.set('homepage', homepage.trim())
  params.set('enabled', 'true')
  return `ccswitch://v1/import?${params.toString()}`
}
