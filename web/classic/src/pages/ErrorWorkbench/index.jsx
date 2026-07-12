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
  List,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconExternalOpen, IconRefresh } from '@douyinfe/semi-icons';
import {
  API,
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

function renderChannelStatus(status, t) {
  const meta = {
    1: { color: 'green', text: t('已启用') },
    2: { color: 'red', text: t('手动禁用') },
    3: { color: 'orange', text: t('自动禁用') },
  }[status] || { color: 'grey', text: t('未知') };
  return (
    <Tag color={meta.color} shape='circle'>
      {meta.text}
    </Tag>
  );
}

function renderStatusCode(statusCode, t) {
  if (!statusCode) return <Tag color='grey'>{t('无状态码')}</Tag>;
  if (statusCode >= 500) return <Tag color='red'>{statusCode}</Tag>;
  if (statusCode >= 400) return <Tag color='orange'>{statusCode}</Tag>;
  return <Tag color='blue'>{statusCode}</Tag>;
}

function renderTime(timestamp) {
  return timestamp ? timestamp2string(timestamp) : '-';
}

function formatErrorRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return '0%';
  if (rate >= 1) return '100%';
  return `${(rate * 100).toFixed(rate < 0.01 ? 1 : 0)}%`;
}

function renderSeverity(severity, t) {
  const meta = {
    critical: { color: 'red', text: t('严重') },
    high: { color: 'orange', text: t('高') },
    medium: { color: 'yellow', text: t('中') },
    low: { color: 'grey', text: t('低') },
  }[severity] || { color: 'grey', text: t('低') };
  return (
    <Tag color={meta.color} shape='circle'>
      {meta.text}
    </Tag>
  );
}

function renderTrend(trend, t) {
  const labels = {
    new: t('新增'),
    rising: t('上升'),
    falling: t('下降'),
    stable: t('稳定'),
  };
  return (
    <span className='text-xs text-gray-500'>
      {labels[trend] || labels.stable}
    </span>
  );
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
  return { hours: Number(timeRange) || 24 };
}

function buildUsageLogUrl(record, summary, includeSample = false) {
  const params = new URLSearchParams();
  params.set('type', '5');
  if (record.model_name) params.set('model_name', record.model_name);
  if (record.channel) params.set('channel', String(record.channel));
  if (record.group) params.set('group', record.group);
  if (summary.start_time) {
    params.set('start_timestamp', String(summary.start_time));
  }
  if (summary.end_time) params.set('end_timestamp', String(summary.end_time));
  if (includeSample && record.sample_request_id) {
    params.set('request_id', record.sample_request_id);
  }
  if (includeSample && record.sample_upstream_request_id) {
    params.set('upstream_request_id', record.sample_upstream_request_id);
  }
  return `/console/log?${params.toString()}`;
}

function buildRoutingUrl(record) {
  const params = new URLSearchParams({ tab: 'routing' });
  if (record.model_name) params.set('routing_model', record.model_name);
  if (record.group) params.set('routing_group', record.group);
  if (record.channel) params.set('routing_channel', String(record.channel));
  return `/console/models?${params.toString()}`;
}

function getUrgentClusterCount(items) {
  return items.filter(
    (item) => item.severity === 'critical' || item.severity === 'high',
  ).length;
}

function ErrorClusterList({ items, selectedKey, loading, onSelect, t }) {
  return (
    <section className='flex min-h-[520px] min-w-0 flex-col rounded border border-solid border-gray-200 bg-white'>
      <div className='flex items-center justify-between border-b border-solid border-gray-200 px-3 py-2'>
        <Typography.Text strong>{t('故障簇')}</Typography.Text>
        <Typography.Text type='tertiary' size='small'>
          {items.length}
        </Typography.Text>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {items.length === 0 ? (
          <div className='flex min-h-80 items-center justify-center px-6'>
            {loading ? <Spin /> : <Empty title={t('暂无错误日志')} />}
          </div>
        ) : (
          <List
            dataSource={items}
            renderItem={(record) => {
              const selected = selectedKey === record.key;
              return (
                <List.Item
                  onClick={() => onSelect(record.key)}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    background: selected
                      ? 'var(--semi-color-fill-0)'
                      : 'transparent',
                    borderLeft: selected
                      ? '3px solid var(--semi-color-primary)'
                      : '3px solid transparent',
                  }}
                >
                  <div className='w-full min-w-0'>
                    <div className='flex min-w-0 items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <Space spacing={4} wrap>
                          {renderSeverity(record.severity, t)}
                          {record.status_code > 0 && (
                            <Tag color='grey'>{record.status_code}</Tag>
                          )}
                          {renderTrend(record.trend, t)}
                        </Space>
                        <Typography.Text
                          strong
                          ellipsis={{ showTooltip: true, rows: 2 }}
                          style={{ display: 'block', marginTop: 6 }}
                        >
                          {record.error_summary || t('无错误内容')}
                        </Typography.Text>
                        <Typography.Text
                          type='tertiary'
                          size='small'
                          ellipsis={{ showTooltip: true }}
                          style={{ display: 'block', marginTop: 5 }}
                        >
                          {record.model_name || '-'} · {record.group || '-'} ·{' '}
                          {record.channel_name || `#${record.channel || '-'}`}
                        </Typography.Text>
                      </div>
                      <div className='shrink-0 text-right'>
                        <div className='text-lg font-semibold tabular-nums'>
                          {formatErrorRate(record.route_error_rate)}
                        </div>
                        <Typography.Text type='tertiary' size='small'>
                          {t('错误率')}
                        </Typography.Text>
                      </div>
                    </div>
                    <div className='mt-2 flex items-center justify-between gap-2 text-xs text-gray-500'>
                      <span>
                        {t('受影响请求')}: {record.affected_requests}
                      </span>
                      <span>{renderTime(record.last_seen)}</span>
                    </div>
                  </div>
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </section>
  );
}

function ErrorClusterDetails({
  record,
  summary,
  actionLoading,
  testChannel,
  t,
}) {
  if (!record) {
    return (
      <section className='flex min-h-[520px] items-center justify-center rounded border border-solid border-gray-200 bg-white px-6 text-center'>
        <Typography.Text type='tertiary'>{t('请选择故障簇')}</Typography.Text>
      </section>
    );
  }

  const renderPeer = (peer) => {
    const key = `${record.key}:test:${peer.channel}`;
    return (
      <div
        key={peer.channel}
        className={`grid gap-3 border-b border-solid border-gray-100 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${peer.is_current ? 'bg-yellow-50' : ''}`}
      >
        <div className='min-w-0'>
          <Space spacing={4} wrap>
            <Typography.Text strong ellipsis={{ showTooltip: true }}>
              {peer.channel_name || t('未知渠道')}
            </Typography.Text>
            <Typography.Text type='tertiary' size='small'>
              #{peer.channel}
            </Typography.Text>
            {peer.is_current && <Tag color='orange'>{t('当前')}</Tag>}
            {renderChannelStatus(peer.channel_status, t)}
          </Space>
          <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500'>
            <span>
              {t('错误率')} {formatErrorRate(peer.recent_error_rate)}
            </span>
            <span>
              {t('请求次数')} {peer.recent_attempt_count || 0}
            </span>
            <span>
              {t('优先级')} {peer.channel_priority || 0}
            </span>
            <span>
              {t('权重')} {peer.channel_weight || 0}
            </span>
          </div>
        </div>
        <Button
          size='small'
          theme='light'
          icon={actionLoading[key] ? <Spin size='small' /> : undefined}
          loading={actionLoading[key]}
          disabled={!peer.channel}
          onClick={() => testChannel(record, peer.channel)}
        >
          {t('测试')}
        </Button>
      </div>
    );
  };

  const currentTestKey = `${record.key}:test:${record.channel}`;
  return (
    <section className='flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded border border-solid border-gray-200 bg-white'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b border-solid border-gray-200 px-4 py-3'>
        <div className='min-w-0'>
          <Space spacing={4} wrap>
            {record.status_code > 0 && renderStatusCode(record.status_code, t)}
            {record.error_type && <Tag color='red'>{record.error_type}</Tag>}
            {record.error_code && <Tag color='orange'>{record.error_code}</Tag>}
          </Space>
          <Typography.Title
            heading={5}
            ellipsis={{ showTooltip: true }}
            style={{ margin: '8px 0 2px' }}
          >
            {record.error_summary || t('无错误内容')}
          </Typography.Title>
          <Typography.Text type='tertiary' size='small' className='font-mono'>
            {record.fingerprint}
          </Typography.Text>
        </div>
        <Space spacing={6} wrap>
          <Button
            size='small'
            icon={<IconExternalOpen />}
            onClick={() =>
              window.open(buildUsageLogUrl(record, summary), '_blank')
            }
          >
            {t('查看日志')}
          </Button>
          <Button
            size='small'
            icon={<IconExternalOpen />}
            onClick={() => window.open(buildRoutingUrl(record), '_blank')}
          >
            {t('查看路由')}
          </Button>
        </Space>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='space-y-5 p-4'>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
            {[
              [t('错误率'), formatErrorRate(record.route_error_rate)],
              [t('受影响请求'), record.affected_requests],
              [t('受影响用户'), record.affected_users],
              [t('请求次数'), record.route_attempt_count],
            ].map(([label, value]) => (
              <div
                key={label}
                className='rounded border border-solid border-gray-100 bg-gray-50 px-3 py-2'
              >
                <Typography.Text type='tertiary' size='small'>
                  {label}
                </Typography.Text>
                <div className='mt-1 font-semibold tabular-nums'>{value}</div>
              </div>
            ))}
          </div>

          <div className='grid gap-4 text-sm sm:grid-cols-2'>
            <div>
              <Typography.Text type='tertiary' size='small'>
                {t('路由')}
              </Typography.Text>
              <div className='mt-1 break-all font-mono'>
                {record.model_name || '-'}
              </div>
              <Typography.Text type='tertiary' size='small'>
                {record.group || '-'} · {record.channel_name || t('未知渠道')} #
                {record.channel || '-'}
              </Typography.Text>
            </div>
            <div>
              <Typography.Text type='tertiary' size='small'>
                {t('时间线')}
              </Typography.Text>
              <div className='mt-1 tabular-nums'>
                {t('首次')}: {renderTime(record.first_seen)}
              </div>
              <div className='tabular-nums'>
                {t('最近')}: {renderTime(record.last_seen)}
              </div>
            </div>
          </div>

          <div>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <Typography.Text strong>{t('错误样本')}</Typography.Text>
              {(record.sample_request_id ||
                record.sample_upstream_request_id) && (
                <Button
                  size='small'
                  theme='borderless'
                  icon={<IconExternalOpen />}
                  onClick={() =>
                    window.open(
                      buildUsageLogUrl(record, summary, true),
                      '_blank',
                    )
                  }
                >
                  {t('打开样本')}
                </Button>
              )}
            </div>
            <pre className='max-h-64 overflow-auto rounded border border-solid border-gray-200 bg-gray-50 p-3 text-xs leading-5 whitespace-pre-wrap break-words'>
              {record.sample_content || record.error_summary || '-'}
            </pre>
          </div>

          <div className='border-t border-solid border-gray-200 pt-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <Typography.Text strong>{t('当前渠道')}</Typography.Text>
                <div className='mt-1 text-xs text-gray-500'>
                  {record.automatic_channel_test_disabled
                    ? t('已跳过自动测活')
                    : t('参与自动测活')}
                </div>
              </div>
              <Button
                type='primary'
                size='small'
                loading={actionLoading[currentTestKey]}
                disabled={!record.channel}
                onClick={() => testChannel(record, record.channel)}
              >
                {t('测试当前渠道')}
              </Button>
            </div>
            <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500'>
              <span>
                {t('最近测试')}: {renderTime(record.channel_test_time)}
              </span>
              <span>
                {t('响应时间')}: {record.channel_response_time || 0} ms
              </span>
              <span>
                {t('优先级')}: {record.channel_priority || 0}
              </span>
            </div>
          </div>

          <div className='border-t border-solid border-gray-200 pt-4'>
            <div className='mb-2 flex items-center justify-between gap-2'>
              <Typography.Text strong>{t('路由对比')}</Typography.Text>
              <Typography.Text type='tertiary' size='small'>
                {record.peer_channels?.length || 0}
              </Typography.Text>
            </div>
            <div className='overflow-hidden rounded border border-solid border-gray-200'>
              {(record.peer_channels || []).length === 0 ? (
                <div className='px-3 py-8 text-center text-sm text-gray-500'>
                  {t('没有同模型渠道上下文')}
                </div>
              ) : (
                record.peer_channels.map(renderPeer)
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ErrorWorkbench() {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [queryFilters, setQueryFilters] = useState(DEFAULT_FILTERS);
  const [selectedKey, setSelectedKey] = useState(null);

  const statCards = useMemo(
    () => [
      [
        t('错误日志'),
        summary.total_logs,
        summary.truncated ? t('仅聚合最近扫描记录') : t('已覆盖当前筛选范围'),
      ],
      [t('故障簇'), summary.items.length, t('按稳定错误指纹聚合')],
      [
        t('受影响请求'),
        summary.items.reduce(
          (total, item) => total + (item.affected_requests || 0),
          0,
        ),
        t('当前可见故障簇'),
      ],
      [
        t('紧急故障簇'),
        getUrgentClusterCount(summary.items),
        t('高和严重等级'),
      ],
    ],
    [summary, t],
  );

  const setFilterValue = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const fetchSummary = async (nextFilters = queryFilters) => {
    setLoading(true);
    try {
      const params = {
        limit: nextFilters.limit,
        ...buildTimeRangeParams(nextFilters.time_range),
      };
      if (nextFilters.model_name?.trim())
        params.model_name = nextFilters.model_name.trim();
      if (nextFilters.channel !== '' && nextFilters.channel !== undefined)
        params.channel = nextFilters.channel;
      if (nextFilters.group?.trim()) params.group = nextFilters.group.trim();

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
    setQueryFilters((prev) => ({ ...prev, time_range: filters.time_range }));
  }, [filters.time_range]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setQueryFilters((prev) => ({
        ...prev,
        limit: filters.limit,
        model_name: filters.model_name,
        channel: filters.channel,
        group: filters.group,
      }));
    }, FILTER_INPUT_DEBOUNCE_MS);
    return () => clearTimeout(handler);
  }, [filters.limit, filters.model_name, filters.channel, filters.group]);

  useEffect(() => {
    fetchSummary(queryFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryFilters]);

  const selectedRecord =
    summary.items.find((item) => item.key === selectedKey) ||
    summary.items[0] ||
    null;

  const testChannel = async (record, channelId = record.channel) => {
    if (!channelId) {
      showError(t('该错误日志没有记录渠道 ID'));
      return;
    }
    const key = `${record.key}:test:${channelId}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const params = record.model_name ? { model: record.model_name } : {};
      const res = await API.get(`/api/channel/test/${channelId}`, {
        params,
        disableDuplicate: true,
      });
      if (res.data.success) {
        showSuccess(t('渠道测试成功'));
        await fetchSummary();
      } else {
        showError(res.data.message || t('渠道测试失败'));
      }
    } catch (error) {
      showError(error);
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

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
                {t('按稳定错误指纹聚合故障，并提供日志与路由证据。')}
              </Typography.Text>
            </div>
            <Space spacing={8} wrap>
              <Button
                icon={<IconExternalOpen />}
                onClick={() => window.open('/console/log', '_blank')}
              >
                {t('打开使用日志')}
              </Button>
              <Button
                icon={<IconExternalOpen />}
                onClick={() =>
                  window.open('/console/models?tab=routing', '_blank')
                }
              >
                {t('打开模型路由')}
              </Button>
            </Space>
          </div>

          <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {statCards.map(([label, value, hint]) => (
              <div
                key={label}
                className='rounded border border-solid border-gray-200 bg-gray-50 p-4'
              >
                <Typography.Text type='tertiary'>{label}</Typography.Text>
                <div className='mt-1 text-2xl font-semibold tabular-nums'>
                  {value}
                </div>
                <Typography.Text type='tertiary' size='small'>
                  {hint}
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
                icon={<IconRefresh />}
                loading={loading}
                onClick={() => fetchSummary()}
              >
                {t('刷新')}
              </Button>
              <Button
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setSelectedKey(null);
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

          <div className='grid w-full grid-cols-1 gap-3 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.4fr)]'>
            <ErrorClusterList
              items={summary.items || []}
              selectedKey={selectedRecord?.key || null}
              loading={loading}
              onSelect={setSelectedKey}
              t={t}
            />
            <ErrorClusterDetails
              record={selectedRecord}
              summary={summary}
              actionLoading={actionLoading}
              testChannel={testChannel}
              t={t}
            />
          </div>
        </Space>
      </Card>
    </div>
  );
}
