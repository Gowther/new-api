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
import { api } from './api'
import {
  getOAuthSessionStorage,
  markOAuthBindPopup,
} from '@/features/auth/lib/oauth-callback-mode'

// ============================================================================
// OAuth URL Builders
// ============================================================================

/**
 * Build GitHub OAuth URL
 */
export function buildGitHubOAuthUrl(clientId: string, state: string): string {
  return `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
}

/**
 * Build Discord OAuth URL
 */
export function buildDiscordOAuthUrl(clientId: string, state: string): string {
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set(
    'redirect_uri',
    `${window.location.origin}/oauth/discord`
  )
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'identify+openid')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build OIDC OAuth URL
 */
export function buildOIDCOAuthUrl(
  authUrl: string,
  clientId: string,
  state: string
): string {
  const url = new URL(authUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${window.location.origin}/oauth/oidc`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('state', state)
  return url.toString()
}

/**
 * Build LinuxDO OAuth URL
 */
export function buildLinuxDOOAuthUrl(clientId: string, state: string): string {
  return `https://connect.linux.do/oauth2/authorize?response_type=code&client_id=${clientId}&state=${state}`
}

// ============================================================================
// OAuth Helper Functions
// ============================================================================

/**
 * Get OAuth state token
 * Includes affiliate code from localStorage if available
 */
export async function getOAuthState(): Promise<string | null> {
  try {
    let path = '/api/oauth/state'
    const affCode = localStorage.getItem('aff')
    if (affCode && affCode.length > 0) {
      path += `?aff=${affCode}`
    }
    const res = await api.get(path)
    if (res.data.success) {
      return res.data.data
    }
    return null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get OAuth state:', error)
    return null
  }
}

/**
 * 绑定/登录复用弹窗的统一发起：先开一个同源 about:blank 占位弹窗，在其
 * sessionStorage 里盖章（provider+state），再导向授权页。回调页据此区分
 * 绑定流与普通登录——仅凭 window.opener 无法判断，外部链接打开的登录
 * 标签页同样携带 opener，会被误判为绑定流并卡死在绑定页面。
 */
export function openOAuthBindPopup(
  url: string,
  provider: string,
  state: string
): void {
  const popup = window.open('about:blank')
  if (!popup) {
    // 弹窗被浏览器拦截：回退为直接打开
    window.open(url)
    return
  }
  try {
    markOAuthBindPopup(getOAuthSessionStorage(popup), provider, state)
  } catch (error) {
    // sessionStorage 被隐私设置封锁时绑定回调退回登录方向（可恢复），
    // 这里照常推进授权页
    void error
  }
  popup.location.replace(url)
}

/**
 * Handle GitHub OAuth binding/login
 */
export async function handleGitHubOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildGitHubOAuthUrl(clientId, state)
  openOAuthBindPopup(url, 'github', state)
}

/**
 * Handle Discord OAuth binding/login
 */
export async function handleDiscordOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildDiscordOAuthUrl(clientId, state)
  openOAuthBindPopup(url, 'discord', state)
}

/**
 * Handle OIDC OAuth binding/login
 */
export async function handleOIDCOAuth(
  authUrl: string,
  clientId: string
): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildOIDCOAuthUrl(authUrl, clientId, state)
  openOAuthBindPopup(url, 'oidc', state)
}

/**
 * Handle LinuxDO OAuth binding/login
 */
export async function handleLinuxDOOAuth(clientId: string): Promise<void> {
  const state = await getOAuthState()
  if (!state) return

  const url = buildLinuxDOOAuthUrl(clientId, state)
  openOAuthBindPopup(url, 'linuxdo', state)
}
