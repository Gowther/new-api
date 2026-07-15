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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconBookmark,
  IconDelete,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconSave,
  IconSearch,
} from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

import { LinkifiedText } from '../../common/LinkifiedText';
import { CHANNEL_OPTIONS } from '../../../constants';
import {
  API,
  getChannelIcon,
  getLobeHubIcon,
  showError,
  showInfo,
  showSuccess,
} from '../../../helpers';
import EditChannelModal from '../channels/modals/EditChannelModal';

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

const openChannelUsageLogs = (channelId) => {
  const targetUrl = `/console/log?channel=${encodeURIComponent(
    String(channelId),
  )}`;
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
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

const ModelRoutingWorkbench = ({ targetModelName, targetChannelId }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [models, setModels] = useState([]);
  const [channels, setChannels] = useState([]);
  const [providerSearch, setProviderSearch] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [selectedProviderKey, setSelectedProviderKey] = useState(null);
  const [selectedModelName, setSelectedModelName] = useState(null);
  const [routingChanges, setRoutingChanges] = useState({});
  const [statusUpdatingIds, setStatusUpdatingIds] = useState({});
  const [editingChannel, setEditingChannel] = useState({ id: undefined });
  const [showEditChannel, setShowEditChannel] = useState(false);
  const [deletingChannelId, setDeletingChannelId] = useState(null);
  const [testingChannelIds, setTestingChannelIds] = useState({});
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

  const providerOptions = useMemo(() => {
    const modelCounts = new Map();
    models.forEach((model) => {
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
  }, [models, t, vendors]);

  const targetRoutingSelection = useMemo(() => {
    if (!targetModelName) return null;
    const targetModel = models.find(
      (model) => model.model_name === targetModelName,
    );
    return targetModel ? getRoutingSelectionFromModel(targetModel) : null;
  }, [models, targetModelName]);

  const filteredProviders = useMemo(() => {
    const search = providerSearch.trim().toLowerCase();
    if (!search) return providerOptions;
    return providerOptions.filter((provider) =>
      provider.label.toLowerCase().includes(search),
    );
  }, [providerOptions, providerSearch]);

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
    return models
      .filter((model) => getProviderKey(model) === selectedProviderKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name));
  }, [models, selectedProviderKey]);

  const filteredModels = useMemo(() => {
    const search = modelSearch.trim().toLowerCase();
    if (!search) return providerModels;
    return providerModels.filter((model) =>
      model.model_name.toLowerCase().includes(search),
    );
  }, [modelSearch, providerModels]);

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
      resolveInitialRoutingSelection(models, providerDefaultSelections),
    [models, providerDefaultSelections, targetRoutingSelection],
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

  useEffect(() => {
    if (!targetChannelId) return;
    if (targetModelName && selectedModelName !== targetModelName) return;
    if (!channelsForModel.some((channel) => channel.id === targetChannelId)) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-routing-channel-id="${targetChannelId}"]`)
        ?.scrollIntoView({ block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [channelsForModel, selectedModelName, targetChannelId, targetModelName]);

  const handleProviderSelect = (providerKey) => {
    setSelectedProviderKey(providerKey);
    setSelectedModelName(null);
    setModelSearch('');
  };

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
          showSuccess(t('删除成功'));
        } catch (error) {
          showError(error.message || t('删除失败'));
        } finally {
          setDeletingChannelId(null);
        }
      },
    });
  };

  const handleTestChannel = async (channel) => {
    let shouldStart = false;
    setTestingChannelIds((prev) => {
      if (prev[channel.id]) return prev;
      shouldStart = true;
      return { ...prev, [channel.id]: true };
    });
    if (!shouldStart) return;

    try {
      let url = `/api/channel/test/${channel.id}`;
      if (selectedModelName) {
        url += `?model=${encodeURIComponent(selectedModelName)}`;
      }
      const res = await API.get(url);
      const { success, message, time } = res.data || {};
      if (success) {
        const elapsed =
          typeof time === 'number' ? time.toFixed(2) : String(time ?? '');
        if (selectedModelName) {
          showInfo(
            t(
              '通道 ${name} 测试成功，模型 ${model} 耗时 ${time.toFixed(2)} 秒。',
            )
              .replace('${name}', channel.name)
              .replace('${model}', selectedModelName)
              .replace('${time.toFixed(2)}', elapsed),
          );
        } else {
          showInfo(
            t('通道 ${name} 测试成功，耗时 ${time.toFixed(2)} 秒。')
              .replace('${name}', channel.name)
              .replace('${time.toFixed(2)}', elapsed),
          );
        }
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
      showError(error.message || t('测试失败'));
    } finally {
      setTestingChannelIds((prev) => {
        const next = { ...prev };
        delete next[channel.id];
        return next;
      });
    }
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
        const statusMeta =
          CHANNEL_STATUS_META[record.status] ||
          CHANNEL_STATUS_META[CHANNEL_STATUS.UNKNOWN];
        const nameNode = (
          <Text
            strong
            ellipsis
            type={isEnabled ? undefined : 'tertiary'}
            style={{
              display: 'block',
              width: '100%',
            }}
          >
            {record.name}
          </Text>
        );
        return (
          <div className='grid min-w-0 grid-cols-[150px_minmax(0,1fr)] items-center gap-2'>
            <div className='flex min-w-0 items-center gap-1'>
              <span className='inline-flex w-9 shrink-0'>
                <Tag color='grey' shape='circle' size='small'>
                  {routingRank === undefined ? '—' : `#${routingRank}`}
                </Tag>
              </span>
              <button
                type='button'
                className='w-14 shrink-0 truncate text-left font-mono text-xs text-[var(--semi-color-text-2)] hover:underline'
                title={t('打开使用日志')}
                aria-label={`${t('打开使用日志')} #${record.id}`}
                onClick={() => openChannelUsageLogs(record.id)}
              >
                ID:{record.id}
              </button>
              {routeRoleLabel ? (
                <span className='inline-flex w-11 shrink-0'>
                  <Tag
                    color={ROUTING_ROLE_COLORS[routeRoleIndex]}
                    shape='circle'
                    size='small'
                  >
                    {t(routeRoleLabel)}
                  </Tag>
                </span>
              ) : (
                <span className='w-11 shrink-0' aria-hidden='true' />
              )}
            </div>
            <div className='flex min-w-0 items-center gap-2'>
              <div className='min-w-0 flex-1'>
                {remark ? (
                  <Tooltip
                    content={
                      <div className='max-w-xs break-words text-sm'>
                        <LinkifiedText text={remark} />
                      </div>
                    }
                    trigger='hover'
                    position='topLeft'
                  >
                    {nameNode}
                  </Tooltip>
                ) : (
                  nameNode
                )}
              </div>
              {!isEnabled ? (
                <Tag color={statusMeta.color} shape='circle' size='small'>
                  {t(statusMeta.label)}
                </Tag>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      title: t('操作'),
      dataIndex: 'actions',
      width: 150,
      render: (_, record) => {
        return (
          <div className='flex items-center gap-2'>
            <Button
              type='tertiary'
              size='small'
              loading={Boolean(testingChannelIds[record.id])}
              onClick={() => handleTestChannel(record)}
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
      title: t('分组'),
      dataIndex: 'group',
      width: 100,
      render: (group) => (
        <Tag color='grey' shape='circle' size='small'>
          {group}
        </Tag>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 150,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const updating = Boolean(statusUpdatingIds[record.id]);
        const statusMeta =
          CHANNEL_STATUS_META[record.status] ||
          CHANNEL_STATUS_META[CHANNEL_STATUS.UNKNOWN];
        return (
          <div className='flex items-center gap-2'>
            <Switch
              size='small'
              checked={isEnabled}
              loading={updating}
              disabled={updating}
              onChange={(checked) => handleChannelStatusChange(record, checked)}
            />
            <Tag color={statusMeta.color} shape='circle' size='small'>
              {t(statusMeta.label)}
            </Tag>
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
      width: 190,
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
            onClick={loadRoutingData}
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

      <div className='grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_320px_minmax(0,1fr)]'>
        <section className='flex min-h-[360px] flex-col rounded border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-0)]'>
          <div className='border-b border-[var(--semi-color-border)] p-3'>
            <Text strong>{t('供应商')}</Text>
            <Input
              prefix={<IconSearch />}
              placeholder={t('搜索供应商...')}
              value={providerSearch}
              onChange={setProviderSearch}
              style={{ marginTop: 8 }}
            />
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
                <Tag color='grey' shape='circle' size='small'>
                  {providerModels.length}
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
            <Input
              prefix={<IconSearch />}
              placeholder={t('搜索模型...')}
              value={modelSearch}
              onChange={setModelSearch}
              style={{ marginTop: 8 }}
            />
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
                    onClick={() => setSelectedModelName(model.model_name)}
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
                      <Tag color='grey' shape='circle' size='small'>
                        {model.channelCount}
                      </Tag>
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
          <div className='min-h-0 flex-1 overflow-auto p-2'>
            {loading ? (
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
                scroll={{ x: 980 }}
                onRow={(record) => {
                  const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
                  const isTarget = record.id === targetChannelId;
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
                  if (isTarget) {
                    boxShadow.push('inset 0 0 0 1px var(--semi-color-warning)');
                  }

                  return {
                    'data-routing-channel-id': record.id,
                    style: {
                      background: isTarget
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
        refresh={loadRoutingData}
        visible={showEditChannel}
        handleClose={closeChannelEditor}
        editingChannel={editingChannel}
      />
    </div>
  );
};

export default ModelRoutingWorkbench;
