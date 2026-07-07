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

export interface TokenUsageSummary {
  total_requests: number
  total_quota: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  total_cache_read_tokens: number
  total_cache_write_tokens: number
  api_key_count: number
  model_count: number
}

export interface TokenUsageTrendItem {
  timestamp: number
  count: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface TokenUsageTokenItem {
  token_id: number
  token_name: string
  count: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  last_used_at: number
}

export interface TokenUsageModelItem {
  model_name: string
  count: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  last_used_at: number
}

export interface TokenUsageDetailItem {
  created_at: number
  token_id: number
  token_name: string
  model_name: string
  count: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  last_used_at: number
}

export interface TokenUsageSelfResponse {
  summary: TokenUsageSummary
  trend: TokenUsageTrendItem[]
  by_token: TokenUsageTokenItem[]
  by_model: TokenUsageModelItem[]
  rows: TokenUsageDetailItem[]
}

export interface TokenUsageQueryParams {
  start_timestamp: number
  end_timestamp: number
  granularity: 'hour' | 'day'
  detail_limit?: number
  token_id?: number
}
