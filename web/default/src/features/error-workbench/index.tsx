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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useResizableLayout,
} from '@/components/ui/resizable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { testChannel as testChannelRequest } from '@/features/channels/api'
import { useDebounce } from '@/hooks'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

import { ErrorBriefingBand } from './components/error-briefing-band'
import { ErrorClusterDetails } from './components/error-cluster-details'
import { ErrorClusterList } from './components/error-cluster-list'
import { ErrorMetricHelp } from './components/error-metric-help'
import { ErrorProblemOverview } from './components/error-problem-overview'
import {
  ErrorWorkbenchFiltersPopover,
  ErrorWorkbenchTimeRange,
} from './components/error-workbench-filters'
import { ErrorWorkbenchStats } from './components/error-workbench-stats'
import { DEFAULT_FILTERS, EMPTY_SUMMARY, buildSummaryParams } from './lib'
import type {
  ErrorBriefingResponse,
  ErrorSummaryProblem,
  ErrorSummaryResponse,
  ErrorWorkbenchFilters,
} from './types'

type BackendResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

const FILTER_INPUT_DEBOUNCE_MS = 500

/** The left panel shows the clusters or the problems they fold into. */
type ListView = 'clusters' | 'problems'

async function getErrorSummary(filters: ErrorWorkbenchFilters) {
  const response = await api.get<BackendResponse<ErrorSummaryResponse>>(
    '/api/log/error_summary',
    {
      params: buildSummaryParams(filters),
      disableDuplicate: true,
    }
  )
  if (!response.data.success) {
    throw new Error(response.data.message || 'Failed to load error summary')
  }
  return response.data.data ?? EMPTY_SUMMARY
}

async function generateErrorBriefing(
  filters: ErrorWorkbenchFilters,
  startTime: number,
  endTime: number,
  language: string,
  fallbackMessage: string
) {
  const params = buildSummaryParams(filters)
  delete params.hours
  params.start_time = startTime
  params.end_time = endTime
  params.language = language
  const response = await api.post<BackendResponse<ErrorBriefingResponse>>(
    '/api/log/error_briefing',
    null,
    { params }
  )
  if (!response.data.success) {
    throw new Error(response.data.message || fallbackMessage)
  }
  if (!response.data.data) {
    throw new Error(fallbackMessage)
  }
  return response.data.data
}

export function ErrorWorkbench() {
  const { t, i18n } = useTranslation()
  const [filters, setFilters] = useState<ErrorWorkbenchFilters>(DEFAULT_FILTERS)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null)
  const [listView, setListView] = useState<ListView>('clusters')
  const { defaultLayout: layout, onLayoutChanged } = useResizableLayout({
    id: 'error-workbench-split',
  })

  const debouncedLimit = useDebounce(filters.limit, FILTER_INPUT_DEBOUNCE_MS)
  const debouncedModelName = useDebounce(
    filters.modelName,
    FILTER_INPUT_DEBOUNCE_MS
  )
  const debouncedChannel = useDebounce(
    filters.channel,
    FILTER_INPUT_DEBOUNCE_MS
  )
  const debouncedGroup = useDebounce(filters.group, FILTER_INPUT_DEBOUNCE_MS)

  const queryFilters: ErrorWorkbenchFilters = {
    timeRange: filters.timeRange,
    limit: debouncedLimit,
    modelName: debouncedModelName,
    channel: debouncedChannel,
    group: debouncedGroup,
  }

  const summaryQuery = useQuery({
    queryKey: ['error-workbench-summary', queryFilters],
    queryFn: () => getErrorSummary(queryFilters),
  })
  const summary = summaryQuery.data ?? EMPTY_SUMMARY
  const selectedRecord =
    summary.items.find((item) => item.key === selectedKey) ??
    summary.items[0] ??
    null
  const briefingLanguage = i18n.resolvedLanguage || i18n.language

  const briefingContextKey = JSON.stringify([
    queryFilters,
    summary.start_time,
    summary.end_time,
    briefingLanguage,
  ])

  const briefingMutation = useMutation({
    mutationFn: async (input: {
      filters: ErrorWorkbenchFilters
      startTime: number
      endTime: number
      language: string
      contextKey: string
      fallbackMessage: string
    }) => ({
      data: await generateErrorBriefing(
        input.filters,
        input.startTime,
        input.endTime,
        input.language,
        input.fallbackMessage
      ),
      contextKey: input.contextKey,
    }),
  })
  const briefingResult =
    briefingMutation.data?.contextKey === briefingContextKey
      ? briefingMutation.data.data
      : undefined
  const briefingError =
    briefingMutation.variables?.contextKey === briefingContextKey &&
    briefingMutation.error instanceof Error
      ? briefingMutation.error.message
      : ''

  // A problem stands for several clusters. Opening one selects its first
  // cluster, the most severe of the group because the folded list keeps
  // the ranking the cluster list uses.
  const selectProblem = (problem: ErrorSummaryProblem) => {
    const firstKey = problem.cluster_keys[0]
    if (firstKey) {
      setSelectedKey(firstKey)
      // Switch back so the row that just became selected is on screen.
      setListView('clusters')
    }
  }

  const testMutation = useMutation({
    mutationFn: async (input: { channelId: number; modelName: string }) => {
      const response = await testChannelRequest(
        input.channelId,
        input.modelName ? { model: input.modelName } : undefined
      )
      if (!response.success) {
        throw new Error(response.message || t('Channel test failed'))
      }
      return response
    },
    onMutate: (input) => {
      setTestingChannelId(input.channelId)
    },
    onSuccess: () => {
      toast.success(t('Channel test succeeded'))
      briefingMutation.reset()
      void summaryQuery.refetch()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Channel test failed')
      )
    },
    onSettled: () => {
      setTestingChannelId(null)
    },
  })

  const setFilterValue = (
    key: keyof ErrorWorkbenchFilters,
    value: string | number
  ) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setSelectedKey(null)
    briefingMutation.reset()
  }

  const refreshSummary = () => {
    briefingMutation.reset()
    void summaryQuery.refetch()
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Error Workbench')}</span>
          <Badge variant='outline' className='shrink-0'>
            {t('Admin')}
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <ErrorWorkbenchTimeRange
          value={filters.timeRange}
          onChange={(value) => setFilterValue('timeRange', value)}
        />
        <ErrorWorkbenchFiltersPopover
          filters={filters}
          onChange={setFilterValue}
          onReset={resetFilters}
        />
        <Button
          type='button'
          variant='outline'
          onClick={refreshSummary}
          disabled={summaryQuery.isFetching}
        >
          <RefreshCw
            className={cn('size-4', summaryQuery.isFetching && 'animate-spin')}
          />
          {t('Refresh')}
        </Button>
        {summary.briefing_available && !summaryQuery.isFetching && (
          <Button
            type='button'
            variant='outline'
            onClick={() =>
              briefingMutation.mutate({
                filters: { ...queryFilters },
                startTime: summary.start_time,
                endTime: summary.end_time,
                language: briefingLanguage,
                contextKey: briefingContextKey,
                fallbackMessage: t('Failed to generate briefing'),
              })
            }
            disabled={briefingMutation.isPending}
          >
            <Sparkles
              className={cn(
                'size-4',
                briefingMutation.isPending && 'animate-pulse'
              )}
            />
            {briefingMutation.isPending
              ? t('Generating briefing...')
              : t('Generate AI briefing')}
          </Button>
        )}
        <Button
          type='button'
          variant='outline'
          render={
            <Link to='/usage-logs/$section' params={{ section: 'common' }} />
          }
        >
          <ExternalLink className='size-4' />
          {t('Open usage logs')}
        </Button>
        <Button
          type='button'
          variant='outline'
          render={
            <Link to='/models/$section' params={{ section: 'routing' }} />
          }
        >
          <Activity className='size-4' />
          {t('Open model routing')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <ErrorWorkbenchStats
            summary={summary}
            error={
              summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : ''
            }
          />

          <ErrorBriefingBand
            briefing={briefingResult?.briefing ?? ''}
            briefingModel={briefingResult?.model ?? ''}
            briefingCached={briefingResult?.cached ?? false}
            briefingError={briefingError}
            onDismiss={() => briefingMutation.reset()}
          />

          <ResizablePanelGroup
            className='min-h-0 flex-1 max-lg:flex-col'
            orientation='horizontal'
            defaultLayout={layout}
            onLayoutChanged={onLayoutChanged}
          >
            <ResizablePanel
              id='error-workbench-list'
              minSize='18rem'
              defaultSize='36%'
              className='bg-background flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border'
            >
              <Tabs
                value={listView}
                onValueChange={(value) => setListView(value as ListView)}
                className='flex min-h-0 flex-1 flex-col gap-0'
              >
                <TabsList className='m-2 grid w-auto shrink-0 grid-cols-2'>
                  <TabsTrigger value='clusters'>
                    {t('Fault clusters')}
                    <span className='text-muted-foreground ml-1.5 tabular-nums'>
                      {summary.items.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value='problems'>
                    <ErrorMetricHelp
                      description={t(
                        'Problems fold the fault clusters by what they share. One channel failing the same way across several models becomes a single channel problem; one model failing across several channels becomes a single model problem. Every cluster belongs to exactly one problem.'
                      )}
                    >
                      {t('Problems')}
                    </ErrorMetricHelp>
                    <span className='text-muted-foreground ml-1.5 tabular-nums'>
                      {summary.problems.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <TabsContent
                  value='clusters'
                  className='min-h-0 flex-1 border-t'
                >
                  <ErrorClusterList
                    items={summary.items}
                    selectedKey={selectedRecord?.key ?? null}
                    loading={summaryQuery.isFetching}
                    onSelect={setSelectedKey}
                  />
                </TabsContent>
                <TabsContent
                  value='problems'
                  className='min-h-0 flex-1 border-t'
                >
                  <ErrorProblemOverview
                    problems={summary.problems}
                    onSelectProblem={selectProblem}
                  />
                </TabsContent>
              </Tabs>
            </ResizablePanel>

            <ResizableHandle withHandle className='mx-1 max-lg:hidden' />

            <ResizablePanel
              id='error-workbench-details'
              minSize='24rem'
              className='flex min-h-[24rem] min-w-0 flex-col max-lg:mt-3'
            >
              <ErrorClusterDetails
                record={selectedRecord}
                startTime={summary.start_time}
                endTime={summary.end_time}
                testingChannelId={testingChannelId}
                onTestChannel={(channelId, modelName) =>
                  testMutation.mutate({ channelId, modelName })
                }
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
