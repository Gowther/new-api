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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Radio,
  RadioGroup,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconBookmark,
  IconCopy,
  IconDelete,
  IconEdit,
  IconHistogram,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSearch,
  IconUndo,
} from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useIsMobile } from '../../../hooks/common/useIsMobile';

import { ChannelRemarkTooltip } from '../../common/ChannelRemarkTooltip';
import { CHANNEL_OPTIONS } from '../../../constants';
import {
  API,
  CHANNEL_CREATED_EVENT,
  copy,
  getChannelIcon,
  getLobeHubIcon,
  showError,
  showInfo,
  showSuccess,
  timestamp2string,
} from '../../../helpers';
import EditChannelModal from '../channels/modals/EditChannelModal';
import ModelTestModal from '../channels/modals/ModelTestModal';
import {
  fetchRoutingOverrideConflicts,
  renderRoutingOverrideConflicts,
} from '../channels/routingOverrideConflicts';

const { Text } = Typography;

const ROUTING_PAGE_SIZE = 100;
const UNASSIGNED_PROVIDER_KEY = '__unassigned__';
const ROUTING_ROLE_LABELS = ['主', '备', '兜底'];
const ROUTING_ROLE_COLORS = ['green', 'blue', 'orange'];
const ROUTING_DEFAULT_SELECTION_KEY = 'model-routing-default-selection';
const ROUTING_LAST_SELECTION_KEY = 'model-routing-last-selection';
const ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY =
  'model-routing-provider-default-selections:v1';
const ROUTING_LAST_PROVIDER_KEY = 'model-routing-last-provider:v1';
const ROUTING_SHOW_ALL_MODELS_KEY = 'model-routing-show-all-models:v1';
const PREFERRED_DEFAULT_VENDOR_NAME = 'OpenAI';
const PREFERRED_DEFAULT_MODEL_NAME = 'gpt-5.5';

const CHANNEL_STATUS = {
  UNKNOWN: 0,
  ENABLED: 1,
  MANUAL_DISABLED: 2,
  AUTO_DISABLED: 3,
};

const CHANNEL_STATUS_META = {
  [CHANNEL_STATUS.UNKNOWN]: { label: '未知', color: 'grey' },
  [CHANNEL_STATUS.ENABLED]: { label: '已启用', color: 'green' },
  [CHANNEL_STATUS.MANUAL_DISABLED]: { label: '已禁用', color: 'red' },
  [CHANNEL_STATUS.AUTO_DISABLED]: { label: '自动禁用', color: 'orange' },
};

const renderRoutingChannelStatusTag = (channel, t) => {
  const statusMeta =
    CHANNEL_STATUS_META[channel.status] ||
    CHANNEL_STATUS_META[CHANNEL_STATUS.UNKNOWN];
  // shrink-0 keeps flex from squeezing the tag below its text width, which
  // truncated the longer labels such as 自动禁用 in the status column.
  const statusTag = (
    <Tag
      color={statusMeta.color}
      shape='circle'
      size='small'
      className='shrink-0'
    >
      {t(statusMeta.label)}
    </Tag>
  );

  if (channel.status !== CHANNEL_STATUS.AUTO_DISABLED) {
    return statusTag;
  }

  try {
    const otherInfo = channel.other_info
      ? JSON.parse(channel.other_info)
      : null;
    const reason = otherInfo?.status_reason || '';
    const time = otherInfo?.status_time || 0;
    const details =
      (reason ? t('原因：') + reason : '') +
      (time ? t('，时间：') + timestamp2string(time) : '');
    return details ? (
      <Tooltip content={details}>{statusTag}</Tooltip>
    ) : (
      statusTag
    );
  } catch {
    return statusTag;
  }
};

const ROUTING_CHANNEL_GROUP = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
};

const getRoutingChannelGroup = (channel) =>
  channel.status === CHANNEL_STATUS.ENABLED
    ? ROUTING_CHANNEL_GROUP.ENABLED
    : ROUTING_CHANNEL_GROUP.DISABLED;

const CHANNEL_TYPE_LABELS = CHANNEL_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

const splitCsv = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getProviderKey = (model) =>
  model.vendor_id ? String(model.vendor_id) : UNASSIGNED_PROVIDER_KEY;

const getRoutingSelectionFromModel = (model) => ({
  providerKey: getProviderKey(model),
  modelName: model.model_name,
});

const readStoredRoutingSelection = (key) => {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    if (!parsed?.providerKey || !parsed?.modelName) return null;
    return {
      providerKey: String(parsed.providerKey),
      modelName: String(parsed.modelName),
    };
  } catch {
    return null;
  }
};

const writeStoredRoutingSelection = (key, selection) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(selection));
  } catch {}
};

const readStoredProviderDefaultSelections = () => {
  const selections = {};

  try {
    const rawValue = window.localStorage.getItem(
      ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY,
    );
    if (rawValue) {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.entries(parsed).forEach(([providerKey, modelName]) => {
          if (typeof modelName !== 'string' || modelName.trim() === '') return;
          selections[String(providerKey)] = modelName;
        });
      }
    }
  } catch {}

  const legacyDefault = readStoredRoutingSelection(
    ROUTING_DEFAULT_SELECTION_KEY,
  );
  if (legacyDefault && selections[legacyDefault.providerKey] === undefined) {
    selections[legacyDefault.providerKey] = legacyDefault.modelName;
  }

  return selections;
};

const writeStoredProviderDefaultSelections = (selections) => {
  try {
    window.localStorage.setItem(
      ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY,
      JSON.stringify(selections),
    );
  } catch {}
};

const readStoredProviderKey = (key) => {
  try {
    const providerKey = window.localStorage.getItem(key);
    return providerKey ? String(providerKey) : null;
  } catch {
    return null;
  }
};

const writeStoredProviderKey = (key, providerKey) => {
  try {
    window.localStorage.setItem(key, providerKey);
  } catch {}
};

const readStoredShowAllModels = () => {
  try {
    return window.localStorage.getItem(ROUTING_SHOW_ALL_MODELS_KEY) !== 'false';
  } catch {
    return true;
  }
};

const writeStoredShowAllModels = (showAllModels) => {
  try {
    window.localStorage.setItem(
      ROUTING_SHOW_ALL_MODELS_KEY,
      String(showAllModels),
    );
  } catch {}
};

const findModelForSelection = (models, selection) => {
  if (!selection) return null;
  return (
    models.find(
      (model) =>
        getProviderKey(model) === selection.providerKey &&
        model.model_name === selection.modelName,
    ) || null
  );
};

const findProviderDefaultModel = (models, providerDefaults, providerKey) => {
  if (!providerKey) return null;
  const modelName = providerDefaults[providerKey];
  if (!modelName) return null;
  return findModelForSelection(models, { providerKey, modelName });
};

const findFirstModelForProvider = (models, providerKey) => {
  if (!providerKey) return null;
  return (
    models
      .filter((model) => getProviderKey(model) === providerKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name))[0] || null
  );
};

const findPreferredDefaultModel = (models) =>
  models.find(
    (model) =>
      model.vendor_name === PREFERRED_DEFAULT_VENDOR_NAME &&
      model.model_name === PREFERRED_DEFAULT_MODEL_NAME,
  ) || null;

const resolveInitialRoutingSelection = (models, providerDefaults) => {
  const lastProviderKey = readStoredProviderKey(ROUTING_LAST_PROVIDER_KEY);
  const lastProviderDefault = findProviderDefaultModel(
    models,
    providerDefaults,
    lastProviderKey,
  );
  if (lastProviderDefault) {
    return getRoutingSelectionFromModel(lastProviderDefault);
  }

  const firstLastProviderModel = findFirstModelForProvider(
    models,
    lastProviderKey,
  );
  if (firstLastProviderModel) {
    return getRoutingSelectionFromModel(firstLastProviderModel);
  }

  const legacyDefault = readStoredRoutingSelection(
    ROUTING_DEFAULT_SELECTION_KEY,
  );
  const validLegacyDefault = findModelForSelection(models, legacyDefault);
  if (validLegacyDefault) {
    return getRoutingSelectionFromModel(validLegacyDefault);
  }

  const lastSelection = readStoredRoutingSelection(ROUTING_LAST_SELECTION_KEY);
  const validLast = findModelForSelection(models, lastSelection);
  if (validLast) return getRoutingSelectionFromModel(validLast);

  const preferredDefault = findPreferredDefaultModel(models);
  return preferredDefault
    ? getRoutingSelectionFromModel(preferredDefault)
    : null;
};

const isSameProviderDefaultSelection = (selection, providerDefaults) => {
  if (!selection) return false;
  return providerDefaults[selection.providerKey] === selection.modelName;
};

const getRoutingModelNames = (model) => {
  return model ? [model.model_name] : [];
};

const getModelInitial = (modelName) => {
  return (modelName || '').trim().charAt(0).toUpperCase() || '?';
};

const openUsageLogs = (modelName, channelId) => {
  const searchParams = new URLSearchParams({ model: modelName });
  if (channelId !== undefined) {
    searchParams.set('channel', String(channelId));
  }
  window.open(
    `/console/log?${searchParams.toString()}`,
    '_blank',
    'noopener,noreferrer',
  );
};

const channelSupportsModel = (channel, modelNames) => {
  if (modelNames.length === 0) return false;
  const channelModels = new Set(splitCsv(channel.models));
  return modelNames.some((modelName) => channelModels.has(modelName));
};

const getChannelModelNames = (channels) => {
  const modelNames = new Set();
  channels.forEach((channel) => {
    splitCsv(channel.models).forEach((modelName) => modelNames.add(modelName));
  });
  return Array.from(modelNames);
};

const buildRoutingCatalog = (
  pricingModels,
  pricingVendors,
  channels,
  modelVendorGroups,
) => {
  const vendorsById = new Map();
  pricingVendors.forEach((vendor) => vendorsById.set(vendor.id, vendor));
  modelVendorGroups.forEach((group) => {
    if (group.vendor_id <= 0 || vendorsById.has(group.vendor_id)) return;
    vendorsById.set(group.vendor_id, {
      id: group.vendor_id,
      name: group.vendor_name,
    });
  });

  const vendorIdByModel = new Map();
  modelVendorGroups.forEach((group) => {
    if (group.vendor_id <= 0) return;
    group.models.forEach((modelName) => {
      vendorIdByModel.set(modelName, group.vendor_id);
    });
  });

  const channelCountByModel = new Map();
  channels.forEach((channel) => {
    const channelModels = new Set(splitCsv(channel.models));
    channelModels.forEach((modelName) => {
      channelCountByModel.set(
        modelName,
        (channelCountByModel.get(modelName) || 0) + 1,
      );
    });
  });

  const modelsByName = new Map();
  pricingModels.forEach((model) => {
    modelsByName.set(model.model_name, {
      model_name: model.model_name,
      icon: model.icon,
      vendor_id: model.vendor_id,
      vendor_name: model.vendor_name,
      vendor_icon: model.vendor_icon,
      vendor_description: model.vendor_description,
      channelCount: channelCountByModel.get(model.model_name) || 0,
    });
  });

  channelCountByModel.forEach((channelCount, modelName) => {
    if (modelsByName.has(modelName)) return;
    const vendorId = vendorIdByModel.get(modelName);
    const vendor = vendorId ? vendorsById.get(vendorId) : null;
    modelsByName.set(modelName, {
      model_name: modelName,
      vendor_id: vendorId,
      vendor_name: vendor?.name,
      vendor_icon: vendor?.icon,
      vendor_description: vendor?.description,
      channelCount,
    });
  });

  return {
    models: Array.from(modelsByName.values()),
    vendors: Array.from(vendorsById.values()),
  };
};

const getFieldValue = (channel, changes, field) => {
  const changedValue = changes[channel.id]?.[field];
  if (changedValue !== undefined) return changedValue;
  return channel[field] ?? 0;
};

const sortRoutingChannels = (channels, changes = {}) =>
  [...channels].sort((a, b) => {
    const statusDiff =
      Number(b.status === CHANNEL_STATUS.ENABLED) -
      Number(a.status === CHANNEL_STATUS.ENABLED);
    if (statusDiff !== 0) return statusDiff;

    const priorityDiff =
      getFieldValue(b, changes, 'priority') -
      getFieldValue(a, changes, 'priority');
    if (priorityDiff !== 0) return priorityDiff;

    const weightDiff =
      getFieldValue(b, changes, 'weight') - getFieldValue(a, changes, 'weight');
    if (weightDiff !== 0) return weightDiff;

    return a.id - b.id;
  });

const getChangedCount = (changes) =>
  Object.values(changes).filter(
    (change) => change.priority !== undefined || change.weight !== undefined,
  ).length;

const fetchPricingRoutingData = async () => {
  const res = await API.get('/api/pricing');
  const { success, message, data, vendors } = res.data || {};
  if (!success) {
    throw new Error(message || '获取模型列表失败');
  }
  const vendorMap = {};
  (vendors || []).forEach((vendor) => {
    vendorMap[vendor.id] = vendor;
  });
  return {
    models: (data || []).map((model) => {
      const vendor = model.vendor_id ? vendorMap[model.vendor_id] : null;
      return {
        ...model,
        vendor_name: vendor?.name,
        vendor_icon: vendor?.icon,
        vendor_description: vendor?.description,
      };
    }),
    vendors: vendors || [],
  };
};

const fetchAllChannels = async () => {
  const channels = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await API.get(
      `/api/channel?p=${page}&page_size=${ROUTING_PAGE_SIZE}`,
    );
    const { success, message, data } = res.data || {};
    if (!success) {
      throw new Error(message || '获取渠道列表失败');
    }

    const items = data?.items || [];
    channels.push(...items);

    const total = data?.total || channels.length;
    hasMore = channels.length < total && items.length > 0;
    page += 1;
  }

  const modelNames = getChannelModelNames(channels);
  let modelVendorGroups = [];
  if (modelNames.length > 0) {
    try {
      const res = await API.post('/api/channel/model_vendor_groups', {
        models: modelNames,
      });
      if (res?.data?.success) {
        modelVendorGroups = res.data.data || [];
      }
    } catch {}
  }

  return {
    channels: sortRoutingChannels(channels),
    modelVendorGroups,
  };
};

const fetchModelRoutingOverride = async () => {
  const res = await API.get('/api/channel/model_routing_override', {
    params: {},
  });
  const { success, message, data } = res.data || {};
  if (!success) {
    throw new Error(message || '加载临时路由模式失败');
  }
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
};

const ModelRoutingWorkbench = ({ targetModelName, targetChannelId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [models, setModels] = useState([]);
  const [channels, setChannels] = useState([]);
  // One search above all three columns, in place of the old per-column filters.
  // 'model' matches model names; 'channel' matches channel name or id and then
  // resolves to the models those channels serve.
  const [searchMode, setSearchMode] = useState('channel');
  const [searchQuery, setSearchQuery] = useState('');
  // Which query the auto-jump has already been applied for.
  const appliedSearchTokenRef = useRef(null);
  // Holds the channel list as it was when the create finished, so the jump can
  // tell "the catalog has not caught up yet" from "this model is unknown".
  const [pendingCreated, setPendingCreated] = useState(null);
  // Set by the temporary-mode banner to mark its channel's row. It behaves like
  // targetChannelId, except it comes from inside the workbench, and it lasts
  // until the operator moves through the columns themselves.
  const [focusedChannelId, setFocusedChannelId] = useState(null);
  // The row to scroll to, consumed once. Kept apart from the marks above because
  // those persist: an effect that scrolls for as long as a channel stays marked
  // re-runs on every routingChanges edit and drags the table away mid-keystroke.
  const [pendingScrollChannelId, setPendingScrollChannelId] = useState(
    targetChannelId || null,
  );
  const [showAllModels, setShowAllModels] = useState(() =>
    readStoredShowAllModels(),
  );
  const [selectedProviderKey, setSelectedProviderKey] = useState(null);
  const [selectedModelName, setSelectedModelName] = useState(null);
  const [routingChanges, setRoutingChanges] = useState({});
  const [statusUpdatingIds, setStatusUpdatingIds] = useState({});
  const [editingChannel, setEditingChannel] = useState({ id: undefined });
  const [showEditChannel, setShowEditChannel] = useState(false);
  const [deletingChannelId, setDeletingChannelId] = useState(null);
  const [copyingChannelId, setCopyingChannelId] = useState(null);
  const [testingChannel, setTestingChannel] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModels, setTestingModels] = useState(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState([]);
  const [isBatchTesting, setIsBatchTesting] = useState(false);
  const [modelSearchKeyword, setModelSearchKeyword] = useState('');
  const [modelTablePage, setModelTablePage] = useState(1);
  const [selectedEndpointType, setSelectedEndpointType] = useState('');
  const [isStreamTest, setIsStreamTest] = useState(false);
  // ModelTestModal writes through this ref while its select-all runs.
  const testModalAllSelectingRef = useRef(false);
  const [routingOverride, setRoutingOverride] = useState([]);
  const [routingOverrideLoading, setRoutingOverrideLoading] = useState(false);
  const [routingOverrideUpdating, setRoutingOverrideUpdating] = useState(false);
  const [providerDefaultSelections, setProviderDefaultSelections] = useState(
    () => readStoredProviderDefaultSelections(),
  );

  const loadRoutingData = useCallback(async () => {
    setLoading(true);
    try {
      const [pricingData, channelData] = await Promise.all([
        fetchPricingRoutingData(),
        fetchAllChannels(),
      ]);
      const routingCatalog = buildRoutingCatalog(
        pricingData.models,
        pricingData.vendors,
        channelData.channels,
        channelData.modelVendorGroups,
      );
      setVendors(routingCatalog.vendors);
      setModels(routingCatalog.models);
      setChannels(channelData.channels);
      setRoutingChanges({});
    } catch (error) {
      showError(error.message || t('加载模型路由失败'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadRoutingData();
  }, [loadRoutingData]);

  useEffect(() => {
    let cancelled = false;
    setRoutingOverride([]);
    setRoutingOverrideLoading(true);
    fetchModelRoutingOverride()
      .then((override) => {
        if (!cancelled) setRoutingOverride(override);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(error.message || t('加载临时路由模式失败'));
        }
      })
      .finally(() => {
        if (!cancelled) setRoutingOverrideLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const enabledChannelCountsByModel = useMemo(() => {
    const counts = new Map();
    channels.forEach((channel) => {
      if (channel.status !== CHANNEL_STATUS.ENABLED) return;
      new Set(splitCsv(channel.models)).forEach((modelName) => {
        counts.set(modelName, (counts.get(modelName) || 0) + 1);
      });
    });
    return counts;
  }, [channels]);

  const visibleModels = useMemo(() => {
    if (showAllModels) return models;
    return models.flatMap((model) => {
      const channelCount = enabledChannelCountsByModel.get(model.model_name);
      return channelCount ? [{ ...model, channelCount }] : [];
    });
  }, [enabledChannelCountsByModel, models, showAllModels]);

  const providerOptions = useMemo(() => {
    const modelCounts = new Map();
    visibleModels.forEach((model) => {
      const key = getProviderKey(model);
      modelCounts.set(key, (modelCounts.get(key) || 0) + 1);
    });

    const options = vendors
      .map((vendor) => ({
        key: String(vendor.id),
        label: vendor.name,
        icon: vendor.icon,
        modelCount: modelCounts.get(String(vendor.id)) || 0,
        vendor,
      }))
      .filter((provider) => provider.modelCount > 0)
      .sort((a, b) => a.label.localeCompare(b.label));

    const unassignedCount = modelCounts.get(UNASSIGNED_PROVIDER_KEY) || 0;
    if (unassignedCount > 0) {
      options.push({
        key: UNASSIGNED_PROVIDER_KEY,
        label: t('未分配供应商'),
        modelCount: unassignedCount,
      });
    }

    return options;
  }, [t, vendors, visibleModels]);

  const targetRoutingSelection = useMemo(() => {
    if (!targetModelName) return null;
    const targetModel = visibleModels.find(
      (model) => model.model_name === targetModelName,
    );
    return targetModel ? getRoutingSelectionFromModel(targetModel) : null;
  }, [targetModelName, visibleModels]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery !== '';

  // Channel search resolves to models through the channel's model list, so both
  // modes end up expressed as a set of model names.
  const searchMatch = useMemo(() => {
    if (!isSearching) return { modelNames: null, channelIds: null };

    if (searchMode === 'model') {
      const modelNames = new Set();
      visibleModels.forEach((model) => {
        if (model.model_name.toLowerCase().includes(trimmedQuery)) {
          modelNames.add(model.model_name);
        }
      });
      return { modelNames, channelIds: null };
    }

    const channelIds = new Set();
    const servedModels = new Set();
    channels.forEach((channel) => {
      const matchesName = channel.name?.toLowerCase().includes(trimmedQuery);
      const matchesId = String(channel.id).includes(trimmedQuery);
      if (!matchesName && !matchesId) return;
      channelIds.add(channel.id);
      splitCsv(channel.models).forEach((modelName) =>
        servedModels.add(modelName),
      );
    });
    // Intersect with the visible catalog so the model column never lists a name
    // the routing view has no model record for.
    const modelNames = new Set();
    visibleModels.forEach((model) => {
      if (servedModels.has(model.model_name)) modelNames.add(model.model_name);
    });
    return { modelNames, channelIds };
  }, [channels, isSearching, searchMode, trimmedQuery, visibleModels]);

  const matchedModels = useMemo(() => {
    if (!searchMatch.modelNames) return null;
    return visibleModels
      .filter((model) => searchMatch.modelNames.has(model.model_name))
      .sort((a, b) => a.model_name.localeCompare(b.model_name));
  }, [searchMatch, visibleModels]);

  // While searching, the provider column narrows to the vendors that own the
  // matches, counted by matches rather than by their whole catalog.
  const filteredProviders = useMemo(() => {
    if (!matchedModels) return providerOptions;
    const matchCounts = new Map();
    matchedModels.forEach((model) => {
      const key = getProviderKey(model);
      matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
    });
    return providerOptions
      .filter((provider) => matchCounts.has(provider.key))
      .map((provider) => ({
        ...provider,
        modelCount: matchCounts.get(provider.key) || 0,
      }));
  }, [matchedModels, providerOptions]);

  const selectedProvider = useMemo(() => {
    if (!selectedProviderKey) return null;
    return (
      providerOptions.find(
        (provider) => provider.key === selectedProviderKey,
      ) || null
    );
  }, [providerOptions, selectedProviderKey]);

  const providerModels = useMemo(() => {
    if (!selectedProviderKey) return [];
    return visibleModels
      .filter((model) => getProviderKey(model) === selectedProviderKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name));
  }, [selectedProviderKey, visibleModels]);

  // Searching lists the matches for the selected vendor; the vendor itself is
  // kept in sync with the selected model, so this still reads as one vendor's
  // models rather than a flat cross-vendor list.
  const filteredModels = useMemo(() => {
    if (!matchedModels) return providerModels;
    if (!selectedProviderKey) return matchedModels;
    return matchedModels.filter(
      (model) => getProviderKey(model) === selectedProviderKey,
    );
  }, [matchedModels, providerModels, selectedProviderKey]);

  // Matches hidden purely because they have no enabled channel. Without this the
  // search looks broken for a model the user knows exists.
  const hiddenMatchCount = useMemo(() => {
    if (!isSearching || showAllModels) return 0;

    // Channel mode dead-ends the same way when a matched channel is itself
    // disabled and its models have no other enabled channel.
    let matchesName;
    if (searchMode === 'model') {
      matchesName = (model) =>
        model.model_name.toLowerCase().includes(trimmedQuery);
    } else {
      const servedModels = new Set();
      channels.forEach((channel) => {
        const nameHit = channel.name?.toLowerCase().includes(trimmedQuery);
        const idHit = String(channel.id).includes(trimmedQuery);
        if (!nameHit && !idHit) return;
        splitCsv(channel.models).forEach((modelName) =>
          servedModels.add(modelName),
        );
      });
      matchesName = (model) => servedModels.has(model.model_name);
    }

    let count = 0;
    models.forEach((model) => {
      if (!matchesName(model)) return;
      if (!enabledChannelCountsByModel.has(model.model_name)) count += 1;
    });
    return count;
  }, [
    channels,
    enabledChannelCountsByModel,
    isSearching,
    models,
    searchMode,
    showAllModels,
    trimmedQuery,
  ]);

  const selectedModel = useMemo(() => {
    if (!selectedModelName) return null;
    return (
      providerModels.find((model) => model.model_name === selectedModelName) ||
      null
    );
  }, [providerModels, selectedModelName]);

  const selectedRoutingSelection = useMemo(
    () => (selectedModel ? getRoutingSelectionFromModel(selectedModel) : null),
    [selectedModel],
  );

  const initialRoutingSelection = useMemo(
    () =>
      targetRoutingSelection ||
      resolveInitialRoutingSelection(visibleModels, providerDefaultSelections),
    [providerDefaultSelections, targetRoutingSelection, visibleModels],
  );

  const isSelectedDefaultModel = isSameProviderDefaultSelection(
    selectedRoutingSelection,
    providerDefaultSelections,
  );

  const selectedModelNames = useMemo(
    () => getRoutingModelNames(selectedModel),
    [selectedModel],
  );

  const channelsForModel = useMemo(() => {
    const matchedChannels = channels.filter((channel) =>
      channelSupportsModel(channel, selectedModelNames),
    );
    return sortRoutingChannels(matchedChannels, routingChanges);
  }, [channels, routingChanges, selectedModelNames]);

  const routingRanks = useMemo(() => {
    const ranks = new Map();
    channelsForModel.forEach((channel) => {
      if (channel.status !== CHANNEL_STATUS.ENABLED) return;
      ranks.set(channel.id, ranks.size + 1);
    });
    return ranks;
  }, [channelsForModel]);

  const changedCount = getChangedCount(routingChanges);

  useEffect(() => {
    if (!targetRoutingSelection) return;
    setSelectedProviderKey(targetRoutingSelection.providerKey);
    setSelectedModelName(targetRoutingSelection.modelName);
  }, [targetRoutingSelection]);

  // Follow a channel created from here: land on the vendor and model it serves.
  // Waits for the reloaded channel list, since a model whose only channel is the
  // new one is not in the catalog until then.
  useEffect(() => {
    if (!pendingCreated) return;
    if (pendingCreated.models.length === 0) {
      setPendingCreated(null);
      return;
    }

    const wanted = new Set(pendingCreated.models);
    const candidates = visibleModels.filter((model) =>
      wanted.has(model.model_name),
    );
    if (candidates.length === 0) {
      // Give up only once the reload has landed: until then the model may be
      // missing simply because the new channel is its only one.
      if (channels !== pendingCreated.channelsAtQueue) setPendingCreated(null);
      return;
    }

    // Several vendors can serve one channel's models; take the first as the
    // vendor column orders them, then that vendor's first model by name.
    const candidateKeys = new Set(candidates.map(getProviderKey));
    const firstProvider = providerOptions.find((provider) =>
      candidateKeys.has(provider.key),
    );
    const providerKey = firstProvider?.key || getProviderKey(candidates[0]);
    const [target] = candidates
      .filter((model) => getProviderKey(model) === providerKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name));

    setSearchQuery('');
    setSelectedProviderKey(providerKey);
    setSelectedModelName(target.model_name);
    setPendingCreated(null);
  }, [channels, pendingCreated, providerOptions, visibleModels]);

  // Jump to the first match once per query, not whenever the selection happens
  // to sit outside the match set. Without the token, clicking a vendor clears
  // the model, this effect sees a stale selection and snaps back to the first
  // match's vendor, so only that one vendor ever appeared clickable.
  useEffect(() => {
    if (!matchedModels) {
      appliedSearchTokenRef.current = null;
      return;
    }
    if (matchedModels.length === 0) return;

    const token = `${searchMode}:${trimmedQuery}`;
    if (appliedSearchTokenRef.current === token) return;
    appliedSearchTokenRef.current = token;

    // Typing further into a query that still matches the current model should
    // not move the selection.
    if (
      selectedModelName &&
      matchedModels.some((model) => model.model_name === selectedModelName)
    ) {
      return;
    }
    const [first] = matchedModels;
    setSelectedProviderKey(getProviderKey(first));
    setSelectedModelName(first.model_name);
  }, [matchedModels, searchMode, selectedModelName, trimmedQuery]);

  useEffect(() => {
    if (selectedProviderKey) {
      const exists = providerOptions.some(
        (provider) => provider.key === selectedProviderKey,
      );
      if (exists) return;
    }

    const initialProvider = initialRoutingSelection
      ? providerOptions.find(
          (provider) => provider.key === initialRoutingSelection.providerKey,
        )
      : null;
    const firstProvider =
      initialProvider ||
      providerOptions.find((provider) => provider.modelCount > 0);
    setSelectedProviderKey(
      firstProvider?.key || providerOptions[0]?.key || null,
    );
  }, [initialRoutingSelection, providerOptions, selectedProviderKey]);

  useEffect(() => {
    if (!selectedProviderKey) {
      setSelectedModelName(null);
      return;
    }

    const exists = providerModels.some(
      (model) => model.model_name === selectedModelName,
    );
    if (exists) return;

    const initialModel =
      initialRoutingSelection?.providerKey === selectedProviderKey
        ? providerModels.find(
            (model) => model.model_name === initialRoutingSelection.modelName,
          )
        : null;
    const providerDefaultModel = findProviderDefaultModel(
      providerModels,
      providerDefaultSelections,
      selectedProviderKey,
    );
    setSelectedModelName(
      initialModel?.model_name ||
        providerDefaultModel?.model_name ||
        providerModels[0]?.model_name ||
        null,
    );
  }, [
    initialRoutingSelection,
    providerDefaultSelections,
    providerModels,
    selectedModelName,
    selectedProviderKey,
  ]);

  useEffect(() => {
    if (!selectedRoutingSelection) return;
    writeStoredProviderKey(
      ROUTING_LAST_PROVIDER_KEY,
      selectedRoutingSelection.providerKey,
    );
    writeStoredRoutingSelection(
      ROUTING_LAST_SELECTION_KEY,
      selectedRoutingSelection,
    );
  }, [selectedRoutingSelection]);

  // A deep link and the temporary-mode banner both mark one channel's row.
  const spotlightChannelId = targetChannelId || focusedChannelId;

  // A deep link arriving later asks for its own scroll.
  useEffect(() => {
    if (targetChannelId) setPendingScrollChannelId(targetChannelId);
  }, [targetChannelId]);

  useEffect(() => {
    if (!pendingScrollChannelId) return;
    // Only the deep link has a model to wait for; the banner sets both at once.
    if (
      targetChannelId === pendingScrollChannelId &&
      targetModelName &&
      selectedModelName !== targetModelName
    ) {
      return;
    }
    // The row appears once a model the channel serves is selected. Until then
    // there is nothing to scroll to, so the request waits rather than expires.
    if (
      !channelsForModel.some((channel) => channel.id === pendingScrollChannelId)
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-routing-channel-id="${pendingScrollChannelId}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    // Scrolling is a one-time answer to the request; the mark outlives it.
    setPendingScrollChannelId(null);
    return () => window.cancelAnimationFrame(frame);
  }, [
    channelsForModel,
    pendingScrollChannelId,
    selectedModelName,
    targetChannelId,
    targetModelName,
  ]);

  // A new channel's models are only selectable once the reloaded channel list
  // has put them in the catalog, so the jump is queued and applied by an effect.
  const handleChannelCreated = (createdModels) => {
    setPendingCreated({ models: createdModels, channelsAtQueue: channels });
  };

  const handleProviderSelect = (providerKey) => {
    setFocusedChannelId(null);
    setSelectedProviderKey(providerKey);
    // While searching, land on that vendor's first match. Clearing the model
    // would let the fallback effect pick its first model overall, which the
    // column is not even showing.
    const firstMatch = matchedModels?.find(
      (model) => getProviderKey(model) === providerKey,
    );
    setSelectedModelName(firstMatch?.model_name || null);
  };

  // Provider and model move together: the fallback effect drops any model that
  // is not in the selected provider's list, so a match from another vendor has
  // to bring its vendor along.
  const handleModelSelect = (model) => {
    setFocusedChannelId(null);
    setSelectedProviderKey(getProviderKey(model));
    setSelectedModelName(model.model_name);
  };

  // Jump from the temporary-mode banner to the pinned channel's row. The channel
  // only has a row while a model it serves is selected, so this picks one of its
  // covered models the way following a newly created channel does: the first
  // vendor as the vendor column orders them, then that vendor's first model by
  // name. Clearing the search keeps the model visible in its vendor context.
  const focusRoutingOverrideChannel = (override) => {
    const covered = new Set(override.models || []);
    let candidates = visibleModels.filter((model) =>
      covered.has(model.model_name),
    );
    if (candidates.length === 0) {
      // A covered model with no enabled channel is filtered out of the model
      // column, and the fallback effect would drop the selection right back. It
      // happens when the channel is pinned but its ability for that model is
      // off, so reveal it rather than letting the click do nothing.
      candidates = models.filter((model) => covered.has(model.model_name));
      if (candidates.length === 0) return;
      setShowAllModels(true);
      writeStoredShowAllModels(true);
    }

    const candidateKeys = new Set(candidates.map(getProviderKey));
    const firstProvider = providerOptions.find((provider) =>
      candidateKeys.has(provider.key),
    );
    const providerKey = firstProvider?.key || getProviderKey(candidates[0]);
    const [target] = candidates
      .filter((model) => getProviderKey(model) === providerKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name));

    setSearchQuery('');
    setSelectedProviderKey(providerKey);
    setSelectedModelName(target.model_name);
    setFocusedChannelId(override.channel_id);
    setPendingScrollChannelId(override.channel_id);
  };

  const handleShowAllModelsChange = (checked) => {
    setShowAllModels(checked);
    writeStoredShowAllModels(checked);
  };

  const refreshRoutingData = useCallback(async () => {
    await loadRoutingData();
    setRoutingOverrideLoading(true);
    try {
      setRoutingOverride(await fetchModelRoutingOverride());
    } catch (error) {
      showError(error.message || t('加载临时路由模式失败'));
    } finally {
      setRoutingOverrideLoading(false);
    }
  }, [loadRoutingData, t]);

  // A channel added from elsewhere — the paste listener opens its create modal
  // over whatever page is showing — lands in this table. The initial load only
  // runs on mount, and arriving here from the paste flow does not remount when
  // the routing tab is already open, so the new channel would stay invisible.
  useEffect(() => {
    const onChannelCreated = () => {
      refreshRoutingData();
    };

    window.addEventListener(CHANNEL_CREATED_EVENT, onChannelCreated);
    return () => {
      window.removeEventListener(CHANNEL_CREATED_EVENT, onChannelCreated);
    };
  }, [refreshRoutingData]);

  const handleSetDefaultModel = () => {
    if (!selectedRoutingSelection) return;
    const nextProviderDefaults = {
      ...providerDefaultSelections,
      [selectedRoutingSelection.providerKey]:
        selectedRoutingSelection.modelName,
    };
    writeStoredProviderDefaultSelections(nextProviderDefaults);
    writeStoredProviderKey(
      ROUTING_LAST_PROVIDER_KEY,
      selectedRoutingSelection.providerKey,
    );
    writeStoredRoutingSelection(
      ROUTING_DEFAULT_SELECTION_KEY,
      selectedRoutingSelection,
    );
    setProviderDefaultSelections(nextProviderDefaults);
    showSuccess(t('保存成功'));
  };

  const openChannelEditor = (channel) => {
    setEditingChannel(channel);
    setShowEditChannel(true);
  };

  const openChannelCreator = () => {
    if (!selectedModel) return;
    setEditingChannel({ id: undefined });
    setShowEditChannel(true);
  };

  const closeChannelEditor = () => {
    setShowEditChannel(false);
    setEditingChannel({ id: undefined });
  };

  const handleRoutingFieldChange = (channel, field, value) => {
    const numericValue =
      value === null || value === undefined || value === '' ? 0 : Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return;

    const originalValue = channel[field] ?? 0;
    setRoutingChanges((prev) => {
      const next = { ...prev };
      const channelChanges = { ...(next[channel.id] || {}) };

      if (numericValue === originalValue) {
        delete channelChanges[field];
      } else {
        channelChanges[field] = numericValue;
      }

      if (
        channelChanges.priority === undefined &&
        channelChanges.weight === undefined
      ) {
        delete next[channel.id];
      } else {
        next[channel.id] = channelChanges;
      }

      return next;
    });
  };

  const handleChannelStatusChange = async (channel, checked) => {
    const status = checked
      ? CHANNEL_STATUS.ENABLED
      : CHANNEL_STATUS.MANUAL_DISABLED;

    setStatusUpdatingIds((prev) => ({ ...prev, [channel.id]: true }));

    try {
      const res = await API.post(`/api/channel/${channel.id}/status`, {
        status,
      });
      const { success, message } = res.data || {};
      if (!success) {
        throw new Error(message || t('更新失败'));
      }

      setChannels((prev) =>
        prev.map((item) =>
          item.id === channel.id ? { ...item, status } : item,
        ),
      );
      setRoutingOverride(await fetchModelRoutingOverride());
      showSuccess(checked ? t('已启用') : t('已禁用'));
    } catch (error) {
      showError(error.message || t('更新失败'));
    } finally {
      setStatusUpdatingIds((prev) => {
        const next = { ...prev };
        delete next[channel.id];
        return next;
      });
    }
  };

  const handleEnableRoutingOverride = async (channel) => {
    const activeOverride = routingOverride.find(
      (override) => override.channel_id === channel.id,
    );
    const isActive = Boolean(activeOverride);
    if (!isActive && channel.status !== CHANNEL_STATUS.ENABLED) return;

    // Enabling has to name the temporary targets it would release before asking.
    // Restoring cannot conflict, so it skips the preflight.
    let conflicts = [];
    if (!isActive) {
      setRoutingOverrideUpdating(true);
      try {
        conflicts = await fetchRoutingOverrideConflicts(channel.id);
      } catch (error) {
        showError(error.message || t('更新临时路由模式失败'));
        return;
      } finally {
        setRoutingOverrideUpdating(false);
      }
    }

    const currentTargetName = activeOverride
      ? activeOverride.channel_name || `#${activeOverride.channel_id}`
      : channel.name;
    const modelCount = splitCsv(channel.models).length;
    let okText = t('开启临时模式');
    if (isActive) {
      okText = t('恢复正常路由');
    } else if (conflicts.length > 0) {
      okText = t('替换并开启');
    }

    Modal.confirm({
      title: isActive ? t('恢复正常路由？') : t('开启临时单渠道模式？'),
      content: isActive ? (
        t(
          '临时路由目标“{{channel}}”及其模型规则将被移除。现有渠道状态、优先级、权重和亲和性数据不会改变。',
          { channel: currentTargetName },
        )
      ) : (
        <div>
          {t(
            '渠道“{{channel}}”上的 {{count}} 个模型将临时仅使用该渠道；该渠道不支持的模型恢复正常路由。显式指定渠道的请求不受影响。',
            { channel: channel.name, count: modelCount },
          )}
          {renderRoutingOverrideConflicts(conflicts, t)}
        </div>
      ),
      okText,
      okButtonProps: conflicts.length > 0 ? { type: 'danger' } : undefined,
      cancelText: t('取消'),
      onOk: async () => {
        setRoutingOverrideUpdating(true);
        try {
          const res = isActive
            ? await API.delete('/api/channel/model_routing_override', {
                params: { channel_id: channel.id },
              })
            : await API.put('/api/channel/model_routing_override', {
                channel_id: channel.id,
                replace_conflicts: conflicts.length > 0,
              });
          const { success, message, data } = res.data || {};
          if (!success) {
            throw new Error(message || t('更新临时路由模式失败'));
          }
          setRoutingOverride(Array.isArray(data) ? data : data ? [data] : []);
          showSuccess(
            isActive ? t('已恢复正常路由') : t('已开启临时单渠道模式'),
          );
        } catch (error) {
          showError(error.message || t('更新临时路由模式失败'));
          throw error;
        } finally {
          setRoutingOverrideUpdating(false);
        }
      },
    });
  };

  // Without an argument this clears every override, matching the header button.
  // The banner list passes one override so a single temporary target can be
  // released even when its channel serves none of the selected model's rows.
  const handleRestoreRoutingOverride = (override) => {
    if (routingOverride.length === 0) return;

    const targets = override ? [override] : routingOverride;

    Modal.confirm({
      title: t('恢复正常路由？'),
      content: t(
        '临时路由目标“{{channel}}”及其模型规则将被移除。现有渠道状态、优先级、权重和亲和性数据不会改变。',
        {
          channel: targets
            .map((item) => item.channel_name || `#${item.channel_id}`)
            .join(', '),
        },
      ),
      okText: t('恢复正常路由'),
      cancelText: t('取消'),
      onOk: async () => {
        setRoutingOverrideUpdating(true);
        try {
          const res = await API.delete(
            '/api/channel/model_routing_override',
            override ? { params: { channel_id: override.channel_id } } : {},
          );
          const { success, message } = res.data || {};
          if (!success) {
            throw new Error(message || t('更新临时路由模式失败'));
          }
          const nextData = res.data?.data;
          setRoutingOverride(
            Array.isArray(nextData) ? nextData : nextData ? [nextData] : [],
          );
          showSuccess(t('已恢复正常路由'));
        } catch (error) {
          showError(error.message || t('更新临时路由模式失败'));
          throw error;
        } finally {
          setRoutingOverrideUpdating(false);
        }
      },
    });
  };

  const handleDeleteChannel = (channel) => {
    Modal.confirm({
      title: t('删除渠道'),
      content: (
        <div className='flex flex-col gap-1'>
          <div>
            {t('渠道')}: <Text strong>{channel.name}</Text>
          </div>
          <div>{t('此操作将永久删除该渠道，且无法撤销。')}</div>
        </div>
      ),
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        setDeletingChannelId(channel.id);
        try {
          const res = await API.delete(`/api/channel/${channel.id}/`);
          const { success, message } = res.data || {};
          if (!success) {
            showError(message || t('删除失败'));
            return;
          }

          setChannels((prev) => prev.filter((item) => item.id !== channel.id));
          setRoutingChanges((prev) => {
            const next = { ...prev };
            delete next[channel.id];
            return next;
          });
          setRoutingOverride(await fetchModelRoutingOverride());
          showSuccess(t('删除成功'));
        } catch (error) {
          showError(error.message || t('删除失败'));
        } finally {
          setDeletingChannelId(null);
        }
      },
    });
  };

  const handleCopyChannel = (channel) => {
    Modal.confirm({
      title: t('确定是否要复制此渠道？'),
      content: t('复制渠道的所有信息'),
      okText: t('复制'),
      cancelText: t('取消'),
      onOk: async () => {
        setCopyingChannelId(channel.id);
        try {
          const res = await API.post(`/api/channel/copy/${channel.id}`);
          const { success, message } = res.data || {};
          if (!success) {
            showError(message || t('渠道复制失败'));
            return;
          }
          showSuccess(t('渠道复制成功'));
          // The copy is a new channel, so the routing table has to reload.
          await refreshRoutingData();
        } catch (error) {
          showError(
            error?.response?.data?.message ||
              error.message ||
              t('渠道复制失败'),
          );
        } finally {
          setCopyingChannelId(null);
        }
      },
    });
  };

  // The modal is scoped to the routed model, so currentTestChannel carries a
  // single-entry models list. ModelTestModal derives its rows, header count and
  // batch label from that field, which keeps it unmodified.
  const testModalChannel = useMemo(() => {
    if (!testingChannel) return null;
    return { ...testingChannel, models: selectedModelName || '' };
  }, [testingChannel, selectedModelName]);

  // Picking another model would silently re-scope an open modal, so close it.
  useEffect(() => {
    setTestingChannel(null);
  }, [selectedModelName]);

  const testRoutingModel = async (channel, model, endpointType, stream) => {
    const testKey = `${channel.id}-${model}`;
    setTestingModels((prev) => new Set([...prev, model]));

    try {
      let url = `/api/channel/test/${channel.id}?model=${encodeURIComponent(model)}`;
      if (endpointType) url += `&endpoint_type=${endpointType}`;
      if (stream) url += '&stream=true';

      const res = await API.get(url);
      const { success, message, time, error_code } = res.data || {};

      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success,
          message,
          time: time || 0,
          timestamp: Date.now(),
          errorCode: error_code || null,
        },
      }));

      if (success) {
        setChannels((prev) =>
          prev.map((item) =>
            item.id === channel.id
              ? {
                  ...item,
                  response_time:
                    typeof time === 'number' ? time * 1000 : item.response_time,
                  test_time: Date.now() / 1000,
                }
              : item,
          ),
        );
      } else {
        showError(message || t('测试失败'));
      }
    } catch (error) {
      setModelTestResults((prev) => ({
        ...prev,
        [testKey]: {
          success: false,
          message: error.message || t('网络错误'),
          time: 0,
          timestamp: Date.now(),
          errorCode: null,
        },
      }));
      showError(error.message || t('测试失败'));
    } finally {
      setTestingModels((prev) => {
        const next = new Set(prev);
        next.delete(model);
        return next;
      });
    }
  };

  const runTestModalBatch = async () => {
    if (!testModalChannel || !selectedModelName) return;
    setIsBatchTesting(true);
    try {
      await testRoutingModel(
        testModalChannel,
        selectedModelName,
        selectedEndpointType,
        isStreamTest,
      );
    } finally {
      setIsBatchTesting(false);
    }
  };

  const handleCloseTestModal = () => {
    setTestingChannel(null);
    setModelSearchKeyword('');
    setSelectedModelKeys([]);
    setModelTablePage(1);
    setIsBatchTesting(false);
    setTestingModels(new Set());
  };

  const handleSaveRouting = async () => {
    if (changedCount === 0) {
      showInfo(t('没有需要保存的修改'));
      return;
    }

    setSaving(true);
    try {
      const updates = Object.entries(routingChanges).map(
        async ([id, change]) => {
          const channelId = parseInt(id, 10);
          const payload = {};
          if (change.priority !== undefined) payload.priority = change.priority;
          if (change.weight !== undefined) payload.weight = change.weight;

          const res = await API.put('/api/channel/', {
            id: channelId,
            ...payload,
          });
          const { success, message } = res.data || {};
          if (!success) {
            throw new Error(message || t('更新模型路由失败'));
          }

          return { id: channelId, patch: payload };
        },
      );

      const results = await Promise.allSettled(updates);
      const successfulUpdates = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failCount = results.filter(
        (result) => result.status === 'rejected',
      ).length;

      if (successfulUpdates.length > 0) {
        setChannels((prev) => {
          const patchesById = new Map(
            successfulUpdates.map((update) => [update.id, update.patch]),
          );
          return sortRoutingChannels(
            prev.map((channel) => {
              const patch = patchesById.get(channel.id);
              return patch ? { ...channel, ...patch } : channel;
            }),
          );
        });
        setRoutingChanges((prev) => {
          const next = { ...prev };
          successfulUpdates.forEach((update) => {
            delete next[update.id];
          });
          return next;
        });
        showSuccess(
          t('已更新 {{count}} 个渠道', { count: successfulUpdates.length }),
        );
      }

      if (failCount > 0) {
        showError(t('{{count}} 个渠道更新失败', { count: failCount }));
      }
    } catch (error) {
      showError(error.message || t('更新模型路由失败'));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: t('渠道'),
      dataIndex: 'name',
      width: 320,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const remark = record.remark?.trim();
        const routingRank = routingRanks.get(record.id);
        const routeRoleIndex = routingRank === undefined ? -1 : routingRank - 1;
        const routeRoleLabel =
          routeRoleIndex >= 0 && routeRoleIndex < ROUTING_ROLE_LABELS.length
            ? ROUTING_ROLE_LABELS[routeRoleIndex]
            : null;
        const nameNode = (
          <Text
            strong
            ellipsis
            type={isEnabled ? undefined : 'tertiary'}
            className='-my-1 cursor-help py-1'
            style={{
              display: 'block',
              width: '100%',
            }}
          >
            {record.name}
          </Text>
        );
        // Two lines: the name owns the first one so long channel names stay
        // readable, while rank, id, role and group sit together on a compact
        // second line.
        return (
          <div className='flex min-w-0 flex-col gap-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <div className='min-w-0 flex-1'>
                <ChannelRemarkTooltip title={record.name} remark={remark}>
                  {nameNode}
                </ChannelRemarkTooltip>
              </div>
              {!isEnabled ? renderRoutingChannelStatusTag(record, t) : null}
            </div>
            <div className='flex min-w-0 items-center gap-1'>
              <span className='inline-flex shrink-0'>
                <Tag color='grey' shape='circle' size='small'>
                  {routingRank === undefined ? '—' : `#${routingRank}`}
                </Tag>
              </span>
              {/* useChannelsData derives its search keyword from channel_id,
                  so the id alone is enough to land on that one channel. */}
              <button
                type='button'
                className='shrink-0 cursor-pointer border-none bg-transparent p-0 font-mono text-xs text-[var(--semi-color-text-2)] underline-offset-2 hover:text-[var(--semi-color-text-0)] hover:underline'
                title={t('在渠道列表中打开')}
                aria-label={`${t('在渠道列表中打开')}: ${record.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/console/channel?channel_id=${record.id}`);
                }}
              >
                ID:{record.id}
              </button>
              {routeRoleLabel ? (
                <span className='inline-flex shrink-0'>
                  <Tag
                    color={ROUTING_ROLE_COLORS[routeRoleIndex]}
                    shape='circle'
                    size='small'
                  >
                    {t(routeRoleLabel)}
                  </Tag>
                </span>
              ) : null}
              <span
                className='truncate text-xs text-[var(--semi-color-text-2)]'
                title={record.group}
              >
                {record.group}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      title: t('操作'),
      dataIndex: 'actions',
      width: 225,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const isOverrideTarget = routingOverride.some(
          (override) => override.channel_id === record.id,
        );
        return (
          <div className='flex items-center gap-2'>
            <Tooltip content={t('打开使用日志')}>
              <Button
                theme='borderless'
                type='tertiary'
                size='small'
                icon={<IconHistogram />}
                title={t('打开使用日志')}
                aria-label={`${t('打开使用日志')}: ${record.name}`}
                onClick={() => openUsageLogs(selectedModelName, record.id)}
              />
            </Tooltip>
            <Tooltip
              content={
                isOverrideTarget ? t('当前临时路由目标') : t('临时单渠道模式')
              }
            >
              <Button
                theme={isOverrideTarget ? 'solid' : 'borderless'}
                type={isOverrideTarget ? 'warning' : 'tertiary'}
                size='small'
                icon={<IconLock />}
                aria-label={`${
                  isOverrideTarget ? t('当前临时路由目标') : t('临时单渠道模式')
                }: ${record.name}`}
                disabled={
                  (!isEnabled && !isOverrideTarget) || routingOverrideUpdating
                }
                onClick={() => handleEnableRoutingOverride(record)}
              />
            </Tooltip>
            <Button
              type='tertiary'
              size='small'
              disabled={!selectedModelName}
              onClick={() => setTestingChannel(record)}
            >
              {t('测试')}
            </Button>
            <Button
              type='tertiary'
              size='small'
              icon={<IconEdit />}
              aria-label={t('编辑')}
              onClick={() => openChannelEditor(record)}
            />
            <Tooltip content={t('复制')}>
              <Button
                theme='borderless'
                type='tertiary'
                size='small'
                icon={<IconCopy />}
                aria-label={`${t('复制')}: ${record.name}`}
                loading={copyingChannelId === record.id}
                onClick={() => handleCopyChannel(record)}
              />
            </Tooltip>
            <Button
              type='danger'
              size='small'
              icon={<IconDelete />}
              aria-label={t('删除')}
              loading={deletingChannelId === record.id}
              onClick={() => handleDeleteChannel(record)}
            />
          </div>
        );
      },
    },
    {
      title: t('类型'),
      dataIndex: 'type',
      width: 130,
      render: (type) => (
        <span className='flex items-center gap-2'>
          {getChannelIcon(type)}
          {CHANNEL_TYPE_LABELS[type] || t('未知')}
        </span>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 150,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const updating = Boolean(statusUpdatingIds[record.id]);
        return (
          <div className='flex items-center gap-2'>
            <Switch
              size='small'
              checked={isEnabled}
              loading={updating}
              disabled={updating}
              onChange={(checked) => handleChannelStatusChange(record, checked)}
            />
            {renderRoutingChannelStatusTag(record, t)}
          </div>
        );
      },
    },
    {
      title: (
        <div className='grid grid-cols-2 gap-2'>
          <span>{t('优先级')}</span>
          <span>{t('权重')}</span>
        </div>
      ),
      dataIndex: 'routing',
      width: 210,
      fixed: 'right',
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const updating = Boolean(statusUpdatingIds[record.id]);
        return (
          <div className='grid grid-cols-2 gap-2'>
            <InputNumber
              min={0}
              value={getFieldValue(record, routingChanges, 'priority')}
              disabled={!isEnabled || updating}
              onChange={(value) =>
                handleRoutingFieldChange(record, 'priority', value)
              }
              style={{ width: '100%' }}
            />
            <InputNumber
              min={0}
              value={getFieldValue(record, routingChanges, 'weight')}
              disabled={!isEnabled || updating}
              onChange={(value) =>
                handleRoutingFieldChange(record, 'weight', value)
              }
              style={{ width: '100%' }}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className='flex min-h-[560px] flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Tag color={changedCount > 0 ? 'orange' : 'green'} shape='circle'>
          {changedCount > 0
            ? t('{{count}} 个未保存修改', { count: changedCount })
            : t('路由已同步')}
        </Tag>
        <div className='flex items-center gap-2'>
          <Button
            icon={<IconRefresh />}
            onClick={refreshRoutingData}
            disabled={loading || saving}
          >
            {t('刷新')}
          </Button>
          <Button
            theme='solid'
            type='primary'
            icon={<IconSave />}
            loading={saving}
            disabled={changedCount === 0 || saving}
            onClick={handleSaveRouting}
          >
            {t('保存路由')}
          </Button>
        </div>
      </div>

      {/* One search across all three columns. Model mode matches model names;
          channel mode matches a channel and resolves to the models it serves. */}
      <div className='flex flex-wrap items-center gap-2'>
        <RadioGroup
          type='button'
          value={searchMode}
          onChange={(event) => setSearchMode(event?.target?.value ?? event)}
        >
          <Radio value='model'>{t('按模型')}</Radio>
          <Radio value='channel'>{t('按渠道')}</Radio>
        </RadioGroup>
        <Input
          prefix={<IconSearch />}
          placeholder={
            searchMode === 'model'
              ? t('搜索全部模型...')
              : t('按名称或 ID 搜索渠道...')
          }
          value={searchQuery}
          onChange={setSearchQuery}
          showClear
          className='min-w-0 flex-1 sm:!max-w-sm'
        />
        {isSearching ? (
          <Text type='tertiary' size='small'>
            {t('匹配 {{count}} 个模型', { count: matchedModels?.length || 0 })}
          </Text>
        ) : null}
      </div>

      <div className='grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_320px_minmax(0,1fr)]'>
        <section className='flex min-h-[360px] flex-col rounded border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)]'>
          <div className='border-b border-[var(--semi-color-border)] p-3'>
            <div className='flex items-center justify-between gap-2'>
              <Text strong>{t('供应商')}</Text>
              <Tag color='grey' shape='circle' size='small'>
                {filteredProviders.length}
              </Tag>
            </div>
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-2'>
            {loading ? (
              <div className='flex h-48 items-center justify-center'>
                <Spin />
              </div>
            ) : filteredProviders.length === 0 ? (
              <Empty description={t('未找到供应商')} />
            ) : (
              <List
                dataSource={filteredProviders}
                renderItem={(provider) => (
                  <List.Item
                    onClick={() => handleProviderSelect(provider.key)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor:
                        selectedProviderKey === provider.key
                          ? 'var(--semi-color-primary-light-default)'
                          : 'transparent',
                      borderRadius: 4,
                      marginBottom: 4,
                      padding: '8px 10px',
                    }}
                  >
                    <div className='flex w-full min-w-0 items-center justify-between gap-2'>
                      <div className='flex min-w-0 items-center gap-2'>
                        {provider.vendor
                          ? getLobeHubIcon(provider.icon || 'Layers', 16)
                          : null}
                        <Text ellipsis>{provider.label}</Text>
                      </div>
                      <Tag color='grey' shape='circle' size='small'>
                        {provider.modelCount}
                      </Tag>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>
        </section>

        <section className='flex min-h-[360px] flex-col rounded border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)]'>
          <div className='border-b border-[var(--semi-color-border)] p-3'>
            <div className='flex items-center justify-between gap-2'>
              <Text strong ellipsis>
                {selectedProvider?.label || t('模型')}
              </Text>
              <div className='flex shrink-0 items-center gap-2'>
                <Text type='tertiary' size='small'>
                  {t(showAllModels ? '全部模型' : '已启用')}
                </Text>
                <Switch
                  size='small'
                  checked={showAllModels}
                  onChange={handleShowAllModelsChange}
                  aria-label={t('全部模型')}
                />
                <Tag color='grey' shape='circle' size='small'>
                  {filteredModels.length}
                </Tag>
                <Button
                  theme={isSelectedDefaultModel ? 'solid' : 'borderless'}
                  type={isSelectedDefaultModel ? 'warning' : 'tertiary'}
                  size='small'
                  icon={<IconBookmark />}
                  disabled={!selectedModel}
                  title={t('默认')}
                  aria-label={t('默认')}
                  onClick={handleSetDefaultModel}
                />
              </div>
            </div>
            {/* Matches excluded only by the enabled-channel filter, with the way
                to reveal them, so a search for a known model is not just empty. */}
            {hiddenMatchCount > 0 ? (
              <Button
                theme='borderless'
                type='tertiary'
                size='small'
                className='!mt-2 !px-0'
                onClick={() => handleShowAllModelsChange(true)}
              >
                {t('有 {{count}} 个匹配模型没有启用的渠道，显示全部模型。', {
                  count: hiddenMatchCount,
                })}
              </Button>
            ) : null}
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto p-2'>
            {loading ? (
              <div className='flex h-48 items-center justify-center'>
                <Spin />
              </div>
            ) : filteredModels.length === 0 ? (
              <Empty description={t('未找到模型')} />
            ) : (
              <List
                dataSource={filteredModels}
                renderItem={(model) => (
                  <List.Item
                    onClick={() => handleModelSelect(model)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor:
                        selectedModelName === model.model_name
                          ? 'var(--semi-color-primary-light-default)'
                          : 'transparent',
                      borderRadius: 4,
                      marginBottom: 4,
                      padding: '8px 10px',
                    }}
                  >
                    <div className='flex w-full min-w-0 items-center justify-between gap-2'>
                      <div className='flex min-w-0 items-center gap-2'>
                        {model.icon || model.vendor_icon ? (
                          getLobeHubIcon(model.icon || model.vendor_icon, 16)
                        ) : (
                          <span className='flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--semi-color-fill-0)] text-[10px] font-semibold text-[var(--semi-color-text-2)]'>
                            {getModelInitial(model.model_name)}
                          </span>
                        )}
                        <Text ellipsis>{model.model_name}</Text>
                      </div>
                      <div className='flex shrink-0 items-center gap-1'>
                        <Tooltip content={t('点击复制模型名称')}>
                          <Button
                            theme='borderless'
                            type='tertiary'
                            size='small'
                            icon={<IconCopy />}
                            title={t('点击复制模型名称')}
                            aria-label={`${t('点击复制模型名称')}: ${model.model_name}`}
                            onClick={async (event) => {
                              event.stopPropagation();
                              if (await copy(model.model_name)) {
                                showSuccess(t('已复制模型名称'));
                              } else {
                                showError(t('复制失败'));
                              }
                            }}
                          />
                        </Tooltip>
                        <Tag color='grey' shape='circle' size='small'>
                          {model.channelCount}
                        </Tag>
                        <Tooltip content={t('打开使用日志')}>
                          <Button
                            theme='borderless'
                            type='tertiary'
                            size='small'
                            icon={<IconHistogram />}
                            title={t('打开使用日志')}
                            aria-label={`${t('打开使用日志')}: ${model.model_name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openUsageLogs(model.model_name);
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            )}
          </div>
        </section>

        <section className='flex min-h-[360px] flex-col overflow-hidden rounded border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)]'>
          <div className='border-b border-[var(--semi-color-border)] p-3'>
            <div className='flex items-center justify-between gap-2'>
              <div className='min-w-0'>
                <Text strong ellipsis>
                  {selectedModel?.model_name || t('渠道')}
                </Text>
                {selectedModel ? (
                  <div className='mt-1'>
                    <Text type='tertiary' size='small'>
                      {t('{{count}} 个渠道', {
                        count: channelsForModel.length,
                      })}
                    </Text>
                  </div>
                ) : null}
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {routingOverride.length > 0 ? (
                  <Button
                    theme='light'
                    type='warning'
                    size='small'
                    icon={<IconUndo />}
                    loading={routingOverrideUpdating}
                    onClick={() => handleRestoreRoutingOverride()}
                  >
                    {t('恢复正常路由')}
                  </Button>
                ) : null}
                <Button
                  theme='light'
                  type='primary'
                  size='small'
                  icon={<IconPlus />}
                  disabled={!selectedModel}
                  onClick={openChannelCreator}
                >
                  {t('添加渠道')}
                </Button>
              </div>
            </div>
          </div>
          {routingOverride.length > 0 ? (
            <div className='space-y-2 border-b border-[var(--semi-color-border)] bg-[var(--semi-color-fill-0)] px-3 py-2'>
              {routingOverride.map((override) => {
                const overrideLabel =
                  override.channel_name || `#${override.channel_id}`;
                return (
                  <div
                    key={override.channel_id}
                    className='flex items-start gap-2'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Tag color='orange' shape='circle' size='small'>
                          {t('临时单渠道模式')}
                        </Tag>
                        {/* The pinned channel need not serve the selected model,
                            so without this the table below may not even list it.
                            Selecting one of its covered models brings its row
                            into view. */}
                        <button
                          type='button'
                          className='flex min-w-0 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left underline-offset-2 hover:underline'
                          title={t('在路由表中定位该渠道')}
                          aria-label={`${t('在路由表中定位该渠道')}: ${overrideLabel}`}
                          onClick={() => focusRoutingOverrideChannel(override)}
                        >
                          <Text strong ellipsis>
                            {overrideLabel}
                          </Text>
                          <Text type='tertiary' size='small'>
                            ID:{override.channel_id}
                          </Text>
                        </button>
                        <Text type='tertiary' size='small'>
                          {t('{{count}} 个覆盖模型', {
                            count: override.model_count,
                          })}
                        </Text>
                        <Text type='tertiary' size='small'>
                          {t('覆盖分组')}: {override.groups.join(', ')}
                        </Text>
                      </div>
                      <div className='mt-1'>
                        <Text type='tertiary' size='small'>
                          {t(
                            '所有覆盖模型的自动请求仅使用此渠道；显式指定渠道的请求不受影响。',
                          )}
                        </Text>
                      </div>
                    </div>
                    <Tooltip content={t('恢复正常路由')}>
                      <Button
                        theme='borderless'
                        type='tertiary'
                        size='small'
                        className='shrink-0'
                        icon={<IconUndo />}
                        aria-label={`${t('恢复正常路由')}: ${overrideLabel}`}
                        disabled={routingOverrideUpdating}
                        onClick={() => handleRestoreRoutingOverride(override)}
                      />
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className='min-h-0 flex-1 overflow-auto p-2'>
            {loading || routingOverrideLoading ? (
              <div className='flex h-64 items-center justify-center'>
                <Spin />
              </div>
            ) : !selectedModel ? (
              <Empty description={t('请选择模型')} />
            ) : channelsForModel.length === 0 ? (
              <Empty description={t('没有渠道支持此模型')} />
            ) : (
              <Table
                columns={columns}
                dataSource={channelsForModel}
                rowKey='id'
                groupBy={getRoutingChannelGroup}
                expandAllGroupRows
                clickGroupedRowToExpand={false}
                expandIcon={() => <span aria-hidden='true' />}
                renderGroupSection={(groupKey, group) => {
                  const isEnabledGroup =
                    groupKey === ROUTING_CHANNEL_GROUP.ENABLED;
                  return (
                    <div className='flex items-center gap-2 py-1'>
                      <Tag
                        color={isEnabledGroup ? 'green' : 'orange'}
                        shape='circle'
                        size='small'
                      >
                        {t(isEnabledGroup ? '参与路由' : '不参与路由')}
                      </Tag>
                      <Text type='tertiary' size='small'>
                        {group?.length || 0}
                      </Text>
                    </div>
                  );
                }}
                pagination={false}
                size='small'
                scroll={{ x: 1035 }}
                onRow={(record) => {
                  const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
                  const isTarget = record.id === spotlightChannelId;
                  let background;
                  let accent;

                  if (record.status === CHANNEL_STATUS.MANUAL_DISABLED) {
                    background = 'var(--semi-color-danger-light-default)';
                    accent = 'var(--semi-color-danger)';
                  } else if (record.status === CHANNEL_STATUS.AUTO_DISABLED) {
                    background = 'var(--semi-color-warning-light-default)';
                    accent = 'var(--semi-color-warning)';
                  } else if (!isEnabled) {
                    background = 'var(--semi-color-fill-0)';
                    accent = 'var(--semi-color-border)';
                  }

                  const boxShadow = [];
                  if (accent) boxShadow.push(`inset 4px 0 0 ${accent}`);
                  // A channel-mode search keeps every channel serving the model,
                  // so the ones it matched are marked to stay findable among them.
                  const isSearchMatch = Boolean(
                    searchMatch.channelIds?.has(record.id),
                  );

                  if (isTarget || isSearchMatch) {
                    boxShadow.push('inset 0 0 0 1px var(--semi-color-warning)');
                  }

                  return {
                    'data-routing-channel-id': record.id,
                    style: {
                      background:
                        isTarget || isSearchMatch
                          ? 'var(--semi-color-warning-light-default)'
                          : background,
                      boxShadow: boxShadow.join(', ') || undefined,
                    },
                  };
                }}
              />
            )}
          </div>
        </section>
      </div>
      <EditChannelModal
        refresh={refreshRoutingData}
        visible={showEditChannel}
        handleClose={closeChannelEditor}
        editingChannel={editingChannel}
        // The add button sits on the right here, unlike the channel list.
        placement='right'
        onCreated={handleChannelCreated}
      />
      <ModelTestModal
        showModelTestModal={testingChannel !== null}
        currentTestChannel={testModalChannel}
        handleCloseModal={handleCloseTestModal}
        isBatchTesting={isBatchTesting}
        batchTestModels={runTestModalBatch}
        modelSearchKeyword={modelSearchKeyword}
        setModelSearchKeyword={setModelSearchKeyword}
        selectedModelKeys={selectedModelKeys}
        setSelectedModelKeys={setSelectedModelKeys}
        modelTestResults={modelTestResults}
        testingModels={testingModels}
        testChannel={testRoutingModel}
        modelTablePage={modelTablePage}
        setModelTablePage={setModelTablePage}
        selectedEndpointType={selectedEndpointType}
        setSelectedEndpointType={setSelectedEndpointType}
        isStreamTest={isStreamTest}
        setIsStreamTest={setIsStreamTest}
        allSelectingRef={testModalAllSelectingRef}
        isMobile={isMobile}
        t={t}
      />
    </div>
  );
};

export default ModelRoutingWorkbench;
