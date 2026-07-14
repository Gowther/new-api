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
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Form,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlus } from '@douyinfe/semi-icons';

import { API, showError, showInfo, showSuccess } from '../../../helpers';

const { Text } = Typography;
const OPTION_KEY = 'channel_quick_mapping_setting.rules';

const emptyRule = {
  match_mode: 'contains',
  match_value: '',
  case_sensitive: false,
  alias_model: '',
  enabled: true,
};

const parseRules = (rawValue) => {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((rule) => rule && typeof rule === 'object')
      : [];
  } catch {
    return [];
  }
};

const normalizeRule = (rule) => ({
  match_mode: rule.match_mode === 'exact' ? 'exact' : 'contains',
  match_value: String(rule.match_value || '').trim(),
  case_sensitive: Boolean(rule.case_sensitive),
  alias_model: String(rule.alias_model || '').trim(),
  enabled: rule.enabled !== false,
});

const SettingChannelQuickMapping = (props) => {
  const { t } = useTranslation();
  const [rules, setRules] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [draftRule, setDraftRule] = useState(emptyRule);
  const [editorVisible, setEditorVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRules(parseRules(props.options?.[OPTION_KEY]).map(normalizeRule));
  }, [props.options]);

  const columns = useMemo(
    () => [
      {
        title: t('匹配方式'),
        dataIndex: 'match_mode',
        render: (value, record) => (
          <Space vertical spacing={2} align='start'>
            <Tag color='blue'>
              {value === 'exact' ? t('完全匹配') : t('包含匹配')}
            </Tag>
            <Text size='small' type='tertiary'>
              {record.case_sensitive ? t('区分大小写') : t('忽略大小写')}
            </Text>
          </Space>
        ),
      },
      {
        title: t('匹配内容'),
        dataIndex: 'match_value',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('配置模型'),
        dataIndex: 'alias_model',
        render: (value) => <code>{value}</code>,
      },
      {
        title: t('启用'),
        dataIndex: 'enabled',
        render: (value) => (
          <Tag color={value ? 'green' : 'grey'}>
            {value ? t('是') : t('否')}
          </Tag>
        ),
      },
      {
        title: t('操作'),
        render: (_value, _record, index) => (
          <Space>
            <Button
              theme='borderless'
              icon={<IconEdit />}
              onClick={() => {
                setEditingIndex(index);
                setDraftRule(normalizeRule(rules[index]));
                setEditorVisible(true);
              }}
            />
            <Button
              theme='borderless'
              type='danger'
              icon={<IconDelete />}
              onClick={() => {
                setRules((currentRules) =>
                  currentRules.filter(
                    (_rule, ruleIndex) => ruleIndex !== index,
                  ),
                );
              }}
            />
          </Space>
        ),
      },
    ],
    [rules, t],
  );

  const openNewRuleEditor = () => {
    setEditingIndex(null);
    setDraftRule(emptyRule);
    setEditorVisible(true);
  };

  const saveRule = () => {
    const nextRule = normalizeRule(draftRule);
    if (!nextRule.match_value || !nextRule.alias_model) {
      showInfo(t('请填写匹配内容和配置模型'));
      return;
    }
    const duplicateAlias = rules.some(
      (rule, index) =>
        index !== editingIndex &&
        rule.alias_model.toLowerCase() === nextRule.alias_model.toLowerCase(),
    );
    if (duplicateAlias) {
      showInfo(t('每个配置模型只能添加一次'));
      return;
    }
    setRules((currentRules) => {
      if (editingIndex === null) return [...currentRules, nextRule];
      return currentRules.map((rule, index) =>
        index === editingIndex ? nextRule : rule,
      );
    });
    setEditorVisible(false);
  };

  const saveRules = async () => {
    setSaving(true);
    try {
      const response = await API.put('/api/option/', {
        key: OPTION_KEY,
        value: JSON.stringify(rules),
      });
      if (!response?.data?.success) {
        throw new Error(response?.data?.message || t('保存失败'));
      }
      showSuccess(t('快捷映射规则已保存'));
      props.refresh();
    } catch (error) {
      showError(error?.message || t('保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Form.Section text={t('渠道快捷映射规则')}>
        <Banner
          type='info'
          description={t(
            '新增或编辑渠道选择模型后，命中规则时只提示可选映射；原模型会保留，目标模型可从本次全部选择的模型中任选。',
          )}
          className='mb-4'
        />
        <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
          <Text type='tertiary' size='small'>
            {t(
              '当配置模型已在上游模型列表中，或已有对应映射时，不会显示提示。',
            )}
          </Text>
          <Button
            theme='solid'
            type='primary'
            icon={<IconPlus />}
            onClick={openNewRuleEditor}
          >
            {t('新增规则')}
          </Button>
        </div>
        <Table
          columns={columns}
          dataSource={rules}
          rowKey={(_record, index) => index}
          pagination={false}
          empty={t('暂无快捷映射规则')}
          scroll={{ x: 'max-content' }}
        />

        <div className='mt-4 flex justify-end'>
          <Button
            theme='solid'
            type='primary'
            loading={saving}
            onClick={saveRules}
          >
            {t('保存快捷映射规则')}
          </Button>
        </div>
      </Form.Section>

      <Modal
        title={t(
          editingIndex === null ? '新增快捷映射规则' : '编辑快捷映射规则',
        )}
        visible={editorVisible}
        onCancel={() => setEditorVisible(false)}
        onOk={saveRule}
        okText={t('保存')}
        cancelText={t('取消')}
      >
        <Form labelPosition='top'>
          <Form.Select
            label={t('匹配方式')}
            value={draftRule.match_mode}
            optionList={[
              { value: 'exact', label: t('完全匹配') },
              { value: 'contains', label: t('包含匹配') },
            ]}
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, match_mode: value }))
            }
          />
          <Form.Input
            label={t('匹配内容')}
            value={draftRule.match_value}
            placeholder='gpt-'
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, match_value: value }))
            }
          />
          <Form.Input
            label={t('配置模型')}
            value={draftRule.alias_model}
            placeholder='codex-auto-review'
            onChange={(value) =>
              setDraftRule((rule) => ({ ...rule, alias_model: value }))
            }
            extraText={t(
              '当满足匹配条件且上游没有该模型时，提示将该模型映射到你选择的任意渠道模型。',
            )}
          />
          <div className='flex items-center justify-between py-2'>
            <Text>{t('区分大小写')}</Text>
            <Switch
              checked={draftRule.case_sensitive}
              onChange={(checked) =>
                setDraftRule((rule) => ({ ...rule, case_sensitive: checked }))
              }
            />
          </div>
          <div className='flex items-center justify-between py-2'>
            <Text>{t('启用')}</Text>
            <Switch
              checked={draftRule.enabled}
              onChange={(checked) =>
                setDraftRule((rule) => ({ ...rule, enabled: checked }))
              }
            />
          </div>
        </Form>
      </Modal>
    </>
  );
};

export default SettingChannelQuickMapping;
