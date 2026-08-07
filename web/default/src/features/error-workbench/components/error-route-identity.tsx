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

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type ErrorIdentityValueProps = {
  value: string
  compact?: boolean
  mono?: boolean
  className?: string
}

export function ErrorIdentityValue(props: ErrorIdentityValueProps) {
  if (!props.compact) {
    return (
      <span
        className={cn(
          'min-w-0 break-all',
          props.mono && 'font-mono',
          props.className
        )}
      >
        {props.value}
      </span>
    )
  }

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                'min-w-0 truncate',
                props.mono && 'font-mono',
                props.className
              )}
            />
          }
        >
          {props.value}
        </TooltipTrigger>
        <TooltipContent className='max-w-sm text-left break-all'>
          {props.value}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type ErrorRouteIdentityProps = {
  modelName: string
  group: string
  channelName: string
  channelId: number
  compact?: boolean
  className?: string
}

export function ErrorRouteIdentity(props: ErrorRouteIdentityProps) {
  const { t } = useTranslation()
  const compact = props.compact === true

  return (
    <dl
      className={cn(
        'grid min-w-0',
        compact
          ? 'bg-muted/35 gap-2 rounded-md border px-2.5 py-2 text-xs'
          : 'gap-1.5 text-sm',
        props.className
      )}
    >
      <div
        className={cn(
          'grid min-w-0 items-baseline gap-2',
          compact
            ? 'grid-cols-[3.75rem_minmax(0,1fr)]'
            : 'grid-cols-[5rem_minmax(0,1fr)]'
        )}
      >
        <dt className='text-muted-foreground font-medium'>{t('Model')}</dt>
        <dd className='text-foreground min-w-0 text-sm font-semibold'>
          <ErrorIdentityValue
            value={props.modelName || '-'}
            compact={compact}
            mono
          />
        </dd>
      </div>
      <div
        className={cn(
          'grid min-w-0 items-baseline gap-2',
          compact
            ? 'grid-cols-[3.75rem_minmax(0,1fr)]'
            : 'grid-cols-[5rem_minmax(0,1fr)]'
        )}
      >
        <dt className='text-muted-foreground font-medium'>{t('Channel')}</dt>
        <dd className='text-foreground flex min-w-0 items-baseline gap-1.5 text-sm font-semibold'>
          <ErrorIdentityValue
            value={props.channelName || t('Unknown channel')}
            compact={compact}
          />
          <span className='text-muted-foreground shrink-0 font-mono text-xs font-medium'>
            #{props.channelId || '-'}
          </span>
        </dd>
      </div>
      <div
        className={cn(
          'grid min-w-0 items-baseline gap-2',
          compact
            ? 'grid-cols-[3.75rem_minmax(0,1fr)]'
            : 'grid-cols-[5rem_minmax(0,1fr)]'
        )}
      >
        <dt className='text-muted-foreground font-medium'>{t('Group')}</dt>
        <dd className='min-w-0 font-medium'>
          <ErrorIdentityValue
            value={props.group || '-'}
            compact={compact}
            mono
          />
        </dd>
      </div>
    </dl>
  )
}
