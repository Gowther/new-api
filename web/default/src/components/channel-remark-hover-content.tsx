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
import type { ReactNode } from 'react'

import { LinkifiedText } from '@/components/linkified-text'
import { HoverCardContent } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

export const CHANNEL_REMARK_HOVER_DELAY = 200
export const CHANNEL_REMARK_CLOSE_DELAY = 350

type ChannelRemarkHoverContentProps = {
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function ChannelRemarkHoverContent(
  props: ChannelRemarkHoverContentProps
) {
  return (
    <HoverCardContent
      side={props.side}
      align={props.align ?? 'start'}
      sideOffset={2}
      className={cn(
        'max-h-[min(24rem,calc(100vh-2rem))] w-max max-w-[min(48rem,calc(100vw-2rem))] overflow-auto p-4 text-left',
        props.className
      )}
    >
      {props.children}
    </HoverCardContent>
  )
}

type ChannelRemarkTextProps = {
  text: string
  className?: string
  linkClassName?: string
}

export function ChannelRemarkText(props: ChannelRemarkTextProps) {
  return (
    <LinkifiedText
      text={props.text}
      className={cn('break-normal', props.className)}
      linkClassName={cn('whitespace-nowrap', props.linkClassName)}
    />
  )
}
