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

export const CHANNEL_TYPE_ADVANCED_CUSTOM = 58;

export const ADVANCED_CUSTOM_CONVERTER_OPTIONS = [
  { value: 'none', label: 'Native forwarding' },
  {
    value: 'anthropic_messages_to_openai_chat_completions',
    label: 'Anthropic Messages to OpenAI Chat',
  },
  {
    value: 'openai_chat_completions_to_anthropic_messages',
    label: 'OpenAI Chat to Anthropic Messages',
  },
  {
    value: 'openai_chat_completions_to_openai_responses',
    label: 'OpenAI Chat to OpenAI Responses',
  },
  {
    value: 'openai_responses_to_openai_chat_completions',
    label: 'OpenAI Responses to OpenAI Chat',
  },
  {
    value: 'gemini_generate_content_to_openai_chat_completions',
    label: 'Gemini Generate Content to OpenAI Chat',
  },
  {
    value: 'openai_chat_completions_to_gemini_generate_content',
    label: 'OpenAI Chat to Gemini Generate Content',
  },
];

export const ADVANCED_CUSTOM_AUTH_MODE_OPTIONS = [
  { value: 'default', label: 'Default Bearer' },
  { value: 'none', label: 'No Auth' },
  { value: 'header', label: 'Header' },
  { value: 'query', label: 'Query' },
];

export const ADVANCED_CUSTOM_INCOMING_PATH_OPTIONS = [
  { value: '/v1/chat/completions', label: 'OpenAI Chat' },
  { value: '/v1/responses', label: 'OpenAI Responses' },
  { value: '/v1/responses/compact', label: 'OpenAI Responses Compact' },
  { value: '/v1/embeddings', label: 'OpenAI Embeddings' },
  { value: '/v1/images/generations', label: 'OpenAI Image Generations' },
  { value: '/v1/images/edits', label: 'OpenAI Image Edits' },
  { value: '/v1/completions', label: 'OpenAI Completions' },
  { value: '/v1/audio/speech', label: 'OpenAI Audio Speech' },
  {
    value: '/v1/audio/transcriptions',
    label: 'OpenAI Audio Transcriptions',
  },
  { value: '/v1/audio/translations', label: 'OpenAI Audio Translations' },
  { value: '/v1/rerank', label: 'OpenAI Rerank' },
  { value: '/v1/realtime', label: 'OpenAI Realtime' },
  { value: '/v1/messages', label: 'Claude Messages' },
  {
    value: '/v1beta/models/{model}:generateContent',
    label: 'Gemini Generate Content',
  },
  {
    value: '/v1beta/models/{model}:embedContent',
    label: 'Gemini Embed Content',
  },
  {
    value: '/v1beta/models/{model}:batchEmbedContents',
    label: 'Gemini Batch Embed Contents',
  },
];

const ADVANCED_CUSTOM_ROUTE_SUMMARY_LABELS = {
  '/v1/chat/completions': 'OpenAI Chat',
};

const bearerHeaderAuth = () => ({
  type: 'header',
  name: 'Authorization',
  value: 'Bearer {api_key}',
});

const apiKeyHeaderAuth = () => ({
  type: 'header',
  name: 'x-api-key',
  value: '{api_key}',
});

const geminiQueryAuth = () => ({
  type: 'query',
  name: 'key',
  value: '{api_key}',
});

export const ADVANCED_CUSTOM_TEMPLATE_OPTIONS = [
  {
    value: 'official_openai_chat',
    label: 'Official OpenAI Chat',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/chat/completions',
          upstream_path: '/v1/chat/completions',
          converter: 'none',
          auth: bearerHeaderAuth(),
        },
      ],
    },
  },
  {
    value: 'official_openai_responses',
    label: 'Official OpenAI Responses',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/responses',
          upstream_path: '/v1/responses',
          converter: 'none',
          auth: bearerHeaderAuth(),
        },
      ],
    },
  },
  {
    value: 'official_openai_embeddings',
    label: 'Official OpenAI Embeddings',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/embeddings',
          upstream_path: '/v1/embeddings',
          converter: 'none',
          auth: bearerHeaderAuth(),
        },
      ],
    },
  },
  {
    value: 'official_openai_images',
    label: 'Official OpenAI Images',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/images/generations',
          upstream_path: '/v1/images/generations',
          converter: 'none',
          auth: bearerHeaderAuth(),
        },
        {
          incoming_path: '/v1/images/edits',
          upstream_path: '/v1/images/edits',
          converter: 'none',
          auth: bearerHeaderAuth(),
        },
      ],
    },
  },
  {
    value: 'official_claude_messages',
    label: 'Official Claude Messages',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/messages',
          upstream_path: '/v1/messages',
          converter: 'none',
          auth: apiKeyHeaderAuth(),
        },
      ],
    },
  },
  {
    value: 'official_gemini_native',
    label: 'Official Gemini Native',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1beta/models/{model}:generateContent',
          upstream_path: '/v1beta/models/{model}:generateContent',
          converter: 'none',
          auth: geminiQueryAuth(),
        },
        {
          incoming_path: '/v1beta/models/{model}:embedContent',
          upstream_path: '/v1beta/models/{model}:embedContent',
          converter: 'none',
          auth: geminiQueryAuth(),
        },
        {
          incoming_path: '/v1beta/models/{model}:batchEmbedContents',
          upstream_path: '/v1beta/models/{model}:batchEmbedContents',
          converter: 'none',
          auth: geminiQueryAuth(),
        },
      ],
    },
  },
  {
    value: 'official_gemini_from_openai_chat',
    label: 'Official Gemini from OpenAI Chat',
    config: {
      advanced_routes: [
        {
          incoming_path: '/v1/chat/completions',
          upstream_path: '/v1beta/models/{model}:generateContent',
          converter: 'openai_chat_completions_to_gemini_generate_content',
          auth: geminiQueryAuth(),
        },
      ],
    },
  },
];

export const cloneAdvancedCustomConfig = (config) =>
  JSON.parse(JSON.stringify(config));

export const getAdvancedCustomTemplateConfig = (templateKey) => {
  const template =
    ADVANCED_CUSTOM_TEMPLATE_OPTIONS.find(
      (option) => option.value === templateKey,
    ) || ADVANCED_CUSTOM_TEMPLATE_OPTIONS[0];
  return cloneAdvancedCustomConfig(template.config);
};

export const createAdvancedCustomRoute = () => ({
  incoming_path: '/v1/chat/completions',
  upstream_path: '/v1/chat/completions',
  converter: 'none',
});

export const createAdvancedCustomConfig = () => ({
  advanced_routes: [createAdvancedCustomRoute()],
});

export const getAdvancedCustomUpstreamPathPlaceholder = (converter) => {
  if (converter === 'openai_chat_completions_to_gemini_generate_content') {
    return '/v1beta/models/{model}:generateContent';
  }
  if (converter === 'openai_chat_completions_to_anthropic_messages') {
    return '/v1/messages';
  }
  if (converter === 'openai_responses_to_openai_chat_completions') {
    return '/v1/chat/completions';
  }
  return '/v1/chat/completions';
};

export const getAdvancedCustomIncomingPathOptions = (converter) =>
  ADVANCED_CUSTOM_INCOMING_PATH_OPTIONS.filter((option) =>
    isConverterPathAllowed(option.value, converter),
  );

export const getDefaultAdvancedCustomIncomingPath = (converter) =>
  getAdvancedCustomIncomingPathOptions(converter)[0]?.value ||
  '/v1/chat/completions';

export const isAdvancedCustomIncomingPathAllowed = (incomingPath, converter) =>
  isConverterPathAllowed(incomingPath, converter);

export const getAdvancedCustomConverterOptions = (incomingPath) => {
  const normalizedIncomingPath = String(incomingPath || '').trim();
  return ADVANCED_CUSTOM_CONVERTER_OPTIONS.filter(
    (option) =>
      option.value === 'none' ||
      isConverterPathAllowed(normalizedIncomingPath, option.value),
  );
};

export const getAdvancedCustomIncomingPathLabel = (value) =>
  ADVANCED_CUSTOM_INCOMING_PATH_OPTIONS.find((option) => option.value === value)
    ?.label || value;

export const parseAdvancedCustomConfig = (value) => {
  if (!String(value || '').trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return normalizeAdvancedCustomConfig(parsed);
  } catch {
    return null;
  }
};

export const stringifyAdvancedCustomConfig = (config) =>
  JSON.stringify(normalizeAdvancedCustomConfig(config), null, 2);

export const normalizeAdvancedCustomConfig = (config) => {
  const routes = Array.isArray(config?.advanced_routes)
    ? config.advanced_routes.map(normalizeAdvancedCustomRoute)
    : [];
  return { advanced_routes: routes };
};

export const validateAdvancedCustomConfig = (config) => {
  if (!config) {
    return { message: 'Advanced custom configuration is required' };
  }

  const normalized = normalizeAdvancedCustomConfig(config);
  const routes = normalized.advanced_routes || [];
  if (routes.length === 0) {
    return {
      message: 'Advanced custom configuration requires at least one route',
    };
  }

  const seenPaths = new Set();
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const incomingPath = String(route.incoming_path || '').trim();
    const upstreamPath = getAdvancedCustomRouteUpstreamPath(route);
    const converter = route.converter || 'none';

    if (!incomingPath) {
      return { routeIndex: index, message: 'Incoming path is required' };
    }
    if (!incomingPath.startsWith('/')) {
      return {
        routeIndex: index,
        message: 'Incoming path must start with /',
      };
    }
    if (incomingPath.includes('?')) {
      return {
        routeIndex: index,
        message: 'Incoming path must not include query',
      };
    }
    if (seenPaths.has(incomingPath)) {
      return { routeIndex: index, message: 'Incoming path must be unique' };
    }
    seenPaths.add(incomingPath);

    if (!upstreamPath) {
      return { routeIndex: index, message: 'Upstream path is required' };
    }
    if (!isFullHttpURLOrAbsolutePath(upstreamPath)) {
      return {
        routeIndex: index,
        message: 'Upstream path must be a full URL or a path starting with /',
      };
    }
    if (!isAdvancedCustomConverter(converter)) {
      return { routeIndex: index, message: 'Converter is not registered' };
    }
    if (!isConverterPathAllowed(incomingPath, converter)) {
      return {
        routeIndex: index,
        message: 'Converter does not match incoming path',
      };
    }

    const authError = validateRouteAuth(route.auth);
    if (authError) return { routeIndex: index, message: authError };
  }

  return null;
};

export const advancedCustomConfigUsesRelativeUpstreamPath = (config) => {
  if (!config) return false;
  return normalizeAdvancedCustomConfig(config).advanced_routes.some((route) =>
    getAdvancedCustomRouteUpstreamPath(route).startsWith('/'),
  );
};

export const getAdvancedCustomStats = (value) => {
  const config = parseAdvancedCustomConfig(value);
  if (!config) {
    return { routeCount: 0, valid: false, routeTypeLabels: [] };
  }

  const routes = normalizeAdvancedCustomConfig(config).advanced_routes;
  const routeTypeLabels = [];
  const seenRouteTypeLabels = new Set();
  routes.forEach((route) => {
    const label = getAdvancedCustomRouteSummaryLabel(route);
    if (!label || seenRouteTypeLabels.has(label)) return;
    routeTypeLabels.push(label);
    seenRouteTypeLabels.add(label);
  });

  return {
    routeCount: routes.length,
    valid: validateAdvancedCustomConfig(config) === null,
    routeTypeLabels,
  };
};

export const getAdvancedCustomAuthMode = (route) =>
  route.auth?.type || 'default';

export const buildAdvancedCustomAuth = (mode, previousAuth) => {
  if (mode === 'default') return undefined;
  if (mode === 'none') return { type: 'none' };
  if (mode === 'header') {
    return {
      type: 'header',
      name: previousAuth?.name || 'Authorization',
      value: previousAuth?.value || 'Bearer {api_key}',
    };
  }
  return {
    type: 'query',
    name: previousAuth?.name || 'api_key',
    value: previousAuth?.value || '{api_key}',
  };
};

const normalizeAdvancedCustomRoute = (route) => {
  const source = route && typeof route === 'object' ? route : {};
  const nextRoute = {
    incoming_path: source.incoming_path || '',
    upstream_path: getAdvancedCustomRouteUpstreamPath(source),
    converter: source.converter || 'none',
  };
  if (source.auth && typeof source.auth === 'object') {
    nextRoute.auth = {
      type: source.auth.type,
      name: source.auth.name || '',
      value: source.auth.value || '',
    };
  }
  return nextRoute;
};

const getAdvancedCustomRouteUpstreamPath = (route) =>
  String(route?.upstream_path || '').trim();

const getAdvancedCustomRouteSummaryLabel = (route) => {
  const incomingPath = String(route?.incoming_path || '').trim();
  if (!incomingPath) return null;
  return (
    ADVANCED_CUSTOM_ROUTE_SUMMARY_LABELS[incomingPath] ||
    getAdvancedCustomIncomingPathLabel(incomingPath)
  );
};

const isFullHttpURLOrAbsolutePath = (value) => {
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    const parsed = new URL(value);
    return (
      Boolean(parsed.host) &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    );
  } catch {
    return false;
  }
};

const isAdvancedCustomConverter = (value) =>
  ADVANCED_CUSTOM_CONVERTER_OPTIONS.some((option) => option.value === value);

const isConverterPathAllowed = (incomingPath, converter) => {
  if (converter === 'none') return true;
  if (converter === 'anthropic_messages_to_openai_chat_completions') {
    return incomingPath === '/v1/messages';
  }
  if (
    converter === 'openai_chat_completions_to_anthropic_messages' ||
    converter === 'openai_chat_completions_to_openai_responses' ||
    converter === 'openai_chat_completions_to_gemini_generate_content'
  ) {
    return incomingPath === '/v1/chat/completions';
  }
  if (converter === 'openai_responses_to_openai_chat_completions') {
    return incomingPath === '/v1/responses';
  }
  return (
    incomingPath.includes(':generateContent') ||
    incomingPath.includes(':streamGenerateContent')
  );
};

const validateRouteAuth = (auth) => {
  if (!auth || auth.type === 'none') return null;
  if (auth.type !== 'header' && auth.type !== 'query') {
    return 'Auth type is invalid';
  }
  if (!String(auth.name || '').trim()) return 'Auth name is required';
  if (!String(auth.value || '').trim()) return 'Auth value is required';
  return null;
};
