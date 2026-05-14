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
  TokenUsageModelItem,
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

function formatTime(timestamp: number, withHour = true) {
  const format = withHour ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'
  return timestamp > 0 ? dayjs(timestamp * 1000).format(format) : '-'
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

function TokenRankList({ items }: { items: TokenUsageTokenItem[] }) {
  const { t } = useTranslation()
  const max = Math.max(...items.map((item) => item.total_tokens), 1)

  if (items.length === 0) {
    return (
      <div className='text-muted-foreground py-10 text-center text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {items.slice(0, 8).map((item) => (
        <div key={item.token_id} className='space-y-1.5'>
          <div className='flex items-center justify-between gap-3 text-sm'>
            <div className='min-w-0 truncate font-medium'>
              {item.token_name || `#${item.token_id}`}
            </div>
            <div className='text-muted-foreground shrink-0'>
              {formatInteger(item.total_tokens)}
            </div>
          </div>
          <div className='bg-muted h-2 overflow-hidden rounded-full'>
            <div
              className='bg-primary h-full rounded-full'
              style={{
                width: `${Math.max((item.total_tokens / max) * 100, 3)}%`,
              }}
            />
          </div>
          <div className='text-muted-foreground flex items-center justify-between gap-2 text-xs'>
            <span>
              {formatInteger(item.count)} {t('Requests')}
            </span>
            <span>{formatQuotaWithCurrency(item.quota)}</span>
          </div>
        </div>
      ))}
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
          <TableHead>{t('Time')}</TableHead>
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
            <TableCell>{formatTime(row.created_at)}</TableCell>
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

  const trendValues = useMemo(
    () =>
      data.trend.map((item) => ({
        time: formatTime(item.timestamp, params.granularity === 'hour'),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
      })),
    [data.trend, params.granularity]
  )

  const modelValues = useMemo(
    () =>
      data.by_model.slice(0, 10).map((item: TokenUsageModelItem) => ({
        model: item.model_name || t('Unknown'),
        tokens: item.total_tokens,
        requests: item.count,
      })),
    [data.by_model, t]
  )

  const trendSpec = useMemo(
    () => ({
      type: 'area',
      data: [{ id: 'trend', values: loading ? [] : trendValues }],
      xField: 'time',
      yField: 'tokens',
      seriesField: 'series',
      point: { visible: true },
      area: { style: { fillOpacity: 0.25 } },
      axes: [
        { orient: 'bottom', label: { autoRotate: true } },
        { orient: 'left', label: { formatMethod: formatInteger } },
      ],
      title: loading
        ? undefined
        : trendValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [loading, resolvedTheme, t, trendValues]
  )

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
      title: loading
        ? undefined
        : modelValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [loading, modelValues, resolvedTheme, t]
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
            <Panel title={t('Usage Trend')}>
              <div className='h-[320px]'>
                <VChart spec={trendSpec} option={VCHART_OPTION} />
              </div>
            </Panel>
            <Panel title={t('Model Distribution')}>
              <div className='h-[320px]'>
                <VChart spec={modelSpec} option={VCHART_OPTION} />
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
