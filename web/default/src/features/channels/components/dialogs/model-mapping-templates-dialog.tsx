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
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import {
  persistModelMappingTemplates,
  upsertModelMappingTemplate,
  type ModelMappingTemplate,
} from '../../lib/model-mapping-templates'
import { ModelMappingEditor } from '../model-mapping-editor'

type ModelMappingTemplatesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: ModelMappingTemplate[]
  onTemplatesChange: (templates: ModelMappingTemplate[]) => void
  /** Mapping to seed a brand new template with, e.g. the channel's current one. */
  initialMapping?: string
  sourceModelOptions?: string[]
  targetModelOptions?: string[]
}

const EMPTY_DRAFT_ID = ''

function toJson(mapping: Record<string, string>): string {
  if (Object.keys(mapping).length === 0) return ''
  return JSON.stringify(mapping, null, 2)
}

export function ModelMappingTemplatesDialog({
  open,
  onOpenChange,
  templates,
  onTemplatesChange,
  initialMapping,
  sourceModelOptions,
  targetModelOptions,
}: ModelMappingTemplatesDialogProps) {
  const { t } = useTranslation()
  const [draftId, setDraftId] = useState(EMPTY_DRAFT_ID)
  const [draftName, setDraftName] = useState('')
  const [draftJson, setDraftJson] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] =
    useState<ModelMappingTemplate | null>(null)

  // Each opening starts on a fresh draft: either the mapping the caller handed
  // over, or an empty one.
  useEffect(() => {
    if (!open) return
    setDraftId(EMPTY_DRAFT_ID)
    setDraftName('')
    setDraftJson(initialMapping?.trim() ? initialMapping : '')
    setNameError(null)
  }, [open, initialMapping])

  const selectTemplate = (template: ModelMappingTemplate) => {
    setDraftId(template.id)
    setDraftName(template.name)
    setDraftJson(toJson(template.mapping))
    setNameError(null)
  }

  const startNewDraft = () => {
    setDraftId(EMPTY_DRAFT_ID)
    setDraftName('')
    setDraftJson('')
    setNameError(null)
  }

  const handleSave = () => {
    const name = draftName.trim()
    if (!name) {
      setNameError(t('Template name is required'))
      return
    }

    let mapping: Record<string, string> = {}
    if (draftJson.trim()) {
      try {
        const parsed = JSON.parse(draftJson)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setNameError(t('Model mapping must be a valid JSON object'))
          return
        }
        if (Object.values(parsed).some((value) => typeof value !== 'string')) {
          setNameError(t('Model mapping values must be strings'))
          return
        }
        mapping = parsed as Record<string, string>
      } catch {
        setNameError(t('Model mapping must be valid JSON format'))
        return
      }
    }

    if (Object.keys(mapping).length === 0) {
      setNameError(t('Add at least one mapping before saving'))
      return
    }

    // A different template already holding this name would become
    // indistinguishable in the list, so reject instead of silently merging.
    const clash = templates.find(
      (template) => template.name === name && template.id !== draftId
    )
    if (clash) {
      setNameError(t('Another template already uses this name'))
      return
    }

    const next = upsertModelMappingTemplate(templates, {
      id: draftId || `model-mapping-${Date.now()}`,
      name,
      mapping,
    })
    if (!persistModelMappingTemplates(next)) {
      setNameError(t('Failed to save'))
      return
    }
    onTemplatesChange(next)
    onOpenChange(false)
  }

  const handleConfirmDelete = () => {
    if (!pendingDelete) return
    const next = templates.filter(
      (template) => template.id !== pendingDelete.id
    )
    if (!persistModelMappingTemplates(next)) {
      setNameError(t('Failed to save'))
      setPendingDelete(null)
      return
    }
    onTemplatesChange(next)
    if (draftId === pendingDelete.id) startNewDraft()
    setPendingDelete(null)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('Manage mapping templates')}
        description={t(
          'Templates are stored in this browser and are not tied to any channel. Editing one here leaves the channel you are editing untouched.'
        )}
        contentClassName='sm:max-w-3xl'
        footer={
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              {t('Cancel')}
            </Button>
            <Button type='button' onClick={handleSave}>
              {draftId ? t('Save changes') : t('Create template')}
            </Button>
          </div>
        }
      >
        <div className='grid gap-4 sm:grid-cols-[14rem_1fr]'>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label>{t('Templates')}</Label>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={startNewDraft}
              >
                <Plus className='mr-1 h-4 w-4' aria-hidden='true' />
                {t('New')}
              </Button>
            </div>
            {templates.length === 0 ? (
              <div className='text-muted-foreground rounded-md border border-dashed px-2 py-6 text-center text-xs'>
                {t('No saved templates')}
              </div>
            ) : (
              <ul className='space-y-1'>
                {templates.map((template) => (
                  <li key={template.id} className='flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      className={cn(
                        'min-w-0 flex-1 justify-start',
                        template.id === draftId && 'bg-muted'
                      )}
                      onClick={() => selectTemplate(template)}
                    >
                      <span className='min-w-0 truncate'>{template.name}</span>
                      <span className='text-muted-foreground ml-auto text-xs tabular-nums'>
                        {Object.keys(template.mapping).length}
                      </span>
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      className='text-destructive hover:text-destructive shrink-0'
                      aria-label={`${t('Delete template')}: ${template.name}`}
                      onClick={() => setPendingDelete(template)}
                    >
                      <Trash2 className='h-4 w-4' aria-hidden='true' />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className='space-y-3'>
            <div className='space-y-1'>
              <Label htmlFor='model-mapping-template-name'>
                {t('Template name')}
              </Label>
              <Input
                id='model-mapping-template-name'
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value)
                  setNameError(null)
                }}
                placeholder={t('New template')}
                aria-invalid={Boolean(nameError)}
              />
              {nameError && (
                <p className='text-destructive text-xs'>{nameError}</p>
              )}
            </div>
            {/* hideTemplates keeps this from nesting another template menu. */}
            <ModelMappingEditor
              value={draftJson}
              onChange={setDraftJson}
              hideTemplates
              sourceModelOptions={sourceModelOptions}
              targetModelOptions={targetModelOptions}
            />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title={t('Delete template?')}
        desc={t('Template "{{name}}" will be removed from this browser.', {
          name: pendingDelete?.name ?? '',
        })}
        confirmText={t('Delete')}
        destructive
        handleConfirm={handleConfirmDelete}
      />
    </>
  )
}
