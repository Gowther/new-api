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

function formatTime(timestamp, withHour = true) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withHour) return datePart;
  return `${datePart} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function TokenRankList({ items, t }) {
  const max = Math.max(...items.map((item) => item.total_tokens), 1);
  if (items.length === 0) {
    return (
      <div className='py-10'>
        <Empty title={t('暂无用量数据')} />
      </div>
    );
  }
  return (
    <div className='space-y-3'>
      {items.slice(0, 8).map((item) => (
        <div key={item.token_id} className='space-y-1.5'>
          <div className='flex items-center justify-between gap-3 text-sm'>
            <div className='min-w-0 truncate font-medium'>
              {item.token_name || `#${item.token_id}`}
            </div>
            <div className='shrink-0 text-gray-500'>
              {formatInteger(item.total_tokens)}
            </div>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800'>
            <div
              className='h-full rounded-full bg-blue-500'
              style={{
                width: `${Math.max((item.total_tokens / max) * 100, 3)}%`,
              }}
            />
          </div>
          <div className='flex items-center justify-between gap-2 text-xs text-gray-500'>
            <span>
              {formatInteger(item.count)} {t('请求数')}
            </span>
            <span>{renderQuota(item.quota)}</span>
          </div>
        </div>
      ))}
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

  const trendValues = useMemo(
    () =>
      usage.trend.map((item) => ({
        time: formatTime(item.timestamp, params.granularity === 'hour'),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
      })),
    [usage.trend, params.granularity],
  );

  const modelValues = useMemo(
    () =>
      usage.by_model.slice(0, 10).map((item) => ({
        model: item.model_name || t('未知'),
        tokens: item.total_tokens,
        requests: item.count,
      })),
    [usage.by_model, t],
  );

  const trendSpec = useMemo(
    () => ({
      type: 'area',
      data: [{ id: 'trend', values: loading ? [] : trendValues }],
      xField: 'time',
      yField: 'tokens',
      point: { visible: true },
      area: { style: { fillOpacity: 0.25 } },
      axes: [
        { orient: 'bottom', label: { autoRotate: true } },
        { orient: 'left', label: { formatMethod: formatInteger } },
      ],
      title:
        !loading && trendValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [loading, trendValues, t],
  );

  const modelSpec = useMemo(
    () => ({
      type: 'pie',
      data: [{ id: 'models', values: loading ? [] : modelValues }],
      categoryField: 'model',
      valueField: 'tokens',
      outerRadius: 0.82,
      innerRadius: 0.52,
      padAngle: 0.8,
      legends: { visible: true, orient: 'bottom' },
      label: { visible: false },
      title:
        !loading && modelValues.length === 0
          ? { visible: true, text: t('暂无用量数据') }
          : undefined,
      background: 'transparent',
    }),
    [loading, modelValues, t],
  );

  const columns = useMemo(
    () => [
      {
        title: t('时间'),
        dataIndex: 'created_at',
        render: (value) => formatTime(value),
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
            <Panel title={t('用量趋势')}>
              <div className='h-80'>
                <VChart spec={trendSpec} option={CHART_CONFIG} />
              </div>
            </Panel>
            <Panel title={t('模型分布')}>
              <div className='h-80'>
                <VChart spec={modelSpec} option={CHART_CONFIG} />
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
