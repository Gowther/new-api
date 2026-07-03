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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  Input,
  InputNumber,
  List,
  Spin,
  Typography,
  Space,
  Button,
  Tag,
  Switch,
} from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { API, showError, showSuccess, showInfo } from '../../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const CHANNEL_STATUS = {
  UNKNOWN: 0,
  ENABLED: 1,
  MANUAL_DISABLED: 2,
  AUTO_DISABLED: 3,
};

const CHANNEL_STATUS_META = {
  [CHANNEL_STATUS.UNKNOWN]: { label: '未知', color: 'grey' },
  [CHANNEL_STATUS.ENABLED]: { label: '已启用', color: 'green' },
  [CHANNEL_STATUS.MANUAL_DISABLED]: { label: '手动禁用', color: 'red' },
  [CHANNEL_STATUS.AUTO_DISABLED]: { label: '自动禁用', color: 'orange' },
};

const sortChannelsByPriority = (channels) =>
  [...channels].sort((a, b) => {
    const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;
    return a.id - b.id;
  });

const ModelPriorityModal = ({
  visible,
  handleClose,
  refresh,
  onPrioritiesUpdated,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [channels, setChannels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [modelSearch, setModelSearch] = useState('');
  const [priorityChanges, setPriorityChanges] = useState({});
  const [statusUpdatingIds, setStatusUpdatingIds] = useState({});

  // Fetch all channels when modal opens
  useEffect(() => {
    if (visible) {
      fetchAllChannels();
    } else {
      // Reset state when modal closes
      setSelectedModel(null);
      setModelSearch('');
      setPriorityChanges({});
      setStatusUpdatingIds({});
    }
  }, [visible]);

  const fetchAllChannels = async () => {
    setLoading(true);
    try {
      let allChannels = [];
      let page = 1;
      const pageSize = 100; // Backend max limit
      let hasMore = true;

      while (hasMore) {
        const res = await API.get(
          `/api/channel?p=${page}&page_size=${pageSize}`,
        );
        const { success, message, data } = res.data;

        if (!success) {
          showError(message || t('获取渠道列表失败'));
          break;
        }

        const items = data?.items || [];
        allChannels = allChannels.concat(items);

        // Check if there are more pages
        const total = data?.total || 0;
        hasMore = allChannels.length < total;
        page++;
      }

      setChannels(sortChannelsByPriority(allChannels));
    } catch (error) {
      showError(t('获取渠道列表失败'));
    } finally {
      setLoading(false);
    }
  };

  // Extract unique models from all channels
  const allModels = useMemo(() => {
    const modelSet = new Set();
    channels.forEach((channel) => {
      if (channel.models) {
        const models = channel.models.split(',').map((m) => m.trim());
        models.forEach((model) => {
          if (model) modelSet.add(model);
        });
      }
    });
    return Array.from(modelSet).sort();
  }, [channels]);

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!modelSearch) return allModels;
    const search = modelSearch.toLowerCase();
    return allModels.filter((model) => model.toLowerCase().includes(search));
  }, [allModels, modelSearch]);

  const getPriorityValue = useCallback(
    (channel) => {
      if (priorityChanges[channel.id] !== undefined) {
        return priorityChanges[channel.id];
      }
      return channel.priority ?? 0;
    },
    [priorityChanges],
  );

  // Get channels that support the selected model
  const channelsForModel = useMemo(() => {
    if (!selectedModel) return [];
    return channels
      .filter((channel) => {
        if (!channel.models) return false;
        const models = channel.models.split(',').map((m) => m.trim());
        return models.includes(selectedModel);
      })
      .sort((a, b) => {
        const priorityDiff = getPriorityValue(b) - getPriorityValue(a);
        if (priorityDiff !== 0) return priorityDiff;
        return a.id - b.id;
      });
  }, [channels, selectedModel, getPriorityValue]);

  const handlePriorityChange = (channelId, value) => {
    const priority = value === null || value === undefined ? 0 : value;
    setPriorityChanges((prev) => ({
      ...prev,
      [channelId]: priority,
    }));
  };

  const handleChannelStatusChange = async (channel, checked) => {
    const status = checked
      ? CHANNEL_STATUS.ENABLED
      : CHANNEL_STATUS.MANUAL_DISABLED;

    setStatusUpdatingIds((prev) => ({
      ...prev,
      [channel.id]: true,
    }));

    try {
      const res = await API.post(`/api/channel/${channel.id}/status`, {
        status,
      });
      const { success, message } = res.data;
      if (!success) {
        throw new Error(message || t('更新失败'));
      }

      setChannels((prev) =>
        prev.map((item) =>
          item.id === channel.id ? { ...item, status } : item,
        ),
      );
      showSuccess(checked ? t('已启用') : t('已禁用'));
      await refresh?.();
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

  const handleSave = async () => {
    if (Object.keys(priorityChanges).length === 0) {
      showInfo(t('没有需要保存的修改'));
      return;
    }

    setSaving(true);
    try {
      const updates = Object.entries(priorityChanges).map(
        async ([id, priority]) => {
          const channelId = parseInt(id, 10);
          const res = await API.put('/api/channel/', {
            id: channelId,
            priority,
          });
          const { success, message } = res.data;
          if (!success) {
            throw new Error(message || t('更新优先级失败'));
          }
          return { id: channelId, priority };
        },
      );

      const results = await Promise.allSettled(updates);
      const successfulUpdates = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const successCount = successfulUpdates.length;
      const failCount = results.filter((r) => r.status === 'rejected').length;

      if (successCount > 0) {
        showSuccess(t('已更新 {{count}} 个渠道', { count: successCount }));
        setChannels((prev) => {
          const prioritiesById = new Map(
            successfulUpdates.map((update) => [update.id, update.priority]),
          );
          return sortChannelsByPriority(
            prev.map((channel) => {
              const priority = prioritiesById.get(channel.id);
              if (priority === undefined) return channel;
              return { ...channel, priority };
            }),
          );
        });
        setPriorityChanges((prev) => {
          const next = { ...prev };
          successfulUpdates.forEach((update) => {
            delete next[update.id];
          });
          return next;
        });
        onPrioritiesUpdated?.(successfulUpdates);
        await refresh?.();
      }

      if (failCount > 0) {
        showError(t('{{count}} 个渠道更新失败', { count: failCount }));
      }
    } catch (error) {
      showError(t('更新优先级失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('模型优先级管理')}
      visible={visible}
      onCancel={handleClose}
      width={1000}
      style={{ maxWidth: '95vw' }}
      footer={
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}
        >
          <Button onClick={handleClose} disabled={saving}>
            {t('取消')}
          </Button>
          <Button
            theme='solid'
            type='primary'
            onClick={handleSave}
            loading={saving}
            disabled={
              saving ||
              Object.keys(priorityChanges).length === 0 ||
              !selectedModel
            }
          >
            {t('保存更改')}
          </Button>
        </div>
      }
    >
      <div style={{ minHeight: '500px', maxHeight: '70vh' }}>
        <Text
          type='tertiary'
          style={{ display: 'block', marginBottom: '16px' }}
        >
          {t('从左侧选择一个模型，查看并编辑支持该模型的渠道优先级')}
        </Text>

        {loading ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '400px',
            }}
          >
            <Spin size='large' />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '16px', height: '100%' }}>
            {/* Left: Model List */}
            <div
              style={{
                width: '35%',
                borderRight: '1px solid var(--semi-color-border)',
                paddingRight: '16px',
              }}
            >
              <Input
                prefix={<IconSearch />}
                placeholder={t('搜索模型...')}
                value={modelSearch}
                onChange={setModelSearch}
                style={{ marginBottom: '12px' }}
              />
              <div
                style={{
                  maxHeight: '450px',
                  overflowY: 'auto',
                }}
              >
                {filteredModels.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '20px',
                      color: 'var(--semi-color-text-2)',
                    }}
                  >
                    {t('未找到模型')}
                  </div>
                ) : (
                  <List
                    dataSource={filteredModels}
                    renderItem={(model) => (
                      <List.Item
                        onClick={() => setSelectedModel(model)}
                        style={{
                          cursor: 'pointer',
                          backgroundColor:
                            selectedModel === model
                              ? 'var(--semi-color-primary-light-default)'
                              : 'transparent',
                          padding: '8px 12px',
                          borderRadius: '4px',
                          marginBottom: '4px',
                        }}
                      >
                        <Text
                          style={{
                            color:
                              selectedModel === model
                                ? 'var(--semi-color-primary)'
                                : 'inherit',
                            fontWeight: selectedModel === model ? 600 : 400,
                          }}
                        >
                          {model}
                        </Text>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            </div>

            {/* Right: Channel List with Priority Editor */}
            <div style={{ flex: 1 }}>
              {!selectedModel ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                    color: 'var(--semi-color-text-2)',
                  }}
                >
                  {t('请选择一个模型以查看渠道')}
                </div>
              ) : (
                <>
                  <Text
                    strong
                    style={{ display: 'block', marginBottom: '12px' }}
                  >
                    {t('支持模型的渠道：{{model}}', { model: selectedModel })} (
                    {channelsForModel.length})
                  </Text>
                  <div
                    style={{
                      maxHeight: '450px',
                      overflowY: 'auto',
                    }}
                  >
                    {channelsForModel.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '20px',
                          color: 'var(--semi-color-text-2)',
                        }}
                      >
                        {t('没有渠道支持此模型')}
                      </div>
                    ) : (
                      <Space vertical spacing='loose' style={{ width: '100%' }}>
                        {channelsForModel.map((channel) => {
                          const isEnabled =
                            channel.status === CHANNEL_STATUS.ENABLED;
                          const isStatusUpdating = Boolean(
                            statusUpdatingIds[channel.id],
                          );
                          const statusMeta =
                            CHANNEL_STATUS_META[channel.status] ||
                            CHANNEL_STATUS_META[CHANNEL_STATUS.UNKNOWN];
                          return (
                            <div
                              key={channel.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns:
                                  'minmax(0, 1fr) 120px 118px',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px',
                                border: '1px solid var(--semi-color-border)',
                                borderRadius: '4px',
                                backgroundColor: isEnabled
                                  ? 'transparent'
                                  : 'var(--semi-color-fill-0)',
                                opacity: isEnabled ? 1 : 0.6,
                              }}
                            >
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '4px',
                                  }}
                                >
                                  <Text
                                    strong
                                    ellipsis
                                    style={{
                                      textDecoration: isEnabled
                                        ? 'none'
                                        : 'line-through',
                                    }}
                                  >
                                    {channel.name}
                                  </Text>
                                  <Tag color={statusMeta.color} size='small'>
                                    {t(statusMeta.label)}
                                  </Tag>
                                </div>
                                <Text
                                  type='tertiary'
                                  size='small'
                                  style={{ display: 'block' }}
                                >
                                  ID: {channel.id} | {t('分组')}:{' '}
                                  {channel.group}
                                </Text>
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  gap: '8px',
                                }}
                              >
                                <Text>{t('状态')}:</Text>
                                <Switch
                                  size='small'
                                  checked={isEnabled}
                                  disabled={isStatusUpdating}
                                  loading={isStatusUpdating}
                                  onChange={(checked) =>
                                    handleChannelStatusChange(channel, checked)
                                  }
                                />
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  gap: '8px',
                                }}
                              >
                                <Text>{t('优先级')}:</Text>
                                <InputNumber
                                  value={getPriorityValue(channel)}
                                  onChange={(value) =>
                                    handlePriorityChange(channel.id, value)
                                  }
                                  min={0}
                                  disabled={!isEnabled || isStatusUpdating}
                                  style={{ width: '80px' }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </Space>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ModelPriorityModal;
