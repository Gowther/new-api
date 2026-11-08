/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import React from 'react';
import { Modal, Table } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { buildPriceChanges } from '../../../shared/price-changes';
import { showWarning } from '../helpers';

function PriceChangeReview({ changes }) {
  const { t } = useTranslation();
  const labels = {
    ModelPrice: t('模型固定价格'), ModelRatio: t('模型倍率'),
    CacheRatio: t('提示缓存倍率'), CreateCacheRatio: t('缓存创建倍率'),
    CompletionRatio: t('补全倍率'), ImageRatio: t('图片倍率'),
    AudioRatio: t('音频倍率'), AudioCompletionRatio: t('音频补全倍率'),
    'billing_setting.billing_mode': t('计费模式'),
    'billing_setting.billing_expr': t('计费表达式'),
    ModelPriceReference: t('价格跟随绑定'), ExposeRatioEnabled: t('暴露倍率接口'),
  };
  return <Table dataSource={changes} rowKey={(row) => `${row.field}:${row.model}`}
    pagination={false} scroll={{ y: 440, x: 700 }} size='small'
    columns={[
      { title: t('模型'), dataIndex: 'model', width: 180 },
      { title: t('Setting'), dataIndex: 'field', width: 160, render: (field) => labels[field] || field },
      ...['before', 'after'].map((key) => ({ title: key === 'before' ? t('Before') : t('After'), dataIndex: key, width: 180,
        render: (value) => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value === undefined ? t('Not set') : String(value)}</span>,
      })),
    ]} />;
}

export function confirmPriceChanges(before, after, onSave, t) {
  const changes = buildPriceChanges(before, after);
  if (!changes.length) {
    showWarning(t('No model price changes to save'));
    return;
  }
  Modal.confirm({
    title: t('Review price changes'),
    content: <><p>{t('Review the values below before saving.')}</p><PriceChangeReview changes={changes} /></>,
    width: 900, centered: true,
    okText: t('Confirm and save'), cancelText: t('取消'),
    maskClosable: false, onOk: onSave,
  });
}
