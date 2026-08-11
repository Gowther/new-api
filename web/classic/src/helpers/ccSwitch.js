/*
Copyright (C) 2025 QuantumNous

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
      { key: 'model', labelKey: '主模型', required: true },
      { key: 'haikuModel', labelKey: 'Haiku 模型', required: false },
      { key: 'sonnetModel', labelKey: 'Sonnet 模型', required: false },
      { key: 'opusModel', labelKey: 'Opus 模型', required: false },
    ],
  },
  codex: {
    label: 'Codex',
    defaultName: 'My Codex',
    modelFields: [{ key: 'model', labelKey: '主模型', required: true }],
  },
  gemini: {
    label: 'Gemini',
    defaultName: 'My Gemini',
    modelFields: [{ key: 'model', labelKey: '主模型', required: true }],
  },
};

export function normalizeCCSwitchEndpoint(app, endpoint) {
  const normalized = String(endpoint || '')
    .trim()
    .replace(/\/+$/, '');
  if (app === 'codex' && normalized && !/\/v1$/i.test(normalized)) {
    return `${normalized}/v1`;
  }
  return normalized;
}

export function getRecommendedCCSwitchApp(channelType) {
  if (channelType === 14) return 'claude';
  if (channelType === 24) return 'gemini';
  return 'codex';
}

export function getCCSwitchModelOptions(models, modelMapping, testModel) {
  let mapping = {};
  if (modelMapping?.trim()) {
    try {
      const parsed = JSON.parse(modelMapping);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        mapping = Object.fromEntries(
          Object.entries(parsed).filter(
            ([, value]) => typeof value === 'string' && value.trim(),
          ),
        );
      }
    } catch (_) {}
  }

  const names = String(models || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const options = [];
  const seen = new Set();
  names.forEach((model) => {
    const upstreamModel = mapping[model]?.trim() || model;
    if (seen.has(upstreamModel)) return;
    seen.add(upstreamModel);
    options.push({
      value: upstreamModel,
      label: upstreamModel === model ? model : `${model} -> ${upstreamModel}`,
    });
  });

  const testModelName = String(testModel || '').trim();
  return {
    options,
    defaultModel: testModelName
      ? mapping[testModelName]?.trim() || testModelName
      : options[0]?.value || '',
  };
}

export function buildCCSwitchURL({
  app,
  name,
  models,
  apiKey,
  endpoint,
  homepage,
}) {
  const params = new URLSearchParams();
  params.set('resource', 'provider');
  params.set('app', app);
  params.set('name', String(name || '').trim());
  params.set('endpoint', normalizeCCSwitchEndpoint(app, endpoint));
  params.set('apiKey', apiKey);
  Object.entries(models || {}).forEach(([key, value]) => {
    if (value?.trim()) params.set(key, value.trim());
  });
  if (homepage?.trim()) params.set('homepage', homepage.trim());
  params.set('enabled', 'true');
  return `ccswitch://v1/import?${params.toString()}`;
}
