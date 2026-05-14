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
import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  BarChart3,
  Clock,
  Key,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { VCHART_OPTION } from '@/lib/vchart'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionPageLayout } from '@/components/layout'
import { getTokenUsageSelf } from './api'
import type {
  TokenUsageDetailItem,
  TokenUsageQueryParams,
  TokenUsageSelfResponse,
  TokenUsageTokenItem,
} from './types'

type RangeOption = {
  labelKey: string
  days: number
  granularity: 'hour' | 'day'
}

const RANGE_OPTIONS: RangeOption[] = [
  { labelKey: 'Last 24 hours', days: 1, granularity: 'hour' },
  { labelKey: 'Last 7 days', days: 7, granularity: 'day' },
  { labelKey: 'Last 30 days', days: 30, granularity: 'day' },
  { labelKey: 'Last 90 days', days: 90, granularity: 'day' },
]

function emptyTokenUsage(): TokenUsageSelfResponse {
  return {
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
  }
}

function formatInteger(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value || 0
  )
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`
}

function formatHourRange(timestamp: number) {
  if (timestamp <= 0) return '-'
  const start = dayjs(timestamp * 1000)
  const end = start.add(1, 'hour')
  const endText = start.isSame(end, 'day')
    ? end.format('HH:mm')
    : end.format('YYYY-MM-DD HH:mm')
  return `${start.format('YYYY-MM-DD HH:mm')}-${endText}`
}

function buildParams(range: RangeOption): TokenUsageQueryParams {
  const end = Math.floor(Date.now() / 1000)
  return {
    start_timestamp: end - range.days * 24 * 3600,
    end_timestamp: end,
    granularity: range.granularity,
    detail_limit: 200,
  }
}

function StatCard({
  title,
  value,
  icon: Icon,
}: {
  title: string
  value: string
  icon: LucideIcon
}) {
  return (
    <Card size='sm' className='rounded-lg'>
      <CardContent className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-muted-foreground text-xs'>{title}</div>
          <div className='mt-1 truncate text-xl font-semibold'>{value}</div>
        </div>
        <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
          <Icon className='text-muted-foreground size-4' />
        </div>
      </CardContent>
    </Card>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className='rounded-lg'>
      <CardHeader className='border-b pb-3'>
        <CardTitle className='text-sm'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='pt-1'>{children}</CardContent>
    </Card>
  )
}

function tokenUsageLabel(item: TokenUsageTokenItem) {
  return item.token_name || `#${item.token_id}`
}

function RankMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className='bg-background min-w-0 rounded-md border px-2.5 py-2 shadow-sm'>
      <div className='text-foreground/70 truncate text-[11px] font-medium'>
        {label}
      </div>
      <div className='text-foreground mt-0.5 truncate text-sm font-semibold'>
        {value}
      </div>
    </div>
  )
}

function TokenRankList({ items }: { items: TokenUsageTokenItem[] }) {
  const { t } = useTranslation()
  const max = Math.max(...items.map((item) => item.quota), 1)
  const totalQuota = items.reduce((sum, item) => sum + item.quota, 0)
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
  ]

  if (items.length === 0) {
    return (
      <div className='text-muted-foreground py-10 text-center text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {items.slice(0, 10).map((item, index) => {
        const share = totalQuota > 0 ? (item.quota / totalQuota) * 100 : 0
        const style = rankStyles[index % rankStyles.length]
        return (
          <div
            key={item.token_id}
            className={`bg-background space-y-3 rounded-md border border-l-4 p-3 shadow-sm ${style.border}`}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                <div
                  className={`flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${style.badge}`}
                >
                  {index + 1}
                </div>
                <div className='min-w-0'>
                  <div className='text-foreground truncate text-sm font-bold'>
                    {tokenUsageLabel(item)}
                  </div>
                  <div className='text-foreground/70 text-xs font-medium'>
                    {formatPercent(share)} {t('Share')}
                  </div>
                </div>
              </div>
              <div className='shrink-0 text-right'>
                <div className='text-foreground text-sm font-bold'>
                  {formatQuotaWithCurrency(item.quota)}
                </div>
                <div className='text-foreground/70 text-xs font-medium'>
                  {t('Cost')}
                </div>
              </div>
            </div>
            <div className='bg-background h-2 overflow-hidden rounded-full border'>
              <div
                className={`h-full rounded-full ${style.bar}`}
                style={{
                  width: `${Math.max((item.quota / max) * 100, 3)}%`,
                }}
              />
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              <RankMetric
                label={t('Requests')}
                value={formatInteger(item.count)}
              />
              <RankMetric
                label={t('Total Tokens')}
                value={formatInteger(item.total_tokens)}
              />
              <RankMetric
                label={t('Prompt Tokens')}
                value={formatInteger(item.prompt_tokens)}
              />
              <RankMetric
                label={t('Completion Tokens')}
                value={formatInteger(item.completion_tokens)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UsageDetailsTable({ rows }: { rows: TokenUsageDetailItem[] }) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground py-12 text-center text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Time Range')}</TableHead>
          <TableHead>{t('API Key')}</TableHead>
          <TableHead>{t('Model')}</TableHead>
          <TableHead className='text-right'>{t('Requests')}</TableHead>
          <TableHead className='text-right'>{t('Prompt Tokens')}</TableHead>
          <TableHead className='text-right'>{t('Completion Tokens')}</TableHead>
          <TableHead className='text-right'>{t('Cost')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.created_at}-${row.token_id}-${row.model_name}`}>
            <TableCell>{formatHourRange(row.created_at)}</TableCell>
            <TableCell>{row.token_name || `#${row.token_id}`}</TableCell>
            <TableCell>{row.model_name || '-'}</TableCell>
            <TableCell className='text-right'>
              {formatInteger(row.count)}
            </TableCell>
            <TableCell className='text-right'>
              {formatInteger(row.prompt_tokens)}
            </TableCell>
            <TableCell className='text-right'>
              {formatInteger(row.completion_tokens)}
            </TableCell>
            <TableCell className='text-right'>
              {formatQuotaWithCurrency(row.quota)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function TokenUsage() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [rangeIndex, setRangeIndex] = useState(1)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const range = RANGE_OPTIONS[rangeIndex] ?? RANGE_OPTIONS[1]
  const params = useMemo(() => buildParams(range), [range, refreshNonce])

  const query = useQuery({
    queryKey: ['token-usage-self', params],
    queryFn: () => getTokenUsageSelf(params),
  })

  const data = query.data?.data ?? emptyTokenUsage()
  const loading = query.isLoading || query.isFetching

  const apiKeyValues = useMemo(
    () =>
      data.by_token.map((item: TokenUsageTokenItem) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
      })),
    [data.by_token]
  )

  const apiKeyShareValues = useMemo(
    () =>
      data.by_token.map((item: TokenUsageTokenItem) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
      })),
    [data.by_token]
  )

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
      title: loading
        ? undefined
        : apiKeyValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [apiKeyValues, loading, resolvedTheme, t]
  )

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
      title: loading
        ? undefined
        : apiKeyShareValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [apiKeyShareValues, loading, resolvedTheme, t]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('API Key Usage')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <NativeSelect
          value={String(rangeIndex)}
          onChange={(event) => setRangeIndex(Number(event.target.value))}
          aria-label={t('Time Range')}
        >
          {RANGE_OPTIONS.map((option, index) => (
            <option key={option.labelKey} value={index}>
              {t(option.labelKey)}
            </option>
          ))}
        </NativeSelect>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setRefreshNonce((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw className='size-4' />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
            <StatCard
              title={t('Total Requests')}
              value={formatInteger(data.summary.total_requests)}
              icon={BarChart3}
            />
            <StatCard
              title={t('Total Tokens')}
              value={formatInteger(data.summary.total_tokens)}
              icon={Sparkles}
            />
            <StatCard
              title={t('Total Cost')}
              value={formatQuotaWithCurrency(data.summary.total_quota)}
              icon={Clock}
            />
            <StatCard
              title={t('API Keys Used')}
              value={formatInteger(data.summary.api_key_count)}
              icon={Key}
            />
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]'>
            <Panel title={t('API Key Usage')}>
              <div className='h-[320px]'>
                <VChart spec={apiKeyBarSpec} option={VCHART_OPTION} />
              </div>
            </Panel>
            <Panel title={`${t('API Key')} ${t('Share')}`}>
              <div className='h-[320px]'>
                <VChart spec={apiKeyShareSpec} option={VCHART_OPTION} />
              </div>
            </Panel>
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(320px,0.45fr)_minmax(0,1fr)]'>
            <Panel title={t('API Key Ranking')}>
              <TokenRankList items={data.by_token as TokenUsageTokenItem[]} />
            </Panel>
            <Panel title={t('Usage Details')}>
              <UsageDetailsTable rows={data.rows} />
            </Panel>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
