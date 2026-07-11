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

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  API,
  copy,
  showError,
  showSuccess,
  timestamp2string,
} from '../../helpers';

const DEFAULT_SUMMARY = {
  items: [],
  scanned_logs: 0,
  total_logs: 0,
  truncated: false,
  start_time: 0,
  end_time: 0,
};

const DEFAULT_FILTERS = {
  time_range: '24',
  limit: 50,
  model_name: '',
  channel: '',
  group: '',
};

const FILTER_INPUT_DEBOUNCE_MS = 500;
const CHANNEL_STATUS_ENABLED = 1;

const channelStatusMeta = {
  1: { color: 'green', text: '已启用' },
  2: { color: 'red', text: '手动禁用' },
  3: { color: 'orange', text: '自动禁用' },
};

function renderChannelStatus(status) {
  const meta = channelStatusMeta[status] || { color: 'grey', text: '未知' };
  return (
    <Tag color={meta.color} shape='circle'>
      {meta.text}
    </Tag>
  );
}

function renderStatusCode(statusCode) {
  if (!statusCode) {
    return <Tag color='grey'>无状态码</Tag>;
  }
  if (statusCode >= 500) {
    return <Tag color='red'>{statusCode}</Tag>;
  }
  if (statusCode >= 400) {
    return <Tag color='orange'>{statusCode}</Tag>;
  }
  return <Tag color='blue'>{statusCode}</Tag>;
}

function renderTime(timestamp) {
  if (!timestamp) {
    return '-';
  }
  return timestamp2string(timestamp);
}

function buildUsageLogFilter(record) {
  return {
    type: 5,
    channel: record.channel || undefined,
    model_name: record.model_name || undefined,
    group: record.sample_group || undefined,
    request_id: record.sample_request_id || undefined,
    upstream_request_id: record.sample_upstream_request_id || undefined,
  };
}

function buildTimeRangeParams(timeRange) {
  if (timeRange === 'today' || timeRange === 'yesterday') {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayStartSeconds = Math.floor(todayStart.getTime() / 1000);
    if (timeRange === 'today') {
      return {
        start_time: todayStartSeconds,
        end_time: Math.floor(now.getTime() / 1000),
      };
    }
    return {
      start_time: todayStartSeconds - 24 * 3600,
      end_time: todayStartSeconds - 1,
    };
  }
  return { hours: Number(timeRange) || Number(DEFAULT_FILTERS.time_range) };
}

function comparePeerChannels(a, b) {
  if (a.channel_priority !== b.channel_priority) {
    return b.channel_priority - a.channel_priority;
  }
  if (a.channel_weight !== b.channel_weight) {
    return b.channel_weight - a.channel_weight;
  }
  return a.channel - b.channel;
}

function isRoutablePeerChannel(peer) {
  return peer.channel_status === CHANNEL_STATUS_ENABLED && peer.ability_enabled;
}

function getRoutablePeerChannels(record) {
  return (record.peer_channels || [])
    .filter(isRoutablePeerChannel)
    .sort(comparePeerChannels);
}

function getPeerChannelDisplayRows(record) {
  const routablePeers = [];
  const contextPeers = [];

  for (const peer of record.peer_channels || []) {
    if (isRoutablePeerChannel(peer)) {
      routablePeers.push(peer);
    } else {
      contextPeers.push(peer);
    }
  }

  routablePeers.sort(comparePeerChannels);
  contextPeers.sort(comparePeerChannels);

  return [
    ...routablePeers.map((peer, index) => ({
      peer,
      routeRank: index + 1,
      isRoutable: true,
    })),
    ...contextPeers.map((peer) => ({
      peer,
      routeRank: null,
      isRoutable: false,
    })),
  ];
}

function occupiedPeerPriorities(peers, currentChannel) {
  const priorities = new Set();
  for (const peer of peers) {
    if (peer.channel !== currentChannel) {
      priorities.add(peer.channel_priority);
    }
  }
  return priorities;
}

function nextAvailablePriority(priority, occupiedPriorities, step) {
  let nextPriority = priority;
  while (occupiedPriorities.has(nextPriority)) {
    nextPriority += step;
  }
  return nextPriority;
}

function getPriorityMoveTarget(record, direction) {
  const peers = getRoutablePeerChannels(record);
  const currentIndex = peers.findIndex(
    (peer) => peer.channel === record.channel,
  );
  if (currentIndex < 0 || peers.length < 2) {
    return null;
  }
  const currentPeer = peers[currentIndex];
  const otherPeers = peers.filter((peer) => peer.channel !== record.channel);
  const occupiedPriorities = occupiedPeerPriorities(peers, record.channel);
  if (direction === 'top') {
    const highestOtherPriority = Math.max(
      ...otherPeers.map((peer) => peer.channel_priority),
    );
    if (currentPeer.channel_priority > highestOtherPriority) {
      return null;
    }
    return nextAvailablePriority(
      highestOtherPriority + 1,
      occupiedPriorities,
      1,
    );
  }
  if (direction === 'bottom') {
    const lowestOtherPriority = Math.min(
      ...otherPeers.map((peer) => peer.channel_priority),
    );
    if (currentPeer.channel_priority < lowestOtherPriority) {
      return null;
    }
    return nextAvailablePriority(
      lowestOtherPriority - 1,
      occupiedPriorities,
      -1,
    );
  }
  if (direction === 'up') {
    if (currentIndex === 0) {
      return null;
    }
    return nextAvailablePriority(
      peers[currentIndex - 1].channel_priority + 1,
      occupiedPriorities,
      1,
    );
  }
  if (currentIndex === peers.length - 1) {
    return null;
  }
  return nextAvailablePriority(
    peers[currentIndex + 1].channel_priority - 1,
    occupiedPriorities,
    -1,
  );
}

function canMovePriority(record, direction) {
  return getPriorityMoveTarget(record, direction) !== null;
}

export default function ErrorWorkbench() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [queryFilters, setQueryFilters] = useState(DEFAULT_FILTERS);

  const statCards = useMemo(
    () => [
      {
        label: t('错误日志'),
        value: summary.total_logs,
        hint: t('当前筛选范围内的错误日志数量'),
      },
      {
        label: t('错误分组'),
        value: summary.items.length,
        hint: t('按模型、渠道、错误码和错误内容聚合'),
      },
      {
        label: t('扫描日志'),
        value: summary.scanned_logs,
        hint: summary.truncated
          ? t('日志较多，仅扫描最近部分记录')
          : t('已覆盖当前筛选范围'),
      },
    ],
    [summary, t],
  );

  const setFilterValue = (key, value) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const fetchSummary = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const params = {
        limit: nextFilters.limit,
        ...buildTimeRangeParams(nextFilters.time_range),
      };
      if (nextFilters.model_name?.trim()) {
        params.model_name = nextFilters.model_name.trim();
      }
      if (nextFilters.channel !== '' && nextFilters.channel !== undefined) {
        params.channel = nextFilters.channel;
      }
      if (nextFilters.group?.trim()) {
        params.group = nextFilters.group.trim();
      }

      const res = await API.get('/api/log/error_summary', {
        params,
        disableDuplicate: true,
      });
      if (res.data.success) {
        setSummary(res.data.data || DEFAULT_SUMMARY);
      } else {
        showError(res.data.message || t('获取错误汇总失败'));
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQueryFilters((prev) => {
      if (prev.time_range === filters.time_range) {
        return prev;
      }
      return {
        ...prev,
        time_range: filters.time_range,
      };
    });
  }, [filters.time_range]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setQueryFilters((prev) => {
        if (
          prev.limit === filters.limit &&
          prev.model_name === filters.model_name &&
          prev.channel === filters.channel &&
          prev.group === filters.group
        ) {
          return prev;
        }
        return {
          ...prev,
          limit: filters.limit,
          model_name: filters.model_name,
          channel: filters.channel,
          group: filters.group,
        };
      });
    }, FILTER_INPUT_DEBOUNCE_MS);

    return () => {
      clearTimeout(handler);
    };
  }, [filters.limit, filters.model_name, filters.channel, filters.group]);

  useEffect(() => {
    fetchSummary(queryFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryFilters]);

  const runChannelAction = async (record, action, runner) => {
    if (!record.channel) {
      showError(t('该错误日志没有记录渠道 ID'));
      return;
    }
    const key = `${record.key}:${action}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      await runner();
      await fetchSummary();
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const testChannel = async (record) => {
    await runChannelAction(record, 'test', async () => {
      const params = {};
      if (record.model_name) {
        params.model = record.model_name;
      }
      const res = await API.get(`/api/channel/test/${record.channel}`, {
        params,
        disableDuplicate: true,
      });
      if (res.data.success) {
        const time = Number(res.data.time || 0).toFixed(2);
        showSuccess(t('渠道测试成功，耗时 ') + time + t(' 秒'));
      } else {
        showError(res.data.message || t('渠道测试失败'));
      }
    });
  };

  const updateChannelStatus = (record, status) => {
    const nextText = status === 1 ? t('启用') : t('禁用');
    Modal.confirm({
      title: t('确认') + nextText + t('渠道？'),
      content: `${record.channel_name || record.channel} (${record.channel})`,
      onOk: async () => {
        await runChannelAction(record, `status-${status}`, async () => {
          const res = await API.post(`/api/channel/${record.channel}/status`, {
            status,
          });
          if (res.data.success) {
            showSuccess(t('操作成功完成！'));
          } else {
            showError(res.data.message || t('操作失败'));
          }
        });
      },
    });
  };

  const updatePriority = async (record, priority, action = 'priority') => {
    if (!record.channel || priority === null || priority === undefined) {
      return;
    }
    if (Number.isNaN(priority) || priority === record.channel_priority) {
      return;
    }
    await runChannelAction(record, action, async () => {
      const res = await API.put('/api/channel/', {
        id: record.channel,
        priority,
      });
      if (res.data.success) {
        showSuccess(t('更新成功！'));
      } else {
        showError(res.data.message || t('更新失败'));
      }
    });
  };

  const movePriority = async (record, direction) => {
    const priority = getPriorityMoveTarget(record, direction);
    if (priority === null) {
      showError(t('没有同模型渠道排序上下文'));
      return;
    }
    await updatePriority(record, priority, `priority-${direction}`);
  };

  const renderPeerChannels = (record) => {
    const peerRows = getPeerChannelDisplayRows(record);
    if (peerRows.length === 0) {
      return (
        <Typography.Text type='tertiary' size='small'>
          {t('没有同模型渠道排序上下文')}
        </Typography.Text>
      );
    }
    return (
      <div className='max-h-56 w-full overflow-y-auto rounded-lg border border-solid border-gray-100 bg-gray-50 p-2'>
        <Typography.Text type='tertiary' size='small'>
          {t('同模型渠道池')} · {t('按优先级、权重排序')}
        </Typography.Text>
        <Space
          vertical
          align='start'
          spacing={6}
          style={{ width: '100%', marginTop: 6 }}
        >
          {peerRows.map(({ peer, routeRank, isRoutable }) => (
            <div
              key={peer.channel}
              className={
                (peer.is_current
                  ? 'w-full rounded-md border border-solid border-yellow-200 bg-yellow-50 p-2'
                  : 'w-full rounded-md border border-solid border-gray-100 bg-white p-2') +
                (isRoutable ? '' : ' opacity-60')
              }
            >
              <Space spacing={4} wrap>
                <Tag color='grey'>
                  {routeRank === null ? '-' : `#${routeRank}`}
                </Tag>
                <Typography.Text strong>
                  {peer.channel_name || t('未知渠道')} #{peer.channel}
                </Typography.Text>
                {peer.is_current && <Tag color='orange'>{t('当前')}</Tag>}
              </Space>
              <div className='mt-1'>
                <Space spacing={4} wrap>
                  {renderChannelStatus(peer.channel_status)}
                  <Tag color='grey'>
                    {t('优先级')} {peer.channel_priority || 0}
                  </Tag>
                  <Tag color='grey'>
                    {t('权重')} {peer.channel_weight || 0}
                  </Tag>
                  <Tag color={peer.recent_error_count > 0 ? 'red' : 'grey'}>
                    {t('近期错误')} {peer.recent_error_count || 0}
                  </Tag>
                  {peer.automatic_channel_test_disabled && (
                    <Tag color='red'>{t('跳过自动测活')}</Tag>
                  )}
                  {peer.multi_key_total > 0 && (
                    <Tag color='blue'>
                      {t('多 Key')} {peer.multi_key_enabled}/
                      {peer.multi_key_total}
                    </Tag>
                  )}
                </Space>
              </div>
            </div>
          ))}
        </Space>
      </div>
    );
  };

  const copyUsageLogFilter = async (record) => {
    const filter = buildUsageLogFilter(record);
    const ok = await copy(JSON.stringify(filter, null, 2));
    if (ok) {
      showSuccess(t('已复制日志筛选条件'));
    } else {
      showError(t('复制失败'));
    }
  };

  const columns = [
    {
      title: t('错误次数'),
      dataIndex: 'count',
      width: 120,
      sorter: (a, b) => a.count - b.count,
      render: (_, record) => (
        <div>
          <div className='text-2xl font-semibold leading-none text-red-600 tabular-nums'>
            {record.count}
          </div>
          <div className='mt-2 text-xs text-gray-500'>
            {t('最近')} {renderTime(record.last_seen)}
          </div>
          <div className='text-xs text-gray-500'>
            {t('首次')} {renderTime(record.first_seen)}
          </div>
        </div>
      ),
    },
    {
      title: t('模型'),
      dataIndex: 'model_name',
      width: 180,
      render: (_, record) =>
        record.model_name ? (
          <Space vertical align='start' spacing={4}>
            <Typography.Text
              strong
              ellipsis={{ showTooltip: true }}
              className='max-w-[170px] font-mono'
            >
              {record.model_name}
            </Typography.Text>
            {record.sample_group && (
              <Tag color='violet' type='light'>
                {record.sample_group}
              </Tag>
            )}
          </Space>
        ) : (
          <Typography.Text type='tertiary'>{t('未记录')}</Typography.Text>
        ),
    },
    {
      title: t('渠道状态'),
      dataIndex: 'channel',
      width: 260,
      render: (_, record) => (
        <Space vertical align='start' spacing={4}>
          <Typography.Text
            strong
            ellipsis={{ showTooltip: true }}
            className='max-w-[240px]'
          >
            {record.channel_name || t('未知渠道')}
          </Typography.Text>
          <Typography.Text type='tertiary' size='small'>
            #{record.channel || '-'}
          </Typography.Text>
          <Space spacing={4} wrap>
            {renderChannelStatus(record.channel_status)}
            <Tag color='light-blue' type='light'>
              {t('优先级')} {record.channel_priority || 0}
            </Tag>
            {record.channel_response_time > 0 && (
              <Tag color='blue'>{record.channel_response_time} ms</Tag>
            )}
          </Space>
          <Typography.Text type='tertiary' size='small'>
            {t('最近测试')} {renderTime(record.channel_test_time)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('错误原因'),
      dataIndex: 'error_summary',
      width: 460,
      ellipsis: true,
      render: (_, record) => (
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Space vertical align='start' spacing={6} style={{ width: '100%' }}>
            <Space spacing={4} wrap style={{ width: '100%', maxWidth: '100%' }}>
              {renderStatusCode(record.status_code)}
              {record.error_type && (
                <Tag
                  color='red'
                  style={{
                    maxWidth: '100%',
                    whiteSpace: 'normal',
                    wordBreak: 'break-all',
                  }}
                >
                  {record.error_type}
                </Tag>
              )}
              {record.error_code && (
                <Tag
                  color='orange'
                  style={{
                    maxWidth: '100%',
                    whiteSpace: 'normal',
                    wordBreak: 'break-all',
                  }}
                >
                  {record.error_code}
                </Tag>
              )}
            </Space>
            <Tooltip
              position='topLeft'
              content={
                <pre className='m-0 max-w-xl whitespace-pre-wrap text-xs'>
                  {record.sample_content || record.error_summary}
                </pre>
              }
            >
              <Typography.Text
                strong
                ellipsis={{ showTooltip: false, rows: 3 }}
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  wordBreak: 'break-all',
                }}
              >
                {record.error_summary || t('无错误内容')}
              </Typography.Text>
            </Tooltip>
            {(record.sample_request_id ||
              record.sample_upstream_request_id) && (
              <Typography.Text
                type='tertiary'
                size='small'
                className='font-mono'
                ellipsis={{ showTooltip: true }}
                style={{ display: 'block', width: '100%', maxWidth: '100%' }}
              >
                {record.sample_request_id || record.sample_upstream_request_id}
              </Typography.Text>
            )}
          </Space>
        </div>
      ),
    },
    {
      title: t('测活配置'),
      dataIndex: 'automatic_channel_test_disabled',
      width: 220,
      render: (_, record) => (
        <Space vertical align='start' spacing={4}>
          <Space spacing={4} wrap>
            {record.automatic_channel_test_disabled ? (
              <Tag color='red' type='light'>
                {t('跳过自动测活')}
              </Tag>
            ) : (
              <Tag color='green' type='light'>
                {t('参与自动测活')}
              </Tag>
            )}
            {record.auto_test_channel_interval_minutes > 0 && (
              <Tag color='blue'>
                {record.auto_test_channel_interval_minutes} {t('分钟')}
              </Tag>
            )}
          </Space>
          {record.multi_key_total > 0 && (
            <div className='rounded-md border border-solid border-gray-100 bg-gray-50 p-2'>
              <Typography.Text strong className='tabular-nums'>
                {record.multi_key_enabled}/{record.multi_key_total}
              </Typography.Text>
              <div className='text-xs text-gray-500'>{t('多 Key')}</div>
              <Space spacing={4} wrap className='mt-1'>
                {record.multi_key_auto_disabled > 0 && (
                  <Tag color='orange' type='light'>
                    {t('自动禁用')} {record.multi_key_auto_disabled}
                  </Tag>
                )}
                {record.multi_key_manual_disabled > 0 && (
                  <Tag color='red' type='light'>
                    {t('手动禁用')} {record.multi_key_manual_disabled}
                  </Tag>
                )}
              </Space>
            </div>
          )}
        </Space>
      ),
    },
    {
      title: t('同模型渠道池'),
      dataIndex: 'peer_channels',
      width: 320,
      render: (_, record) => renderPeerChannels(record),
    },
    {
      title: t('处理'),
      dataIndex: 'actions',
      width: 250,
      fixed: 'right',
      render: (_, record) => (
        <Space vertical align='start' spacing={6}>
          <Space spacing={6} wrap>
            <Button
              size='small'
              type='primary'
              theme='light'
              loading={actionLoading[`${record.key}:test`]}
              disabled={!record.channel}
              onClick={() => testChannel(record)}
            >
              {t('测试')}
            </Button>
            {record.channel_status === 1 ? (
              <Button
                size='small'
                type='danger'
                theme='light'
                loading={actionLoading[`${record.key}:status-2`]}
                disabled={!record.channel}
                onClick={() => updateChannelStatus(record, 2)}
              >
                {t('禁用')}
              </Button>
            ) : (
              <Button
                size='small'
                type='tertiary'
                theme='light'
                loading={actionLoading[`${record.key}:status-1`]}
                disabled={!record.channel}
                onClick={() => updateChannelStatus(record, 1)}
              >
                {t('启用')}
              </Button>
            )}
            <Button
              size='small'
              theme='borderless'
              onClick={() => copyUsageLogFilter(record)}
            >
              {t('复制筛选')}
            </Button>
          </Space>
          <Space vertical align='start' spacing={4}>
            <Typography.Text type='tertiary' size='small'>
              {t('路由排序')}
            </Typography.Text>
            <Space spacing={4} wrap>
              <Button
                size='small'
                theme='light'
                loading={actionLoading[`${record.key}:priority-top`]}
                disabled={!record.channel || !canMovePriority(record, 'top')}
                onClick={() => movePriority(record, 'top')}
              >
                {t('置顶')}
              </Button>
              <Button
                size='small'
                theme='light'
                loading={actionLoading[`${record.key}:priority-up`]}
                disabled={!record.channel || !canMovePriority(record, 'up')}
                onClick={() => movePriority(record, 'up')}
              >
                {t('上移')}
              </Button>
              <Button
                size='small'
                theme='light'
                loading={actionLoading[`${record.key}:priority-down`]}
                disabled={!record.channel || !canMovePriority(record, 'down')}
                onClick={() => movePriority(record, 'down')}
              >
                {t('下移')}
              </Button>
              <Button
                size='small'
                theme='light'
                loading={actionLoading[`${record.key}:priority-bottom`]}
                disabled={!record.channel || !canMovePriority(record, 'bottom')}
                onClick={() => movePriority(record, 'bottom')}
              >
                {t('降到底')}
              </Button>
            </Space>
          </Space>
        </Space>
      ),
    },
  ];

  return (
    <div className='mt-[60px] px-2'>
      <Card>
        <Space vertical align='start' spacing={18} style={{ width: '100%' }}>
          <div className='flex w-full flex-col gap-2 md:flex-row md:items-end md:justify-between'>
            <div>
              <Typography.Title heading={4} style={{ margin: 0 }}>
                {t('错误排障工作台')}
              </Typography.Title>
              <Typography.Text type='tertiary'>
                {t(
                  '按模型、渠道、错误码和错误内容聚合最近错误，方便快速调整渠道。',
                )}
              </Typography.Text>
            </div>
            <Space spacing={8} wrap>
              <Button onClick={() => window.open('/console/log', '_blank')}>
                {t('打开使用日志')}
              </Button>
              <Button onClick={() => window.open('/console/channel', '_blank')}>
                {t('打开渠道管理')}
              </Button>
            </Space>
          </div>

          <div className='grid w-full grid-cols-1 gap-3 md:grid-cols-3'>
            {statCards.map((card) => (
              <div
                key={card.label}
                className='rounded-xl border border-solid border-gray-100 bg-gray-50 p-4'
              >
                <Typography.Text type='tertiary'>{card.label}</Typography.Text>
                <div className='mt-1 text-2xl font-semibold'>{card.value}</div>
                <Typography.Text type='tertiary' size='small'>
                  {card.hint}
                </Typography.Text>
              </div>
            ))}
          </div>

          <div className='flex w-full flex-wrap items-end gap-3'>
            <div style={{ width: 150 }}>
              <Typography.Text type='tertiary' size='small'>
                {t('时间范围')}
              </Typography.Text>
              <Select
                value={filters.time_range}
                style={{ width: '100%' }}
                onChange={(value) => setFilterValue('time_range', value)}
              >
                <Select.Option value='today'>{t('今天')}</Select.Option>
                <Select.Option value='yesterday'>{t('昨天')}</Select.Option>
                <Select.Option value='1'>{t('最近 1 小时')}</Select.Option>
                <Select.Option value='6'>{t('最近 6 小时')}</Select.Option>
                <Select.Option value='24'>{t('最近 24 小时')}</Select.Option>
                <Select.Option value='72'>{t('最近 3 天')}</Select.Option>
                <Select.Option value='168'>{t('最近 7 天')}</Select.Option>
              </Select>
            </div>
            <div style={{ width: 120 }}>
              <Typography.Text type='tertiary' size='small'>
                {t('数量')}
              </Typography.Text>
              <InputNumber
                value={filters.limit}
                min={1}
                max={200}
                style={{ width: '100%' }}
                onChange={(value) => setFilterValue('limit', value || 50)}
              />
            </div>
            <div style={{ width: 210 }}>
              <Typography.Text type='tertiary' size='small'>
                {t('模型')}
              </Typography.Text>
              <Input
                value={filters.model_name}
                placeholder='gpt-4o'
                onChange={(value) => setFilterValue('model_name', value)}
              />
            </div>
            <div style={{ width: 140 }}>
              <Typography.Text type='tertiary' size='small'>
                {t('渠道 ID')}
              </Typography.Text>
              <InputNumber
                value={filters.channel}
                min={1}
                style={{ width: '100%' }}
                onChange={(value) => setFilterValue('channel', value || '')}
              />
            </div>
            <div style={{ width: 160 }}>
              <Typography.Text type='tertiary' size='small'>
                {t('分组')}
              </Typography.Text>
              <Input
                value={filters.group}
                placeholder='default'
                onChange={(value) => setFilterValue('group', value)}
              />
            </div>
            <Space spacing={8}>
              <Button
                type='primary'
                loading={loading}
                onClick={() => fetchSummary()}
              >
                {t('刷新')}
              </Button>
              <Button
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                }}
              >
                {t('重置')}
              </Button>
            </Space>
          </div>

          {summary.truncated && (
            <Tag color='orange' size='large'>
              {t(
                '错误日志较多，本页仅聚合最近扫描到的部分记录。可缩短时间范围或增加筛选条件。',
              )}
            </Tag>
          )}

          <Table
            rowKey='key'
            loading={loading}
            columns={columns}
            dataSource={summary.items || []}
            pagination={false}
            scroll={{ x: 1640 }}
            style={{ width: '100%' }}
            empty={
              <Empty
                title={t('暂无错误日志')}
                description={t('当前筛选范围内没有错误记录')}
              />
            }
          />
        </Space>
      </Card>
    </div>
  );
}
