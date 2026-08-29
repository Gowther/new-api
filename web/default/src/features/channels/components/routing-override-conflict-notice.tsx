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

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

import type { ModelRoutingOverrideConflict } from '../api'

/** Long model lists are summarized so the prompt stays readable. */
const MAX_LISTED_MODELS = 6

type RoutingOverrideConflictNoticeProps = {
  conflicts: ModelRoutingOverrideConflict[]
}

/**
 * Names the temporary targets that confirming would release. Rendered inside the
 * enable prompt, so the operator decides with the overlap in front of them
 * instead of reading it back from a failure.
 */
export function RoutingOverrideConflictNotice({
  conflicts,
}: RoutingOverrideConflictNoticeProps) {
  const { t } = useTranslation()
  if (conflicts.length === 0) return null

  return (
    <Alert variant='destructive'>
      <AlertTitle>
        {t('{{count}} channel(s) already pin some of these models', {
          count: conflicts.length,
        })}
      </AlertTitle>
      <AlertDescription className='space-y-2'>
        <div>
          {t(
            'Continuing turns temporary single-channel mode off for them, including any models they cover that this channel does not.'
          )}
        </div>
        <ul className='space-y-1'>
          {conflicts.map((conflict) => {
            const listed = conflict.models.slice(0, MAX_LISTED_MODELS)
            const remaining = conflict.models.length - listed.length
            return (
              <li key={conflict.channel_id} className='min-w-0'>
                <span className='text-foreground font-medium'>
                  {conflict.channel_name || `#${conflict.channel_id}`}
                </span>
                <span className='ml-1 font-mono text-xs'>
                  ID:{conflict.channel_id}
                </span>
                <div className='font-mono text-xs break-words'>
                  {listed.join(', ')}
                  {remaining > 0
                    ? ` ${t('and {{count}} more', { count: remaining })}`
                    : ''}
                </div>
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
