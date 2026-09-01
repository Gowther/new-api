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

import { formatTimestampToDate } from '@/lib/format'

import { getUrgentClusterCount, getVisibleAffectedRequests } from '../lib'
import type { ErrorSummaryResponse } from '../types'
import { ErrorMetricHelp } from './error-metric-help'

type ErrorWorkbenchStatsProps = {
  summary: ErrorSummaryResponse
  /** Summary fetch failure, shown inline so it does not need its own row. */
  error: string
}

/**
 * The four headline counts on one line. They used to be four cards above the
 * work area, which cost the cluster list and details roughly a fifth of the
 * viewport for numbers an operator reads once.
 */
export function ErrorWorkbenchStats(props: ErrorWorkbenchStatsProps) {
  const { t } = useTranslation()
  const summary = props.summary

  return (
    <div className='text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs'>
      <span className='flex items-center gap-1.5'>
        <ErrorMetricHelp
          description={t(
            'Error logs is the total number of matching error-log rows in the selected time range. If scanning is truncated, this total still covers all matches while fault clusters use only the latest scanned rows.'
          )}
        >
          {t('Error logs')}
        </ErrorMetricHelp>
        <span className='text-foreground font-semibold tabular-nums'>
          {summary.total_logs.toLocaleString()}
        </span>
      </span>

      <span className='flex items-center gap-1.5'>
        <ErrorMetricHelp
          description={t(
            'A fault cluster groups error logs by model, group, channel, and a normalized error fingerprint. The visible list is ranked by severity and capped by the fault cluster limit.'
          )}
        >
          {t('Fault clusters')}
        </ErrorMetricHelp>
        <span className='text-foreground font-semibold tabular-nums'>
          {summary.items.length.toLocaleString()}
        </span>
      </span>

      <span className='flex items-center gap-1.5'>
        <ErrorMetricHelp
          description={t(
            "Visible affected requests is the sum of each visible fault cluster's distinct failed-request count. The same request can be counted more than once if it appears in multiple clusters."
          )}
        >
          {t('Affected requests')}
        </ErrorMetricHelp>
        <span className='text-foreground font-semibold tabular-nums'>
          {getVisibleAffectedRequests(summary.items).toLocaleString()}
        </span>
      </span>

      <span className='flex items-center gap-1.5'>
        <ErrorMetricHelp
          description={t(
            'Urgent clusters are visible clusters classified as high or critical by channel status, HTTP status, route error rate, route attempts, and cluster error-log count.'
          )}
        >
          {t('Urgent clusters')}
        </ErrorMetricHelp>
        <span className='text-foreground font-semibold tabular-nums'>
          {getUrgentClusterCount(summary.items).toLocaleString()}
        </span>
      </span>

      {summary.truncated && (
        <span>{t('Only the latest scanned logs are summarized')}</span>
      )}

      {props.error !== '' && (
        <span className='text-destructive'>{props.error}</span>
      )}

      {summary.items.length > 0 && (
        <span className='ml-auto'>
          {t('Last updated')}: {formatTimestampToDate(summary.end_time)}
        </span>
      )}
    </div>
  )
}
