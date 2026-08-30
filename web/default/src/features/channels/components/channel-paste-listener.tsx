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
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import {
  channelConnectionPasteClaim,
  parseChannelConnectionString,
  readClipboardWhenAllowed,
  type ChannelConnectionConfig,
} from '../lib/channel-connection'

/** Matches the Sheet close transition so the drawer finishes animating out
 *  before the pasted key leaves state. */
const DRAWER_EXIT_MS = 300

// The create drawer is one of the largest components in the app and routes are
// code-split in production, so keep it out of the shared layout chunk until a
// paste actually needs it.
const LazyChannelPasteDrawer = lazy(() =>
  import('./channel-paste-drawer').then((m) => ({
    default: m.ChannelPasteDrawer,
  }))
)

/**
 * Turns a channel-connection paste into an open create-channel drawer from
 * anywhere in the console, so sharing a channel no longer means navigating to
 * the channels page first.
 *
 * A `paste` event carries its own clipboard data, which means this path needs
 * neither the clipboard-read permission nor a dedicated button.
 */
export function ChannelPasteListener() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const currentUser = useAuthStore((s) => s.auth.user)
  const canEditSensitive = hasPermission(
    currentUser,
    ADMIN_PERMISSION_RESOURCES.CHANNEL,
    ADMIN_PERMISSION_ACTIONS.SENSITIVE_WRITE
  )
  const [pasted, setPasted] = useState<ChannelConnectionConfig | null>(null)
  const [open, setOpen] = useState(false)
  // The clipboard keeps holding the payload, so remember what has already been
  // offered: switching tabs repeatedly must not reopen the drawer, and neither
  // must returning after the user dismissed it. Kept in memory only — a key
  // does not belong in localStorage.
  const offeredRef = useRef<string | null>(null)

  const offer = useCallback(
    (text: string, config: ChannelConnectionConfig) => {
      offeredRef.current = text
      setPasted(config)
      setOpen(true)
      toast.success(t('Connection info filled in'))
    },
    [t]
  )

  useEffect(() => {
    if (!canEditSensitive) return

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text')
      const config = channelConnectionPasteClaim(
        text,
        event.target as HTMLElement | null
      )
      if (!config || !text) return
      event.preventDefault()
      offer(text, config)
    }

    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [canEditSensitive, offer])

  // Copying happens in the other tab, where this page is in the background and
  // may not read the clipboard at all. Coming back is the first moment a read is
  // allowed, so that is when the offer is made — no keystroke needed.
  useEffect(() => {
    if (!canEditSensitive) return

    const onFocus = async () => {
      const text = await readClipboardWhenAllowed()
      if (text === null || text === offeredRef.current) return
      // Don't stack on top of a dialog the user already has open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return
      }
      const config = parseChannelConnectionString(text)
      if (config) offer(text, config)
    }

    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [canEditSensitive, offer])

  // Drop the pasted key once the drawer is gone; keeping it until then lets the
  // close animation play instead of the drawer vanishing.
  useEffect(() => {
    if (open || !pasted) return
    const timer = window.setTimeout(() => setPasted(null), DRAWER_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open, pasted])

  // Adding a channel is normally followed by setting its priority or pinning it
  // as the temporary single channel, both of which live in the routing table. The
  // create response carries no channel id, but the routing table is organised by
  // model, so naming a model the new channel serves is enough to land on it —
  // the workbench derives the vendor from that model.
  const followToRouting = useCallback(
    (createdModels: string[]) => {
      const [firstByName] = [...createdModels].sort((a, b) =>
        a.localeCompare(b)
      )
      if (!firstByName) return
      void navigate({
        to: '/models/$section',
        params: { section: 'routing' },
        search: { routingModel: firstByName },
      })
    },
    [navigate]
  )

  const initialValues = useMemo(() => {
    if (!pasted) return undefined
    return {
      key: pasted.key,
      base_url: pasted.url,
      ...(pasted.name ? { name: pasted.name } : {}),
      ...(pasted.remark ? { remark: pasted.remark } : {}),
    }
  }, [pasted])

  if (!pasted) return null

  return (
    <Suspense fallback={null}>
      <LazyChannelPasteDrawer
        open={open}
        onOpenChange={setOpen}
        initialValues={initialValues}
        onCreated={followToRouting}
      />
    </Suspense>
  )
}
