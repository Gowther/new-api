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
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type ErrorMetricHelpProps = {
  children: ReactNode
  description: string
  className?: string
  showIcon?: boolean
}

export function ErrorMetricHelp(props: ErrorMetricHelpProps) {
  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                'inline-flex min-w-0 cursor-help items-center gap-1',
                props.className
              )}
            />
          }
        >
          {props.children}
          {props.showIcon === false ? null : (
            <CircleHelp className='size-3.5 shrink-0' aria-hidden='true' />
          )}
          <span className='sr-only'>: {props.description}</span>
        </TooltipTrigger>
        <TooltipContent className='max-w-sm items-start text-left leading-5 whitespace-normal'>
          {props.description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type RouteErrorRateHelpProps = {
  children: ReactNode
  errors: number
  attempts: number
  rate: string
  className?: string
}

export function RouteErrorRateHelp(props: RouteErrorRateHelpProps) {
  const { t } = useTranslation()
  const description = t(
    'Route error rate = error attempts / total route attempts for the same channel, model, and group in the selected time range. This route has {{errors}} error attempts out of {{attempts}} total attempts ({{rate}}). It includes all error fingerprints on the route.',
    {
      errors: props.errors,
      attempts: props.attempts,
      rate: props.rate,
    }
  )

  return (
    <ErrorMetricHelp description={description} className={props.className}>
      {props.children}
    </ErrorMetricHelp>
  )
}
