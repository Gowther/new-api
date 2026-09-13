import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { cleanupStaleTokenModelLimits, getStaleTokenModelLimits } from '../api'

export function StaleModelLimitsBanner() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState(false)
  const [cleaningTokenId, setCleaningTokenId] = useState<number | null>(null)
  const { data: report } = useQuery({
    queryKey: ['stale-token-model-limits'],
    queryFn: async () => {
      const result = await getStaleTokenModelLimits()
      if (!result.success) {
        throw new Error(result.message || t('Failed to load stale model limits'))
      }
      return result.data ?? null
    },
  })

  if (dismissed || !report || report.tokens.length === 0) {
    return null
  }

  const handleCleanup = async (tokenId: number) => {
    setCleaningTokenId(tokenId)
    try {
      const result = await cleanupStaleTokenModelLimits([tokenId])
      if (result.success) {
        toast.success(t('Removed the stale models from the token'))
        await queryClient.invalidateQueries({
          queryKey: ['stale-token-model-limits'],
        })
        await queryClient.invalidateQueries({ queryKey: ['keys'] })
      } else {
        toast.error(result.message || t('Failed to remove stale models'))
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to remove stale models')
      )
    } finally {
      setCleaningTokenId(null)
    }
  }

  return (
    <Alert className='mb-3'>
      <AlertTriangle />
      <AlertTitle>{t('Stale models in token model limits')}</AlertTitle>
      <AlertDescription className='space-y-2'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'The following models are no longer served by any enabled channel. They are kept in case a channel serves them again, and can be removed manually.'
          )}
        </p>
        <div className='flex flex-wrap gap-1.5'>
          {report.stale_models.map((modelName) => (
            <span
              key={modelName}
              className='bg-muted text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs break-all'
            >
              {modelName}
            </span>
          ))}
        </div>
        <div className='space-y-1.5'>
          {report.tokens.map((token) => (
            <div
              key={token.token_id}
              className='flex flex-wrap items-center justify-between gap-2'
            >
              <span className='min-w-0 truncate text-xs font-medium'>
                {token.token_name}
                <span className='text-muted-foreground font-normal'>
                  {' '}
                  · {token.stale_models.join(', ')}
                </span>
              </span>
              <Button
                variant='outline'
                size='sm'
                className='h-7 px-2 text-xs'
                disabled={cleaningTokenId === token.token_id}
                onClick={() => handleCleanup(token.token_id)}
              >
                {t('Remove stale models')}
              </Button>
            </div>
          ))}
        </div>
      </AlertDescription>
      <AlertAction>
        <Button
          variant='ghost'
          size='icon'
          className='size-6'
          aria-label={t('Dismiss')}
          onClick={() => setDismissed(true)}
        >
          <X />
        </Button>
      </AlertAction>
    </Alert>
  )
}
