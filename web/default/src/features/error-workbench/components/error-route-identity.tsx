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
        'grid min-w-0 gap-1.5',
        compact ? 'text-xs' : 'text-sm',
        props.className
      )}
    >
      <div className='grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2'>
        <dt className='text-muted-foreground'>{t('Model')}</dt>
        <dd className='min-w-0 font-medium'>
          <ErrorIdentityValue
            value={props.modelName || '-'}
            compact={compact}
            mono
          />
        </dd>
      </div>
      <div className='grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2'>
        <dt className='text-muted-foreground'>{t('Channel')}</dt>
        <dd className='flex min-w-0 items-baseline gap-1.5 font-medium'>
          <ErrorIdentityValue
            value={props.channelName || t('Unknown channel')}
            compact={compact}
          />
          <span className='text-muted-foreground shrink-0 font-mono text-xs'>
            #{props.channelId || '-'}
          </span>
        </dd>
      </div>
      <div className='grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-2'>
        <dt className='text-muted-foreground'>{t('Group')}</dt>
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
