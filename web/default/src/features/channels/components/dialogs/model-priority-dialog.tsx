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
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { getChannels, updateChannel, updateChannelStatus } from '../../api'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_CONFIG,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../../constants'
import { channelsQueryKeys } from '../../lib'
import type { Channel, GetChannelsResponse } from '../../types'

type ModelPriorityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function compareChannelsForModelRouting(
  a: Channel,
  b: Channel,
  getPriority = (channel: Channel) => channel.priority ?? 0
): number {
  const statusDiff =
    Number(b.status === CHANNEL_STATUS.ENABLED) -
    Number(a.status === CHANNEL_STATUS.ENABLED)
  if (statusDiff !== 0) return statusDiff

  const priorityDiff = getPriority(b) - getPriority(a)
  if (priorityDiff !== 0) return priorityDiff
  return a.id - b.id
}

function sortChannelsByPriority(channels: Channel[]): Channel[] {
  return [...channels].sort(compareChannelsForModelRouting)
}

function applyPriorityUpdates(
  oldData: GetChannelsResponse | undefined,
  prioritiesById: Map<number, number>,
  shouldSort = false
): GetChannelsResponse | undefined {
  if (!oldData?.data?.items) return oldData

  const items = oldData.data.items.map((channel) => {
    const priority = prioritiesById.get(channel.id)
    if (priority === undefined) return channel
    return { ...channel, priority }
  })

  return {
    ...oldData,
    data: {
      ...oldData.data,
      items: shouldSort ? sortChannelsByPriority(items) : items,
    },
  }
}

function applyChannelStatusUpdates(
  oldData: GetChannelsResponse | undefined,
  statusesById: Map<number, number>,
  shouldSort = false
): GetChannelsResponse | undefined {
  if (!oldData?.data?.items) return oldData

  const items = oldData.data.items.map((channel) => {
    const status = statusesById.get(channel.id)
    if (status === undefined) return channel
    return { ...channel, status }
  })

  return {
    ...oldData,
    data: {
      ...oldData.data,
      items: shouldSort ? sortChannelsByPriority(items) : items,
    },
  }
}

export function ModelPriorityDialog({
  open,
  onOpenChange,
}: ModelPriorityDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [priorityChanges, setPriorityChanges] = useState<
    Record<number, number>
  >({})
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<
    Record<number, boolean>
  >({})

  // Fetch all channels with pagination
  const { data: channelsData, isLoading } = useQuery<GetChannelsResponse>({
    queryKey: channelsQueryKeys.list({ all: true }),
    queryFn: async () => {
      let allChannels: Channel[] = []
      let page = 1
      const pageSize = 100 // Backend max limit
      let hasMore = true

      while (hasMore) {
        const response = await getChannels({ p: page, page_size: pageSize })
        if (!response.success || !response.data) {
          break
        }

        const items = response.data.items || []
        allChannels = allChannels.concat(items)

        // Check if there are more pages
        const total = response.data.total || 0
        hasMore = allChannels.length < total
        page++
      }

      return {
        success: true,
        data: {
          items: allChannels,
          total: allChannels.length,
          page: 1,
          page_size: allChannels.length,
        },
      }
    },
    enabled: open,
  })

  const channels: Channel[] = channelsData?.data?.items || []

  // Extract unique models from all channels
  const allModels = useMemo(() => {
    const modelSet = new Set<string>()
    channels.forEach((channel) => {
      if (channel.models) {
        const models = channel.models.split(',').map((m) => m.trim())
        models.forEach((model) => {
          if (model) modelSet.add(model)
        })
      }
    })
    return Array.from(modelSet).sort()
  }, [channels])

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!modelSearch) return allModels
    const search = modelSearch.toLowerCase()
    return allModels.filter((model) => model.toLowerCase().includes(search))
  }, [allModels, modelSearch])

  const getPriorityValue = useCallback((channel: Channel): number => {
    if (priorityChanges[channel.id] !== undefined) {
      return priorityChanges[channel.id]
    }
    return channel.priority ?? 0
  }, [priorityChanges])

  // Get channels that support the selected model
  const channelsForModel = useMemo(() => {
    if (!selectedModel) return []
    return channels
      .filter((channel) => {
        if (!channel.models) return false
        const models = channel.models.split(',').map((m) => m.trim())
        return models.includes(selectedModel)
      })
      .sort((a, b) => compareChannelsForModelRouting(a, b, getPriorityValue))
  }, [channels, selectedModel, getPriorityValue])

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedModel(null)
      setModelSearch('')
      setPriorityChanges({})
    }
  }, [open])

  const handlePriorityChange = (channelId: number, value: string) => {
    const priority = value === '' ? 0 : parseInt(value, 10)
    if (isNaN(priority)) return
    setPriorityChanges((prev) => ({
      ...prev,
      [channelId]: priority,
    }))
  }

  const updateCachedChannelStatuses = useCallback(
    (statusesById: Map<number, number>) => {
      queryClient.setQueriesData<GetChannelsResponse>(
        { queryKey: channelsQueryKeys.lists() },
        (oldData) => applyChannelStatusUpdates(oldData, statusesById)
      )
      queryClient.setQueryData(
        channelsQueryKeys.list({ all: true }),
        (oldData: GetChannelsResponse | undefined) =>
          applyChannelStatusUpdates(oldData, statusesById, true)
      )
    },
    [queryClient]
  )

  const handleChannelStatusChange = useCallback(
    async (channel: Channel, checked: boolean) => {
      const status = checked
        ? CHANNEL_STATUS.ENABLED
        : CHANNEL_STATUS.MANUAL_DISABLED

      setStatusUpdatingIds((prev) => ({
        ...prev,
        [channel.id]: true,
      }))

      try {
        const response = await updateChannelStatus(channel.id, status)
        if (!response.success) {
          throw new Error(response.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }

        updateCachedChannelStatuses(new Map([[channel.id, status]]))
        await queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.lists(),
        })
        toast.success(
          t(checked ? SUCCESS_MESSAGES.ENABLED : SUCCESS_MESSAGES.DISABLED)
        )
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t(ERROR_MESSAGES.UPDATE_FAILED)
        )
      } finally {
        setStatusUpdatingIds((prev) => {
          const next = { ...prev }
          delete next[channel.id]
          return next
        })
      }
    },
    [queryClient, t, updateCachedChannelStatuses]
  )

  const handleSave = async () => {
    if (Object.keys(priorityChanges).length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    setIsSaving(true)

    try {
      const updates = Object.entries(priorityChanges).map(
        async ([id, priority]) => {
          const channelId = parseInt(id, 10)
          const response = await updateChannel(channelId, { priority })
          if (!response.success) {
            throw new Error(response.message || t('Failed to update priorities'))
          }
          return { id: channelId, priority }
        }
      )

      const results = await Promise.allSettled(updates)
      const successfulUpdates = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const successCount = successfulUpdates.length
      const failCount = results.filter((r) => r.status === 'rejected').length

      if (successCount > 0) {
        toast.success(
          t('{{count}} channel(s) updated', { count: successCount })
        )
        const prioritiesById = new Map(
          successfulUpdates.map((update) => [update.id, update.priority])
        )
        queryClient.setQueriesData<GetChannelsResponse>(
          { queryKey: channelsQueryKeys.lists() },
          (oldData) => applyPriorityUpdates(oldData, prioritiesById)
        )
        queryClient.setQueryData(
          channelsQueryKeys.list({ all: true }),
          (oldData: GetChannelsResponse | undefined) =>
            applyPriorityUpdates(oldData, prioritiesById, true)
        )
        await queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.lists(),
        })
        setPriorityChanges((prev) => {
          const next = { ...prev }
          successfulUpdates.forEach((update) => {
            delete next[update.id]
          })
          return next
        })
      }

      if (failCount > 0) {
        toast.error(
          t('{{count}} channel(s) failed to update', { count: failCount })
        )
      }
    } catch (error) {
      toast.error(t('Failed to update priorities'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-[95vw] max-w-6xl sm:max-w-6xl h-[85vh] max-h-[85vh] flex flex-col p-6'>
        <DialogHeader className='flex-shrink-0'>
          <DialogTitle>{t('Model Priority Management')}</DialogTitle>
          <DialogDescription>
            {t(
              'Select a model from the left to view and edit priorities for channels that support it'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center flex-1 min-h-[400px]'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <div className='flex-1 flex gap-4 overflow-hidden min-h-0'>
            {/* Left: Model List */}
            <div className='w-72 flex-shrink-0 flex flex-col gap-3 border-r pr-4'>
              <div className='relative flex-shrink-0'>
                <Search className='absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input
                  placeholder={t('Search models...')}
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className='pl-8'
                />
              </div>
              <ScrollArea className='flex-1 overflow-y-auto'>
                <div className='space-y-1 pr-2'>
                  {filteredModels.length === 0 ? (
                    <div className='text-center text-sm text-muted-foreground py-8'>
                      {t('No models found')}
                    </div>
                  ) : (
                    filteredModels.map((model) => (
                      <button
                        key={model}
                        onClick={() => setSelectedModel(model)}
                        className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                          selectedModel === model
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'hover:bg-muted'
                        }`}
                      >
                        {model}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right: Channel List with Priority Editor */}
            <div className='flex-1 flex flex-col gap-3 min-w-0 overflow-hidden'>
              {!selectedModel ? (
                <div className='flex items-center justify-center h-full text-muted-foreground text-sm'>
                  {t('Select a model to view channels')}
                </div>
              ) : (
                <>
                  <div className='text-sm font-medium flex-shrink-0'>
                    {t('Channels supporting: {{model}}', {
                      model: selectedModel,
                    })}{' '}
                    ({channelsForModel.length})
                  </div>
                  <ScrollArea className='flex-1 overflow-y-auto'>
                    {channelsForModel.length === 0 ? (
                      <div className='text-center text-sm text-muted-foreground py-8'>
                        {t('No channels support this model')}
                      </div>
                    ) : (
                      <div className='space-y-3 pr-2'>
                        {channelsForModel.map((channel) => {
                          const isEnabled =
                            channel.status === CHANNEL_STATUS.ENABLED
                          const isStatusUpdating = Boolean(
                            statusUpdatingIds[channel.id]
                          )
                          const statusConfig =
                            CHANNEL_STATUS_CONFIG[
                              channel.status as keyof typeof CHANNEL_STATUS_CONFIG
                            ] || CHANNEL_STATUS_CONFIG[CHANNEL_STATUS.UNKNOWN]
                          return (
                            <div
                              key={channel.id}
                              className={`grid gap-3 rounded-lg border p-4 transition-colors sm:grid-cols-[minmax(0,1fr)_9rem_8rem] sm:items-center ${
                                !isEnabled ? 'bg-muted/30 opacity-75' : ''
                              }`}
                            >
                              <div className='min-w-0 space-y-1'>
                                <div className='flex min-w-0 items-center gap-2'>
                                  <div
                                    className={`min-w-0 truncate font-medium ${
                                      !isEnabled ? 'line-through' : ''
                                    }`}
                                  >
                                    {channel.name}
                                  </div>
                                  <StatusBadge
                                    label={t(statusConfig.label)}
                                    variant={statusConfig.variant}
                                    copyable={false}
                                    className='shrink-0'
                                  />
                                </div>
                                <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                                  <span>ID: {channel.id}</span>
                                  <span>
                                    {t('Group')}: {channel.group}
                                  </span>
                                </div>
                              </div>
                              <div className='flex items-center justify-between gap-3 sm:justify-end'>
                                <Label
                                  htmlFor={`status-${channel.id}`}
                                  className='text-sm whitespace-nowrap'
                                >
                                  {t('Status')}
                                </Label>
                                <Switch
                                  id={`status-${channel.id}`}
                                  checked={isEnabled}
                                  onCheckedChange={(checked) =>
                                    handleChannelStatusChange(channel, checked)
                                  }
                                  disabled={isStatusUpdating}
                                  aria-label={t('Status')}
                                />
                              </div>
                              <div className='flex items-center justify-between gap-2 sm:justify-end'>
                                <Label
                                  htmlFor={`priority-${channel.id}`}
                                  className='text-sm whitespace-nowrap'
                                >
                                  {t('Priority')}:
                                </Label>
                                <Input
                                  id={`priority-${channel.id}`}
                                  type='number'
                                  value={getPriorityValue(channel)}
                                  onChange={(e) =>
                                    handlePriorityChange(channel.id, e.target.value)
                                  }
                                  className='w-24'
                                  min={0}
                                  disabled={!isEnabled || isStatusUpdating}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter className='flex-shrink-0'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              isSaving || Object.keys(priorityChanges).length === 0 || !selectedModel
            }
          >
            {isSaving && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Save Changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
