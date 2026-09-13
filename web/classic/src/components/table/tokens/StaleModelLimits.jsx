/*
Copyright (C) 2025 QuantumNous

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

import React, { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Modal,
  Tag,
  Tooltip,
  Typography,
} from '@douyinfe/semi-ui';
import { IconAlertTriangle } from '@douyinfe/semi-icons';
import { API, showError, showSuccess } from '../../../helpers';

// 提醒当前用户令牌模型限制中已无任何启用渠道提供的模型。
// 失效条目本身无危害且模型回归后自动生效，因此只提醒 + 手动按模型清理，绝不自动删除。
export const StaleModelLimitsEntry = ({ report, onOpen, t }) => {
  if (!report || !report.tokens || report.tokens.length === 0) {
    return null;
  }
  return (
    <Button
      type='warning'
      theme='light'
      size='small'
      icon={<IconAlertTriangle />}
      title={t('令牌模型限制中存在已无渠道提供的模型')}
      onClick={() => onOpen(null)}
    >
      {t('失效模型')}（{report.tokens.length}）
    </Button>
  );
};

export const StaleModelLimitsTag = ({ staleModels, onOpen, t }) => {
  return (
    <Tooltip
      content={
        <div className='text-xs max-w-[320px]'>
          {t(
            '以下模型已无任何启用渠道提供。条目已保留，渠道恢复提供后自动生效，可按需手动移除。',
          )}
          <div className='mt-1 break-all'>{staleModels.join('、')}</div>
        </div>
      }
      position='top'
      showArrow
    >
      <Tag
        color='amber'
        shape='circle'
        size='small'
        className='cursor-pointer'
        onClick={onOpen}
      >
        {t('失效模型')} · {staleModels.length}
      </Tag>
    </Tooltip>
  );
};

export const StaleModelLimitsModal = ({
  visible,
  onClose,
  report,
  focusTokenId,
  t,
  onChanged,
}) => {
  const [selection, setSelection] = useState({});
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    if (!visible || !report) return;
    const initial = {};
    report.tokens.forEach((token) => {
      initial[token.token_id] = [...token.stale_models];
    });
    setSelection(initial);
  }, [visible, report]);

  useEffect(() => {
    if (!visible || focusTokenId == null) return;
    const target = document.querySelector(
      `[data-stale-token-id="${focusTokenId}"]`,
    );
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Only scroll on open — selection changes must not re-scroll the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, focusTokenId]);

  if (!visible || !report) {
    return null;
  }

  const selectedCount = Object.values(selection).reduce(
    (sum, models) => sum + models.length,
    0,
  );
  const tokenSelection = (token) => selection[token.token_id] ?? [];

  const toggleModel = (tokenId, model, checked) => {
    setSelection((prev) => {
      const current = prev[tokenId] ?? [];
      const next = checked
        ? [...current, model]
        : current.filter((name) => name !== model);
      return { ...prev, [tokenId]: next };
    });
  };

  const handleCleanup = async () => {
    const ids = [];
    const selectedModels = new Set();
    report.tokens.forEach((token) => {
      const checked = tokenSelection(token);
      if (checked.length === 0) return;
      ids.push(token.token_id);
      checked.forEach((model) => selectedModels.add(model));
    });
    if (ids.length === 0 || cleaning) return;

    setCleaning(true);
    try {
      const res = await API.post('/api/token/stale_model_limits/cleanup', {
        ids,
        models: [...selectedModels],
      });
      const { success, message } = res.data || {};
      if (success) {
        showSuccess(t('已清理选中的失效模型'));
        onClose();
        onChanged?.();
      } else {
        showError(message || t('移除失效模型失败'));
      }
    } catch (e) {
      showError(e.message || t('移除失效模型失败'));
    } finally {
      setCleaning(false);
    }
  };

  const { Text } = Typography;

  return (
    <Modal
      title={t('令牌模型限制中存在已无渠道提供的模型')}
      visible={visible}
      onCancel={onClose}
      width={640}
      okText={t('清理选中的失效模型')}
      cancelText={t('关闭')}
      okButtonProps={{ disabled: selectedCount === 0, loading: cleaning }}
      onOk={handleCleanup}
    >
      <Text type='tertiary' size='small'>
        {t(
          '以下模型已无任何启用渠道提供。条目已保留，渠道恢复提供后自动生效，可按需手动移除。',
        )}
      </Text>
      <div className='mt-3 max-h-[50vh] overflow-y-auto space-y-2.5 pr-1'>
        {report.tokens.map((token) => {
          const checked = tokenSelection(token);
          const focused = focusTokenId === token.token_id;
          return (
            <div
              key={token.token_id}
              data-stale-token-id={token.token_id}
              className={`rounded-xl border p-3 transition-colors ${
                focused
                  ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-900/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className='mb-2 flex items-center justify-between gap-2'>
                <Text
                  strong
                  ellipsis={{ showTooltip: true }}
                  className='min-w-0'
                >
                  {token.token_name}
                </Text>
                <span className='flex shrink-0 items-center gap-1'>
                  <Button
                    theme='borderless'
                    type='tertiary'
                    size='small'
                    onClick={() =>
                      setSelection((prev) => ({
                        ...prev,
                        [token.token_id]: [...token.stale_models],
                      }))
                    }
                  >
                    {t('全选')}
                  </Button>
                  <Button
                    theme='borderless'
                    type='tertiary'
                    size='small'
                    onClick={() =>
                      setSelection((prev) => ({
                        ...prev,
                        [token.token_id]: [],
                      }))
                    }
                  >
                    {t('取消全选')}
                  </Button>
                </span>
              </div>
              <div className='grid gap-1.5 sm:grid-cols-2'>
                {token.stale_models.map((model) => (
                  <Checkbox
                    key={model}
                    checked={checked.includes(model)}
                    onChange={(e) =>
                      toggleModel(token.token_id, model, e.target.checked)
                    }
                  >
                    <span className='break-all'>{model}</span>
                  </Checkbox>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <Text type='tertiary' size='small' className='mt-3 block'>
        {t(
          '勾选的模型将被移除，未勾选的失效模型保留，渠道恢复提供后自动重新生效。',
        )}
      </Text>
    </Modal>
  );
};
