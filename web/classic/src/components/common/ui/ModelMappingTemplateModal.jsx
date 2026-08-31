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
import { Banner, Button, Input, Modal, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconPlus } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';

import {
  persistModelMappingTemplates,
  upsertModelMappingTemplate,
} from '../../../helpers/modelMapping';

const { Text } = Typography;

const mappingToRows = (mapping) =>
  Object.entries(mapping || {}).map(([from, to], index) => ({
    id: `tpl-row-${index}`,
    from,
    to: String(to ?? ''),
  }));

/**
 * Manages the locally stored model redirect templates: rename, edit the mapping
 * itself, delete, or create one. Kept separate from JSONEditor so a template can
 * be changed without first applying it to the channel being edited.
 */
const ModelMappingTemplateModal = ({
  visible,
  onCancel,
  templates,
  onTemplatesChange,
  initialMapping,
}) => {
  const { t } = useTranslation();
  const [draftId, setDraftId] = useState('');
  const [draftName, setDraftName] = useState('');
  const [rows, setRows] = useState([]);
  const [rowSeq, setRowSeq] = useState(0);
  const [error, setError] = useState('');

  // Every opening starts on a fresh draft: the mapping the caller handed over,
  // or an empty one.
  useEffect(() => {
    if (!visible) return;
    setDraftId('');
    setDraftName('');
    setRows(mappingToRows(initialMapping));
    setRowSeq(Object.keys(initialMapping || {}).length);
    setError('');
  }, [visible, initialMapping]);

  const nextRowId = () => {
    const id = `tpl-row-new-${rowSeq}`;
    setRowSeq((prev) => prev + 1);
    return id;
  };

  const selectTemplate = (template) => {
    setDraftId(template.id);
    setDraftName(template.name);
    setRows(mappingToRows(template.mapping));
    setError('');
  };

  const startNewDraft = () => {
    setDraftId('');
    setDraftName('');
    setRows([]);
    setError('');
  };

  const updateRow = (id, field, value) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
    setError('');
  };

  const handleSave = () => {
    const name = draftName.trim();
    if (!name) {
      setError(t('请输入模板名称'));
      return;
    }

    const mapping = {};
    const duplicates = [];
    for (const row of rows) {
      const from = row.from.trim();
      if (!from) continue;
      if (Object.prototype.hasOwnProperty.call(mapping, from)) {
        duplicates.push(from);
        continue;
      }
      mapping[from] = row.to.trim();
    }

    if (duplicates.length > 0) {
      setError(`${t('重复的源模型')}: ${duplicates.join(', ')}`);
      return;
    }
    if (Object.keys(mapping).length === 0) {
      setError(t('请先添加至少一条映射'));
      return;
    }

    // A second template under the same name would be indistinguishable in the
    // list, so reject instead of silently merging the two.
    const clash = templates.find(
      (item) => item.name === name && item.id !== draftId,
    );
    if (clash) {
      setError(t('已有同名模板'));
      return;
    }

    const next = upsertModelMappingTemplate(templates, {
      id: draftId || `model-mapping-${Date.now()}`,
      name,
      mapping,
    });
    if (!persistModelMappingTemplates(next)) {
      setError(t('保存失败'));
      return;
    }
    onTemplatesChange(next);
    onCancel();
  };

  const handleDelete = (template) => {
    Modal.confirm({
      title: t('删除模板？'),
      content: `${t('模板')} "${template.name}" ${t('将从此浏览器中移除。')}`,
      okText: t('删除'),
      cancelText: t('取消'),
      okButtonProps: { type: 'danger' },
      onOk: () => {
        const next = templates.filter((item) => item.id !== template.id);
        if (!persistModelMappingTemplates(next)) {
          setError(t('保存失败'));
          return;
        }
        onTemplatesChange(next);
        if (draftId === template.id) startNewDraft();
      },
    });
  };

  return (
    <Modal
      title={t('管理模型重定向模板')}
      visible={visible}
      onCancel={onCancel}
      width={760}
      className='!rounded-lg'
      footer={
        <div className='flex justify-end gap-2'>
          <Button type='tertiary' onClick={onCancel}>
            {t('取消')}
          </Button>
          <Button onClick={handleSave}>
            {draftId ? t('保存修改') : t('新建模板')}
          </Button>
        </div>
      }
    >
      <Banner
        type='info'
        closeIcon={null}
        className='!rounded-lg mb-3'
        description={t(
          '模板保存在当前浏览器，不属于任何渠道；在此编辑不会改动正在编辑的渠道映射。',
        )}
      />

      {error ? (
        <Banner
          type='danger'
          closeIcon={null}
          className='!rounded-lg mb-3'
          description={error}
        />
      ) : null}

      <div className='flex flex-col gap-4 sm:flex-row'>
        <div className='w-full shrink-0 sm:w-56'>
          <div className='mb-2 flex items-center justify-between'>
            <Text strong>{t('模板')}</Text>
            <Button
              theme='borderless'
              type='tertiary'
              size='small'
              icon={<IconPlus />}
              onClick={startNewDraft}
            >
              {t('新建')}
            </Button>
          </div>
          {templates.length === 0 ? (
            <div className='rounded-lg border border-dashed border-[var(--semi-color-border)] px-2 py-6 text-center'>
              <Text type='tertiary' size='small'>
                {t('暂无保存的模板')}
              </Text>
            </div>
          ) : (
            <div className='flex flex-col gap-1'>
              {templates.map((template) => (
                <div key={template.id} className='flex items-center gap-1'>
                  <Button
                    theme={template.id === draftId ? 'light' : 'borderless'}
                    type='tertiary'
                    size='small'
                    className='min-w-0 flex-1 !justify-start'
                    onClick={() => selectTemplate(template)}
                  >
                    <span className='flex w-full min-w-0 justify-between gap-2'>
                      <span className='truncate'>{template.name}</span>
                      <span className='text-xs opacity-60'>
                        {Object.keys(template.mapping).length}
                      </span>
                    </span>
                  </Button>
                  <Button
                    theme='borderless'
                    type='danger'
                    size='small'
                    icon={<IconDelete />}
                    aria-label={`${t('删除')}: ${template.name}`}
                    onClick={() => handleDelete(template)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className='min-w-0 flex-1'>
          <div className='mb-3'>
            <Text strong className='mb-1 block'>
              {t('模板名称')}
            </Text>
            <Input
              value={draftName}
              onChange={(value) => {
                setDraftName(value);
                setError('');
              }}
              placeholder={t('新建')}
            />
          </div>

          <Text strong className='mb-1 block'>
            {t('模型重定向')}
          </Text>
          {rows.length === 0 ? (
            <div className='mb-2 rounded-lg border border-dashed border-[var(--semi-color-border)] px-2 py-6 text-center'>
              <Text type='tertiary' size='small'>
                {t('暂无映射，点击下方按钮添加。')}
              </Text>
            </div>
          ) : (
            <div className='mb-2 flex flex-col gap-2'>
              {rows.map((row) => (
                <div key={row.id} className='flex items-center gap-2'>
                  <Input
                    value={row.from}
                    onChange={(value) => updateRow(row.id, 'from', value)}
                    placeholder='client-model'
                    className='min-w-0 flex-1'
                  />
                  <Input
                    value={row.to}
                    onChange={(value) => updateRow(row.id, 'to', value)}
                    placeholder='upstream-model'
                    className='min-w-0 flex-1'
                  />
                  <Button
                    theme='borderless'
                    type='danger'
                    size='small'
                    icon={<IconDelete />}
                    aria-label={t('删除')}
                    onClick={() =>
                      setRows((prev) =>
                        prev.filter((item) => item.id !== row.id),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <Button
            theme='light'
            type='tertiary'
            size='small'
            icon={<IconPlus />}
            className='w-full'
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { id: nextRowId(), from: '', to: '' },
              ])
            }
          >
            {t('添加映射')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ModelMappingTemplateModal;
