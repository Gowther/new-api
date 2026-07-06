/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { API, showError, timestamp2string } from '../../../helpers';
import { useIsMobile } from '../../../hooks/common/useIsMobile';
import { createCardProPagination } from '../../../helpers/utils';

const { Text, Title } = Typography;

const TASK_LIMIT = 20;
const ACTIVE_POLL_INTERVAL_MS = 8000;

const TYPE_LABEL = {
  log_cleanup: '日志清理',
  channel_test: '通道测试',
  model_update: '上游模型更新',
  midjourney_poll: '绘图任务轮询',
  async_task_poll: '异步任务轮询',
};

const TYPE_DISPLAY_ID = {
  midjourney_poll: 'drawing_task_poll',
};

const STATUS_LABEL = {
  pending: '等待中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
};

const STATUS_COLOR = {
  pending: 'yellow',
  running: 'light-blue',
  succeeded: 'green',
  failed: 'red',
};

function isActiveStatus(status) {
  return status === 'pending' || status === 'running';
}

function getProgress(task) {
  const progress = task?.state?.progress;
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null;
  return Math.min(100, Math.max(0, progress));
}

function getTaskMetric(result, key) {
  if (!result || typeof result !== 'object') return 0;
  const value = result[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getTaskDetail(task, t) {
  if (task.error) return task.error;
  if (task.type !== 'channel_test' || task.status !== 'succeeded') return '-';

  return t(
    '通道测试：{{tested}} 个渠道，成功 {{succeeded}}，失败 {{failed}}，跳过 {{skipped}}，禁用 {{disabled}}，恢复 {{enabled}}；Key 测试 {{keyTested}}，恢复 {{keyRecovered}}，失败 {{keyFailed}}',
    {
      tested: getTaskMetric(task.result, 'tested'),
      succeeded: getTaskMetric(task.result, 'succeeded'),
      failed: getTaskMetric(task.result, 'failed'),
      skipped: getTaskMetric(task.result, 'skipped'),
      disabled: getTaskMetric(task.result, 'disabled'),
      enabled: getTaskMetric(task.result, 'enabled'),
      keyTested: getTaskMetric(task.result, 'key_tested'),
      keyRecovered: getTaskMetric(task.result, 'key_recovered'),
      keyFailed: getTaskMetric(task.result, 'key_failed'),
    },
  );
}

function SystemTasksTable({ tasks }) {
  const { t } = useTranslation();

  const columns = useMemo(
    () => [
      {
        title: t('类型'),
        dataIndex: 'type',
        width: 220,
        render: (type) => (
          <div>
            <div style={{ fontWeight: 600 }}>{t(TYPE_LABEL[type] || type)}</div>
            <Text
              type='tertiary'
              size='small'
              style={{ fontFamily: 'monospace' }}
            >
              {TYPE_DISPLAY_ID[type] || type}
            </Text>
          </div>
        ),
      },
      {
        title: t('状态'),
        dataIndex: 'status',
        width: 120,
        render: (status) => (
          <Tag color={STATUS_COLOR[status] || 'grey'} shape='circle'>
            {t(STATUS_LABEL[status] || status)}
          </Tag>
        ),
      },
      {
        title: t('进度'),
        dataIndex: 'state',
        width: 180,
        render: (_, task) => {
          const progress = getProgress(task);
          if (progress === null) return '-';
          return (
            <Progress
              percent={progress}
              showInfo
              style={{ minWidth: 140 }}
              aria-label='system task progress'
            />
          );
        },
      },
      {
        title: t('执行器'),
        dataIndex: 'locked_by',
        width: 240,
        render: (lockedBy) => (
          <Text
            type='tertiary'
            size='small'
            ellipsis={{ showTooltip: true }}
            style={{ maxWidth: 220, fontFamily: 'monospace' }}
          >
            {lockedBy || '-'}
          </Text>
        ),
      },
      {
        title: t('更新时间'),
        dataIndex: 'updated_at',
        width: 180,
        render: (updatedAt) => (updatedAt ? timestamp2string(updatedAt) : '-'),
      },
      {
        title: t('详情'),
        dataIndex: 'error',
        width: 320,
        render: (_, task) => {
          const detail = getTaskDetail(task, t);
          const content = (
            <Text
              type={task.error ? 'danger' : 'tertiary'}
              size='small'
              ellipsis
              style={{ maxWidth: 300 }}
            >
              {detail}
            </Text>
          );
          if (detail === '-') return content;
          return <Tooltip content={detail}>{content}</Tooltip>;
        },
      },
    ],
    [t],
  );

  return (
    <Table
      rowKey='task_id'
      columns={columns}
      dataSource={tasks}
      pagination={false}
      size='small'
      scroll={{ x: 1260 }}
    />
  );
}

export default function SettingsSystemTasks() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(TASK_LIMIT);
  const [total, setTotal] = useState(0);

  const activeTasks = tasks.filter((task) => isActiveStatus(task.status));
  const historyTasks = tasks.filter((task) => !isActiveStatus(task.status));
  const hasActiveTasks = activeTasks.length > 0;

  async function loadTasks(
    showInlineRefreshing = false,
    page = currentPage,
    size = pageSize,
  ) {
    if (showInlineRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await API.get('/api/system-task/list', {
        params: { page, limit: size },
        disableDuplicate: true,
      });
      const { success, message, data } = res.data;
      if (!success || !Array.isArray(data)) {
        showError(message || t('加载系统任务失败'));
        return;
      }
      setTasks(data);
      setTotal(res.data.total ?? data.length);
      setCurrentPage(res.data.page ?? page);
      setPageSize(res.data.page_size ?? size);
    } catch (error) {
      showError(t('加载系统任务失败'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadTasks(false, 1, pageSize);
  }, []);

  useEffect(() => {
    if (!hasActiveTasks) return undefined;
    const timer = window.setInterval(() => {
      loadTasks(true, currentPage, pageSize);
    }, ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [currentPage, hasActiveTasks, pageSize]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    loadTasks(false, page, pageSize);
  };

  const handlePageSizeChange = (size) => {
    setPageSize(size);
    setCurrentPage(1);
    loadTasks(false, 1, size);
  };

  return (
    <Spin spinning={loading}>
      <div className='flex items-center justify-between gap-3 mb-4'>
        <div className='flex items-center gap-2'>
          <ListChecks size={20} />
          <div>
            <Title heading={5} style={{ margin: 0 }}>
              {t('系统任务记录')}
            </Title>
            <Text type='secondary' size='small'>
              {t('查看后台定时任务和手动任务的执行状态')}
            </Text>
          </div>
        </div>
        <Space>
          <Text type='tertiary' size='small'>
            {hasActiveTasks
              ? t('自动刷新中（每 {{seconds}} 秒）', {
                  seconds: ACTIVE_POLL_INTERVAL_MS / 1000,
                })
              : t('无运行中任务时暂停自动刷新')}
          </Text>
          <Button
            icon={<IconRefresh />}
            loading={refreshing}
            onClick={() => loadTasks(true, currentPage, pageSize)}
          >
            {refreshing ? t('刷新中') : t('刷新')}
          </Button>
        </Space>
      </div>

      {tasks.length === 0 ? (
        <Empty title={t('暂无系统任务记录')} />
      ) : (
        <div className='space-y-4'>
          <div>
            <div className='flex items-center justify-between mb-2'>
              <Text strong>{t('活动任务')}</Text>
              <Tag
                color={hasActiveTasks ? 'light-blue' : 'grey'}
                shape='circle'
              >
                {activeTasks.length}
              </Tag>
            </div>
            {activeTasks.length > 0 ? (
              <SystemTasksTable tasks={activeTasks} />
            ) : (
              <Empty title={t('无运行中的系统任务')} />
            )}
          </div>

          <div>
            <div className='flex items-center justify-between mb-2'>
              <Text strong>{t('历史任务')}</Text>
              <Tag color='grey' shape='circle'>
                {historyTasks.length}
              </Tag>
            </div>
            {historyTasks.length > 0 ? (
              <SystemTasksTable tasks={historyTasks} />
            ) : (
              <Empty title={t('暂无历史系统任务')} />
            )}
          </div>

          {total > 0 ? (
            <div className='flex items-center justify-between gap-3'>
              {createCardProPagination({
                currentPage,
                pageSize,
                total,
                pageSizeOpts: [20, 50, 100],
                onPageChange: handlePageChange,
                onPageSizeChange: handlePageSizeChange,
                isMobile,
                t,
              })}
            </div>
          ) : null}
        </div>
      )}
    </Spin>
  );
}
