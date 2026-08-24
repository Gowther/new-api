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
import { Code, FileStack, Plus, Save, Table, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type ModelMappingEditorProps = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  sourceModelOptions?: string[]
  targetModelOptions?: string[]
}

type MappingRow = {
  id: string
  from: string
  to: string
}

type ModelMappingTemplate = {
  id: string
  name: string
  mapping: Record<string, string>
}

const DUPLICATE_MAPPING_SENTINEL = '{ "duplicate_source_models": '
const MODEL_MAPPING_TEMPLATES_STORAGE_KEY =
  'new-api:model-mapping-templates:v1'
const DEFAULT_MODEL_MAPPING_TEMPLATE: ModelMappingTemplate = {
  id: 'default-gpt-3.5-turbo',
  name: 'gpt-3.5-turbo',
  mapping: { 'gpt-3.5-turbo': 'gpt-3.5-turbo-0125' },
}

function getDuplicateSources(rows: MappingRow[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const row of rows) {
    const source = row.from.trim()
    if (!source) continue
    if (seen.has(source)) {
      duplicates.add(source)
    } else {
      seen.add(source)
    }
  }

  return Array.from(duplicates)
}

function normalizeTemplate(value: unknown): ModelMappingTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null
  }
  if (
    !candidate.mapping ||
    typeof candidate.mapping !== 'object' ||
    Array.isArray(candidate.mapping)
  ) {
    return null
  }
  const mapping: Record<string, string> = {}
  for (const [from, to] of Object.entries(candidate.mapping)) {
    if (typeof to !== 'string') return null
    const source = from.trim()
    if (source) mapping[source] = to
  }
  const name = candidate.name.trim()
  if (!name) return null
  return { id: candidate.id, name, mapping }
}

function loadModelMappingTemplates(): ModelMappingTemplate[] {
  if (typeof window === 'undefined') return [DEFAULT_MODEL_MAPPING_TEMPLATE]
  try {
    const raw = window.localStorage.getItem(MODEL_MAPPING_TEMPLATES_STORAGE_KEY)
    if (!raw) return [DEFAULT_MODEL_MAPPING_TEMPLATE]
    const parsed = JSON.parse(raw)
    const values = Array.isArray(parsed)
      ? parsed
      : parsed?.version === 1 && Array.isArray(parsed.templates)
        ? parsed.templates
        : []
    const templates = values
      .map(normalizeTemplate)
      .filter((template): template is ModelMappingTemplate => template !== null)
    return templates.length > 0 ? templates : [DEFAULT_MODEL_MAPPING_TEMPLATE]
  } catch (_error) {
    return [DEFAULT_MODEL_MAPPING_TEMPLATE]
  }
}

function persistModelMappingTemplates(templates: ModelMappingTemplate[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    MODEL_MAPPING_TEMPLATES_STORAGE_KEY,
    JSON.stringify({ version: 1, templates }),
  )
}

export function ModelMappingEditor(props: ModelMappingEditorProps) {
  const { t } = useTranslation()
  const sourceListId = useId()
  const targetListId = useId()
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const [rows, setRows] = useState<MappingRow[]>([])
  const [jsonValue, setJsonValue] = useState(props.value)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ModelMappingTemplate[]>(
    loadModelMappingTemplates,
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  )
  const nextRowIdRef = useRef(0)
  const duplicateSources = useMemo(() => getDuplicateSources(rows), [rows])

  const createRowId = () => {
    nextRowIdRef.current += 1
    return `mapping-${nextRowIdRef.current}`
  }

  const parseJsonToRows = (json: string): boolean => {
    try {
      if (!json.trim()) {
        setRows([])
        setJsonError(null)
        return true
      }
      const parsed = JSON.parse(json)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError(t('Model mapping must be a valid JSON object'))
        return false
      }
      const entries = Object.entries(parsed)
      const invalidValue = entries.find(([, to]) => typeof to !== 'string')
      if (invalidValue) {
        setJsonError(t('Model mapping values must be strings'))
        return false
      }
      setRows((previousRows) => {
        const remainingRows = [...previousRows]
        return entries.map(([from, to], index) => {
          const toString = String(to)
          const existingIndex = remainingRows.findIndex(
            (row) =>
              row.from === from ||
              (row.from === from && row.to === toString) ||
              previousRows[index]?.id === row.id
          )
          if (existingIndex >= 0) {
            const [existing] = remainingRows.splice(existingIndex, 1)
            return {
              id: existing.id,
              from,
              to: toString,
            }
          }
          return {
            id: createRowId(),
            from,
            to: toString,
          }
        })
      })
      setJsonError(null)
      return true
    } catch (_error) {
      setJsonError(t('Model mapping must be valid JSON format'))
      return false
    }
  }

  // Parse JSON to rows when value changes externally
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsonValue(props.value)
    parseJsonToRows(props.value)
  }, [props.value])

  const convertRowsToJson = (updatedRows: MappingRow[]): string => {
    if (updatedRows.length === 0) {
      return ''
    }
    const obj: Record<string, string> = {}
    updatedRows.forEach((row) => {
      if (row.from.trim()) {
        obj[row.from.trim()] = row.to.trim()
      }
    })
    return JSON.stringify(obj, null, 2)
  }

  const syncRows = (updatedRows: MappingRow[]) => {
    setRows(updatedRows)
    const duplicates = getDuplicateSources(updatedRows)
    if (duplicates.length > 0) {
      setJsonError(t('Duplicate source model mappings are not allowed'))
      setJsonValue(DUPLICATE_MAPPING_SENTINEL)
      props.onChange(DUPLICATE_MAPPING_SENTINEL)
      return
    }

    const json = convertRowsToJson(updatedRows)
    setJsonError(null)
    setJsonValue(json)
    props.onChange(json)
  }

  const handleAddRow = () => {
    const newRow: MappingRow = {
      id: createRowId(),
      from: '',
      to: '',
    }
    syncRows([...rows, newRow])
  }

  const handleDeleteRow = (id: string) => {
    syncRows(rows.filter((row) => row.id !== id))
  }

  const handleRowChange = (
    id: string,
    field: 'from' | 'to',
    newValue: string
  ) => {
    const updatedRows = rows.map((row) =>
      row.id === id ? { ...row, [field]: newValue } : row
    )
    syncRows(updatedRows)
  }

  const handleJsonChange = (newJson: string) => {
    setJsonValue(newJson)
    props.onChange(newJson)
    parseJsonToRows(newJson)
  }

  const applyTemplate = (template: ModelMappingTemplate) => {
    const value = JSON.stringify(template.mapping, null, 2)
    setSelectedTemplateId(template.id)
    setJsonValue(value)
    props.onChange(value)
    parseJsonToRows(value)
  }

  const saveCurrentAsTemplate = () => {
    const mapping = rows.reduce<Record<string, string>>((result, row) => {
      const source = row.from.trim()
      if (source) result[source] = row.to.trim()
      return result
    }, {})
    if (Object.keys(mapping).length === 0) return

    const selectedTemplate = templates.find(
      (template) => template.id === selectedTemplateId,
    )
    const name = window.prompt(
      t('Template name'),
      selectedTemplate?.name || t('New template'),
    )
    const trimmedName = name?.trim()
    if (!trimmedName) return

    const existing = templates.find(
      (template) =>
        template.id !== DEFAULT_MODEL_MAPPING_TEMPLATE.id &&
        (template.id === selectedTemplateId || template.name === trimmedName),
    )
    const nextTemplate: ModelMappingTemplate = {
      id: existing?.id || `model-mapping-${Date.now()}`,
      name: trimmedName,
      mapping,
    }
    const nextTemplates = existing
      ? templates.map((template) =>
          template.id === existing.id ? nextTemplate : template,
        )
      : [...templates, nextTemplate]
    setTemplates(nextTemplates)
    setSelectedTemplateId(nextTemplate.id)
    persistModelMappingTemplates(nextTemplates)
  }

  const deleteTemplate = (template: ModelMappingTemplate) => {
    if (template.id === DEFAULT_MODEL_MAPPING_TEMPLATE.id) return
    if (!window.confirm(`${t('Delete')} "${template.name}"?`)) return
    const nextTemplates = templates.filter((item) => item.id !== template.id)
    setTemplates(nextTemplates)
    if (selectedTemplateId === template.id) setSelectedTemplateId(null)
    persistModelMappingTemplates(nextTemplates)
  }

  const handleModeChange = (nextMode: string) => {
    if (nextMode !== 'visual' && nextMode !== 'json') return
    if (nextMode === 'json') {
      const duplicates = getDuplicateSources(rows)
      if (duplicates.length === 0) {
        const json = convertRowsToJson(rows)
        setJsonValue(json)
        props.onChange(json)
      }
      setMode('json')
      return
    }
    parseJsonToRows(jsonValue)
    setMode('visual')
  }

  return (
    <div className='space-y-2'>
      <Tabs value={mode} onValueChange={handleModeChange} className='space-y-2'>
        <div className='flex items-center justify-between gap-3'>
          <TabsList>
            <TabsTrigger value='visual'>
              <Table className='h-4 w-4' aria-hidden='true' />
              {t('Visual')}
            </TabsTrigger>
            <TabsTrigger value='json'>
              <Code className='h-4 w-4' aria-hidden='true' />
              {t('JSON')}
            </TabsTrigger>
          </TabsList>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type='button'
                  variant='link'
                  size='sm'
                  className='h-auto p-0'
                  disabled={props.disabled}
                />
              }
            >
              <FileStack className='mr-1 h-4 w-4' aria-hidden='true' />
              {t('Fill Templates')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-72'>
              <div className='text-muted-foreground px-2 py-1 text-xs'>
                {t('Select a template')}
              </div>
              {templates.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                >
                  <span className='truncate'>{template.name}</span>
                  <span className='text-muted-foreground ml-auto text-xs'>
                    {Object.keys(template.mapping).length}
                  </span>
                </DropdownMenuItem>
              ))}
              {templates.length === 0 && (
                <div className='text-muted-foreground px-2 py-2 text-xs'>
                  {t('No saved templates')}
                </div>
              )}
              <DropdownMenuSeparator />
              {templates.some(
                (template) => template.id !== DEFAULT_MODEL_MAPPING_TEMPLATE.id
              ) && (
                <div className='text-muted-foreground px-2 py-1 text-xs'>
                  {t('Delete template')}
                </div>
              )}
              {templates
                .filter(
                  (template) =>
                    template.id !== DEFAULT_MODEL_MAPPING_TEMPLATE.id
                )
                .map((template) => (
                  <DropdownMenuItem
                    key={`delete-${template.id}`}
                    variant='destructive'
                    onClick={() => deleteTemplate(template)}
                  >
                    <Trash2 className='mr-2 h-4 w-4' aria-hidden='true' />
                    <span className='truncate'>{template.name}</span>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuItem
                disabled={props.disabled || rows.length === 0}
                onClick={saveCurrentAsTemplate}
              >
                <Save className='mr-2 h-4 w-4' aria-hidden='true' />
                {t('Save current mapping as template')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {jsonError && (
          <Alert variant='destructive'>
            <AlertDescription>{jsonError}</AlertDescription>
          </Alert>
        )}

        {duplicateSources.length > 0 && (
          <Alert>
            <AlertDescription>
              {t('Duplicate source model(s): {{models}}', {
                models: duplicateSources.join(', '),
              })}
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value='visual' className='space-y-2'>
          {rows.length > 0 ? (
            <div className='space-y-2'>
              <div className='grid grid-cols-[1fr_1fr_auto] gap-2 text-sm font-medium'>
                <div>{t('Original Model')}</div>
                <div>{t('Replacement Model')}</div>
                <div className='w-10'></div>
              </div>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className='grid grid-cols-[1fr_1fr_auto] gap-2'
                >
                  <Input
                    value={row.from}
                    onChange={(e) =>
                      handleRowChange(row.id, 'from', e.target.value)
                    }
                    placeholder='gpt-3.5-turbo'
                    disabled={props.disabled}
                    list={sourceListId}
                  />
                  <Input
                    value={row.to}
                    onChange={(e) =>
                      handleRowChange(row.id, 'to', e.target.value)
                    }
                    placeholder='gpt-3.5-turbo-0125'
                    disabled={props.disabled}
                    list={targetListId}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    onClick={() => handleDeleteRow(row.id)}
                    disabled={props.disabled}
                    className='h-10 w-10'
                    aria-label={t('Delete mapping')}
                  >
                    <Trash2 className='h-4 w-4' aria-hidden='true' />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className='text-muted-foreground flex h-24 items-center justify-center rounded-md border border-dashed text-sm'>
              {t(
                'No model mappings configured. Click "Add Mapping" to get started.'
              )}
            </div>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={handleAddRow}
            disabled={props.disabled}
            className='w-full'
          >
            <Plus className='mr-2 h-4 w-4' />
            {t('Add Mapping')}
          </Button>
        </TabsContent>
        <TabsContent value='json'>
          <Textarea
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            placeholder={t('{"original-model": "replacement-model"}')}
            disabled={props.disabled}
            rows={8}
            className={cn(
              'font-mono text-sm',
              jsonError && 'border-destructive'
            )}
            aria-invalid={Boolean(jsonError)}
          />
        </TabsContent>
      </Tabs>

      {props.sourceModelOptions && props.sourceModelOptions.length > 0 && (
        <datalist id={sourceListId}>
          {props.sourceModelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
      {props.targetModelOptions && props.targetModelOptions.length > 0 && (
        <datalist id={targetListId}>
          {props.targetModelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      )}
    </div>
  )
}
