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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { ProviderBadge } from '@/components/provider-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  deleteChannel,
  getChannels,
  updateChannel,
  updateChannelStatus,
} from '@/features/channels/api'
import { ChannelsProvider } from '@/features/channels/components/channels-provider'
import { ChannelMutateDrawer } from '@/features/channels/components/drawers/channel-mutate-drawer'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_CONFIG,
  CHANNEL_TYPES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '@/features/channels/constants'
import { channelsQueryKeys } from '@/features/channels/lib'
import type { Channel } from '@/features/channels/types'
import { getPricing } from '@/features/pricing/api'
import type { PricingModel, PricingVendor } from '@/features/pricing/types'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const ROUTING_PAGE_SIZE = 100
const UNASSIGNED_PROVIDER_KEY = '__unassigned__'
const EMPTY_PRICING_MODELS: PricingModel[] = []
const EMPTY_PRICING_VENDORS: PricingVendor[] = []
const ROUTING_ROLE_LABEL_KEYS = ['Primary', 'Backup', 'Fallback'] as const
const ROUTING_ROLE_VARIANTS = ['green', 'blue', 'amber'] as const
const ROUTING_DEFAULT_SELECTION_KEY = 'model-routing-default-selection'
const ROUTING_LAST_SELECTION_KEY = 'model-routing-last-selection'
const PREFERRED_DEFAULT_VENDOR_NAME = 'OpenAI'
const PREFERRED_DEFAULT_MODEL_NAME = 'gpt-5.5'

type ProviderOption = {
  key: string
  label: string
  icon?: string
  modelCount: number
  vendor?: PricingVendor
}

type RoutingField = 'priority' | 'weight'

type RoutingChange = Partial<Record<RoutingField, number>>

type RoutingChanges = Record<number, RoutingChange>

type PricingRoutingData = {
  models: PricingModel[]
  vendors: PricingVendor[]
}

type StoredRoutingSelection = {
  providerKey: string
  modelName: string
}

async function fetchPricingRoutingData(): Promise<PricingRoutingData> {
  const response = await getPricing()
  if (!response.success) {
    throw new Error(response.message || 'Failed to load models')
  }
  const vendorMap = new Map((response.vendors ?? []).map((v) => [v.id, v]))
  return {
    models: (response.data ?? []).map((model) => {
      const vendor = model.vendor_id ? vendorMap.get(model.vendor_id) : null
      return {
        ...model,
        vendor_name: vendor?.name,
        vendor_icon: vendor?.icon,
        vendor_description: vendor?.description,
      }
    }),
    vendors: response.vendors ?? [],
  }
}

async function fetchAllChannels(): Promise<Channel[]> {
  const channels: Channel[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const response = await getChannels({
      p: page,
      page_size: ROUTING_PAGE_SIZE,
    })

    if (!response.success) {
      throw new Error(response.message || 'Failed to load channels')
    }

    const items = response.data?.items ?? []
    channels.push(...items)

    const total = response.data?.total ?? channels.length
    hasMore = channels.length < total && items.length > 0
    page += 1
  }

  return sortRoutingChannels(channels, {})
}

function splitCsv(value?: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getProviderKey(model: Pick<PricingModel, 'vendor_id'>): string {
  return model.vendor_id ? String(model.vendor_id) : UNASSIGNED_PROVIDER_KEY
}

function getRoutingSelectionFromModel(
  model: PricingModel
): StoredRoutingSelection {
  return {
    providerKey: getProviderKey(model),
    modelName: model.model_name,
  }
}

function readStoredRoutingSelection(
  key: string
): StoredRoutingSelection | null {
  if (typeof window === 'undefined') return null

  try {
    const rawValue = window.localStorage.getItem(key)
    if (!rawValue) return null
    const parsed = JSON.parse(rawValue) as Partial<StoredRoutingSelection>
    if (!parsed.providerKey || !parsed.modelName) return null
    return {
      providerKey: String(parsed.providerKey),
      modelName: String(parsed.modelName),
    }
  } catch {
    return null
  }
}

function writeStoredRoutingSelection(
  key: string,
  selection: StoredRoutingSelection
) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(selection))
}

function findModelForSelection(
  models: PricingModel[],
  selection: StoredRoutingSelection | null
): PricingModel | null {
  if (!selection) return null
  return (
    models.find(
      (model) =>
        getProviderKey(model) === selection.providerKey &&
        model.model_name === selection.modelName
    ) ?? null
  )
}

function findPreferredDefaultModel(
  models: PricingModel[]
): PricingModel | null {
  return (
    models.find(
      (model) =>
        model.vendor_name === PREFERRED_DEFAULT_VENDOR_NAME &&
        model.model_name === PREFERRED_DEFAULT_MODEL_NAME
    ) ?? null
  )
}

function resolveInitialRoutingSelection(
  models: PricingModel[],
  defaultSelection: StoredRoutingSelection | null
): StoredRoutingSelection | null {
  const validDefault = findModelForSelection(models, defaultSelection)
  if (validDefault) return getRoutingSelectionFromModel(validDefault)

  const lastSelection = readStoredRoutingSelection(ROUTING_LAST_SELECTION_KEY)
  const validLast = findModelForSelection(models, lastSelection)
  if (validLast) return getRoutingSelectionFromModel(validLast)

  const preferredDefault = findPreferredDefaultModel(models)
  return preferredDefault
    ? getRoutingSelectionFromModel(preferredDefault)
    : null
}

function isSameRoutingSelection(
  first: StoredRoutingSelection | null,
  second: StoredRoutingSelection | null
): boolean {
  return (
    first?.providerKey === second?.providerKey &&
    first?.modelName === second?.modelName
  )
}

function getRoutingModelNames(model: PricingModel | null): string[] {
  return model ? [model.model_name] : []
}

function getModelInitial(modelName: string): string {
  return modelName.trim().charAt(0).toUpperCase() || '?'
}

function channelSupportsModel(channel: Channel, modelNames: string[]): boolean {
  if (modelNames.length === 0) return false
  const channelModels = new Set(splitCsv(channel.models))
  return modelNames.some((modelName) => channelModels.has(modelName))
}

function getFieldValue(
  channel: Channel,
  changes: RoutingChanges,
  field: RoutingField
): number {
  const changedValue = changes[channel.id]?.[field]
  if (changedValue !== undefined) return changedValue
  return channel[field] ?? 0
}

function sortRoutingChannels(
  channels: Channel[],
  changes: RoutingChanges
): Channel[] {
  return [...channels].sort((a, b) => {
    const statusDiff =
      Number(b.status === CHANNEL_STATUS.ENABLED) -
      Number(a.status === CHANNEL_STATUS.ENABLED)
    if (statusDiff !== 0) return statusDiff

    const priorityDiff =
      getFieldValue(b, changes, 'priority') -
      getFieldValue(a, changes, 'priority')
    if (priorityDiff !== 0) return priorityDiff

    const weightDiff =
      getFieldValue(b, changes, 'weight') - getFieldValue(a, changes, 'weight')
    if (weightDiff !== 0) return weightDiff

    return a.id - b.id
  })
}

function getChangedCount(changes: RoutingChanges): number {
  return Object.values(changes).filter(
    (change) => change.priority !== undefined || change.weight !== undefined
  ).length
}

export function ModelRoutingWorkbench() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )
  const [providerSearch, setProviderSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(
    null
  )
  const [selectedModelName, setSelectedModelName] = useState<string | null>(
    null
  )
  const [channels, setChannels] = useState<Channel[]>([])
  const [routingChanges, setRoutingChanges] = useState<RoutingChanges>({})
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<
    Record<number, boolean>
  >({})
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelEditorOpen, setChannelEditorOpen] = useState(false)
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null)
  const [isDeletingChannel, setIsDeletingChannel] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [defaultRoutingSelection, setDefaultRoutingSelection] =
    useState<StoredRoutingSelection | null>(() =>
      readStoredRoutingSelection(ROUTING_DEFAULT_SELECTION_KEY)
    )

  const pricingQuery = useQuery({
    queryKey: ['model-routing', 'pricing'],
    queryFn: fetchPricingRoutingData,
    staleTime: 5 * 60 * 1000,
  })

  const channelsQuery = useQuery({
    queryKey: ['model-routing', 'channels'],
    queryFn: fetchAllChannels,
    staleTime: 30 * 1000,
  })

  const vendors = pricingQuery.data?.vendors ?? EMPTY_PRICING_VENDORS
  const models = pricingQuery.data?.models ?? EMPTY_PRICING_MODELS

  useEffect(() => {
    if (channelsQuery.data) {
      setChannels(channelsQuery.data)
      setRoutingChanges({})
    }
  }, [channelsQuery.data])

  const providerOptions = useMemo<ProviderOption[]>(() => {
    const modelCounts = new Map<string, number>()
    models.forEach((model) => {
      const key = getProviderKey(model)
      modelCounts.set(key, (modelCounts.get(key) ?? 0) + 1)
    })

    const options: ProviderOption[] = vendors
      .map((vendor) => ({
        key: String(vendor.id),
        label: vendor.name,
        icon: vendor.icon,
        modelCount: modelCounts.get(String(vendor.id)) ?? 0,
        vendor,
      }))
      .filter((provider) => provider.modelCount > 0)
      .sort((a, b) => a.label.localeCompare(b.label))

    const unassignedCount = modelCounts.get(UNASSIGNED_PROVIDER_KEY) ?? 0
    if (unassignedCount > 0) {
      options.push({
        key: UNASSIGNED_PROVIDER_KEY,
        label: t('Unassigned'),
        modelCount: unassignedCount,
      })
    }

    return options
  }, [models, t, vendors])

  const filteredProviders = useMemo(() => {
    const search = providerSearch.trim().toLowerCase()
    if (!search) return providerOptions
    return providerOptions.filter((provider) =>
      provider.label.toLowerCase().includes(search)
    )
  }, [providerOptions, providerSearch])

  const selectedProvider = useMemo(() => {
    if (!selectedProviderKey) return null
    return (
      providerOptions.find(
        (provider) => provider.key === selectedProviderKey
      ) ?? null
    )
  }, [providerOptions, selectedProviderKey])

  const providerModels = useMemo(() => {
    if (!selectedProviderKey) return []
    return models
      .filter((model) => getProviderKey(model) === selectedProviderKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name))
  }, [models, selectedProviderKey])

  const filteredModels = useMemo(() => {
    const search = modelSearch.trim().toLowerCase()
    if (!search) return providerModels
    return providerModels.filter((model) =>
      model.model_name.toLowerCase().includes(search)
    )
  }, [modelSearch, providerModels])

  const selectedModel = useMemo(() => {
    if (!selectedModelName) return null
    return (
      providerModels.find((model) => model.model_name === selectedModelName) ??
      null
    )
  }, [providerModels, selectedModelName])

  const selectedRoutingSelection = useMemo(
    () => (selectedModel ? getRoutingSelectionFromModel(selectedModel) : null),
    [selectedModel]
  )

  const initialRoutingSelection = useMemo(
    () => resolveInitialRoutingSelection(models, defaultRoutingSelection),
    [defaultRoutingSelection, models]
  )

  const isSelectedDefaultModel = isSameRoutingSelection(
    selectedRoutingSelection,
    defaultRoutingSelection
  )

  const selectedModelNames = useMemo(
    () => getRoutingModelNames(selectedModel),
    [selectedModel]
  )

  const channelsForModel = useMemo(() => {
    const matchingChannels = channels.filter((channel) =>
      channelSupportsModel(channel, selectedModelNames)
    )
    return sortRoutingChannels(matchingChannels, routingChanges)
  }, [channels, routingChanges, selectedModelNames])

  const isLoading = pricingQuery.isLoading || channelsQuery.isLoading
  const isFetching = pricingQuery.isFetching || channelsQuery.isFetching
  const changedCount = getChangedCount(routingChanges)
  let createChannelButtonTitle: string | undefined
  if (!canEditSensitive) {
    createChannelButtonTitle = t('No permission to perform this action')
  } else if (!selectedModel) {
    createChannelButtonTitle = t('Select a model')
  }

  useEffect(() => {
    if (selectedProviderKey && providerOptions.length > 0) {
      const exists = providerOptions.some(
        (provider) => provider.key === selectedProviderKey
      )
      if (exists) return
    }

    const initialProvider = initialRoutingSelection
      ? providerOptions.find(
          (provider) => provider.key === initialRoutingSelection.providerKey
        )
      : null
    const firstProvider =
      initialProvider ??
      providerOptions.find((provider) => provider.modelCount > 0)
    setSelectedProviderKey(
      firstProvider?.key ?? providerOptions[0]?.key ?? null
    )
  }, [initialRoutingSelection, providerOptions, selectedProviderKey])

  useEffect(() => {
    if (!selectedProviderKey) {
      setSelectedModelName(null)
      return
    }

    const modelExists = providerModels.some(
      (model) => model.model_name === selectedModelName
    )
    if (modelExists) return

    const initialModel =
      initialRoutingSelection?.providerKey === selectedProviderKey
        ? providerModels.find(
            (model) => model.model_name === initialRoutingSelection.modelName
          )
        : null
    setSelectedModelName(
      initialModel?.model_name ?? providerModels[0]?.model_name ?? null
    )
  }, [
    initialRoutingSelection,
    providerModels,
    selectedModelName,
    selectedProviderKey,
  ])

  useEffect(() => {
    if (!selectedRoutingSelection) return
    writeStoredRoutingSelection(
      ROUTING_LAST_SELECTION_KEY,
      selectedRoutingSelection
    )
  }, [selectedRoutingSelection])

  const refreshRoutingData = useCallback(async () => {
    await Promise.all([pricingQuery.refetch(), channelsQuery.refetch()])
  }, [channelsQuery, pricingQuery])

  const handleProviderSelect = (providerKey: string) => {
    setSelectedProviderKey(providerKey)
    setModelSearch('')
    setSelectedModelName(null)
  }

  const handleSetDefaultModel = () => {
    if (!selectedRoutingSelection) return
    writeStoredRoutingSelection(
      ROUTING_DEFAULT_SELECTION_KEY,
      selectedRoutingSelection
    )
    setDefaultRoutingSelection(selectedRoutingSelection)
    toast.success(t('Saved successfully'))
  }

  const openChannelEditor = (channel: Channel) => {
    setEditingChannel(channel)
    setChannelEditorOpen(true)
  }

  const openChannelCreator = () => {
    if (!selectedModel || !canEditSensitive) return
    setEditingChannel(null)
    setChannelEditorOpen(true)
  }

  const openChannelUsageLogs = (channelId: number) => {
    const targetUrl = `/usage-logs/common?channel=${encodeURIComponent(
      String(channelId)
    )}`
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }

  const handleChannelEditorOpenChange = (open: boolean) => {
    setChannelEditorOpen(open)
    if (open) return
    setEditingChannel(null)
    void channelsQuery.refetch()
    void pricingQuery.refetch()
  }

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (open || isDeletingChannel) return
    setDeletingChannel(null)
  }

  const handleRoutingFieldChange = (
    channel: Channel,
    field: RoutingField,
    value: string
  ) => {
    const numericValue = value.trim() === '' ? 0 : Number(value)
    if (!Number.isFinite(numericValue) || numericValue < 0) return

    const originalValue = channel[field] ?? 0
    setRoutingChanges((prev) => {
      const next = { ...prev }
      const channelChanges = { ...(next[channel.id] ?? {}) }

      if (numericValue === originalValue) {
        delete channelChanges[field]
      } else {
        channelChanges[field] = numericValue
      }

      if (
        channelChanges.priority === undefined &&
        channelChanges.weight === undefined
      ) {
        delete next[channel.id]
      } else {
        next[channel.id] = channelChanges
      }

      return next
    })
  }

  const updateLocalChannel = useCallback(
    (channelId: number, patch: Partial<Channel>) => {
      setChannels((prev) =>
        prev.map((channel) =>
          channel.id === channelId ? { ...channel, ...patch } : channel
        )
      )
    },
    []
  )

  const handleChannelStatusChange = useCallback(
    async (channel: Channel, checked: boolean) => {
      const status = checked
        ? CHANNEL_STATUS.ENABLED
        : CHANNEL_STATUS.MANUAL_DISABLED

      setStatusUpdatingIds((prev) => ({ ...prev, [channel.id]: true }))

      try {
        const response = await updateChannelStatus(channel.id, status)
        if (!response.success) {
          throw new Error(response.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }

        updateLocalChannel(channel.id, { status })
        await queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.lists(),
        })
        await queryClient.invalidateQueries({
          queryKey: ['model-routing', 'pricing'],
        })
        toast.success(
          t(checked ? SUCCESS_MESSAGES.ENABLED : SUCCESS_MESSAGES.DISABLED)
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t(ERROR_MESSAGES.UPDATE_FAILED)
        )
      } finally {
        setStatusUpdatingIds((prev) => {
          const next = { ...prev }
          delete next[channel.id]
          return next
        })
      }
    },
    [queryClient, t, updateLocalChannel]
  )

  const handleConfirmDeleteChannel = async () => {
    if (!deletingChannel) return

    setIsDeletingChannel(true)
    try {
      const response = await deleteChannel(deletingChannel.id)
      if (!response.success) {
        toast.error(response.message || t(ERROR_MESSAGES.DELETE_FAILED))
        return
      }

      setChannels((prev) =>
        prev.filter((channel) => channel.id !== deletingChannel.id)
      )
      setRoutingChanges((prev) => {
        const next = { ...prev }
        delete next[deletingChannel.id]
        return next
      })
      await queryClient.invalidateQueries({
        queryKey: channelsQueryKeys.lists(),
      })
      await queryClient.invalidateQueries({
        queryKey: ['model-routing', 'channels'],
      })
      await queryClient.invalidateQueries({
        queryKey: ['model-routing', 'pricing'],
      })
      toast.success(t(SUCCESS_MESSAGES.DELETED))
      setDeletingChannel(null)
    } catch {
      toast.error(t(ERROR_MESSAGES.DELETE_FAILED))
    } finally {
      setIsDeletingChannel(false)
    }
  }

  const handleSaveRouting = async () => {
    if (changedCount === 0) {
      toast.info(t('No changes to save'))
      return
    }

    setIsSaving(true)

    try {
      const updates = Object.entries(routingChanges).map(
        async ([id, change]) => {
          const channelId = Number(id)
          const payload: Partial<Channel> = {}

          if (change.priority !== undefined) payload.priority = change.priority
          if (change.weight !== undefined) payload.weight = change.weight

          const response = await updateChannel(channelId, payload)
          if (!response.success) {
            throw new Error(response.message || t('Failed to update routing'))
          }

          return { id: channelId, patch: payload }
        }
      )

      const results = await Promise.allSettled(updates)
      const successfulUpdates = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const failCount = results.filter(
        (result) => result.status === 'rejected'
      ).length

      if (successfulUpdates.length > 0) {
        setChannels((prev) => {
          const patchesById = new Map(
            successfulUpdates.map((update) => [update.id, update.patch])
          )
          return sortRoutingChannels(
            prev.map((channel) => {
              const patch = patchesById.get(channel.id)
              return patch ? { ...channel, ...patch } : channel
            }),
            {}
          )
        })
        setRoutingChanges((prev) => {
          const next = { ...prev }
          successfulUpdates.forEach((update) => {
            delete next[update.id]
          })
          return next
        })
        await queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.lists(),
        })
        await queryClient.invalidateQueries({
          queryKey: ['model-routing', 'channels'],
        })
        await queryClient.invalidateQueries({
          queryKey: ['model-routing', 'pricing'],
        })
        toast.success(
          t('{{count}} channel(s) updated', {
            count: successfulUpdates.length,
          })
        )
      }

      if (failCount > 0) {
        toast.error(
          t('{{count}} channel(s) failed to update', { count: failCount })
        )
      }
    } catch {
      toast.error(t('Failed to update routing'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='text-muted-foreground flex min-w-0 items-center gap-2 text-sm'>
          {changedCount > 0 ? (
            <StatusBadge
              label={t('{{count}} unsaved change(s)', { count: changedCount })}
              variant='warning'
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={t('Routing is up to date')}
              variant='success'
              copyable={false}
            />
          )}
          {isFetching && !isLoading ? (
            <Loader2 className='size-4 animate-spin' aria-hidden='true' />
          ) : null}
        </div>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={refreshRoutingData}
            disabled={isFetching || isSaving}
          >
            <RefreshCw className='size-4' />
            {t('Refresh')}
          </Button>
          <Button
            type='button'
            size='sm'
            onClick={handleSaveRouting}
            disabled={changedCount === 0 || isSaving}
          >
            {isSaving ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {t('Save Routing')}
          </Button>
        </div>
      </div>

      <div className='grid min-h-0 flex-1 gap-3 lg:grid-cols-[17rem_20rem_minmax(0,1fr)]'>
        <section className='bg-background flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border'>
          <div className='border-b p-3'>
            <div className='mb-2 text-sm font-medium'>{t('Vendors')}</div>
            <div className='relative'>
              <Search className='text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4' />
              <Input
                value={providerSearch}
                onChange={(event) => setProviderSearch(event.target.value)}
                placeholder={t('Search vendors...')}
                className='pl-8'
                aria-label={t('Search vendors...')}
              />
            </div>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            {isLoading && <LoadingState />}
            {!isLoading && filteredProviders.length === 0 && (
              <EmptyState title={t('No vendors found')} />
            )}
            {!isLoading && filteredProviders.length > 0 && (
              <div className='space-y-1 p-2'>
                {filteredProviders.map((provider) => (
                  <button
                    type='button'
                    key={provider.key}
                    onClick={() => handleProviderSelect(provider.key)}
                    className={cn(
                      'flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      selectedProviderKey === provider.key
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <span className='min-w-0 flex-1'>
                      {provider.vendor ? (
                        <ProviderBadge
                          iconKey={provider.icon}
                          label={provider.label}
                          copyable={false}
                          className={
                            selectedProviderKey === provider.key
                              ? 'text-primary-foreground'
                              : undefined
                          }
                        />
                      ) : (
                        <span className='block truncate'>{provider.label}</span>
                      )}
                    </span>
                    <span className='shrink-0 text-xs tabular-nums opacity-80'>
                      {provider.modelCount}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </section>

        <section className='bg-background flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border'>
          <div className='border-b p-3'>
            <div className='mb-2 flex min-w-0 items-center justify-between gap-2'>
              <div className='truncate text-sm font-medium'>
                {selectedProvider?.label ?? t('Models')}
              </div>
              <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                {providerModels.length}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={handleSetDefaultModel}
                disabled={!selectedModel}
                title={t('Set as default model')}
                aria-label={t('Set as default model')}
                className={cn(
                  'shrink-0',
                  isSelectedDefaultModel && 'text-warning'
                )}
              >
                <Star
                  className={cn(
                    'size-4',
                    isSelectedDefaultModel && 'fill-current'
                  )}
                />
              </Button>
            </div>
            <div className='relative'>
              <Search className='text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4' />
              <Input
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                placeholder={t('Search models...')}
                className='pl-8'
                aria-label={t('Search models...')}
              />
            </div>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            {isLoading && <LoadingState />}
            {!isLoading && filteredModels.length === 0 && (
              <EmptyState title={t('No models found')} />
            )}
            {!isLoading && filteredModels.length > 0 && (
              <div className='space-y-1 p-2'>
                {filteredModels.map((model) => (
                  <button
                    type='button'
                    key={model.model_name}
                    onClick={() => setSelectedModelName(model.model_name)}
                    className={cn(
                      'flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      selectedModelName === model.model_name
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    )}
                  >
                    <span className='flex min-w-0 flex-1 items-center gap-2'>
                      <span className='bg-muted/40 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full'>
                        {model.icon || model.vendor_icon ? (
                          getLobeIcon(model.icon || model.vendor_icon, 16)
                        ) : (
                          <span
                            className={cn(
                              'text-[10px] font-semibold',
                              selectedModelName === model.model_name
                                ? 'text-primary-foreground'
                                : 'text-muted-foreground'
                            )}
                          >
                            {getModelInitial(model.model_name)}
                          </span>
                        )}
                      </span>
                      <span className='min-w-0 flex-1 truncate font-mono'>
                        {model.model_name}
                      </span>
                    </span>
                    <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                      {model.bound_channels?.length ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </section>

        <section className='bg-background flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border'>
          <div className='flex min-h-14 items-center justify-between gap-3 border-b p-3'>
            <div className='min-w-0'>
              <div className='truncate text-sm font-medium'>
                {selectedModel?.model_name ?? t('Channels')}
              </div>
              {selectedModel ? (
                <div className='text-muted-foreground mt-1 text-xs'>
                  {t('{{count}} channel(s)', {
                    count: channelsForModel.length,
                  })}
                </div>
              ) : null}
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={openChannelCreator}
              disabled={!selectedModel || !canEditSensitive}
              title={createChannelButtonTitle}
              aria-label={t('Create Channel')}
            >
              <Plus className='size-4' />
              <span className='max-sm:hidden'>{t('Create Channel')}</span>
            </Button>
          </div>

          <div className='min-h-0 flex-1 overflow-auto'>
            {isLoading && <LoadingState />}
            {!isLoading && !selectedModel && (
              <EmptyState title={t('Select a model')} />
            )}
            {!isLoading && selectedModel && channelsForModel.length === 0 && (
              <EmptyState title={t('No channels support this model')} />
            )}
            {!isLoading && selectedModel && channelsForModel.length > 0 && (
              <Table className='min-w-[58rem] table-fixed'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-80'>{t('Channel')}</TableHead>
                    <TableHead className='w-16'>{t('Actions')}</TableHead>
                    <TableHead className='w-28'>{t('Type')}</TableHead>
                    <TableHead className='w-24'>{t('Group')}</TableHead>
                    <TableHead className='w-36'>{t('Status')}</TableHead>
                    <TableHead className='w-48'>
                      <div className='grid grid-cols-2 gap-2'>
                        <span>{t('Priority')}</span>
                        <span>{t('Weight')}</span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channelsForModel.map((channel, index) => {
                    const isEnabled = channel.status === CHANNEL_STATUS.ENABLED
                    const isStatusUpdating = Boolean(
                      statusUpdatingIds[channel.id]
                    )
                    const routeRoleLabelKey =
                      isEnabled && index < ROUTING_ROLE_LABEL_KEYS.length
                        ? ROUTING_ROLE_LABEL_KEYS[index]
                        : null
                    const statusConfig =
                      CHANNEL_STATUS_CONFIG[
                        channel.status as keyof typeof CHANNEL_STATUS_CONFIG
                      ] || CHANNEL_STATUS_CONFIG[CHANNEL_STATUS.UNKNOWN]
                    const channelType =
                      CHANNEL_TYPES[
                        channel.type as keyof typeof CHANNEL_TYPES
                      ] ?? CHANNEL_TYPES[0]
                    const channelRemark = channel.remark?.trim()

                    return (
                      <TableRow
                        key={channel.id}
                        className={!isEnabled ? 'bg-muted/30 opacity-75' : ''}
                      >
                        <TableCell className='w-80 max-w-80'>
                          <div className='grid min-w-0 grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-2'>
                            <div className='flex min-w-0 items-center gap-1'>
                              <StatusBadge
                                label={`#${index + 1}`}
                                variant='neutral'
                                size='sm'
                                copyable={false}
                                className='w-9 justify-center'
                              />
                              <button
                                type='button'
                                className='text-muted-foreground hover:text-foreground w-14 truncate text-left font-mono text-xs transition-colors hover:underline'
                                title={t('Open usage logs')}
                                aria-label={`${t('Open usage logs')} #${channel.id}`}
                                onClick={() => openChannelUsageLogs(channel.id)}
                              >
                                ID:{channel.id}
                              </button>
                              {routeRoleLabelKey ? (
                                <StatusBadge
                                  label={t(routeRoleLabelKey)}
                                  variant={ROUTING_ROLE_VARIANTS[index]}
                                  size='sm'
                                  copyable={false}
                                  className='w-12 justify-center'
                                />
                              ) : (
                                <span className='w-12' aria-hidden='true' />
                              )}
                            </div>
                            <div className='min-w-0'>
                              {channelRemark ? (
                                <TooltipProvider delay={200}>
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <div
                                          className={cn(
                                            'block min-w-0 truncate font-medium cursor-help',
                                            !isEnabled && 'line-through'
                                          )}
                                        />
                                      }
                                    >
                                      {channel.name}
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side='top'
                                      className='max-w-xs break-words'
                                    >
                                      {channelRemark}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <div
                                  className={cn(
                                    'min-w-0 truncate font-medium',
                                    !isEnabled && 'line-through'
                                  )}
                                >
                                  {channel.name}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className='w-16'>
                          <div className='flex items-center gap-1'>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              className='shrink-0'
                              title={t('Edit')}
                              aria-label={t('Edit')}
                              onClick={() => openChannelEditor(channel)}
                            >
                              <Pencil className='size-4' />
                            </Button>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              className='text-destructive hover:text-destructive shrink-0'
                              title={t('Delete')}
                              aria-label={t('Delete')}
                              onClick={() => setDeletingChannel(channel)}
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className='w-28'>
                          <div className='truncate'>{t(channelType)}</div>
                        </TableCell>
                        <TableCell className='w-24'>
                          <StatusBadge
                            label={channel.group}
                            variant='neutral'
                            size='sm'
                            copyable={false}
                          />
                        </TableCell>
                        <TableCell className='w-36'>
                          <div className='flex min-w-0 items-center gap-2'>
                            <Switch
                              size='sm'
                              checked={isEnabled}
                              disabled={isStatusUpdating}
                              onCheckedChange={(checked) =>
                                handleChannelStatusChange(channel, checked)
                              }
                              aria-label={t('Status')}
                            />
                            <StatusBadge
                              label={t(statusConfig.label)}
                              variant={statusConfig.variant}
                              copyable={false}
                              className='min-w-0'
                            />
                          </div>
                        </TableCell>
                        <TableCell className='w-48'>
                          <div className='grid grid-cols-2 gap-2'>
                            <Input
                              type='number'
                              min={0}
                              value={getFieldValue(
                                channel,
                                routingChanges,
                                'priority'
                              )}
                              onChange={(event) =>
                                handleRoutingFieldChange(
                                  channel,
                                  'priority',
                                  event.target.value
                                )
                              }
                              disabled={!isEnabled || isStatusUpdating}
                              className='h-8 w-full'
                              aria-label={t('Priority')}
                            />
                            <Input
                              type='number'
                              min={0}
                              value={getFieldValue(
                                channel,
                                routingChanges,
                                'weight'
                              )}
                              onChange={(event) =>
                                handleRoutingFieldChange(
                                  channel,
                                  'weight',
                                  event.target.value
                                )
                              }
                              disabled={!isEnabled || isStatusUpdating}
                              className='h-8 w-full'
                              aria-label={t('Weight')}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
      <ChannelsProvider>
        <ChannelMutateDrawer
          open={channelEditorOpen}
          currentRow={editingChannel}
          onOpenChange={handleChannelEditorOpenChange}
        />
      </ChannelsProvider>
      <ConfirmDialog
        open={deletingChannel !== null}
        onOpenChange={handleDeleteDialogOpenChange}
        title={
          <span className='break-words'>
            {t('Delete Channel')}: {deletingChannel?.name}
          </span>
        }
        desc={t(
          'Are you sure you want to delete channel "{{name}}"? This action cannot be undone.',
          { name: deletingChannel?.name ?? '' }
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={isDeletingChannel}
        handleConfirm={handleConfirmDeleteChannel}
      />
    </div>
  )
}

function LoadingState() {
  return (
    <div className='flex min-h-52 items-center justify-center'>
      <Loader2 className='text-muted-foreground size-6 animate-spin' />
    </div>
  )
}

function EmptyState(props: { title: string; description?: string }) {
  return (
    <Empty className='min-h-52 border-0'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Search className='size-4' />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        {props.description ? (
          <EmptyDescription>{props.description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}
