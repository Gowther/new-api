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
export type ErrorWorkbenchFilters = {
  timeRange: string
  limit: number
  modelName: string
  channel: string
  group: string
}

export type ErrorSummaryPeerChannel = {
  channel: number
  channel_name: string
  channel_status: number
  channel_priority: number
  channel_weight: number
  ability_enabled: boolean
  channel_response_time: number
  channel_test_time: number
  automatic_channel_test_disabled: boolean
  auto_test_channel_interval_minutes: number
  multi_key_total: number
  multi_key_enabled: number
  multi_key_auto_disabled: number
  multi_key_manual_disabled: number
  recent_error_count: number
  recent_attempt_count: number
  recent_success_count: number
  recent_error_rate: number
  last_error_time: number
  is_current: boolean
}

export type ErrorSummaryItem = {
  key: string
  fingerprint: string
  model_name: string
  group: string
  channel: number
  channel_name: string
  channel_status: number
  channel_priority: number
  channel_response_time: number
  channel_test_time: number
  automatic_channel_test_disabled: boolean
  auto_test_channel_interval_minutes: number
  multi_key_total: number
  multi_key_enabled: number
  multi_key_auto_disabled: number
  multi_key_manual_disabled: number
  peer_channels: ErrorSummaryPeerChannel[]
  error_type: string
  error_code: string
  status_code: number
  error_summary: string
  count: number
  affected_requests: number
  affected_users: number
  current_count: number
  previous_count: number
  trend: 'new' | 'rising' | 'falling' | 'stable' | string
  severity: 'critical' | 'high' | 'medium' | 'low' | string
  route_attempt_count: number
  route_success_count: number
  route_error_count: number
  route_error_rate: number
  first_seen: number
  last_seen: number
  sample_content: string
  sample_request_id: string
  sample_upstream_request_id: string
  sample_group: string
  max_use_time: number
}

export type ErrorSummaryResponse = {
  items: ErrorSummaryItem[]
  scanned_logs: number
  total_logs: number
  truncated: boolean
  start_time: number
  end_time: number
}
