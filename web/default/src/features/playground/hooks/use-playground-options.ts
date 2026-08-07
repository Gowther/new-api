import { useQuery } from '@tanstack/react-query'
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
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getUserGroups, getUserModelChannels, getUserModels } from '../api'
import {
  getGroupFallback,
  getModelFallback,
  getOptionLoadErrorMessage,
  shouldClearModelForGroup,
} from '../lib'
import type {
  ChannelOption,
  GroupOption,
  ModelOption,
  PlaygroundConfig,
} from '../types'

type UsePlaygroundOptionsParams = {
  currentGroup: string
  currentModel: string
  currentChannelId: number | null
  setGroups: (groups: GroupOption[]) => void
  setModels: (models: ModelOption[]) => void
  setChannels: (channels: ChannelOption[]) => void
  updateConfig: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
}

export function usePlaygroundOptions({
  currentGroup,
  currentModel,
  currentChannelId,
  setGroups,
  setModels,
  setChannels,
  updateConfig,
}: UsePlaygroundOptionsParams) {
  const { t } = useTranslation()
  const initialChannelSelectionRef = useRef(
    currentChannelId === null
      ? null
      : {
          group: currentGroup,
          model: currentModel,
          channelId: currentChannelId,
        }
  )

  const {
    data: modelsData,
    error: modelsError,
    isError: isModelsError,
    isLoading: isLoadingModels,
  } = useQuery({
    queryKey: ['playground-models', currentGroup],
    queryFn: () => getUserModels(currentGroup),
    enabled: currentGroup !== '',
  })

  const {
    data: channelsData,
    error: channelsError,
    isError: isChannelsError,
  } = useQuery({
    queryKey: ['playground-model-channels', currentGroup, currentModel],
    queryFn: () => getUserModelChannels(currentGroup, currentModel),
    enabled: currentGroup !== '' && currentModel !== '',
  })

  const {
    data: groupsData,
    error: groupsError,
    isError: isGroupsError,
  } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: getUserGroups,
  })

  useEffect(() => {
    if (!isModelsError) return

    toast.error(
      getOptionLoadErrorMessage(
        modelsError,
        t('Failed to load playground models')
      )
    )
  }, [isModelsError, modelsError, t])

  useEffect(() => {
    if (!isGroupsError) return

    toast.error(
      getOptionLoadErrorMessage(
        groupsError,
        t('Failed to load playground groups')
      )
    )
  }, [isGroupsError, groupsError, t])

  useEffect(() => {
    if (!isChannelsError) return

    toast.error(
      getOptionLoadErrorMessage(
        channelsError,
        t('Failed to load playground channels')
      )
    )
  }, [isChannelsError, channelsError, t])

  useEffect(() => {
    if (!modelsData) return

    setModels(modelsData)
    const fallback = getModelFallback(modelsData, currentModel)

    if (fallback) {
      updateConfig('model', fallback)
      return
    }

    if (shouldClearModelForGroup(modelsData, currentModel)) {
      updateConfig('model', '')
    }
  }, [modelsData, currentModel, setModels, updateConfig])

  useEffect(() => {
    if (!groupsData) return

    setGroups(groupsData)
    const fallback = getGroupFallback(groupsData, currentGroup)

    if (fallback) {
      updateConfig('group', fallback)
    }
  }, [groupsData, currentGroup, setGroups, updateConfig])

  useEffect(() => {
    setChannels([])
    updateConfig('channelId', null)

    const initialSelection = initialChannelSelectionRef.current
    if (
      initialSelection &&
      (initialSelection.group !== currentGroup ||
        initialSelection.model !== currentModel)
    ) {
      initialChannelSelectionRef.current = null
    }
  }, [currentGroup, currentModel, setChannels, updateConfig])

  useEffect(() => {
    if (!channelsData) return

    setChannels(channelsData)
    const initialSelection = initialChannelSelectionRef.current
    initialChannelSelectionRef.current = null
    if (
      initialSelection?.group === currentGroup &&
      initialSelection.model === currentModel &&
      channelsData.some((channel) => channel.id === initialSelection.channelId)
    ) {
      updateConfig('channelId', initialSelection.channelId)
      return
    }

    if (
      channelsData.every((channel) => channel.id !== currentChannelId) &&
      currentChannelId !== null
    ) {
      updateConfig('channelId', null)
    }
  }, [
    channelsData,
    currentChannelId,
    currentGroup,
    currentModel,
    setChannels,
    updateConfig,
  ])

  return {
    isLoadingModels,
  }
}
