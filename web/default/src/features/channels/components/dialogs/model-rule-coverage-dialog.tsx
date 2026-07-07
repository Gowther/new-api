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
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export type ModelRuleCoverageAction = 'cancel' | 'submit'

type ModelRuleCoverageDialogProps = {
  open: boolean
  uncoveredModels: string[]
  onConfirm: (action: ModelRuleCoverageAction) => void
  onOpenChange?: (open: boolean) => void
}

export function ModelRuleCoverageDialog({
  open,
  uncoveredModels,
  onConfirm,
  onOpenChange,
}: ModelRuleCoverageDialogProps) {
  const { t } = useTranslation()

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      onConfirm('cancel')
    }
    onOpenChange?.(newOpen)
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('Models not covered by model management rules')}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div className='space-y-3 text-sm' />}
          >
            <div>
              {t(
                'The following channel models do not match any enabled model management rule, so they may be hidden from the model square or miss metadata:'
              )}
            </div>
            <div className='rounded-md bg-amber-50 p-2 font-mono text-xs break-all text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'>
              {uncoveredModels.join(', ')}
            </div>
            <div>
              {t(
                'You can go back and add matching model management rules, or save anyway if this is intentional.'
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className='flex-col gap-2 sm:flex-row'>
          <AlertDialogCancel onClick={() => onConfirm('cancel')}>
            {t('Go back and edit')}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm('submit')}>
            {t('Save anyway')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
