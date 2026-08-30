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
import type { ChannelFormValues } from '../lib/channel-form'
import { ChannelsProvider } from './channels-provider'
import { ChannelMutateDrawer } from './drawers/channel-mutate-drawer'

type ChannelPasteDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: Partial<ChannelFormValues>
  onCreated?: (models: string[]) => void
}

/**
 * The create-channel drawer outside the channels page. The drawer reads channel
 * dialog state through `useChannels`, so it carries its own provider the same
 * way the model routing workbench does.
 */
export function ChannelPasteDrawer({
  open,
  onOpenChange,
  initialValues,
  onCreated,
}: ChannelPasteDrawerProps) {
  return (
    <ChannelsProvider>
      <ChannelMutateDrawer
        open={open}
        onOpenChange={onOpenChange}
        initialValues={initialValues}
        onCreated={onCreated}
      />
    </ChannelsProvider>
  )
}
