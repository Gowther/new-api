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

export default function ErrorWorkbench() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [filters, setFilters] = useState({
    hours: 24,
    limit: 50,
    model_name: '',
    channel: '',
    group: '',
  });

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
        hours: nextFilters.hours,
        limit: nextFilters.limit,
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
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const updatePriority = async (record, value) => {
    if (!record.channel || value === '' || value === undefined) {
      return;
    }
    const priority = parseInt(value, 10);
    if (Number.isNaN(priority) || priority === record.channel_priority) {
      return;
    }
    await runChannelAction(record, 'priority', async () => {
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
          <Typography.Text strong>{record.count}</Typography.Text>
          <div className='text-xs text-gray-500'>
            {t('首次')} {renderTime(record.first_seen)}
          </div>
          <div className='text-xs text-gray-500'>
            {t('最近')} {renderTime(record.last_seen)}
          </div>
        </div>
      ),
    },
    {
      title: t('模型'),
      dataIndex: 'model_name',
      width: 180,
      render: (modelName) =>
        modelName ? (
          <Tag color='light-blue' type='light'>
            {modelName}
          </Tag>
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
          <Typography.Text strong>
            {record.channel_name || t('未知渠道')} #{record.channel || '-'}
          </Typography.Text>
          <Space spacing={4} wrap>
            {renderChannelStatus(record.channel_status)}
            <Tag color='grey'>
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
      render: (_, record) => (
        <Space vertical align='start' spacing={6}>
          <Space spacing={4} wrap>
            {renderStatusCode(record.status_code)}
            {record.error_type && <Tag color='red'>{record.error_type}</Tag>}
            {record.error_code && <Tag color='orange'>{record.error_code}</Tag>}
            {record.sample_group && (
              <Tag color='violet'>{record.sample_group}</Tag>
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
              ellipsis={{ showTooltip: false }}
              style={{ maxWidth: 460 }}
            >
              {record.error_summary || t('无错误内容')}
            </Typography.Text>
          </Tooltip>
          {(record.sample_request_id || record.sample_upstream_request_id) && (
            <Typography.Text type='tertiary' size='small'>
              {record.sample_request_id || record.sample_upstream_request_id}
            </Typography.Text>
          )}
        </Space>
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
              <Tag color='red'>{t('跳过自动测活')}</Tag>
            ) : (
              <Tag color='green'>{t('参与自动测活')}</Tag>
            )}
            {record.auto_test_channel_interval_minutes > 0 && (
              <Tag color='blue'>
                {record.auto_test_channel_interval_minutes} {t('分钟')}
              </Tag>
            )}
          </Space>
          {record.multi_key_total > 0 && (
            <Typography.Text type='tertiary' size='small'>
              {t('多 Key')} {record.multi_key_enabled}/{record.multi_key_total}
              {record.multi_key_auto_disabled > 0
                ? `, ${t('自动禁用')} ${record.multi_key_auto_disabled}`
                : ''}
              {record.multi_key_manual_disabled > 0
                ? `, ${t('手动禁用')} ${record.multi_key_manual_disabled}`
                : ''}
            </Typography.Text>
          )}
        </Space>
      ),
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
          <Space spacing={6}>
            <Typography.Text type='tertiary' size='small'>
              {t('优先级')}
            </Typography.Text>
            <InputNumber
              size='small'
              style={{ width: 92 }}
              defaultValue={record.channel_priority || 0}
              disabled={!record.channel}
              onBlur={(event) => updatePriority(record, event.target.value)}
            />
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
                value={filters.hours}
                style={{ width: '100%' }}
                onChange={(value) => setFilterValue('hours', value)}
              >
                <Select.Option value={1}>{t('最近 1 小时')}</Select.Option>
                <Select.Option value={6}>{t('最近 6 小时')}</Select.Option>
                <Select.Option value={24}>{t('最近 24 小时')}</Select.Option>
                <Select.Option value={72}>{t('最近 3 天')}</Select.Option>
                <Select.Option value={168}>{t('最近 7 天')}</Select.Option>
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
                  const nextFilters = {
                    hours: 24,
                    limit: 50,
                    model_name: '',
                    channel: '',
                    group: '',
                  };
                  setFilters(nextFilters);
                  fetchSummary(nextFilters);
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
            scroll={{ x: 1320 }}
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
