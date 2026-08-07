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
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconExternalOpen,
  IconHelpCircle,
  IconRefresh,
} from '@douyinfe/semi-icons';
import { API, showError, showSuccess, timestamp2string } from '../../helpers';

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

function ErrorMetricHelp({ children, description, className = '', showIcon }) {
  return (
    <Tooltip
      content={
        <div style={{ maxWidth: 360, lineHeight: 1.6 }}>{description}</div>
      }
      position='top'
      showArrow
    >
      <span
        className={`inline-flex min-w-0 cursor-help items-center gap-1 ${className}`}
      >
        {children}
        {showIcon === false ? null : (
          <IconHelpCircle className='shrink-0 text-gray-400' />
        )}
        <span className='sr-only'>: {description}</span>
      </span>
    </Tooltip>
  );
}

function RouteErrorRateHelp({ children, errors, attempts, rate, className }) {
  const { t } = useTranslation();
  const description = t(
    'Route error rate = error attempts / total route attempts for the same channel, model, and group in the selected time range. This route has {{errors}} error attempts out of {{attempts}} total attempts ({{rate}}). It includes all error fingerprints on the route.',
    { errors, attempts, rate },
  );
  return (
    <ErrorMetricHelp description={description} className={className}>
      {children}
    </ErrorMetricHelp>
  );
}

function ErrorIdentityValue({ value, compact, mono, className = '' }) {
  const valueClassName = `${mono ? 'font-mono ' : ''}${className}`;
  if (!compact) {
    return (
      <span className={`min-w-0 break-all ${valueClassName}`}>{value}</span>
    );
  }
  return (
    <Tooltip content={value} position='topLeft' showArrow>
      <span className={`min-w-0 truncate ${valueClassName}`}>{value}</span>
    </Tooltip>
  );
}

function ErrorRouteIdentity({ record, compact, t }) {
  return (
    <dl
      className={`grid min-w-0 ${compact ? 'gap-2 rounded border border-solid border-gray-200 bg-gray-50 px-2.5 py-2 text-xs' : 'gap-1.5 text-sm'}`}
    >
      <div
        className={`grid min-w-0 items-baseline gap-2 ${compact ? 'grid-cols-[3.75rem_minmax(0,1fr)]' : 'grid-cols-[5rem_minmax(0,1fr)]'}`}
      >
        <dt className='font-medium text-gray-500'>{t('模型')}</dt>
        <dd className='min-w-0 text-sm font-semibold text-gray-900'>
          <ErrorIdentityValue
            value={record.model_name || '-'}
            compact={compact}
            mono
          />
        </dd>
      </div>
      <div
        className={`grid min-w-0 items-baseline gap-2 ${compact ? 'grid-cols-[3.75rem_minmax(0,1fr)]' : 'grid-cols-[5rem_minmax(0,1fr)]'}`}
      >
        <dt className='font-medium text-gray-500'>{t('渠道')}</dt>
        <dd className='flex min-w-0 items-baseline gap-1.5 text-sm font-semibold text-gray-900'>
          <ErrorIdentityValue
            value={record.channel_name || t('未知渠道')}
            compact={compact}
          />
          <span className='shrink-0 font-mono text-xs font-medium text-gray-500'>
            #{record.channel || '-'}
          </span>
        </dd>
      </div>
      <div
        className={`grid min-w-0 items-baseline gap-2 ${compact ? 'grid-cols-[3.75rem_minmax(0,1fr)]' : 'grid-cols-[5rem_minmax(0,1fr)]'}`}
      >
        <dt className='font-medium text-gray-500'>{t('分组')}</dt>
        <dd className='min-w-0 font-medium'>
          <ErrorIdentityValue
            value={record.group || '-'}
            compact={compact}
            mono
          />
        </dd>
      </div>
    </dl>
  );
}

function renderSeverity(severity, t) {
  const meta = {
    critical: { color: 'red', text: t('严重') },
    high: { color: 'orange', text: t('高') },
    medium: { color: 'yellow', text: t('中') },
    low: { color: 'grey', text: t('低') },
  }[severity] || { color: 'grey', text: t('低') };
  return (
    <ErrorMetricHelp
      description={t(
        'Severity uses channel status, HTTP status, route error rate, route attempts, and cluster error-log count. Critical requires an enabled channel with at least 5 attempts and at least 50% errors; high covers enabled-channel authentication, server, or at least 20% route errors; medium covers HTTP errors or at least 3 logs; otherwise severity is low.',
      )}
      showIcon={false}
    >
      <Tag color={meta.color} shape='circle'>
        {meta.text}
      </Tag>
    </ErrorMetricHelp>
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
    <ErrorMetricHelp
      description={t(
        "Trend compares this cluster's error-log count in the newer half of the selected time range with the older half. New means only the newer half has errors; rising or falling requires a meaningful change; otherwise it is stable.",
      )}
      showIcon={false}
      className='text-xs text-gray-500'
    >
      {labels[trend] || labels.stable}
    </ErrorMetricHelp>
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
    <section className='flex h-[520px] min-w-0 flex-col overflow-hidden rounded border border-solid border-gray-200 bg-white xl:h-full'>
      <div className='flex items-center justify-between border-b border-solid border-gray-200 px-3 py-2'>
        <Typography.Text strong>
          <ErrorMetricHelp
            description={t(
              'A fault cluster groups error logs by model, group, channel, and a normalized error fingerprint. The visible list is ranked by severity and capped by the fault cluster limit.',
            )}
          >
            {t('故障簇')}
          </ErrorMetricHelp>
        </Typography.Text>
        <Typography.Text type='tertiary' size='small'>
          {items.length}
        </Typography.Text>
      </div>
      <div className='min-h-0 flex-1 overscroll-contain overflow-y-auto'>
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
                        <div className='mt-2'>
                          <ErrorRouteIdentity record={record} compact t={t} />
                        </div>
                        <Typography.Text
                          strong
                          ellipsis={{ showTooltip: true, rows: 2 }}
                          style={{ display: 'block', marginTop: 6 }}
                        >
                          {record.error_summary || t('无错误内容')}
                        </Typography.Text>
                      </div>
                      <div className='shrink-0 text-right'>
                        <RouteErrorRateHelp
                          errors={record.route_error_count}
                          attempts={record.route_attempt_count}
                          rate={formatErrorRate(record.route_error_rate)}
                          className='flex-col items-end gap-0'
                        >
                          <span className='text-lg font-semibold tabular-nums'>
                            {formatErrorRate(record.route_error_rate)}
                          </span>
                          <Typography.Text type='tertiary' size='small'>
                            {t('Route error rate')}
                          </Typography.Text>
                        </RouteErrorRateHelp>
                      </div>
                    </div>
                    <div className='mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500'>
                      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                        <ErrorMetricHelp
                          description={t(
                            'Cluster error logs counts error-log rows with this exact fingerprint in the selected time range. Retries can produce more than one row for a request.',
                          )}
                        >
                          <span>
                            {t('Cluster error logs')}: {record.count}
                          </span>
                        </ErrorMetricHelp>
                        <ErrorMetricHelp
                          description={t(
                            'Affected requests counts distinct failed requests in this fault cluster. It deduplicates by request ID, then upstream request ID, and falls back to log ID. It is not used to calculate route error rate.',
                          )}
                        >
                          <span>
                            {t('受影响请求')}: {record.affected_requests}
                          </span>
                        </ErrorMetricHelp>
                      </div>
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
      <section className='flex h-[520px] items-center justify-center rounded border border-solid border-gray-200 bg-white px-6 text-center xl:h-full'>
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
            <ErrorIdentityValue
              value={peer.channel_name || t('未知渠道')}
              compact
              className='max-w-64 text-sm font-medium'
            />
            <Typography.Text type='tertiary' size='small'>
              #{peer.channel}
            </Typography.Text>
            {peer.is_current && <Tag color='orange'>{t('当前')}</Tag>}
            {renderChannelStatus(peer.channel_status, t)}
          </Space>
          <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500'>
            <RouteErrorRateHelp
              errors={peer.recent_error_count}
              attempts={peer.recent_attempt_count}
              rate={formatErrorRate(peer.recent_error_rate)}
            >
              <span>
                {t('Route error rate')}{' '}
                {formatErrorRate(peer.recent_error_rate)}
              </span>
            </RouteErrorRateHelp>
            <ErrorMetricHelp
              description={t(
                'Route attempts count successful consume logs plus error logs for the same channel, model, and group in the selected time range. They are log attempts, not distinct requests.',
              )}
            >
              <span>
                {t('Route attempts')} {peer.recent_attempt_count || 0}
              </span>
            </ErrorMetricHelp>
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
    <section className='flex h-[520px] min-w-0 flex-col overflow-hidden rounded border border-solid border-gray-200 bg-white xl:h-full'>
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
          <div className='flex min-w-0 items-center gap-2 text-xs text-gray-500'>
            <ErrorMetricHelp
              description={t(
                'The fingerprint is derived from error type, error code, HTTP status, and normalized error text. Changing request IDs, URLs, UUIDs, and long tokens are removed before grouping.',
              )}
            >
              {t('Fingerprint')}
            </ErrorMetricHelp>
            <ErrorIdentityValue value={record.fingerprint} compact mono />
          </div>
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
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5'>
            {[
              {
                label: t('Route error rate'),
                value: formatErrorRate(record.route_error_rate),
                description: t(
                  'Route error rate = error attempts / total route attempts for the same channel, model, and group in the selected time range. This route has {{errors}} error attempts out of {{attempts}} total attempts ({{rate}}). It includes all error fingerprints on the route.',
                  {
                    errors: record.route_error_count,
                    attempts: record.route_attempt_count,
                    rate: formatErrorRate(record.route_error_rate),
                  },
                ),
              },
              {
                label: t('Cluster error logs'),
                value: record.count,
                description: t(
                  'Cluster error logs counts error-log rows with this exact fingerprint in the selected time range. Retries can produce more than one row for a request.',
                ),
              },
              {
                label: t('受影响请求'),
                value: record.affected_requests,
                description: t(
                  'Affected requests counts distinct failed requests in this fault cluster. It deduplicates by request ID, then upstream request ID, and falls back to log ID. It is not used to calculate route error rate.',
                ),
              },
              {
                label: t('受影响用户'),
                value: record.affected_users,
                description: t(
                  "Affected users counts distinct non-zero user IDs found in this fault cluster's error logs.",
                ),
              },
              {
                label: t('Route attempts'),
                value: record.route_attempt_count,
                description: t(
                  'Route attempts count successful consume logs plus error logs for the same channel, model, and group in the selected time range. They are log attempts, not distinct requests.',
                ),
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className='rounded border border-solid border-gray-100 bg-gray-50 px-3 py-2'
              >
                <Typography.Text type='tertiary' size='small'>
                  <ErrorMetricHelp description={metric.description}>
                    {metric.label}
                  </ErrorMetricHelp>
                </Typography.Text>
                <div className='mt-1 font-semibold tabular-nums'>
                  {metric.value}
                </div>
              </div>
            ))}
          </div>

          <div className='grid gap-4 text-sm sm:grid-cols-2'>
            <div>
              <Typography.Text type='tertiary' size='small'>
                {t('路由')}
              </Typography.Text>
              <div className='mt-1'>
                <ErrorRouteIdentity record={record} t={t} />
              </div>
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
              <Typography.Text strong>
                <ErrorMetricHelp
                  description={t(
                    'Peer channels are channels available for the same model and group. Their route error rates and attempt counts use the same selected time range.',
                  )}
                >
                  {t('路由对比')}
                </ErrorMetricHelp>
              </Typography.Text>
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
        t(
          'Error logs is the total number of matching error-log rows in the selected time range. If scanning is truncated, this total still covers all matches while fault clusters use only the latest scanned rows.',
        ),
      ],
      [
        t('故障簇'),
        summary.items.length,
        t('按稳定错误指纹聚合'),
        t(
          'A fault cluster groups error logs by model, group, channel, and a normalized error fingerprint. The visible list is ranked by severity and capped by the fault cluster limit.',
        ),
      ],
      [
        t('受影响请求'),
        summary.items.reduce(
          (total, item) => total + (item.affected_requests || 0),
          0,
        ),
        t('当前可见故障簇'),
        t(
          "Visible affected requests is the sum of each visible fault cluster's distinct failed-request count. The same request can be counted more than once if it appears in multiple clusters.",
        ),
      ],
      [
        t('紧急故障簇'),
        getUrgentClusterCount(summary.items),
        t('高和严重等级'),
        t(
          'Urgent clusters are visible clusters classified as high or critical by channel status, HTTP status, route error rate, route attempts, and cluster error-log count.',
        ),
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
    <div className='mt-[60px] px-2 xl:h-[calc(100dvh-60px)] xl:overflow-hidden xl:pb-2'>
      <Card className='xl:h-full xl:[&>.semi-card-body]:h-full xl:[&>.semi-card-body]:overflow-hidden'>
        <Space
          vertical
          align='start'
          spacing={12}
          className='xl:min-h-0'
          style={{ width: '100%', height: '100%' }}
        >
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

          <div className='grid w-full shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {statCards.map(([label, value, hint, description]) => (
              <div
                key={label}
                className='rounded border border-solid border-gray-200 bg-gray-50 px-4 py-3'
              >
                <Typography.Text type='tertiary'>
                  <ErrorMetricHelp description={description}>
                    {label}
                  </ErrorMetricHelp>
                </Typography.Text>
                <div className='mt-1 text-2xl font-semibold tabular-nums'>
                  {value}
                </div>
                <Typography.Text type='tertiary' size='small'>
                  {hint}
                </Typography.Text>
              </div>
            ))}
          </div>

          <div className='flex w-full shrink-0 flex-wrap items-end gap-3'>
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
                <ErrorMetricHelp
                  description={t(
                    'Limit controls how many fault clusters are returned after severity ranking. It does not limit the route attempts used to calculate each route error rate.',
                  )}
                >
                  {t('Fault cluster limit')}
                </ErrorMetricHelp>
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

          <div className='grid min-h-[32.5rem] w-full grid-cols-1 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.4fr)]'>
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
