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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconPlus } from '@douyinfe/semi-icons';
import { useTranslation } from 'react-i18next';
import { API, showError, showSuccess } from '../../../helpers';

const { Text, Title } = Typography;

function parseReferenceBindings(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .filter(
        ([alias, source]) =>
          alias.trim() !== '' &&
          typeof source === 'string' &&
          source.trim() !== '',
      )
      .map(([alias, source]) => ({
        alias: alias.trim(),
        source: source.trim(),
      }))
      .sort((a, b) => a.alias.localeCompare(b.alias));
  } catch (e) {
    return [];
  }
}

function parseModelNames(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return Object.keys(parsed).filter(
      (name) => typeof name === 'string' && name.trim() !== '',
    );
  } catch (e) {
    return [];
  }
}

// 阶梯计费模型只配置在 billing_mode/billing_expr 里，也要作为跟随目标
function parseTieredModelNames(billingMode, billingExpr) {
  const names = new Set();
  try {
    const modes = JSON.parse(billingMode || '{}');
    if (modes && typeof modes === 'object' && !Array.isArray(modes)) {
      for (const [name, mode] of Object.entries(modes)) {
        if (mode === 'tiered_expr' && name.trim() !== '') {
          names.add(name);
        }
      }
    }
  } catch (e) {
    // ignore invalid JSON
  }
  try {
    const exprs = JSON.parse(billingExpr || '{}');
    if (exprs && typeof exprs === 'object' && !Array.isArray(exprs)) {
      for (const [name, expr] of Object.entries(exprs)) {
        if (
          typeof expr === 'string' &&
          expr.trim() !== '' &&
          name.trim() !== ''
        ) {
          names.add(name);
        }
      }
    }
  } catch (e) {
    // ignore invalid JSON
  }
  return [...names];
}

export default function PriceReferenceSettings({
  options,
  refresh,
  unsetModels = [],
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [savedValue, setSavedValue] = useState('{}');
  const [saving, setSaving] = useState(false);

  const serialize = useCallback((list) => {
    const map = {};
    for (const row of list) {
      const alias = (row.alias || '').trim();
      const source = (row.source || '').trim();
      if (alias !== '' && source !== '') {
        map[alias] = source;
      }
    }
    return JSON.stringify(map, null, 2);
  }, []);

  useEffect(() => {
    const bindings = parseReferenceBindings(options?.ModelPriceReference);
    setRows(bindings);
    setSavedValue(serialize(bindings));
  }, [options, serialize]);

  const pricedModelOptions = useMemo(() => {
    const names = new Set([
      ...parseModelNames(options?.ModelPrice),
      ...parseModelNames(options?.ModelRatio),
      ...parseTieredModelNames(
        options?.['billing_setting.billing_mode'],
        options?.['billing_setting.billing_expr'],
      ),
    ]);
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [options]);

  const aliasOptions = useMemo(() => {
    const names = new Set(unsetModels);
    rows.forEach((row) => {
      if ((row.alias || '').trim() !== '') {
        names.add(row.alias.trim());
      }
    });
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [unsetModels, rows]);

  const dirty = useMemo(
    () => serialize(rows) !== savedValue,
    [rows, savedValue, serialize],
  );

  const updateRow = (index, patch) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const removeRow = (index) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { alias: '', source: '' }]);
  };

  const save = async () => {
    const aliases = new Set();
    for (const row of rows) {
      const alias = (row.alias || '').trim();
      const source = (row.source || '').trim();
      if (alias === '' || source === '') {
        showError(t('每条绑定都需要填写别名模型和跟随模型'));
        return;
      }
      if (aliases.has(alias)) {
        showError(t('每个别名模型只能绑定一次'));
        return;
      }
      aliases.add(alias);
    }
    setSaving(true);
    try {
      const res = await API.put('/api/option/', {
        key: 'ModelPriceReference',
        value: serialize(rows),
      });
      if (!res.data?.success) {
        showError(res.data?.message || t('保存价格跟随绑定失败'));
        return;
      }
      showSuccess(t('价格跟随绑定已保存'));
      setSavedValue(serialize(rows));
      await refresh?.();
    } catch (error) {
      showError(t('保存价格跟随绑定失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid var(--semi-color-border)',
        borderRadius: 8,
      }}
    >
      <Title heading={6} style={{ marginTop: 0 }}>
        {t('价格跟随绑定')}
      </Title>
      <Text type='tertiary' style={{ display: 'block', marginBottom: 12 }}>
        {t(
          '将未定价的别名模型绑定到已定价的模型，别名未单独设置的价格项将取自所绑定的模型并自动跟随其变化，包括官方价格同步',
        )}
      </Text>

      {rows.length === 0 ? (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            border: '1px dashed var(--semi-color-border)',
            borderRadius: 6,
            color: 'var(--semi-color-text-2)',
          }}
        >
          {t(
            '还没有绑定。添加一条绑定，让未定价的别名模型跟随现有模型的价格。',
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, index) => (
            <div
              key={`${row.alias}-${index}`}
              style={{ display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <Select
                style={{ flex: 1 }}
                placeholder={t('别名模型')}
                filter
                allowCreate
                showClear
                optionList={aliasOptions}
                value={row.alias || undefined}
                onChange={(value) => updateRow(index, { alias: value || '' })}
              />
              <Select
                style={{ flex: 1 }}
                placeholder={t('跟随模型')}
                filter
                allowCreate
                showClear
                optionList={pricedModelOptions}
                value={row.source || undefined}
                onChange={(value) => updateRow(index, { source: value || '' })}
              />
              <Button
                type='danger'
                theme='light'
                icon={<IconDelete />}
                aria-label={t('移除绑定')}
                onClick={() => removeRow(index)}
              />
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        <Button icon={<IconPlus />} onClick={addRow}>
          {t('添加绑定')}
        </Button>
        <Button theme='solid' loading={saving} disabled={!dirty} onClick={save}>
          {t('保存绑定')}
        </Button>
      </div>
    </div>
  );
}
