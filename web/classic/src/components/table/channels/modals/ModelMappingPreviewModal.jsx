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
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';

const { Text } = Typography;

const ModelMappingPreviewModal = (props) => {
  const { t } = useTranslation();
  const preview = props.preview;
  const columns = useMemo(
    () => [
      {
        title: t('上游模型'),
        dataIndex: 'upstream_model',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('对外模型名'),
        dataIndex: 'exposed_model',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('规则'),
        render: (_value, record) =>
          `${record.match_mode === 'exact' ? t('完全匹配') : t('包含匹配')} · ${record.match_value}`,
      },
      {
        title: t('状态'),
        dataIndex: 'status',
        render: (value) => (
          <Tag color={value === 'applied' ? 'green' : 'orange'}>
            {value === 'applied' ? t('可应用') : t('冲突')}
          </Tag>
        ),
      },
    ],
    [t],
  );

  return (
    <Modal
      title={t('智能模型映射预览')}
      visible={props.visible}
      onCancel={props.onCancel}
      onOk={() => props.onApply(preview)}
      okText={t('应用到表单')}
      cancelText={t('取消')}
      okButtonProps={{ disabled: !preview?.has_changes }}
      width={760}
    >
      {preview && (
        <Space
          vertical
          align='start'
          spacing='medium'
          style={{ width: '100%' }}
        >
          {preview.has_conflicts && (
            <Banner
              type='warning'
              description={t(
                '存在映射冲突的规则不会被自动应用，请手动调整后重新预览。',
              )}
            />
          )}
          {!preview.has_changes && !preview.has_conflicts && (
            <Banner type='info' description={t('没有匹配到映射规则。')} />
          )}
          <div className='grid w-full grid-cols-1 gap-3 sm:grid-cols-2'>
            <div className='rounded border p-3'>
              <Text type='tertiary' size='small'>
                {t('移除模型')}
              </Text>
              <div className='mt-1 break-all'>
                {(preview.removed_models || []).join(', ') || '-'}
              </div>
            </div>
            <div className='rounded border p-3'>
              <Text type='tertiary' size='small'>
                {t('添加模型')}
              </Text>
              <div className='mt-1 break-all'>
                {(preview.added_models || []).join(', ') || '-'}
              </div>
            </div>
          </div>
          <Table
            columns={columns}
            dataSource={preview.changes || []}
            rowKey={(record) =>
              `${record.upstream_model}-${record.exposed_model}`
            }
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        </Space>
      )}
    </Modal>
  );
};

export default ModelMappingPreviewModal;
