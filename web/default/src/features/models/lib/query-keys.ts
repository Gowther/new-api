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
import type { GetModelsParams, SearchModelsParams } from '../types'

/**
 * React Query cache keys for models
 */
export const modelsQueryKeys = {
  all: ['models'] as const,
  lists: () => [...modelsQueryKeys.all, 'list'] as const,
  list: (filters: GetModelsParams | SearchModelsParams) =>
    [...modelsQueryKeys.lists(), filters] as const,
  detail: (id: number) => [...modelsQueryKeys.all, 'detail', id] as const,
  missing: () => [...modelsQueryKeys.all, 'missing'] as const,
  ruleCoverage: () => [...modelsQueryKeys.all, 'rule-coverage'] as const,
}

/**
 * React Query cache keys for the model routing workbench.
 *
 * The workbench keeps its own channel and pricing caches because it needs every
 * channel at once rather than the paginated list the channels page reads. That
 * makes them invisible to `channelsQueryKeys` invalidation, so anything writing
 * channels has to invalidate `all` here too or the routing table keeps showing
 * the channel set from before the write.
 */
export const modelRoutingQueryKeys = {
  all: ['model-routing'] as const,
  channels: () => [...modelRoutingQueryKeys.all, 'channels'] as const,
  pricing: () => [...modelRoutingQueryKeys.all, 'pricing'] as const,
}

/**
 * React Query cache keys for vendors
 */
export const vendorsQueryKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorsQueryKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) =>
    [...vendorsQueryKeys.lists(), filters] as const,
  detail: (id: number) => [...vendorsQueryKeys.all, 'detail', id] as const,
}

/**
 * React Query cache keys for prefill groups
 */
export const prefillGroupsQueryKeys = {
  all: ['prefill-groups'] as const,
  lists: () => [...prefillGroupsQueryKeys.all, 'list'] as const,
  list: (type?: string) => [...prefillGroupsQueryKeys.lists(), type] as const,
}

/**
 * React Query cache keys for deployments
 */
export const deploymentsQueryKeys = {
  all: ['deployments'] as const,
  lists: () => [...deploymentsQueryKeys.all, 'list'] as const,
  list: (filters: {
    keyword?: string
    status?: string
    p?: number
    page_size?: number
  }) => [...deploymentsQueryKeys.lists(), filters] as const,
  detail: (id: string | number) =>
    [...deploymentsQueryKeys.all, 'detail', id] as const,
}
