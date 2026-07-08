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
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconEdit,
  IconRefresh,
  IconSave,
  IconSearch,
} from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

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

const getRoutingModelNames = (model) => {
  return model ? [model.model_name] : [];
};

const getModelInitial = (modelName) => {
  return (modelName || '').trim().charAt(0).toUpperCase() || '?';
};

const channelSupportsModel = (channel, modelNames) => {
  if (modelNames.length === 0) return false;
  const channelModels = new Set(splitCsv(channel.models));
  return modelNames.some((modelName) => channelModels.has(modelName));
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

  return sortRoutingChannels(channels);
};

const ModelRoutingWorkbench = () => {
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

  const loadRoutingData = useCallback(async () => {
    setLoading(true);
    try {
      const [pricingData, channelItems] = await Promise.all([
        fetchPricingRoutingData(),
        fetchAllChannels(),
      ]);
      setVendors(pricingData.vendors);
      setModels(pricingData.models);
      setChannels(channelItems);
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

  const changedCount = getChangedCount(routingChanges);

  useEffect(() => {
    if (selectedProviderKey) {
      const exists = providerOptions.some(
        (provider) => provider.key === selectedProviderKey,
      );
      if (exists) return;
    }

    const firstProvider = providerOptions.find(
      (provider) => provider.modelCount > 0,
    );
    setSelectedProviderKey(
      firstProvider?.key || providerOptions[0]?.key || null,
    );
  }, [providerOptions, selectedProviderKey]);

  useEffect(() => {
    if (!selectedProviderKey) {
      setSelectedModelName(null);
      return;
    }

    const exists = providerModels.some(
      (model) => model.model_name === selectedModelName,
    );
    if (exists) return;

    setSelectedModelName(providerModels[0]?.model_name || null);
  }, [providerModels, selectedModelName, selectedProviderKey]);

  const handleProviderSelect = (providerKey) => {
    setSelectedProviderKey(providerKey);
    setSelectedModelName(null);
    setModelSearch('');
  };

  const openChannelEditor = (channel) => {
    setEditingChannel(channel);
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
      render: (_, record, index) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const remark = record.remark?.trim();
        const routeRoleLabel =
          isEnabled && index < ROUTING_ROLE_LABELS.length
            ? ROUTING_ROLE_LABELS[index]
            : null;
        const nameNode = (
          <Text
            strong
            ellipsis
            style={{
              textDecoration: isEnabled ? 'none' : 'line-through',
            }}
          >
            {record.name}
          </Text>
        );
        return (
          <div className='flex min-w-0 items-center justify-between gap-2'>
            <div className='min-w-0'>
              <div className='flex min-w-0 items-center gap-2'>
                <Tag color='grey' shape='circle' size='small'>
                  #{index + 1}
                </Tag>
                {routeRoleLabel ? (
                  <Tag
                    color={ROUTING_ROLE_COLORS[index]}
                    shape='circle'
                    size='small'
                  >
                    {t(routeRoleLabel)}
                  </Tag>
                ) : null}
                {remark ? (
                  <Tooltip
                    content={
                      <div className='max-w-xs break-words text-sm'>
                        {remark}
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
                <Text type='tertiary' size='small'>
                  ID: {record.id}
                </Text>
              </div>
            </div>
            <Button
              type='tertiary'
              size='small'
              icon={<IconEdit />}
              onClick={() => openChannelEditor(record)}
            >
              {t('编辑')}
            </Button>
          </div>
        );
      },
    },
    {
      title: t('类型'),
      dataIndex: 'type',
      width: 150,
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
      width: 120,
      render: (group) => (
        <Tag color='grey' shape='circle' size='small'>
          {group}
        </Tag>
      ),
    },
    {
      title: t('状态'),
      dataIndex: 'status',
      width: 170,
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
      title: t('优先级'),
      dataIndex: 'priority',
      width: 130,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const updating = Boolean(statusUpdatingIds[record.id]);
        return (
          <InputNumber
            min={0}
            value={getFieldValue(record, routingChanges, 'priority')}
            disabled={!isEnabled || updating}
            onChange={(value) =>
              handleRoutingFieldChange(record, 'priority', value)
            }
            style={{ width: 90 }}
          />
        );
      },
    },
    {
      title: t('权重'),
      dataIndex: 'weight',
      width: 130,
      render: (_, record) => {
        const isEnabled = record.status === CHANNEL_STATUS.ENABLED;
        const updating = Boolean(statusUpdatingIds[record.id]);
        return (
          <InputNumber
            min={0}
            value={getFieldValue(record, routingChanges, 'weight')}
            disabled={!isEnabled || updating}
            onChange={(value) =>
              handleRoutingFieldChange(record, 'weight', value)
            }
            style={{ width: 90 }}
          />
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

      <div className='grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[280px_360px_minmax(0,1fr)]'>
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
              <Tag color='grey' shape='circle' size='small'>
                {providerModels.length}
              </Tag>
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
                        {model.bound_channels?.length || 0}
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
                pagination={false}
                size='small'
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
