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
import { Analytics02Icon, LockIcon, UndoIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  Copy,
  Gauge,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  CHANNEL_REMARK_CLOSE_DELAY,
  CHANNEL_REMARK_HOVER_DELAY,
  ChannelRemarkHoverContent,
  ChannelRemarkText,
} from '@/components/channel-remark-hover-content'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
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
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  type ModelRoutingOverride,
  deleteChannel,
  deleteModelRoutingOverride,
  getChannelModelVendorGroups,
  getChannels,
  getModelRoutingOverride,
  normalizeModelRoutingOverrides,
  setModelRoutingOverride,
  updateChannel,
  updateChannelStatus,
} from '@/features/channels/api'
import { ChannelsProvider } from '@/features/channels/components/channels-provider'
import { ChannelTestDialog } from '@/features/channels/components/dialogs/channel-test-dialog'
import { CopyChannelDialog } from '@/features/channels/components/dialogs/copy-channel-dialog'
import { ChannelMutateDrawer } from '@/features/channels/components/drawers/channel-mutate-drawer'
import {
  CHANNEL_STATUS,
  CHANNEL_STATUS_CONFIG,
  CHANNEL_TYPES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '@/features/channels/constants'
import { channelsQueryKeys } from '@/features/channels/lib'
import type {
  Channel,
  ChannelModelVendorGroup,
} from '@/features/channels/types'
import { getPricing } from '@/features/pricing/api'
import type { PricingModel, PricingVendor } from '@/features/pricing/types'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { formatTimestampToDate } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

const ROUTING_PAGE_SIZE = 100
const UNASSIGNED_PROVIDER_KEY = '__unassigned__'
const EMPTY_PRICING_MODELS: PricingModel[] = []
const EMPTY_PRICING_VENDORS: PricingVendor[] = []
const EMPTY_MODEL_VENDOR_GROUPS: ChannelModelVendorGroup[] = []
const ROUTING_ROLE_LABEL_KEYS = ['Primary', 'Backup', 'Fallback'] as const
const ROUTING_ROLE_VARIANTS = ['green', 'blue', 'amber'] as const
const ROUTING_DEFAULT_SELECTION_KEY = 'model-routing-default-selection'
const ROUTING_LAST_SELECTION_KEY = 'model-routing-last-selection'
const ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY =
  'model-routing-provider-default-selections:v1'
const ROUTING_LAST_PROVIDER_KEY = 'model-routing-last-provider:v1'
const ROUTING_SHOW_ALL_MODELS_KEY = 'model-routing-show-all-models:v1'
const PREFERRED_DEFAULT_VENDOR_NAME = 'OpenAI'
const PREFERRED_DEFAULT_MODEL_NAME = 'gpt-5.5'

type ProviderOption = {
  key: string
  label: string
  icon?: string
  modelCount: number
  vendor?: PricingVendor
}

type RoutingSearchMode = 'model' | 'channel'

type RoutingField = 'priority' | 'weight'

type RoutingChange = Partial<Record<RoutingField, number>>

type RoutingChanges = Record<number, RoutingChange>

type PricingRoutingData = {
  models: PricingModel[]
  vendors: PricingVendor[]
}

type RoutingModel = {
  model_name: string
  icon?: string
  vendor_id?: number
  vendor_name?: string
  vendor_icon?: string
  vendor_description?: string
  channelCount: number
}

type RoutingChannelsData = {
  channels: Channel[]
  modelVendorGroups: ChannelModelVendorGroup[]
}

type RoutingCatalog = {
  models: RoutingModel[]
  vendors: PricingVendor[]
}

type StoredRoutingSelection = {
  providerKey: string
  modelName: string
}

type StoredProviderDefaultSelections = Record<string, string>

type ModelRoutingWorkbenchProps = {
  targetModelName?: string
  targetChannelId?: number
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

async function fetchAllChannels(): Promise<RoutingChannelsData> {
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

  const modelNames = getChannelModelNames(channels)
  let modelVendorGroups: ChannelModelVendorGroup[] = []
  if (modelNames.length > 0) {
    try {
      const response = await getChannelModelVendorGroups(modelNames)
      if (response.success) {
        modelVendorGroups = response.data ?? []
      }
    } catch {}
  }

  return {
    channels: sortRoutingChannels(channels, {}),
    modelVendorGroups,
  }
}

function splitCsv(value?: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function getProviderKey(model: Pick<RoutingModel, 'vendor_id'>): string {
  return model.vendor_id ? String(model.vendor_id) : UNASSIGNED_PROVIDER_KEY
}

function getRoutingSelectionFromModel(
  model: RoutingModel
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
  try {
    window.localStorage.setItem(key, JSON.stringify(selection))
  } catch {}
}

function readStoredProviderDefaultSelections(): StoredProviderDefaultSelections {
  const selections: StoredProviderDefaultSelections = {}
  if (typeof window === 'undefined') return selections

  try {
    const rawValue = window.localStorage.getItem(
      ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY
    )
    if (rawValue) {
      const parsed = JSON.parse(rawValue) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.entries(parsed).forEach(([providerKey, modelName]) => {
          if (typeof modelName !== 'string' || modelName.trim() === '') return
          selections[String(providerKey)] = modelName
        })
      }
    }
  } catch {}

  const legacyDefault = readStoredRoutingSelection(
    ROUTING_DEFAULT_SELECTION_KEY
  )
  if (legacyDefault && selections[legacyDefault.providerKey] === undefined) {
    selections[legacyDefault.providerKey] = legacyDefault.modelName
  }

  return selections
}

function writeStoredProviderDefaultSelections(
  selections: StoredProviderDefaultSelections
) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ROUTING_PROVIDER_DEFAULT_SELECTIONS_KEY,
      JSON.stringify(selections)
    )
  } catch {}
}

function readStoredProviderKey(key: string): string | null {
  if (typeof window === 'undefined') return null

  try {
    const providerKey = window.localStorage.getItem(key)
    return providerKey ? String(providerKey) : null
  } catch {
    return null
  }
}

function writeStoredProviderKey(key: string, providerKey: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, providerKey)
  } catch {}
}

function readStoredShowAllModels(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(ROUTING_SHOW_ALL_MODELS_KEY) !== 'false'
  } catch {
    return true
  }
}

function writeStoredShowAllModels(showAllModels: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      ROUTING_SHOW_ALL_MODELS_KEY,
      String(showAllModels)
    )
  } catch {}
}

function findModelForSelection(
  models: RoutingModel[],
  selection: StoredRoutingSelection | null
): RoutingModel | null {
  if (!selection) return null
  return (
    models.find(
      (model) =>
        getProviderKey(model) === selection.providerKey &&
        model.model_name === selection.modelName
    ) ?? null
  )
}

function findProviderDefaultModel(
  models: RoutingModel[],
  providerDefaults: StoredProviderDefaultSelections,
  providerKey: string | null
): RoutingModel | null {
  if (!providerKey) return null
  const modelName = providerDefaults[providerKey]
  if (!modelName) return null
  return findModelForSelection(models, { providerKey, modelName })
}

function findFirstModelForProvider(
  models: RoutingModel[],
  providerKey: string | null
): RoutingModel | null {
  if (!providerKey) return null
  return (
    models
      .filter((model) => getProviderKey(model) === providerKey)
      .sort((a, b) => a.model_name.localeCompare(b.model_name))[0] ?? null
  )
}

function findPreferredDefaultModel(
  models: RoutingModel[]
): RoutingModel | null {
  return (
    models.find(
      (model) =>
        model.vendor_name === PREFERRED_DEFAULT_VENDOR_NAME &&
        model.model_name === PREFERRED_DEFAULT_MODEL_NAME
    ) ?? null
  )
}

function resolveInitialRoutingSelection(
  models: RoutingModel[],
  providerDefaults: StoredProviderDefaultSelections
): StoredRoutingSelection | null {
  const lastProviderKey = readStoredProviderKey(ROUTING_LAST_PROVIDER_KEY)
  const lastProviderDefault = findProviderDefaultModel(
    models,
    providerDefaults,
    lastProviderKey
  )
  if (lastProviderDefault) {
    return getRoutingSelectionFromModel(lastProviderDefault)
  }

  const firstLastProviderModel = findFirstModelForProvider(
    models,
    lastProviderKey
  )
  if (firstLastProviderModel) {
    return getRoutingSelectionFromModel(firstLastProviderModel)
  }

  const legacyDefault = readStoredRoutingSelection(
    ROUTING_DEFAULT_SELECTION_KEY
  )
  const validLegacyDefault = findModelForSelection(models, legacyDefault)
  if (validLegacyDefault) {
    return getRoutingSelectionFromModel(validLegacyDefault)
  }

  const lastSelection = readStoredRoutingSelection(ROUTING_LAST_SELECTION_KEY)
  const validLast = findModelForSelection(models, lastSelection)
  if (validLast) return getRoutingSelectionFromModel(validLast)

  const preferredDefault = findPreferredDefaultModel(models)
  return preferredDefault
    ? getRoutingSelectionFromModel(preferredDefault)
    : null
}

function isSameProviderDefaultSelection(
  selection: StoredRoutingSelection | null,
  providerDefaults: StoredProviderDefaultSelections
): boolean {
  if (!selection) return false
  return providerDefaults[selection.providerKey] === selection.modelName
}

function getRoutingModelNames(model: RoutingModel | null): string[] {
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

function getChannelModelNames(channels: Channel[]): string[] {
  const modelNames = new Set<string>()
  for (const channel of channels) {
    for (const modelName of splitCsv(channel.models)) {
      modelNames.add(modelName)
    }
  }
  return [...modelNames]
}

function buildRoutingCatalog(
  pricingModels: PricingModel[],
  pricingVendors: PricingVendor[],
  channels: Channel[],
  modelVendorGroups: ChannelModelVendorGroup[]
): RoutingCatalog {
  const vendorsById = new Map<number, PricingVendor>()
  for (const vendor of pricingVendors) {
    vendorsById.set(vendor.id, vendor)
  }
  for (const group of modelVendorGroups) {
    if (group.vendor_id <= 0 || vendorsById.has(group.vendor_id)) continue
    vendorsById.set(group.vendor_id, {
      id: group.vendor_id,
      name: group.vendor_name,
    })
  }

  const vendorIdByModel = new Map<string, number>()
  for (const group of modelVendorGroups) {
    if (group.vendor_id <= 0) continue
    for (const modelName of group.models) {
      vendorIdByModel.set(modelName, group.vendor_id)
    }
  }

  const channelCountByModel = new Map<string, number>()
  for (const channel of channels) {
    const channelModels = new Set(splitCsv(channel.models))
    for (const modelName of channelModels) {
      channelCountByModel.set(
        modelName,
        (channelCountByModel.get(modelName) ?? 0) + 1
      )
    }
  }

  const modelsByName = new Map<string, RoutingModel>()
  for (const model of pricingModels) {
    modelsByName.set(model.model_name, {
      model_name: model.model_name,
      icon: model.icon,
      vendor_id: model.vendor_id,
      vendor_name: model.vendor_name,
      vendor_icon: model.vendor_icon,
      vendor_description: model.vendor_description,
      channelCount: channelCountByModel.get(model.model_name) ?? 0,
    })
  }

  for (const [modelName, channelCount] of channelCountByModel) {
    if (modelsByName.has(modelName)) continue
    const vendorId = vendorIdByModel.get(modelName)
    const vendor = vendorId ? vendorsById.get(vendorId) : undefined
    modelsByName.set(modelName, {
      model_name: modelName,
      vendor_id: vendorId,
      vendor_name: vendor?.name,
      vendor_icon: vendor?.icon,
      vendor_description: vendor?.description,
      channelCount,
    })
  }

  return {
    models: [...modelsByName.values()],
    vendors: [...vendorsById.values()],
  }
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

export function ModelRoutingWorkbench(props: ModelRoutingWorkbenchProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )
  const canEditRouting = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.WRITE
  )
  // One search above all three columns, in place of the old per-column filters.
  // 'model' matches model names; 'channel' matches channel name or id and then
  // resolves to the models those channels serve.
  const [searchMode, setSearchMode] = useState<RoutingSearchMode>('model')
  const [searchQuery, setSearchQuery] = useState('')
  const [showAllModels, setShowAllModels] = useState(() =>
    readStoredShowAllModels()
  )
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
  const [copyingChannel, setCopyingChannel] = useState<Channel | null>(null)
  const [testingChannel, setTestingChannel] = useState<Channel | null>(null)
  const [isDeletingChannel, setIsDeletingChannel] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [routingOverrideCandidate, setRoutingOverrideCandidate] =
    useState<Channel | null>(null)
  const [isUpdatingRoutingOverride, setIsUpdatingRoutingOverride] =
    useState(false)
  // 'all' clears every override from the header button; a single override comes
  // from the per-override button in the banner list.
  const [restoreRoutingOverrideTarget, setRestoreRoutingOverrideTarget] =
    useState<ModelRoutingOverride | 'all' | null>(null)
  const [providerDefaultSelections, setProviderDefaultSelections] =
    useState<StoredProviderDefaultSelections>(() =>
      readStoredProviderDefaultSelections()
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

  const routingOverrideQuery = useQuery({
    queryKey: channelsQueryKeys.routingOverride(),
    queryFn: async () => {
      const response = await getModelRoutingOverride()
      if (!response.success) {
        throw new Error(
          response.message || t('Failed to load temporary routing mode')
        )
      }
      return normalizeModelRoutingOverrides(response.data)
    },
    staleTime: 10 * 1000,
  })

  const pricingModels = pricingQuery.data?.models ?? EMPTY_PRICING_MODELS
  const pricingVendors = pricingQuery.data?.vendors ?? EMPTY_PRICING_VENDORS
  const modelVendorGroups =
    channelsQuery.data?.modelVendorGroups ?? EMPTY_MODEL_VENDOR_GROUPS

  const routingCatalog = useMemo(
    () =>
      buildRoutingCatalog(
        pricingModels,
        pricingVendors,
        channels,
        modelVendorGroups
      ),
    [channels, modelVendorGroups, pricingModels, pricingVendors]
  )
  const enabledChannelCountsByModel = useMemo(() => {
    const counts = new Map<string, number>()
    for (const channel of channels) {
      if (channel.status !== CHANNEL_STATUS.ENABLED) continue
      for (const modelName of new Set(splitCsv(channel.models))) {
        counts.set(modelName, (counts.get(modelName) ?? 0) + 1)
      }
    }
    return counts
  }, [channels])
  const models = useMemo(() => {
    if (showAllModels) return routingCatalog.models
    return routingCatalog.models.flatMap((model) => {
      const channelCount = enabledChannelCountsByModel.get(model.model_name)
      return channelCount ? [{ ...model, channelCount }] : []
    })
  }, [enabledChannelCountsByModel, routingCatalog.models, showAllModels])
  const vendors = routingCatalog.vendors

  const targetRoutingSelection = useMemo(() => {
    if (!props.targetModelName) return null
    const targetModel = models.find(
      (model) => model.model_name === props.targetModelName
    )
    return targetModel ? getRoutingSelectionFromModel(targetModel) : null
  }, [models, props.targetModelName])

  useEffect(() => {
    if (channelsQuery.data) {
      setChannels(channelsQuery.data.channels)
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

  const trimmedQuery = searchQuery.trim().toLowerCase()
  const isSearching = trimmedQuery !== ''

  // Channel search resolves to models through the channel's model list, so both
  // modes end up expressed as a set of model names.
  const searchMatch = useMemo(() => {
    if (!isSearching) {
      return { modelNames: null, channelIds: null } as {
        modelNames: Set<string> | null
        channelIds: Set<number> | null
      }
    }

    if (searchMode === 'model') {
      const modelNames = new Set<string>()
      for (const model of models) {
        if (model.model_name.toLowerCase().includes(trimmedQuery)) {
          modelNames.add(model.model_name)
        }
      }
      return { modelNames, channelIds: null }
    }

    const channelIds = new Set<number>()
    const servedModels = new Set<string>()
    for (const channel of channels) {
      const matchesName = channel.name?.toLowerCase().includes(trimmedQuery)
      const matchesId = String(channel.id).includes(trimmedQuery)
      if (!matchesName && !matchesId) continue
      channelIds.add(channel.id)
      for (const modelName of splitCsv(channel.models)) {
        servedModels.add(modelName)
      }
    }
    // Intersect with the visible catalog so the model column never lists a name
    // the routing view has no model record for.
    const modelNames = new Set<string>()
    for (const model of models) {
      if (servedModels.has(model.model_name)) modelNames.add(model.model_name)
    }
    return { modelNames, channelIds }
  }, [channels, isSearching, models, searchMode, trimmedQuery])

  const matchedModels = useMemo(() => {
    if (!searchMatch.modelNames) return null
    const matched = searchMatch.modelNames
    return models
      .filter((model) => matched.has(model.model_name))
      .sort((a, b) => a.model_name.localeCompare(b.model_name))
  }, [models, searchMatch])

  // While searching, the provider column narrows to the vendors that own the
  // matches, counted by matches rather than by their whole catalog.
  const visibleProviders = useMemo(() => {
    if (!matchedModels) return providerOptions
    const matchCounts = new Map<string, number>()
    for (const model of matchedModels) {
      const key = getProviderKey(model)
      matchCounts.set(key, (matchCounts.get(key) ?? 0) + 1)
    }
    return providerOptions
      .filter((provider) => matchCounts.has(provider.key))
      .map((provider) => ({
        ...provider,
        modelCount: matchCounts.get(provider.key) ?? 0,
      }))
  }, [matchedModels, providerOptions])

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

  // Searching lists the matches for the selected vendor; the vendor itself is
  // kept in sync with the selected model, so this still reads as one vendor's
  // models rather than a flat cross-vendor list.
  const visibleModels = useMemo(() => {
    if (!matchedModels) return providerModels
    if (!selectedProviderKey) return matchedModels
    return matchedModels.filter(
      (model) => getProviderKey(model) === selectedProviderKey
    )
  }, [matchedModels, providerModels, selectedProviderKey])

  // Matches hidden purely because they have no enabled channel. Without this the
  // search looks broken for a model the user knows exists.
  const hiddenMatchCount = useMemo(() => {
    if (!isSearching || showAllModels) return 0

    // Channel mode dead-ends the same way when a matched channel is itself
    // disabled and its models have no other enabled channel.
    let matchesName: (model: RoutingModel) => boolean
    if (searchMode === 'model') {
      matchesName = (model) =>
        model.model_name.toLowerCase().includes(trimmedQuery)
    } else {
      const servedModels = new Set<string>()
      for (const channel of channels) {
        const nameHit = channel.name?.toLowerCase().includes(trimmedQuery)
        const idHit = String(channel.id).includes(trimmedQuery)
        if (!nameHit && !idHit) continue
        for (const modelName of splitCsv(channel.models)) {
          servedModels.add(modelName)
        }
      }
      matchesName = (model) => servedModels.has(model.model_name)
    }

    let count = 0
    for (const model of routingCatalog.models) {
      if (!matchesName(model)) continue
      if (!enabledChannelCountsByModel.has(model.model_name)) count += 1
    }
    return count
  }, [
    channels,
    enabledChannelCountsByModel,
    isSearching,
    routingCatalog.models,
    searchMode,
    showAllModels,
    trimmedQuery,
  ])

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
    () =>
      targetRoutingSelection ??
      resolveInitialRoutingSelection(models, providerDefaultSelections),
    [models, providerDefaultSelections, targetRoutingSelection]
  )

  const isSelectedDefaultModel = isSameProviderDefaultSelection(
    selectedRoutingSelection,
    providerDefaultSelections
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

  const routingRanks = useMemo(() => {
    const ranks = new Map<number, number>()
    for (const channel of channelsForModel) {
      if (channel.status !== CHANNEL_STATUS.ENABLED) continue
      ranks.set(channel.id, ranks.size + 1)
    }
    return ranks
  }, [channelsForModel])
  const enabledChannelCount = routingRanks.size
  const disabledChannelCount = channelsForModel.length - enabledChannelCount
  const routingOverrides: ModelRoutingOverride[] =
    routingOverrideQuery.data ?? []
  const isRoutingOverrideTarget = (channelId: number) =>
    routingOverrides.some((override) => override.channel_id === channelId)

  const isLoading =
    pricingQuery.isLoading ||
    channelsQuery.isLoading ||
    routingOverrideQuery.isLoading
  const isFetching = pricingQuery.isFetching || channelsQuery.isFetching
  const changedCount = getChangedCount(routingChanges)
  let createChannelButtonTitle: string | undefined
  if (!canEditSensitive) {
    createChannelButtonTitle = t('No permission to perform this action')
  } else if (!selectedModel) {
    createChannelButtonTitle = t('Select a model')
  }

  useEffect(() => {
    if (!targetRoutingSelection) return
    setSelectedProviderKey(targetRoutingSelection.providerKey)
    setSelectedModelName(targetRoutingSelection.modelName)
  }, [targetRoutingSelection])

  // Jump to the first match, unless the current selection is already one of
  // them. Provider and model move together: the fallback effects below replace
  // any model that is not in the selected provider's list, which would undo a
  // cross-vendor jump made one state at a time.
  useEffect(() => {
    if (!matchedModels) return
    if (matchedModels.length === 0) return
    if (
      selectedModelName &&
      matchedModels.some((model) => model.model_name === selectedModelName)
    ) {
      return
    }
    const [first] = matchedModels
    setSelectedProviderKey(getProviderKey(first))
    setSelectedModelName(first.model_name)
  }, [matchedModels, selectedModelName])

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
    const providerDefaultModel = findProviderDefaultModel(
      providerModels,
      providerDefaultSelections,
      selectedProviderKey
    )
    setSelectedModelName(
      initialModel?.model_name ??
        providerDefaultModel?.model_name ??
        providerModels[0]?.model_name ??
        null
    )
  }, [
    initialRoutingSelection,
    providerDefaultSelections,
    providerModels,
    selectedModelName,
    selectedProviderKey,
  ])

  useEffect(() => {
    if (!selectedRoutingSelection) return
    writeStoredProviderKey(
      ROUTING_LAST_PROVIDER_KEY,
      selectedRoutingSelection.providerKey
    )
    writeStoredRoutingSelection(
      ROUTING_LAST_SELECTION_KEY,
      selectedRoutingSelection
    )
  }, [selectedRoutingSelection])

  useEffect(() => {
    if (!props.targetChannelId) return
    if (props.targetModelName && selectedModelName !== props.targetModelName) {
      return
    }
    if (
      !channelsForModel.some((channel) => channel.id === props.targetChannelId)
    ) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector(`#routing-channel-${props.targetChannelId}`)
        ?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    channelsForModel,
    props.targetChannelId,
    props.targetModelName,
    selectedModelName,
  ])

  const refreshRoutingData = useCallback(async () => {
    await Promise.all([
      pricingQuery.refetch(),
      channelsQuery.refetch(),
      routingOverrideQuery.refetch(),
    ])
  }, [channelsQuery, pricingQuery, routingOverrideQuery])

  const handleProviderSelect = (providerKey: string) => {
    setSelectedProviderKey(providerKey)
    setSelectedModelName(null)
  }

  // Provider and model move together: the fallback effect drops any model that
  // is not in the selected provider's list, so a match from another vendor has
  // to bring its vendor along.
  const handleModelSelect = (model: RoutingModel) => {
    setSelectedProviderKey(getProviderKey(model))
    setSelectedModelName(model.model_name)
  }

  const handleShowAllModelsChange = (checked: boolean) => {
    setShowAllModels(checked)
    writeStoredShowAllModels(checked)
  }

  const handleSetDefaultModel = () => {
    if (!selectedRoutingSelection) return
    const nextProviderDefaults = {
      ...providerDefaultSelections,
      [selectedRoutingSelection.providerKey]:
        selectedRoutingSelection.modelName,
    }
    writeStoredProviderDefaultSelections(nextProviderDefaults)
    writeStoredProviderKey(
      ROUTING_LAST_PROVIDER_KEY,
      selectedRoutingSelection.providerKey
    )
    writeStoredRoutingSelection(
      ROUTING_DEFAULT_SELECTION_KEY,
      selectedRoutingSelection
    )
    setProviderDefaultSelections(nextProviderDefaults)
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

  const openUsageLogs = (modelName: string, channelId?: number) => {
    const searchParams = new URLSearchParams({ model: modelName })
    if (channelId !== undefined) {
      searchParams.set('channel', String(channelId))
    }
    window.open(
      `/usage-logs/common?${searchParams.toString()}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  const handleChannelEditorOpenChange = (open: boolean) => {
    setChannelEditorOpen(open)
    if (open) return
    setEditingChannel(null)
    void channelsQuery.refetch()
    void pricingQuery.refetch()
    void queryClient.invalidateQueries({
      queryKey: channelsQueryKeys.routingOverride(),
    })
  }

  const handleDeleteDialogOpenChange = (open: boolean) => {
    if (open || isDeletingChannel) return
    setDeletingChannel(null)
  }

  const handleCopyDialogOpenChange = (open: boolean) => {
    if (open) return
    setCopyingChannel(null)
    // A copy is a new channel, so the routing table has to pick it up.
    void channelsQuery.refetch()
  }

  const handleRoutingOverrideDialogOpenChange = (open: boolean) => {
    if (open || isUpdatingRoutingOverride) return
    setRoutingOverrideCandidate(null)
  }

  const handleConfirmRoutingOverride = async () => {
    if (!routingOverrideCandidate) return

    setIsUpdatingRoutingOverride(true)
    try {
      const isActive = isRoutingOverrideTarget(routingOverrideCandidate.id)
      const response = isActive
        ? await deleteModelRoutingOverride(routingOverrideCandidate.id)
        : await setModelRoutingOverride(routingOverrideCandidate.id)
      if (!response.success) {
        throw new Error(
          response.message || t('Failed to update temporary routing mode')
        )
      }
      queryClient.setQueryData(
        channelsQueryKeys.routingOverride(),
        normalizeModelRoutingOverrides(response.data)
      )
      setRoutingOverrideCandidate(null)
      toast.success(
        isActive
          ? t('Normal routing restored')
          : t('Temporary single-channel mode enabled')
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to update temporary routing mode')
      )
    } finally {
      setIsUpdatingRoutingOverride(false)
    }
  }

  const handleRestoreRoutingOverride = async () => {
    const target = restoreRoutingOverrideTarget
    if (!target) return

    setIsUpdatingRoutingOverride(true)
    try {
      const response = await deleteModelRoutingOverride(
        target === 'all' ? undefined : target.channel_id
      )
      if (!response.success) {
        throw new Error(
          response.message || t('Failed to update temporary routing mode')
        )
      }
      queryClient.setQueryData(
        channelsQueryKeys.routingOverride(),
        normalizeModelRoutingOverrides(response.data)
      )
      setRestoreRoutingOverrideTarget(null)
      toast.success(t('Normal routing restored'))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to update temporary routing mode')
      )
    } finally {
      setIsUpdatingRoutingOverride(false)
    }
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
      const channelChanges = { ...next[channel.id] }

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
        await queryClient.invalidateQueries({
          queryKey: channelsQueryKeys.routingOverride(),
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
      await queryClient.invalidateQueries({
        queryKey: channelsQueryKeys.routingOverride(),
      })
      toast.success(t(SUCCESS_MESSAGES.DELETED))
      setDeletingChannel(null)
    } catch {
      toast.error(t(ERROR_MESSAGES.DELETE_FAILED))
    } finally {
      setIsDeletingChannel(false)
    }
  }

  // Picking another model would silently re-scope an open dialog, so close it.
  useEffect(() => {
    setTestingChannel(null)
  }, [selectedModelName])

  const handleTestDialogOpenChange = (open: boolean) => {
    if (open) return
    setTestingChannel(null)
    // The dialog writes response_time / test_time into the channel caches.
    void queryClient.invalidateQueries({
      queryKey: ['model-routing', 'channels'],
    })
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

      {/* One search across all three columns. Model mode matches model names;
          channel mode matches a channel and resolves to the models it serves. */}
      <div className='flex flex-wrap items-center gap-2'>
        <Tabs
          value={searchMode}
          onValueChange={(value) => setSearchMode(value as RoutingSearchMode)}
        >
          <TabsList>
            <TabsTrigger value='model'>{t('By model')}</TabsTrigger>
            <TabsTrigger value='channel'>{t('By channel')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='relative min-w-0 flex-1 sm:max-w-sm'>
          <Search className='text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4' />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={
              searchMode === 'model'
                ? t('Search all models...')
                : t('Search channels by name or ID...')
            }
            className='pl-8'
            aria-label={
              searchMode === 'model'
                ? t('Search all models...')
                : t('Search channels by name or ID...')
            }
          />
        </div>
        {isSearching ? (
          <>
            <span className='text-muted-foreground text-xs tabular-nums'>
              {t('{{count}} matched model(s)', {
                count: matchedModels?.length ?? 0,
              })}
            </span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setSearchQuery('')}
            >
              {t('Clear')}
            </Button>
          </>
        ) : null}
      </div>

      <div className='grid min-h-0 flex-1 gap-3 lg:grid-cols-[17rem_20rem_minmax(0,1fr)]'>
        <section className='bg-background flex min-h-[24rem] min-w-0 flex-col overflow-hidden rounded-lg border'>
          <div className='border-b p-3'>
            <div className='flex items-center justify-between gap-2 text-sm font-medium'>
              <span>{t('Vendors')}</span>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {visibleProviders.length}
              </span>
            </div>
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            {isLoading && <LoadingState />}
            {!isLoading && visibleProviders.length === 0 && (
              <EmptyState title={t('No vendors found')} />
            )}
            {!isLoading && visibleProviders.length > 0 && (
              <div className='space-y-1 p-2'>
                {visibleProviders.map((provider) => (
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
              <div className='flex shrink-0 items-center gap-2'>
                <span className='text-muted-foreground text-xs'>
                  {t(showAllModels ? 'All Models' : 'Enabled')}
                </span>
                <Switch
                  size='sm'
                  checked={showAllModels}
                  onCheckedChange={handleShowAllModelsChange}
                  aria-label={t('All Models')}
                />
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {visibleModels.length}
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
            </div>
            {/* Matches excluded only by the enabled-channel filter, with the way
                to reveal them, so a search for a known model is not just empty. */}
            {hiddenMatchCount > 0 ? (
              <button
                type='button'
                onClick={() => handleShowAllModelsChange(true)}
                className='text-muted-foreground hover:text-foreground mt-2 text-left text-xs underline-offset-2 hover:underline'
              >
                {t(
                  '{{count}} matched model(s) have no enabled channel. Show all models.',
                  { count: hiddenMatchCount }
                )}
              </button>
            ) : null}
          </div>
          <ScrollArea className='min-h-0 flex-1'>
            {isLoading && <LoadingState />}
            {!isLoading && visibleModels.length === 0 && (
              <EmptyState title={t('No models found')} />
            )}
            {!isLoading && visibleModels.length > 0 && (
              <div className='space-y-1 p-2'>
                {visibleModels.map((model) => {
                  const isSelected = selectedModelName === model.model_name

                  return (
                    <div
                      key={model.model_name}
                      className={cn(
                        'flex w-full min-w-0 items-center rounded-md transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      <button
                        type='button'
                        onClick={() => handleModelSelect(model)}
                        className='flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm'
                      >
                        <span className='bg-muted/40 flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full'>
                          {model.icon || model.vendor_icon ? (
                            getLobeIcon(model.icon || model.vendor_icon, 16)
                          ) : (
                            <span
                              className={cn(
                                'text-[10px] font-semibold',
                                isSelected
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
                      </button>
                      <div className='flex shrink-0 items-center gap-1 pr-1'>
                        <CopyButton
                          value={model.model_name}
                          size='icon'
                          tooltip={t('Copy model name')}
                          className={cn(
                            'size-7',
                            isSelected &&
                              'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground'
                          )}
                          iconClassName='size-3.5'
                        />
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            isSelected
                              ? 'text-primary-foreground/80'
                              : 'text-muted-foreground'
                          )}
                        >
                          {model.channelCount}
                        </span>
                        <TooltipProvider delay={100}>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon-sm'
                                  className={cn(
                                    'shrink-0',
                                    isSelected &&
                                      'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground'
                                  )}
                                  title={t('Open usage logs')}
                                  aria-label={`${t('Open usage logs')}: ${model.model_name}`}
                                  onClick={() =>
                                    openUsageLogs(model.model_name)
                                  }
                                />
                              }
                            >
                              <HugeiconsIcon
                                icon={Analytics02Icon}
                                strokeWidth={2}
                              />
                            </TooltipTrigger>
                            <TooltipContent side='top'>
                              {t('Open usage logs')}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  )
                })}
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
            <div className='flex shrink-0 items-center gap-2'>
              {routingOverrides.length > 0 ? (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setRestoreRoutingOverrideTarget('all')}
                  disabled={!canEditRouting || isUpdatingRoutingOverride}
                >
                  <HugeiconsIcon icon={UndoIcon} data-icon='inline-start' />
                  <span className='max-sm:hidden'>
                    {t('Restore normal routing')}
                  </span>
                </Button>
              ) : null}
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={openChannelCreator}
                disabled={!selectedModel || !canEditSensitive}
                title={createChannelButtonTitle}
                aria-label={t('Create Channel')}
              >
                <Plus data-icon='inline-start' />
                <span className='max-sm:hidden'>{t('Create Channel')}</span>
              </Button>
            </div>
          </div>

          {routingOverrides.length > 0 ? (
            <div className='bg-muted/30 space-y-2 border-b px-3 py-2 text-sm'>
              {routingOverrides.map((routingOverride) => {
                const overrideLabel =
                  routingOverride.channel_name ||
                  `#${routingOverride.channel_id}`
                return (
                  <div
                    key={routingOverride.channel_id}
                    className='flex items-start gap-2'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                        <StatusBadge
                          label={t('Temporary single-channel mode')}
                          variant='warning'
                          size='sm'
                          copyable={false}
                        />
                        <span className='min-w-0 truncate font-medium'>
                          {overrideLabel}
                        </span>
                        <span className='text-muted-foreground font-mono text-xs'>
                          ID:{routingOverride.channel_id}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          {t('{{count}} covered model(s)', {
                            count: routingOverride.model_count,
                          })}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          {t('Covered groups')}:{' '}
                          {routingOverride.groups.join(', ')}
                        </span>
                      </div>
                      <div className='text-muted-foreground mt-1 text-xs'>
                        {t(
                          'Automatic requests for every covered model use only this channel. Requests that explicitly specify a channel are unaffected.'
                        )}
                      </div>
                    </div>
                    {/* Per-override restore: the header button clears every
                        override at once, and a channel that does not serve the
                        selected model has no table row to act on. */}
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className='shrink-0'
                      title={t('Restore normal routing')}
                      aria-label={`${t('Restore normal routing')}: ${overrideLabel}`}
                      disabled={!canEditRouting || isUpdatingRoutingOverride}
                      onClick={() =>
                        setRestoreRoutingOverrideTarget(routingOverride)
                      }
                    >
                      <HugeiconsIcon icon={UndoIcon} />
                    </Button>
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className='min-h-0 flex-1 overflow-auto'>
            {isLoading && <LoadingState />}
            {!isLoading && !selectedModel && (
              <EmptyState title={t('Select a model')} />
            )}
            {!isLoading && selectedModel && channelsForModel.length === 0 && (
              <EmptyState title={t('No channels support this model')} />
            )}
            {!isLoading && selectedModel && channelsForModel.length > 0 && (
              <Table className='min-w-[62rem] table-fixed'>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-80'>{t('Channel')}</TableHead>
                    <TableHead className='w-52'>{t('Actions')}</TableHead>
                    <TableHead className='w-28'>{t('Type')}</TableHead>
                    <TableHead className='w-36'>{t('Status')}</TableHead>
                    <TableHead className='bg-background sticky right-0 w-52'>
                      <div className='grid grid-cols-2 gap-2'>
                        <span>{t('Priority')}</span>
                        <span>{t('Weight')}</span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enabledChannelCount > 0 ? (
                    <TableRow className='bg-muted/20 hover:bg-muted/20'>
                      <TableCell colSpan={5} className='py-2'>
                        <div className='flex items-center gap-2'>
                          <StatusBadge
                            label={t('Participating in routing')}
                            variant='success'
                            size='sm'
                            copyable={false}
                          />
                          <span className='text-muted-foreground text-xs tabular-nums'>
                            {enabledChannelCount}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {channelsForModel.flatMap((channel, index) => {
                    const isEnabled = channel.status === CHANNEL_STATUS.ENABLED
                    const isStatusUpdating = Boolean(
                      statusUpdatingIds[channel.id]
                    )
                    const routingRank = routingRanks.get(channel.id)
                    const routeRoleIndex =
                      routingRank === undefined ? -1 : routingRank - 1
                    const routeRoleLabelKey =
                      routeRoleIndex >= 0 &&
                      routeRoleIndex < ROUTING_ROLE_LABEL_KEYS.length
                        ? ROUTING_ROLE_LABEL_KEYS[routeRoleIndex]
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
                    const isFirstDisabled =
                      !isEnabled && index === enabledChannelCount
                    let autoDisableReason = ''
                    let autoDisableTime = ''
                    if (channel.status === CHANNEL_STATUS.AUTO_DISABLED) {
                      try {
                        const otherInfo = channel.other_info
                          ? JSON.parse(channel.other_info)
                          : null
                        if (otherInfo) {
                          autoDisableReason = otherInfo.status_reason || ''
                          autoDisableTime = otherInfo.status_time
                            ? formatTimestampToDate(otherInfo.status_time)
                            : ''
                        }
                      } catch {
                        /* Keep the status usable when legacy metadata is invalid. */
                      }
                    }
                    const showAutoDisableDetails = Boolean(
                      autoDisableReason || autoDisableTime
                    )
                    const channelStatusBadge = (
                      <StatusBadge
                        label={t(statusConfig.label)}
                        variant={statusConfig.variant}
                        copyable={false}
                        className='min-w-0 shrink-0'
                      />
                    )
                    const channelStatusBadgeWithDetails =
                      showAutoDisableDetails ? (
                        <TooltipProvider delay={100}>
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className='min-w-0 shrink-0' />}
                            >
                              {channelStatusBadge}
                            </TooltipTrigger>
                            <TooltipContent side='top' className='max-w-xs'>
                              <div className='space-y-1 text-xs'>
                                {autoDisableReason ? (
                                  <div>
                                    {t('Reason:')} {autoDisableReason}
                                  </div>
                                ) : null}
                                {autoDisableTime ? (
                                  <div>
                                    {t('Time:')} {autoDisableTime}
                                  </div>
                                ) : null}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        channelStatusBadge
                      )

                    return [
                      ...(isFirstDisabled
                        ? [
                            <TableRow
                              key='disabled-routing-channels'
                              className='bg-muted/40 hover:bg-muted/40'
                            >
                              <TableCell colSpan={5} className='py-2'>
                                <div className='flex items-center gap-2'>
                                  <StatusBadge
                                    label={t('Not participating in routing')}
                                    variant='warning'
                                    size='sm'
                                    copyable={false}
                                  />
                                  <span className='text-muted-foreground text-xs tabular-nums'>
                                    {disabledChannelCount}
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>,
                          ]
                        : []),
                      <TableRow
                        key={channel.id}
                        id={`routing-channel-${channel.id}`}
                        className={cn(
                          channel.status === CHANNEL_STATUS.MANUAL_DISABLED &&
                            'bg-destructive/5 hover:bg-destructive/10',
                          channel.status === CHANNEL_STATUS.AUTO_DISABLED &&
                            'bg-warning/5 hover:bg-warning/10',
                          !isEnabled &&
                            channel.status !== CHANNEL_STATUS.MANUAL_DISABLED &&
                            channel.status !== CHANNEL_STATUS.AUTO_DISABLED &&
                            'bg-muted/40 hover:bg-muted/50',
                          // A channel-mode search keeps every channel serving
                          // the model, so the ones it matched are marked to stay
                          // findable among them.
                          (props.targetChannelId === channel.id ||
                            searchMatch.channelIds?.has(channel.id)) &&
                            'bg-warning/10 ring-warning/40 ring-1 ring-inset'
                        )}
                      >
                        <TableCell
                          className={cn(
                            'w-80 max-w-80 border-l-4 border-l-transparent',
                            channel.status === CHANNEL_STATUS.MANUAL_DISABLED &&
                              'border-l-destructive',
                            channel.status === CHANNEL_STATUS.AUTO_DISABLED &&
                              'border-l-warning',
                            !isEnabled &&
                              channel.status !==
                                CHANNEL_STATUS.MANUAL_DISABLED &&
                              channel.status !== CHANNEL_STATUS.AUTO_DISABLED &&
                              'border-l-border'
                          )}
                        >
                          {/* Two lines: the name owns the first one so long
                              channel names stay readable, while rank, id, role
                              and group sit together on a compact second line. */}
                          <div className='flex min-w-0 flex-col gap-1'>
                            <div className='flex min-w-0 items-center gap-2'>
                              <div className='min-w-0 flex-1'>
                                <HoverCard>
                                  <HoverCardTrigger
                                    render={
                                      <div
                                        className={cn(
                                          '-my-1 block min-w-0 cursor-help truncate py-1 font-medium',
                                          !isEnabled && 'text-muted-foreground'
                                        )}
                                      />
                                    }
                                    delay={CHANNEL_REMARK_HOVER_DELAY}
                                    closeDelay={CHANNEL_REMARK_CLOSE_DELAY}
                                  >
                                    {channel.name}
                                  </HoverCardTrigger>
                                  <ChannelRemarkHoverContent side='top'>
                                    <div className='font-medium break-words'>
                                      {channel.name}
                                    </div>
                                    {channelRemark ? (
                                      <div className='mt-2 border-t pt-2'>
                                        <ChannelRemarkText
                                          text={channelRemark}
                                        />
                                      </div>
                                    ) : null}
                                  </ChannelRemarkHoverContent>
                                </HoverCard>
                              </div>
                              {!isEnabled
                                ? channelStatusBadgeWithDetails
                                : null}
                            </div>
                            <div className='flex min-w-0 items-center gap-1'>
                              <StatusBadge
                                label={
                                  routingRank === undefined
                                    ? '—'
                                    : `#${routingRank}`
                                }
                                variant='neutral'
                                size='sm'
                                copyable={false}
                                className='w-9 shrink-0 justify-center'
                              />
                              {/* channelId alone is ignored by the channels
                                  table unless the global filter matches it,
                                  so send both. */}
                              <Link
                                to='/channels'
                                search={{
                                  channelId: channel.id,
                                  filter: String(channel.id),
                                }}
                                className='text-muted-foreground hover:text-foreground shrink-0 font-mono text-xs underline-offset-2 hover:underline'
                                title={t('Open in channel list')}
                                aria-label={`${t('Open in channel list')}: ${channel.name}`}
                              >
                                ID:{channel.id}
                              </Link>
                              {routeRoleLabelKey ? (
                                <StatusBadge
                                  label={t(routeRoleLabelKey)}
                                  variant={
                                    ROUTING_ROLE_VARIANTS[routeRoleIndex]
                                  }
                                  size='sm'
                                  copyable={false}
                                  className='shrink-0 justify-center'
                                />
                              ) : null}
                              <span
                                className='text-muted-foreground truncate text-xs'
                                title={channel.group}
                              >
                                {channel.group}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className='w-52'>
                          <div className='flex items-center gap-1'>
                            <TooltipProvider delay={100}>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='icon-sm'
                                      className='shrink-0'
                                      title={t('Open usage logs')}
                                      aria-label={`${t('Open usage logs')}: ${channel.name}`}
                                      onClick={() => {
                                        if (!selectedModelName) return
                                        openUsageLogs(
                                          selectedModelName,
                                          channel.id
                                        )
                                      }}
                                    />
                                  }
                                >
                                  <HugeiconsIcon
                                    icon={Analytics02Icon}
                                    strokeWidth={2}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side='top'>
                                  {t('Open usage logs')}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider delay={100}>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type='button'
                                      variant='ghost'
                                      size='icon-sm'
                                      className={cn(
                                        'shrink-0',
                                        isRoutingOverrideTarget(channel.id) &&
                                          'text-warning'
                                      )}
                                      title={t(
                                        'Use this channel temporarily for all models'
                                      )}
                                      aria-label={`${t('Use this channel temporarily for all models')}: ${channel.name}`}
                                      disabled={
                                        !canEditRouting ||
                                        (!isEnabled &&
                                          !isRoutingOverrideTarget(channel.id)) ||
                                        isUpdatingRoutingOverride
                                      }
                                      onClick={() =>
                                        setRoutingOverrideCandidate(channel)
                                      }
                                    />
                                  }
                                >
                                  <HugeiconsIcon
                                    icon={LockIcon}
                                    strokeWidth={2}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side='top'>
                                  {isRoutingOverrideTarget(channel.id)
                                    ? t('Temporary routing target')
                                    : t(
                                        'Use this channel temporarily for all models'
                                      )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon-sm'
                              className='shrink-0'
                              title={t('Test Connection')}
                              aria-label={`${t('Test Connection')}: ${channel.name}`}
                              disabled={!selectedModelName}
                              onClick={() => setTestingChannel(channel)}
                            >
                              <Gauge className='size-4' />
                            </Button>
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
                            {canEditSensitive && (
                              <Button
                                type='button'
                                variant='ghost'
                                size='icon-sm'
                                className='shrink-0'
                                title={t('Copy Channel')}
                                aria-label={`${t('Copy Channel')}: ${channel.name}`}
                                onClick={() => setCopyingChannel(channel)}
                              >
                                <Copy className='size-4' />
                              </Button>
                            )}
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
                            {channelStatusBadgeWithDetails}
                          </div>
                        </TableCell>
                        <TableCell className='bg-background sticky right-0 w-52 p-0'>
                          {/* Keep the pinned column opaque and in sync with the
                              row tint so scrolled columns do not show through. */}
                          <div
                            className={cn(
                              'grid grid-cols-2 gap-2 p-2',
                              channel.status ===
                                CHANNEL_STATUS.MANUAL_DISABLED &&
                                'bg-destructive/5 hover:bg-destructive/10',
                              channel.status === CHANNEL_STATUS.AUTO_DISABLED &&
                                'bg-warning/5 hover:bg-warning/10',
                              !isEnabled &&
                                channel.status !==
                                  CHANNEL_STATUS.MANUAL_DISABLED &&
                                channel.status !==
                                  CHANNEL_STATUS.AUTO_DISABLED &&
                                'bg-muted/40 hover:bg-muted/50',
                              props.targetChannelId === channel.id &&
                                'bg-warning/10',
                              channel.status === CHANNEL_STATUS.ENABLED &&
                                props.targetChannelId !== channel.id &&
                                'hover:bg-muted/50'
                            )}
                          >
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
                      </TableRow>,
                    ]
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
        <CopyChannelDialog
          open={copyingChannel !== null}
          currentRow={copyingChannel}
          onOpenChange={handleCopyDialogOpenChange}
        />
        {/* Scoped to the routed model, so the table holds one row instead of
            the channel's whole model list. */}
        <ChannelTestDialog
          open={testingChannel !== null}
          currentRow={testingChannel}
          restrictToModels={selectedModelName ? [selectedModelName] : []}
          onOpenChange={handleTestDialogOpenChange}
        />
      </ChannelsProvider>
      <ConfirmDialog
        open={routingOverrideCandidate !== null}
        onOpenChange={handleRoutingOverrideDialogOpenChange}
        title={
          routingOverrideCandidate &&
          isRoutingOverrideTarget(routingOverrideCandidate.id)
            ? t('Restore normal routing?')
            : t('Enable temporary single-channel mode?')
        }
        desc={
          routingOverrideCandidate &&
          isRoutingOverrideTarget(routingOverrideCandidate.id)
            ? t(
                'The temporary routing rule for channel "{{channel}}" and its models will be removed. Existing channel statuses, priorities, weights, and affinity data will remain unchanged.',
                { channel: routingOverrideCandidate?.name ?? '' }
              )
            : t(
                'All enabled models on channel "{{channel}}" will temporarily use only this channel in its supported groups. Explicit channel selection is unaffected.',
                { channel: routingOverrideCandidate?.name ?? '' }
              )
        }
        confirmText={
          routingOverrideCandidate &&
          isRoutingOverrideTarget(routingOverrideCandidate.id)
            ? t('Restore normal routing')
            : t('Enable temporary mode')
        }
        isLoading={isUpdatingRoutingOverride}
        handleConfirm={handleConfirmRoutingOverride}
      />
      <ConfirmDialog
        open={restoreRoutingOverrideTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isUpdatingRoutingOverride)
            setRestoreRoutingOverrideTarget(null)
        }}
        title={t('Restore normal routing?')}
        desc={
          restoreRoutingOverrideTarget === 'all'
            ? t(
                'All temporary routing rules for channel "{{channel}}" and its models will be removed. Existing channel statuses, priorities, weights, and affinity data will remain unchanged.',
                {
                  channel: routingOverrides
                    .map(
                      (override) =>
                        override.channel_name || `#${override.channel_id}`
                    )
                    .join(', '),
                }
              )
            : t(
                'The temporary routing rule for channel "{{channel}}" and its models will be removed. Existing channel statuses, priorities, weights, and affinity data will remain unchanged.',
                {
                  channel:
                    restoreRoutingOverrideTarget === null
                      ? ''
                      : restoreRoutingOverrideTarget.channel_name ||
                        `#${restoreRoutingOverrideTarget.channel_id}`,
                }
              )
        }
        confirmText={t('Restore normal routing')}
        isLoading={isUpdatingRoutingOverride}
        handleConfirm={handleRestoreRoutingOverride}
      />
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
