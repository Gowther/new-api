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

const RANGE_OPTIONS = [
  { labelKey: '最近 24 小时', days: 1, granularity: 'hour' },
  { labelKey: '最近 7 天', days: 7, granularity: 'day' },
  { labelKey: '最近 30 天', days: 30, granularity: 'day' },
  { labelKey: '最近 90 天', days: 90, granularity: 'day' },
];

const emptyUsage = {
  summary: {
    total_requests: 0,
    total_quota: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    total_tokens: 0,
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

function buildParams(range) {
  const end = Math.floor(Date.now() / 1000);
  return {
    start_timestamp: end - range.days * 24 * 3600,
    end_timestamp: end,
    granularity: range.granularity,
    detail_limit: 200,
  };
}

function StatCard({ title, value, icon: Icon }) {
  return (
    <Card {...CARD_PROPS} className='!rounded-xl'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-xs text-gray-500'>{title}</div>
          <div className='mt-1 truncate text-xl font-semibold'>{value}</div>
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

function RankMetric({ label, value }) {
  return (
    <div className='min-w-0 rounded-md border border-gray-200 bg-white px-2.5 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900'>
      <div className='truncate text-[11px] font-medium text-gray-600 dark:text-gray-300'>
        {label}
      </div>
      <div className='mt-0.5 truncate text-sm font-semibold text-gray-950 dark:text-gray-50'>
        {value}
      </div>
    </div>
  );
}

function TokenRankList({ items, t }) {
  const max = Math.max(...items.map((item) => item.quota), 1);
  const totalQuota = items.reduce((sum, item) => sum + item.quota, 0);
  const rankStyles = [
    {
      border: 'border-l-blue-500',
      badge:
        'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
      bar: 'bg-blue-500',
    },
    {
      border: 'border-l-emerald-500',
      badge:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
      bar: 'bg-emerald-500',
    },
    {
      border: 'border-l-amber-500',
      badge:
        'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
      bar: 'bg-amber-500',
    },
    {
      border: 'border-l-rose-500',
      badge:
        'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
      bar: 'bg-rose-500',
    },
    {
      border: 'border-l-violet-500',
      badge:
        'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
      bar: 'bg-violet-500',
    },
    {
      border: 'border-l-cyan-500',
      badge:
        'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
      bar: 'bg-cyan-500',
    },
    {
      border: 'border-l-lime-500',
      badge:
        'border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950/50 dark:text-lime-200',
      bar: 'bg-lime-500',
    },
    {
      border: 'border-l-slate-500',
      badge:
        'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
      bar: 'bg-slate-500',
    },
  ];
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
        const style = rankStyles[index % rankStyles.length];
        return (
          <div
            key={item.token_id}
            className={`space-y-3 rounded-md border border-l-4 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900 ${style.border}`}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${style.badge}`}
                >
                  {index + 1}
                </div>
                <div className='min-w-0'>
                  <div className='truncate text-sm font-bold text-gray-950 dark:text-gray-50'>
                    {tokenUsageLabel(item)}
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
                className={`h-full rounded-full ${style.bar}`}
                style={{
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
                value={formatInteger(item.total_tokens)}
              />
              <RankMetric
                label={t('提示 Tokens')}
                value={formatInteger(item.prompt_tokens)}
              />
              <RankMetric
                label={t('补全 Tokens')}
                value={formatInteger(item.completion_tokens)}
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
  const [rangeIndex, setRangeIndex] = useState('1');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [usage, setUsage] = useState(emptyUsage);
  const [loading, setLoading] = useState(false);
  const range = RANGE_OPTIONS[Number(rangeIndex)] || RANGE_OPTIONS[1];

  const params = useMemo(() => buildParams(range), [rangeIndex, refreshNonce]);

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
      usage.by_token.map((item) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
      })),
    [usage.by_token],
  );

  const apiKeyShareValues = useMemo(
    () =>
      usage.by_token.map((item) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
      })),
    [usage.by_token],
  );

  const apiKeyBarSpec = useMemo(
    () => ({
      type: 'bar',
      data: [{ id: 'apiKeyUsage', values: loading ? [] : apiKeyValues }],
      xField: 'key',
      yField: 'tokens',
      seriesField: 'key',
      axes: [
        {
          orient: 'bottom',
          label: { autoRotate: true, autoHide: true, autoLimit: true },
        },
        { orient: 'left', label: { formatMethod: formatInteger } },
      ],
      legends: { visible: apiKeyValues.length <= 12, orient: 'bottom' },
      title:
        !loading && apiKeyValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [apiKeyValues, loading, t],
  );

  const apiKeyShareSpec = useMemo(
    () => ({
      type: 'pie',
      data: [{ id: 'apiKeyShare', values: loading ? [] : apiKeyShareValues }],
      categoryField: 'key',
      valueField: 'tokens',
      outerRadius: 0.82,
      innerRadius: 0.52,
      padAngle: 0.8,
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      title:
        !loading && apiKeyShareValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [apiKeyShareValues, loading, t],
  );

  const columns = useMemo(
    () => [
      {
        title: t('时间段'),
        dataIndex: 'created_at',
        render: (value) => formatHourRange(value),
      },
      {
        title: t('API Key'),
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
        title: t('提示 Tokens'),
        dataIndex: 'prompt_tokens',
        align: 'right',
        render: formatInteger,
      },
      {
        title: t('补全 Tokens'),
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
        <h2 className='text-lg font-semibold'>{t('API Key 用量')}</h2>
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
          </Select>
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
              value={formatInteger(usage.summary.total_requests)}
              icon={BarChart3}
            />
            <StatCard
              title={t('总 Tokens')}
              value={formatInteger(usage.summary.total_tokens)}
              icon={Sparkles}
            />
            <StatCard
              title={t('总消耗')}
              value={renderQuota(usage.summary.total_quota)}
              icon={Clock}
            />
            <StatCard
              title={t('使用的 API Key')}
              value={formatInteger(usage.summary.api_key_count)}
              icon={Key}
            />
          </div>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]'>
            <Panel title={t('API Key 用量')}>
              <div className='h-80'>
                <VChart spec={apiKeyBarSpec} option={CHART_CONFIG} />
              </div>
            </Panel>
            <Panel title={`${t('API Key')} ${t('占比')}`}>
              <div className='h-80'>
                <VChart spec={apiKeyShareSpec} option={CHART_CONFIG} />
              </div>
            </Panel>
          </div>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.45fr)_minmax(0,1fr)]'>
            <Panel title={t('API Key 排行')}>
              <TokenRankList items={usage.by_token} t={t} />
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
