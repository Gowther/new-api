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

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: Record<string, unknown>
      ) => string
      remove?: (widgetId: string) => void
      reset?: (widgetId: string) => void
    }
  }
}

interface TurnstileProps {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
  className?: string
}

export function Turnstile({
  siteKey,
  onVerify,
  onExpire,
  className,
}: TurnstileProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  // Keep callbacks in refs so a new function identity from the parent never
  // re-triggers the render effect below (which would stack duplicate widgets).
  const onVerifyRef = useRef(onVerify)
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onVerifyRef.current = onVerify
    onExpireRef.current = onExpire
  })

  useEffect(() => {
    const render = () => {
      if (!ref.current || !window.turnstile) return
      if (widgetIdRef.current != null) return
      try {
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => onVerifyRef.current(token),
          'error-callback': () => onExpireRef.current?.(),
          'expired-callback': () => onExpireRef.current?.(),
        })
      } catch {
        /* empty */
      }
    }

    let scriptEl: HTMLElement | null = null
    if (window.turnstile) {
      render()
    } else {
      const scriptId = 'cf-turnstile'
      const existing = document.getElementById(scriptId)
      if (existing) {
        // Script is already loading (added by another instance); render once
        // it finishes instead of dropping this widget.
        existing.addEventListener('load', render, { once: true })
        scriptEl = existing
      } else {
        const s = document.createElement('script')
        s.id = scriptId
        s.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        s.async = true
        s.defer = true
        s.onload = () => render()
        document.head.appendChild(s)
      }
    }

    return () => {
      scriptEl?.removeEventListener('load', render)
      if (widgetIdRef.current != null) {
        try {
          window.turnstile?.remove?.(widgetIdRef.current)
        } catch {
          /* empty */
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  return <div ref={ref} className={className} />
}
