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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { ChannelQuickMappingSuggestion } from '../../types'

type ChannelQuickMappingSuggestionDialogProps = {
  open: boolean
  suggestions: ChannelQuickMappingSuggestion[]
  onOpenChange: (open: boolean) => void
  onApply: (assignments: Record<string, string>) => void
}

export function ChannelQuickMappingSuggestionDialog(
  props: ChannelQuickMappingSuggestionDialogProps
) {
  const { t } = useTranslation()
  const [assignments, setAssignments] = useState<Record<string, string>>({})

  useEffect(() => {
    if (props.open) {
      setAssignments({})
    }
  }, [props.open, props.suggestions])

  const optionsByAlias = useMemo(
    () =>
      Object.fromEntries(
        props.suggestions.map((suggestion) => [
          suggestion.alias_model,
          suggestion.candidate_models.map((model) => ({
            value: model,
            label: model,
          })),
        ])
      ),
    [props.suggestions]
  )
  const hasAssignments = Object.values(assignments).some(Boolean)

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Suggested Channel Model Mappings')}
      description={t(
        'These optional mappings were triggered by the selected models. Choose any selected model as each alias target, or skip them all.'
      )}
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Skip')}
          </Button>
          <Button
            disabled={!hasAssignments}
            onClick={() => props.onApply(assignments)}
          >
            {t('Apply Selected Mappings')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <Alert>
          <AlertDescription>
            {t(
              'Aliases already provided by the upstream or already mapped are not shown here.'
            )}
          </AlertDescription>
        </Alert>

        <FieldGroup>
          {props.suggestions.map((suggestion) => {
            const items = optionsByAlias[suggestion.alias_model] || []
            const value = assignments[suggestion.alias_model] || null
            return (
              <Field key={suggestion.alias_model}>
                <FieldLabel>{t('Map {{alias}} to', { alias: suggestion.alias_model })}</FieldLabel>
                <Select
                  items={items}
                  value={value}
                  onValueChange={(nextValue) => {
                    setAssignments((currentAssignments) => {
                      const nextAssignments = { ...currentAssignments }
                      if (nextValue) {
                        nextAssignments[suggestion.alias_model] = nextValue
                      } else {
                        delete nextAssignments[suggestion.alias_model]
                      }
                      return nextAssignments
                    })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('Do not add this mapping')} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {value && (
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='w-fit px-0'
                    onClick={() => {
                      setAssignments((currentAssignments) => {
                        const nextAssignments = { ...currentAssignments }
                        delete nextAssignments[suggestion.alias_model]
                        return nextAssignments
                      })
                    }}
                  >
                    {t('Do not add this mapping')}
                  </Button>
                )}
                <p className='text-muted-foreground text-xs'>
                  {t('Triggered by {{mode}} match: {{value}}', {
                    mode:
                      suggestion.match_mode === 'exact'
                        ? t('Exact Match')
                        : t('Contains'),
                    value: suggestion.match_value,
                  })}
                </p>
              </Field>
            )
          })}
        </FieldGroup>
      </div>
    </Dialog>
  )
}
