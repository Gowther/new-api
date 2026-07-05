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
import { VChart } from '@visactor/react-vchart';
import { BarChart3, Clock, Key, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Card, Empty, Select, Spin, Table } from '@douyinfe/semi-ui';
import { API, renderQuota, showError } from '../../helpers';
import { CARD_PROPS, CHART_CONFIG } from '../../constants/dashboard.constants';
import { useActualTheme } from '../../context/Theme';

const RANGE_OPTIONS = [
  { labelKey: '今天', mode: 'today', granularity: 'hour' },
  { labelKey: '最近 24 小时', mode: 'relative', days: 1, granularity: 'hour' },
  { labelKey: '最近 7 天', mode: 'relative', days: 7, granularity: 'day' },
  { labelKey: '最近 30 天', mode: 'relative', days: 30, granularity: 'day' },
  { labelKey: '最近 90 天', mode: 'relative', days: 90, granularity: 'day' },
];

const CUSTOM_RANGE_VALUE = 'custom';

const API_KEY_COLORS = [
  '#2563eb',
  '#10b981',
  '#f59e0b',
  '#e11d48',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#64748b',
  '#f97316',
  '#14b8a6',
  '#d946ef',
  '#0ea5e9',
];

const TOKEN_COUNT_UNITS = [
  { value: 1000000000000, suffix: 'T' },
  { value: 1000000000, suffix: 'B' },
  { value: 1000000, suffix: 'M' },
  { value: 1000, suffix: 'K' },
];

const emptyUsage = {
  summary: {
    total_requests: 0,
    total_quota: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_write_tokens: 0,
    api_key_count: 0,
    model_count: 0,
  },
  trend: [],
  by_token: [],
  by_model: [],
  rows: [],
};

function formatInteger(value) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value || 0,
  );
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCompactTokenCount(value) {
  const numeric = toFiniteNumber(value);
  const abs = Math.abs(numeric);
  const unit = TOKEN_COUNT_UNITS.find((item) => abs >= item.value);

  if (!unit) {
    return formatInteger(numeric);
  }

  const scaled = numeric / unit.value;
  return `${Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(scaled) < 10 ? 1 : 0,
  }).format(scaled)}${unit.suffix}`;
}

function formatCompactWithFullValue(value) {
  const numeric = toFiniteNumber(value);
  const compact = formatCompactTokenCount(numeric);
  const full = formatInteger(numeric);
  return compact === full ? full : `${compact} (${full})`;
}

function formatChartTokenLabel(value, datum) {
  return formatCompactTokenCount(datum?.tokens ?? value);
}

function getCacheTokenParts(row) {
  return {
    read: row?.cache_read_tokens || 0,
    write: row?.cache_write_tokens || 0,
  };
}

function renderInputTokens(value, record, t) {
  const cache = getCacheTokenParts(record);
  return (
    <div className='text-right'>
      <div>{formatInteger(value)}</div>
      {(cache.read > 0 || cache.write > 0) && (
        <div className='mt-1 text-[11px] leading-tight text-gray-500 dark:text-gray-400'>
          {cache.read > 0 && (
            <div>
              {t('缓存读')} {formatInteger(cache.read)}
            </div>
          )}
          {cache.write > 0 && (
            <div>
              {t('缓存写')} {formatInteger(cache.write)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatPercent(value) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
}

function formatHourRange(timestamp) {
  if (!timestamp) return '-';
  const start = new Date(timestamp * 1000);
  const end = new Date((timestamp + 3600) * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const startDatePart = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  const startText = `${startDatePart} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endDatePart = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const endText =
    startDatePart === endDatePart
      ? `${pad(end.getHours())}:${pad(end.getMinutes())}`
      : `${endDatePart} ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${startText}-${endText}`;
}

function dateTimeLocalFromTimestamp(timestamp) {
  const date = new Date(timestamp * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value) {
  if (!value) return 0;
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nextHourTimestamp(timestamp) {
  const hour = timestamp - (timestamp % 3600);
  return timestamp === hour ? hour : hour + 3600;
}

function startOfTodayTimestamp() {
  const now = new Date();
  return Math.floor(
    new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000,
  );
}

function getDefaultCustomRange() {
  const endTimestamp = nextHourTimestamp(Math.floor(Date.now() / 1000));
  return {
    start: dateTimeLocalFromTimestamp(endTimestamp - 24 * 3600),
    end: dateTimeLocalFromTimestamp(endTimestamp),
  };
}

function customRangeGranularity(startTimestamp, endTimestamp) {
  return endTimestamp - startTimestamp <= 2 * 24 * 3600 ? 'hour' : 'day';
}

function buildParams(rangeValue, customRange) {
  if (rangeValue === CUSTOM_RANGE_VALUE) {
    const startTimestamp = parseDateTimeLocal(customRange.start);
    const endTimestamp = parseDateTimeLocal(customRange.end);

    if (startTimestamp > 0 && endTimestamp > startTimestamp) {
      return {
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp - 1,
        granularity: customRangeGranularity(startTimestamp, endTimestamp),
        detail_limit: 200,
      };
    }
  }

  const range = RANGE_OPTIONS[Number(rangeValue)] || RANGE_OPTIONS[0];
  const end = Math.floor(Date.now() / 1000);
  if (range.mode === 'today') {
    return {
      start_timestamp: startOfTodayTimestamp(),
      end_timestamp: end,
      granularity: range.granularity,
      detail_limit: 200,
    };
  }
  return {
    start_timestamp: end - range.days * 24 * 3600,
    end_timestamp: end,
    granularity: range.granularity,
    detail_limit: 200,
  };
}

function StatCard({ title, value, detail, icon: Icon }) {
  return (
    <Card {...CARD_PROPS} className='!rounded-xl'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-xs text-gray-500'>{title}</div>
          <div
            className='mt-1 truncate text-xl font-semibold'
            title={detail || value}
          >
            {value}
          </div>
          {detail && detail !== value && (
            <div
              className='mt-0.5 truncate text-xs text-gray-500'
              title={detail}
            >
              {detail}
            </div>
          )}
        </div>
        <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800'>
          <Icon size={16} />
        </div>
      </div>
    </Card>
  );
}

function Panel({ title, children }) {
  return (
    <Card {...CARD_PROPS} className='!rounded-xl' title={title}>
      {children}
    </Card>
  );
}

function tokenUsageLabel(item) {
  return item.token_name || `#${item.token_id}`;
}

function apiKeyColor(index) {
  return API_KEY_COLORS[index % API_KEY_COLORS.length];
}

function buildApiKeyColorScale(values) {
  return {
    type: 'ordinal',
    domain: values.map((item) => item.key),
    range: values.map((item) => item.color),
    specified: Object.fromEntries(values.map((item) => [item.key, item.color])),
  };
}

function RankMetric({ label, value, fullValue }) {
  return (
    <div
      className='min-w-0 rounded-md border border-gray-200 bg-white px-2.5 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900'
      title={fullValue || value}
    >
      <div className='truncate text-[11px] font-medium text-gray-600 dark:text-gray-300'>
        {label}
      </div>
      <div className='mt-0.5 truncate text-sm font-semibold text-gray-950 dark:text-gray-50'>
        {value}
      </div>
    </div>
  );
}

function TokenRankList({ items, colorByKey, t }) {
  const max = Math.max(...items.map((item) => item.quota), 1);
  const totalQuota = items.reduce((sum, item) => sum + item.quota, 0);
  if (items.length === 0) {
    return (
      <div className='py-10'>
        <Empty title={t('暂无用量数据')} />
      </div>
    );
  }
  return (
    <div className='space-y-3'>
      {items.slice(0, 10).map((item, index) => {
        const share = totalQuota > 0 ? (item.quota / totalQuota) * 100 : 0;
        const keyLabel = tokenUsageLabel(item);
        const color = colorByKey.get(keyLabel) || apiKeyColor(index);
        return (
          <div
            key={item.token_id}
            className='space-y-3 rounded-md border border-l-4 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900'
            style={{ borderLeftColor: color }}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                <div
                  className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-white text-xs font-bold dark:bg-gray-900'
                  style={{ borderColor: color, color }}
                >
                  {index + 1}
                </div>
                <div className='min-w-0'>
                  <div className='flex min-w-0 items-center gap-1.5 text-sm font-bold text-gray-950 dark:text-gray-50'>
                    <span
                      className='h-2.5 w-2.5 shrink-0 rounded-full'
                      style={{ backgroundColor: color }}
                    />
                    <span className='truncate'>{keyLabel}</span>
                  </div>
                  <div className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                    {formatPercent(share)} {t('占比')}
                  </div>
                </div>
              </div>
              <div className='shrink-0 text-right'>
                <div className='text-sm font-bold text-gray-950 dark:text-gray-50'>
                  {renderQuota(item.quota)}
                </div>
                <div className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                  {t('消耗')}
                </div>
              </div>
            </div>
            <div className='h-2 overflow-hidden rounded-full border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-900'>
              <div
                className='h-full rounded-full'
                style={{
                  backgroundColor: color,
                  width: `${Math.max((item.quota / max) * 100, 3)}%`,
                }}
              />
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              <RankMetric
                label={t('请求数')}
                value={formatInteger(item.count)}
              />
              <RankMetric
                label={t('总 Tokens')}
                value={formatCompactTokenCount(item.total_tokens)}
                fullValue={formatInteger(item.total_tokens)}
              />
              <RankMetric
                label={t('输入')}
                value={formatCompactTokenCount(item.prompt_tokens)}
                fullValue={formatInteger(item.prompt_tokens)}
              />
              <RankMetric
                label={t('输出')}
                value={formatCompactTokenCount(item.completion_tokens)}
                fullValue={formatInteger(item.completion_tokens)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TokenUsage = () => {
  const { t } = useTranslation();
  const actualTheme = useActualTheme();
  const [rangeIndex, setRangeIndex] = useState('0');
  const [customRange, setCustomRange] = useState(getDefaultCustomRange);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [usage, setUsage] = useState(emptyUsage);
  const [loading, setLoading] = useState(false);
  const isCustomRange = rangeIndex === CUSTOM_RANGE_VALUE;

  const params = useMemo(
    () => buildParams(rangeIndex, customRange),
    [rangeIndex, customRange, refreshNonce],
  );
  const dateTimeInputStyle = useMemo(
    () => ({
      backgroundColor: 'var(--semi-color-bg-1)',
      borderColor: 'var(--semi-color-border)',
      color: 'var(--semi-color-text-0)',
      colorScheme: actualTheme === 'dark' ? 'dark' : 'light',
    }),
    [actualTheme],
  );

  const handleCustomStartChange = (value) => {
    const startTimestamp = parseDateTimeLocal(value);
    const endTimestamp = parseDateTimeLocal(customRange.end);
    setCustomRange({
      start: value,
      end:
        startTimestamp > 0 && endTimestamp <= startTimestamp
          ? dateTimeLocalFromTimestamp(startTimestamp + 3600)
          : customRange.end,
    });
  };

  const handleCustomEndChange = (value) => {
    const startTimestamp = parseDateTimeLocal(customRange.start);
    const endTimestamp = parseDateTimeLocal(value);
    setCustomRange({
      start:
        endTimestamp > 0 && startTimestamp >= endTimestamp
          ? dateTimeLocalFromTimestamp(endTimestamp - 3600)
          : customRange.start,
      end: value,
    });
  };

  const loadUsage = async () => {
    setLoading(true);
    try {
      const res = await API.get('/api/token_usage/self', { params });
      if (!res.data?.success) {
        showError(res.data?.message || t('加载失败'));
        return;
      }
      setUsage(res.data?.data || emptyUsage);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
  }, [params]);

  const apiKeyValues = useMemo(
    () =>
      usage.by_token.map((item, index) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
        color: apiKeyColor(index),
      })),
    [usage.by_token],
  );

  const apiKeyShareValues = useMemo(
    () =>
      usage.by_token.map((item, index) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        color: apiKeyColor(index),
      })),
    [usage.by_token],
  );

  const apiKeyColorScale = useMemo(
    () => buildApiKeyColorScale(apiKeyValues),
    [apiKeyValues],
  );

  const apiKeyColorByKey = useMemo(
    () => new Map(apiKeyValues.map((item) => [item.key, item.color])),
    [apiKeyValues],
  );

  const apiKeyBarSpec = useMemo(
    () => ({
      type: 'bar',
      data: [{ id: 'apiKeyUsage', values: loading ? [] : apiKeyValues }],
      color: apiKeyColorScale,
      xField: 'key',
      yField: 'tokens',
      seriesField: 'key',
      axes: [
        {
          orient: 'bottom',
          label: { autoRotate: true, autoHide: true, autoLimit: true },
        },
        {
          orient: 'left',
          title: { visible: true, text: 'Tokens' },
          label: { formatMethod: formatCompactTokenCount },
        },
      ],
      label: {
        visible: apiKeyValues.length > 0 && apiKeyValues.length <= 12,
        position: 'outside',
        formatMethod: formatChartTokenLabel,
        style: { fontSize: 11 },
      },
      legends: { visible: apiKeyValues.length <= 12, orient: 'bottom' },
      tooltip: {
        mark: {
          content: [
            {
              key: 'Tokens',
              value: (datum) => formatCompactWithFullValue(datum?.tokens),
            },
            {
              key: t('请求数'),
              value: (datum) => formatCompactWithFullValue(datum?.requests),
            },
            {
              key: t('消耗'),
              value: (datum) => renderQuota(toFiniteNumber(datum?.cost)),
            },
          ],
        },
      },
      title:
        !loading && apiKeyValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [apiKeyColorScale, apiKeyValues, loading, t],
  );

  const apiKeyShareSpec = useMemo(
    () => ({
      type: 'pie',
      data: [{ id: 'apiKeyShare', values: loading ? [] : apiKeyShareValues }],
      color: apiKeyColorScale,
      categoryField: 'key',
      valueField: 'tokens',
      outerRadius: 0.82,
      innerRadius: 0.52,
      padAngle: 0.8,
      legends: { visible: true, orient: 'bottom' },
      label: {
        visible: apiKeyShareValues.length > 0 && apiKeyShareValues.length <= 8,
        formatMethod: formatChartTokenLabel,
        style: { fontSize: 11 },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: 'Tokens',
              value: (datum) => formatCompactWithFullValue(datum?.tokens),
            },
            {
              key: t('请求数'),
              value: (datum) => formatCompactWithFullValue(datum?.requests),
            },
          ],
        },
      },
      title:
        !loading && apiKeyShareValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [apiKeyColorScale, apiKeyShareValues, loading, t],
  );

  const columns = useMemo(
    () => [
      {
        title: t('时间段'),
        dataIndex: 'created_at',
        render: (value) => formatHourRange(value),
      },
      {
        title: t('令牌名称'),
        dataIndex: 'token_name',
        render: (value, record) => value || `#${record.token_id}`,
      },
      {
        title: t('模型'),
        dataIndex: 'model_name',
        render: (value) => value || '-',
      },
      {
        title: t('请求数'),
        dataIndex: 'count',
        align: 'right',
        render: formatInteger,
      },
      {
        title: t('输入'),
        dataIndex: 'prompt_tokens',
        align: 'right',
        render: (value, record) => renderInputTokens(value, record, t),
      },
      {
        title: t('输出'),
        dataIndex: 'completion_tokens',
        align: 'right',
        render: formatInteger,
      },
      {
        title: t('消耗'),
        dataIndex: 'quota',
        align: 'right',
        render: (value) => renderQuota(value),
      },
    ],
    [t],
  );

  return (
    <div className='mt-[60px] px-2'>
      <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <h2 className='text-lg font-semibold'>{t('令牌用量')}</h2>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={rangeIndex}
            onChange={setRangeIndex}
            style={{ width: 150 }}
          >
            {RANGE_OPTIONS.map((option, index) => (
              <Select.Option key={option.labelKey} value={String(index)}>
                {t(option.labelKey)}
              </Select.Option>
            ))}
            <Select.Option value={CUSTOM_RANGE_VALUE}>
              {t('自定义')}
            </Select.Option>
          </Select>
          {isCustomRange && (
            <div className='flex flex-wrap items-center gap-2'>
              <label className='flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300'>
                <span>{t('起始时间')}</span>
                <input
                  type='datetime-local'
                  step={3600}
                  value={customRange.start}
                  onChange={(event) =>
                    handleCustomStartChange(event.target.value)
                  }
                  className='h-8 w-[180px] rounded-md border px-2 text-sm outline-none focus:border-blue-500'
                  style={dateTimeInputStyle}
                />
              </label>
              <label className='flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300'>
                <span>{t('结束时间')}</span>
                <input
                  type='datetime-local'
                  step={3600}
                  value={customRange.end}
                  onChange={(event) =>
                    handleCustomEndChange(event.target.value)
                  }
                  className='h-8 w-[180px] rounded-md border px-2 text-sm outline-none focus:border-blue-500'
                  style={dateTimeInputStyle}
                />
              </label>
            </div>
          )}
          <Button
            theme='outline'
            icon={<RefreshCw size={16} />}
            loading={loading}
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            {t('刷新')}
          </Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <div className='space-y-4'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4'>
            <StatCard
              title={t('总请求数')}
              value={formatCompactTokenCount(usage.summary.total_requests)}
              detail={formatInteger(usage.summary.total_requests)}
              icon={BarChart3}
            />
            <StatCard
              title={t('总 Tokens')}
              value={formatCompactTokenCount(usage.summary.total_tokens)}
              detail={`${formatInteger(usage.summary.total_tokens)} Tokens`}
              icon={Sparkles}
            />
            <StatCard
              title={t('总消耗')}
              value={renderQuota(usage.summary.total_quota)}
              icon={Clock}
            />
            <StatCard
              title={t('使用的令牌')}
              value={formatInteger(usage.summary.api_key_count)}
              icon={Key}
            />
          </div>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]'>
            <Panel title={t('令牌用量')}>
              <div className='h-80'>
                <VChart spec={apiKeyBarSpec} option={CHART_CONFIG} />
              </div>
            </Panel>
            <Panel title={t('令牌占比')}>
              <div className='h-80'>
                <VChart spec={apiKeyShareSpec} option={CHART_CONFIG} />
              </div>
            </Panel>
          </div>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.45fr)_minmax(0,1fr)]'>
            <Panel title={t('令牌排行')}>
              <TokenRankList
                items={usage.by_token}
                colorByKey={apiKeyColorByKey}
                t={t}
              />
            </Panel>
            <Panel title={t('用量明细')}>
              <Table
                columns={columns}
                dataSource={usage.rows}
                rowKey={(record) =>
                  `${record.created_at}-${record.token_id}-${record.model_name}`
                }
                pagination={{ pageSize: 10 }}
              />
            </Panel>
          </div>
        </div>
      </Spin>
    </div>
  );
};

export default TokenUsage;
