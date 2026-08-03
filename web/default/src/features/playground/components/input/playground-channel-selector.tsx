import { Check, ChevronsUpDown, Route } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { ChannelOption } from '../../types'

interface PlaygroundChannelSelectorProps {
  channels: ChannelOption[]
  selectedChannelId: number | null
  onChannelChange: (channelId: number | null) => void
  disabled?: boolean
}

const AUTO_CHANNEL_VALUE = '__auto__'

export function PlaygroundChannelSelector({
  channels,
  selectedChannelId,
  onChannelChange,
  disabled = false,
}: PlaygroundChannelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId),
    [channels, selectedChannelId]
  )

  const handleSelect = (value: string) => {
    onChannelChange(
      value === AUTO_CHANNEL_VALUE ? null : Number.parseInt(value, 10)
    )
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            size='sm'
            role='combobox'
            aria-expanded={open}
            aria-label={t('Channel')}
            disabled={disabled}
            className='h-8 max-w-[14rem] gap-2 px-3 text-xs font-medium shadow-none'
          >
            <Route className='size-4 shrink-0 text-muted-foreground' />
            <span className='truncate'>
              {selectedChannel?.name || t('Auto')}
            </span>
            <ChevronsUpDown className='size-4 shrink-0 opacity-50' />
          </Button>
        }
      />
      <PopoverContent
        align='start'
        side='bottom'
        sideOffset={4}
        collisionPadding={8}
        className='bg-popover z-40 w-[min(20rem,90vw)] rounded-lg border p-0 !shadow-none'
      >
        <Command
          filter={(value, search) => {
            if (value === AUTO_CHANNEL_VALUE) {
              return t('Auto').toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0
            }
            const channel = channels.find(
              (item) => String(item.id) === value
            )
            if (!channel) return 0
            const searchableText = `${channel.name} ${channel.typeName}`
              .toLowerCase()
            return searchableText.includes(search.toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput placeholder={t('Search')} className='h-9' />
          <CommandEmpty>{t('No channels found')}</CommandEmpty>
          <CommandList className='max-h-[280px]'>
            <CommandGroup>
              <CommandItem
                value={AUTO_CHANNEL_VALUE}
                onSelect={handleSelect}
                className='flex items-center justify-between rounded-lg px-2 py-2 text-xs'
              >
                <span>{t('Auto')}</span>
                <Check
                  className={cn(
                    'size-4',
                    selectedChannelId === null ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </CommandItem>
              {channels.map((channel) => (
                <CommandItem
                  key={channel.id}
                  value={String(channel.id)}
                  onSelect={handleSelect}
                  className='flex items-center justify-between rounded-lg px-2 py-2 text-xs'
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate font-medium'>
                      {channel.name}
                    </span>
                    <span className='text-muted-foreground truncate text-[10px]'>
                      {channel.typeName}
                    </span>
                  </span>
                  <Check
                    className={cn(
                      'size-4 shrink-0',
                      selectedChannelId === channel.id
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
