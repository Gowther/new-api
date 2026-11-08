import { CHANNEL_TYPES } from '@/features/channels/constants'

import type { PricingBoundChannel } from '../types'

type Translate = (key: string) => string

export function getPricingChannelTypeKey(type: number): string {
  return CHANNEL_TYPES[type as keyof typeof CHANNEL_TYPES] || 'Unknown'
}

export function getPricingChannelShortLabel(
  channel: PricingBoundChannel,
  t: Translate
): string {
  return channel.name?.trim() || t(getPricingChannelTypeKey(channel.type))
}

export function getPricingChannelDisplayLabel(
  channel: PricingBoundChannel,
  t: Translate
): string {
  const name = channel.name?.trim()
  const typeLabel = t(getPricingChannelTypeKey(channel.type))
  if (!name) {
    return typeLabel
  }
  return `${name} (${typeLabel})`
}
