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
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { getChannels, updateChannel } from '../../api'
import { channelsQueryKeys } from '../../lib'
import type { Channel } from '../../types'

type ModelPriorityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
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

  // Fetch all channels
  const { data: channelsData, isLoading } = useQuery({
    queryKey: channelsQueryKeys.list({ p: 0 }),
    queryFn: async () => {
      const response = await getChannels({ p: 0 })
      return response
    },
    enabled: open,
  })

  const channels = channelsData?.data?.items || []

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

  // Get channels that support the selected model
  const channelsForModel = useMemo(() => {
    if (!selectedModel) return []
    return channels.filter((channel) => {
      if (!channel.models) return false
      const models = channel.models.split(',').map((m) => m.trim())
      return models.includes(selectedModel)
    })
  }, [channels, selectedModel])

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

  const handleSave = async () => {
    if (Object.keys(priorityChanges).length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    setIsSaving(true)

    try {
      const updates = Object.entries(priorityChanges).map(([id, priority]) =>
        updateChannel(parseInt(id, 10), { priority })
      )

      const results = await Promise.allSettled(updates)
      const successCount = results.filter((r) => r.status === 'fulfilled').length
      const failCount = results.filter((r) => r.status === 'rejected').length

      if (successCount > 0) {
        toast.success(
          t('{{count}} channel(s) updated', { count: successCount })
        )
        queryClient.invalidateQueries({ queryKey: channelsQueryKeys.lists() })
        setPriorityChanges({})
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

  const getPriorityValue = (channel: Channel): number => {
    if (priorityChanges[channel.id] !== undefined) {
      return priorityChanges[channel.id]
    }
    return channel.priority ?? 0
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl h-[80vh] flex flex-col'>
        <DialogHeader>
          <DialogTitle>{t('Model Priority Management')}</DialogTitle>
          <DialogDescription>
            {t(
              'Select a model from the left to view and edit priorities for channels that support it'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center flex-1'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <div className='flex-1 flex gap-4 min-h-0'>
            {/* Left: Model List */}
            <div className='w-1/3 flex flex-col gap-2 border-r pr-4'>
              <div className='relative'>
                <Search className='absolute left-2 top-2.5 h-4 w-4 text-muted-foreground' />
                <Input
                  placeholder={t('Search models...')}
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className='pl-8'
                />
              </div>
              <ScrollArea className='flex-1'>
                <div className='space-y-1'>
                  {filteredModels.length === 0 ? (
                    <div className='text-center text-sm text-muted-foreground py-4'>
                      {t('No models found')}
                    </div>
                  ) : (
                    filteredModels.map((model) => (
                      <button
                        key={model}
                        onClick={() => setSelectedModel(model)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                          selectedModel === model
                            ? 'bg-primary text-primary-foreground'
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
            <div className='flex-1 flex flex-col gap-2'>
              {!selectedModel ? (
                <div className='flex items-center justify-center h-full text-muted-foreground text-sm'>
                  {t('Select a model to view channels')}
                </div>
              ) : (
                <>
                  <div className='text-sm font-medium'>
                    {t('Channels supporting: {{model}}', {
                      model: selectedModel,
                    })}{' '}
                    ({channelsForModel.length})
                  </div>
                  <ScrollArea className='flex-1'>
                    {channelsForModel.length === 0 ? (
                      <div className='text-center text-sm text-muted-foreground py-4'>
                        {t('No channels support this model')}
                      </div>
                    ) : (
                      <div className='space-y-3 pr-2'>
                        {channelsForModel.map((channel) => (
                          <div
                            key={channel.id}
                            className='flex items-center gap-3 p-3 border rounded-md'
                          >
                            <div className='flex-1 min-w-0'>
                              <div className='font-medium truncate'>
                                {channel.name}
                              </div>
                              <div className='text-xs text-muted-foreground'>
                                ID: {channel.id} | Group: {channel.group}
                              </div>
                            </div>
                            <div className='flex items-center gap-2'>
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
                                className='w-20'
                                min={0}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
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
