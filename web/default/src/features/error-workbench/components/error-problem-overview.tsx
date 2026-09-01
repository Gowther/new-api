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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import type { ErrorSummaryProblem } from '../types'

type ErrorProblemOverviewProps = {
  problems: ErrorSummaryProblem[]
  onSelectProblem: (problem: ErrorSummaryProblem) => void
}

const severityClassNames: Record<string, string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30',
  high: 'border-orange-300 bg-orange-50 text-orange-800 dark:bg-orange-950/30',
  medium: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30',
  low: 'border-border bg-muted/40 text-muted-foreground',
}

/**
 * The folded problems, one row each. Another view of the data the cluster list
 * shows, so it shares the left panel with it as a tab rather than stacking
 * above it and taking height from both panes.
 */
export function ErrorProblemOverview(props: ErrorProblemOverviewProps) {
  const { t } = useTranslation()

  const severityLabels: Record<string, string> = {
    critical: t('Critical'),
    high: t('High'),
    medium: t('Medium'),
    low: t('Low'),
  }

  if (props.problems.length === 0) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm'>
        {t('No problems in this range')}
      </div>
    )
  }

  return (
    <ScrollArea className='h-full'>
      <div className='divide-y'>
        {props.problems.map((problem) => {
          let primary = problem.model_name || problem.channel_name || '-'
          let secondary =
            problem.channel_name && problem.model_name
              ? problem.channel_name
              : ''
          if (problem.scope === 'channel') {
            primary = problem.channel_name || `#${problem.channel}`
            secondary =
              problem.affected_models.length > 1
                ? t('{{count}} models', {
                    count: problem.affected_models.length,
                  })
                : ''
          } else if (problem.scope === 'model') {
            primary = problem.model_name
            secondary =
              problem.affected_channels.length > 1
                ? t('{{count}} channels', {
                    count: problem.affected_channels.length,
                  })
                : ''
          }
          return (
            <button
              key={problem.key}
              type='button'
              onClick={() => props.onSelectProblem(problem)}
              className='hover:bg-muted/50 focus-visible:ring-ring flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none'
            >
              <Badge
                variant='outline'
                className={cn(
                  'text-[11px]',
                  severityClassNames[problem.severity] ?? severityClassNames.low
                )}
              >
                {severityLabels[problem.severity] ?? t('Low')}
              </Badge>
              {problem.status_code > 0 && (
                <Badge variant='outline' className='font-mono text-[11px]'>
                  {problem.status_code}
                </Badge>
              )}
              <span className='min-w-0 truncate font-medium'>{primary}</span>
              {secondary && (
                <span className='text-muted-foreground shrink-0'>
                  {secondary}
                </span>
              )}
              <span
                className='text-muted-foreground ml-auto shrink-0 tabular-nums'
              >
                {t('{{count}} clusters', { count: problem.cluster_count })}
                {' · '}
                {t('{{count}} requests', {
                  count: problem.affected_requests,
                })}
              </span>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
