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
import { useTranslation } from 'react-i18next';
import { Banner, Modal, Select, Space, Typography } from '@douyinfe/semi-ui';

const { Text } = Typography;

const QuickMappingSuggestionModal = (props) => {
  const { t } = useTranslation();
  const [assignments, setAssignments] = useState({});

  useEffect(() => {
    if (props.visible) {
      setAssignments({});
    }
  }, [props.visible, props.suggestions]);

  const hasAssignments = Object.values(assignments).some(Boolean);

  return (
    <Modal
      title={t('渠道快捷映射建议')}
      visible={props.visible}
      onCancel={props.onCancel}
      onOk={() => props.onApply(assignments)}
      okText={t('应用所选映射')}
      cancelText={t('跳过')}
      okButtonProps={{ disabled: !hasAssignments }}
      width={680}
    >
      <Space vertical spacing='medium' style={{ width: '100%' }}>
        <Banner
          type='info'
          description={t(
            '以下建议由已选模型触发。你可以为每个别名任选一个当前渠道模型作为目标，也可以全部跳过。',
          )}
        />
        <Text type='tertiary' size='small'>
          {t('上游原生支持或已有映射的别名不会显示在这里。')}
        </Text>
        {props.suggestions.map((suggestion) => (
          <div key={suggestion.alias_model} className='rounded border p-3'>
            <Text strong>
              {t('将 {{alias}} 映射到', { alias: suggestion.alias_model })}
            </Text>
            <Select
              className='mt-2 w-full'
              value={assignments[suggestion.alias_model]}
              placeholder={t('不添加此映射')}
              optionList={suggestion.candidate_models.map((model) => ({
                value: model,
                label: model,
              }))}
              showClear
              onChange={(value) => {
                setAssignments((currentAssignments) => {
                  const nextAssignments = { ...currentAssignments };
                  if (value) {
                    nextAssignments[suggestion.alias_model] = value;
                  } else {
                    delete nextAssignments[suggestion.alias_model];
                  }
                  return nextAssignments;
                });
              }}
            />
            <Text type='tertiary' size='small' className='mt-2 block'>
              {t('触发条件：{{mode}} {{value}}', {
                mode:
                  suggestion.match_mode === 'exact'
                    ? t('完全匹配')
                    : t('包含匹配'),
                value: suggestion.match_value,
              })}
            </Text>
          </div>
        ))}
      </Space>
    </Modal>
  );
};

export default QuickMappingSuggestionModal;
