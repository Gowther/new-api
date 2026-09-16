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
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Where a freshly created channel lands: true = model routing, false = the
 *  channel list. Toggled next to "Temporary single-channel mode" in the create
 *  drawer; every caller reads it fresh at creation time. */
export const CHANNEL_CREATE_FOLLOW_TARGET_KEY = 'channel_create_follow_routing'

export const readStoredFollowRouting = () => {
  try {
    return (
      window.localStorage.getItem(CHANNEL_CREATE_FOLLOW_TARGET_KEY) !== 'false'
    )
  } catch {
    return true
  }
}

export const writeStoredFollowRouting = (followRouting: boolean) => {
  try {
    window.localStorage.setItem(
      CHANNEL_CREATE_FOLLOW_TARGET_KEY,
      String(followRouting)
    )
  } catch {}
}

/**
 * Follow-up behaviour shared by the create-channel drawer's footer toggle: on,
 * chase the new channel into the model routing table (the jump the paste flow
 * has always done); off, land back on the channel list. The create response
 * carries no channel id, but the routing table is organised by model, so
 * naming a model the new channel serves is enough to land on it — the
 * workbench derives the vendor from that model. A multi-model channel lets the
 * operator pick the landing model instead of always the alphabetical first; a
 * single-model channel jumps straight there.
 *
 * `followDialog` is rendered by the caller and must outlive the drawer's close
 * animation, since onCreated fires while the drawer is still closing.
 */
export function useFollowCreatedChannel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [landing, setLanding] = useState<{
    models: string[]
    selected: string
  } | null>(null)

  const followCreated = useCallback(
    (createdModels: string[]) => {
      if (!readStoredFollowRouting()) {
        void navigate({ to: '/channels' })
        return
      }
      const models = [...new Set(createdModels)].sort((a, b) =>
        a.localeCompare(b)
      )
      const [firstByName] = models
      if (!firstByName) return
      if (models.length === 1) {
        void navigate({
          to: '/models/$section',
          params: { section: 'routing' },
          search: () => ({ routingModel: firstByName }),
        })
        return
      }
      setLanding({ models, selected: firstByName })
    },
    [navigate]
  )

  const followDialog = (
    <ConfirmDialog
      open={landing !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setLanding(null)
      }}
      title={t('Open in model routing')}
      desc={t('Pick the model the routing table should land on.')}
      cancelBtnText={t('Stay here')}
      confirmText={t('Go')}
      handleConfirm={() => {
        if (landing?.selected) {
          void navigate({
            to: '/models/$section',
            params: { section: 'routing' },
            search: () => ({ routingModel: landing.selected }),
          })
        }
        setLanding(null)
      }}
    >
      {landing && (
        <Select
          items={landing.models.map((model) => ({
            value: model,
            label: model,
          }))}
          value={landing.selected}
          onValueChange={(value) =>
            setLanding((current) =>
              current && value ? { ...current, selected: value } : current
            )
          }
        >
          <SelectTrigger className='w-full' aria-label={t('Landing model')}>
            <SelectValue>{landing.selected}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {landing.models.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </ConfirmDialog>
  )

  return { followCreated, followDialog }
}
