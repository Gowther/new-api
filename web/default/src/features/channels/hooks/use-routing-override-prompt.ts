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
import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  deleteModelRoutingOverride,
  getModelRoutingOverrideConflicts,
  normalizeModelRoutingOverrides,
  setModelRoutingOverride,
  type ModelRoutingOverrideConflict,
} from '../api'
import { channelsQueryKeys } from '../lib'

/** The channel a prompt is open for, and whether it is already pinned. */
export type RoutingOverridePromptTarget = {
  id: number
  name: string
  /** Already a temporary target, so confirming restores normal routing. */
  isActive: boolean
}

/**
 * Drives the confirm-before-replacing flow for temporary single-channel mode.
 *
 * Enabling a channel whose models are already pinned elsewhere has to release
 * those channels first. Rather than letting the write fail, the prompt runs a
 * preflight so the operator sees which targets they are about to give up, and
 * confirming sends that decision along.
 */
export function useRoutingOverridePrompt() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<RoutingOverridePromptTarget | null>(null)
  const [conflicts, setConflicts] = useState<ModelRoutingOverrideConflict[]>([])
  const [isChecking, setIsChecking] = useState(false)
  // A channel that cannot host temporary routing at all (disabled, no enabled
  // abilities) fails the preflight; block confirm instead of letting the write
  // repeat the same rejection.
  const [blockedReason, setBlockedReason] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const open = useCallback((next: RoutingOverridePromptTarget) => {
    setTarget(next)
    setConflicts([])
    setBlockedReason(null)
  }, [])

  const close = useCallback(() => {
    setTarget(null)
    setConflicts([])
    setBlockedReason(null)
  }, [])

  const channelId = target?.id ?? null
  const needsPreflight = target !== null && !target.isActive

  // Restoring cannot conflict, so only enabling pays for the preflight.
  useEffect(() => {
    if (!needsPreflight || channelId === null) return

    let cancelled = false
    setIsChecking(true)
    void getModelRoutingOverrideConflicts(channelId)
      .then((response) => {
        if (cancelled) return
        if (!response.success) {
          setBlockedReason(
            response.message || t('Failed to update temporary routing mode')
          )
          return
        }
        setConflicts(response.data ?? [])
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBlockedReason(
          error instanceof Error
            ? error.message
            : t('Failed to update temporary routing mode')
        )
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [channelId, needsPreflight, t])

  const confirm = useCallback(async () => {
    if (!target) return

    setIsSubmitting(true)
    try {
      const response = target.isActive
        ? await deleteModelRoutingOverride(target.id)
        : await setModelRoutingOverride(target.id, conflicts.length > 0)
      if (!response.success) {
        // A conflict that appears between the preflight and the write keeps the
        // prompt open with the newly reported targets to confirm. Only the
        // enable path can report them; a restore never conflicts.
        const lateConflicts = response.conflicts ?? []
        if (lateConflicts.length > 0) {
          setConflicts(lateConflicts)
          return
        }
        throw new Error(
          response.message || t('Failed to update temporary routing mode')
        )
      }
      queryClient.setQueryData(
        channelsQueryKeys.routingOverride(),
        normalizeModelRoutingOverrides(response.data)
      )
      toast.success(
        target.isActive
          ? t('Normal routing restored')
          : t('Temporary single-channel mode enabled')
      )
      close()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('Failed to update temporary routing mode')
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [close, conflicts.length, queryClient, t, target])

  return {
    target,
    conflicts,
    isChecking,
    blockedReason,
    isSubmitting,
    open,
    close,
    confirm,
  }
}
