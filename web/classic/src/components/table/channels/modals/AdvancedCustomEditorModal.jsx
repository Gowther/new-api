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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banner,
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import { IconDelete, IconPlus } from '@douyinfe/semi-icons';
import { showError } from '../../../../helpers';
import {
  ADVANCED_CUSTOM_AUTH_MODE_OPTIONS,
  ADVANCED_CUSTOM_CONVERTER_OPTIONS,
  ADVANCED_CUSTOM_INCOMING_PATH_OPTIONS,
  ADVANCED_CUSTOM_TEMPLATE_OPTIONS,
  buildAdvancedCustomAuth,
  createAdvancedCustomConfig,
  createAdvancedCustomRoute,
  getAdvancedCustomAuthMode,
  getAdvancedCustomConverterOptions,
  getAdvancedCustomTemplateConfig,
  getAdvancedCustomUpstreamPathPlaceholder,
  getDefaultAdvancedCustomIncomingPath,
  isAdvancedCustomIncomingPathAllowed,
  normalizeAdvancedCustomConfig,
  parseAdvancedCustomConfig,
  stringifyAdvancedCustomConfig,
  validateAdvancedCustomConfig,
} from './advancedCustom';

const { Text } = Typography;

const UPSTREAM_PATH_DESCRIPTION =
  'Use a path to append it to the channel Base URL, or enter a full URL to override the Base URL for this route.';

const getOptionLabel = (options, value) =>
  options.find((option) => option.value === value)?.label || value;

const AdvancedCustomEditorModal = ({ visible, value, onCancel, onSave }) => {
  const { t } = useTranslation();
  const routeKeyCounterRef = useRef(0);
  const initialConfig =
    parseAdvancedCustomConfig(value) || createAdvancedCustomConfig();
  const [config, setConfig] = useState(initialConfig);
  const [routeKeys, setRouteKeys] = useState(() =>
    normalizeAdvancedCustomConfig(initialConfig).advanced_routes.map(
      (_route, index) => `advanced-custom-route-initial-${index}`,
    ),
  );
  const [editMode, setEditMode] = useState('visual');
  const [jsonText, setJsonText] = useState(() =>
    stringifyAdvancedCustomConfig(initialConfig),
  );
  const [jsonError, setJsonError] = useState('');
  const [templateKey, setTemplateKey] = useState(
    ADVANCED_CUSTOM_TEMPLATE_OPTIONS[0]?.value || '',
  );

  useEffect(() => {
    if (!visible) return;
    const nextConfig =
      parseAdvancedCustomConfig(value) || createAdvancedCustomConfig();
    const normalized = normalizeAdvancedCustomConfig(nextConfig);
    setConfig(normalized);
    setRouteKeys(
      normalized.advanced_routes.map(
        (_route, index) => `advanced-custom-route-initial-${index}`,
      ),
    );
    setEditMode('visual');
    setJsonText(stringifyAdvancedCustomConfig(normalized));
    setJsonError('');
  }, [visible, value]);

  const normalizedConfig = useMemo(
    () => normalizeAdvancedCustomConfig(config),
    [config],
  );
  const routes = normalizedConfig.advanced_routes;
  const routeRows = routes.map((route, index) => ({
    route,
    routeKey:
      routeKeys[index] ||
      route.incoming_path ||
      route.upstream_path ||
      route.converter ||
      `advanced-custom-route-${index}`,
  }));
  const validationError = useMemo(
    () => validateAdvancedCustomConfig(normalizedConfig),
    [normalizedConfig],
  );

  const createRouteKey = () => {
    routeKeyCounterRef.current += 1;
    return `advanced-custom-route-${routeKeyCounterRef.current}`;
  };

  const updateRoute = (index, patch) => {
    setConfig((current) => {
      const next = normalizeAdvancedCustomConfig(current);
      const nextRoutes = [...next.advanced_routes];
      nextRoutes[index] = { ...nextRoutes[index], ...patch };
      return { ...next, advanced_routes: nextRoutes };
    });
  };

  const addRoute = () => {
    setConfig((current) => {
      const next = normalizeAdvancedCustomConfig(current);
      return {
        ...next,
        advanced_routes: [...next.advanced_routes, createAdvancedCustomRoute()],
      };
    });
    setRouteKeys((current) => [...current, createRouteKey()]);
  };

  const removeRoute = (index) => {
    setConfig((current) => {
      const next = normalizeAdvancedCustomConfig(current);
      return {
        ...next,
        advanced_routes: next.advanced_routes.filter(
          (_route, routeIndex) => routeIndex !== index,
        ),
      };
    });
    setRouteKeys((current) =>
      current.filter((_routeKey, routeIndex) => routeIndex !== index),
    );
  };

  const parseJsonEditorConfig = () => {
    const parsed = parseAdvancedCustomConfig(jsonText);
    if (!parsed) {
      setJsonError(t('Invalid JSON'));
      return null;
    }

    const error = validateAdvancedCustomConfig(parsed);
    if (error) {
      setJsonError(t(error.message));
      return null;
    }

    setJsonError('');
    return parsed;
  };

  const switchToVisualMode = () => {
    const parsed = parseJsonEditorConfig();
    if (!parsed) return;
    const normalized = normalizeAdvancedCustomConfig(parsed);
    setConfig(normalized);
    setRouteKeys(normalized.advanced_routes.map(() => createRouteKey()));
    setEditMode('visual');
  };

  const switchToJsonMode = () => {
    setJsonText(stringifyAdvancedCustomConfig(normalizedConfig));
    setJsonError('');
    setEditMode('json');
  };

  const formatJson = () => {
    const parsed = parseJsonEditorConfig();
    if (!parsed) return;
    setJsonText(stringifyAdvancedCustomConfig(parsed));
  };

  const applyTemplate = (mode) => {
    const templateConfig = getAdvancedCustomTemplateConfig(templateKey);
    let nextConfig = templateConfig;

    if (mode === 'append') {
      const baseConfig =
        editMode === 'json' ? parseJsonEditorConfig() : normalizedConfig;
      if (!baseConfig) return;
      nextConfig = {
        advanced_routes: [
          ...normalizeAdvancedCustomConfig(baseConfig).advanced_routes,
          ...normalizeAdvancedCustomConfig(templateConfig).advanced_routes,
        ],
      };
    }

    const normalized = normalizeAdvancedCustomConfig(nextConfig);
    setConfig(normalized);
    setRouteKeys(normalized.advanced_routes.map(() => createRouteKey()));
    setJsonText(stringifyAdvancedCustomConfig(normalized));
    setJsonError('');
  };

  const handleSave = () => {
    if (editMode === 'json') {
      const parsed = parseJsonEditorConfig();
      if (!parsed) {
        showError(t('Please fix JSON errors before saving'));
        return;
      }
      onSave(stringifyAdvancedCustomConfig(parsed));
      return;
    }

    if (validationError) {
      showError(t(validationError.message));
      return;
    }
    onSave(stringifyAdvancedCustomConfig(normalizedConfig));
  };

  const templateOptions = ADVANCED_CUSTOM_TEMPLATE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.label),
  }));

  return (
    <Modal
      title={t('Advanced Custom Routes')}
      visible={visible}
      onCancel={onCancel}
      onOk={handleSave}
      okText={t('Save changes')}
      cancelText={t('Cancel')}
      width={1120}
      bodyStyle={{ maxHeight: '76vh', overflowY: 'auto', paddingTop: 12 }}
    >
      <Space vertical spacing='medium' style={{ width: '100%' }}>
        <Card
          className='!rounded-xl !border-0 w-full'
          bodyStyle={{
            padding: 12,
            background: 'var(--semi-color-fill-0)',
          }}
        >
          <Space wrap spacing={8}>
            <Tag color='grey'>{t('Mode')}</Tag>
            <Button
              size='small'
              type={editMode === 'visual' ? 'primary' : 'tertiary'}
              onClick={switchToVisualMode}
            >
              {t('Visual')}
            </Button>
            <Button
              size='small'
              type={editMode === 'json' ? 'primary' : 'tertiary'}
              onClick={switchToJsonMode}
            >
              {t('JSON Text')}
            </Button>
            <Tag color='grey'>{t('Template')}</Tag>
            <Select
              value={templateKey}
              optionList={templateOptions}
              style={{ width: 280, maxWidth: '100%' }}
              onChange={(nextValue) =>
                setTemplateKey(
                  nextValue || ADVANCED_CUSTOM_TEMPLATE_OPTIONS[0]?.value || '',
                )
              }
            />
            <Button size='small' onClick={() => applyTemplate('fill')}>
              {t('Fill Template')}
            </Button>
            <Button
              size='small'
              type='tertiary'
              onClick={() => applyTemplate('append')}
            >
              {t('Append Template')}
            </Button>
          </Space>
        </Card>

        {editMode === 'visual' ? (
          <>
            <div className='flex items-center justify-between gap-3'>
              <Text type='tertiary' size='small'>
                {t(UPSTREAM_PATH_DESCRIPTION)}
              </Text>
              <Button size='small' icon={<IconPlus />} onClick={addRoute}>
                {t('Add route')}
              </Button>
            </div>

            {validationError && (
              <Banner
                type='warning'
                description={
                  validationError.routeIndex !== undefined
                    ? `${t('Route')} ${validationError.routeIndex + 1}: ${t(validationError.message)}`
                    : t(validationError.message)
                }
              />
            )}

            {routeRows.map(({ route, routeKey }, index) => (
              <RouteEditor
                key={routeKey}
                route={route}
                index={index}
                onChange={(patch) => updateRoute(index, patch)}
                onRemove={() => removeRoute(index)}
              />
            ))}
          </>
        ) : (
          <Card
            className='!rounded-xl !border-0 w-full'
            bodyStyle={{
              padding: 14,
              background: 'var(--semi-color-fill-0)',
            }}
          >
            <div className='flex items-center justify-between gap-3 mb-3'>
              <Text type='tertiary' size='small'>
                {t('Advanced text editing')}
              </Text>
              <Button size='small' type='tertiary' onClick={formatJson}>
                {t('Format')}
              </Button>
            </div>
            <TextArea
              value={jsonText}
              onChange={(nextValue) => {
                setJsonText(nextValue);
                if (jsonError) setJsonError('');
              }}
              placeholder={stringifyAdvancedCustomConfig(
                getAdvancedCustomTemplateConfig(templateKey),
              )}
              autosize={{ minRows: 18, maxRows: 28 }}
              className='font-mono text-xs'
            />
            <Text type='tertiary' size='small' className='mt-2 block'>
              {t('Edit JSON text directly. Format will be validated on save.')}
            </Text>
            {jsonError && (
              <Text type='danger' size='small' className='mt-1 block'>
                {jsonError}
              </Text>
            )}
          </Card>
        )}
      </Space>
    </Modal>
  );
};

const RouteEditor = ({ route, index, onChange, onRemove }) => {
  const { t } = useTranslation();
  const converter = route.converter || 'none';
  const authMode = getAdvancedCustomAuthMode(route);
  const incomingPath =
    route.incoming_path || getDefaultAdvancedCustomIncomingPath(converter);
  const incomingPathOptions = ADVANCED_CUSTOM_INCOMING_PATH_OPTIONS.map(
    (option) => ({
      value: option.value,
      label: `${t(option.label)} · ${option.value}`,
    }),
  );
  const converterOptions = getAdvancedCustomConverterOptions(incomingPath).map(
    (option) => ({ value: option.value, label: t(option.label) }),
  );
  const authOptions = ADVANCED_CUSTOM_AUTH_MODE_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.label),
  }));

  const setConverter = (nextConverter) => {
    const patch = { converter: nextConverter };
    if (!isAdvancedCustomIncomingPathAllowed(incomingPath, nextConverter)) {
      patch.incoming_path = getDefaultAdvancedCustomIncomingPath(nextConverter);
    }
    onChange(patch);
  };

  const setIncomingPath = (nextIncomingPath) => {
    const resolvedIncomingPath =
      nextIncomingPath || getDefaultAdvancedCustomIncomingPath(converter);
    const patch = { incoming_path: resolvedIncomingPath };
    if (!isAdvancedCustomIncomingPathAllowed(resolvedIncomingPath, converter)) {
      patch.converter = 'none';
    }
    onChange(patch);
  };

  const setAuthMode = (mode) =>
    onChange({ auth: buildAdvancedCustomAuth(mode, route.auth) });

  const updateAuth = (field, nextValue) => {
    if (!route.auth || route.auth.type === 'none') return;
    onChange({
      auth: {
        type: route.auth.type,
        name: route.auth.name || '',
        value: route.auth.value || '',
        [field]: nextValue,
      },
    });
  };

  return (
    <Card
      className='!rounded-xl !border-0 w-full'
      bodyStyle={{
        padding: 14,
        background: 'var(--semi-color-fill-0)',
      }}
    >
      <div className='flex items-center justify-between gap-3 mb-3'>
        <Space spacing={8}>
          <Text strong>{`${t('Route')} ${index + 1}`}</Text>
          <Tag color={converter === 'none' ? 'grey' : 'blue'}>
            {t(getOptionLabel(ADVANCED_CUSTOM_CONVERTER_OPTIONS, converter))}
          </Tag>
        </Space>
        <Button
          size='small'
          type='danger'
          theme='borderless'
          icon={<IconDelete />}
          onClick={onRemove}
        >
          {t('Delete')}
        </Button>
      </div>

      <Row gutter={12}>
        <Col xs={24} md={12} xl={6}>
          <FieldBlock label={t('Incoming path')}>
            <Select
              value={incomingPath}
              optionList={incomingPathOptions}
              style={{ width: '100%' }}
              onChange={setIncomingPath}
            />
          </FieldBlock>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <FieldBlock label={t('Upstream path')}>
            <Input
              value={route.upstream_path || ''}
              placeholder={getAdvancedCustomUpstreamPathPlaceholder(converter)}
              onChange={(nextValue) => onChange({ upstream_path: nextValue })}
            />
          </FieldBlock>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <FieldBlock label={t('Converter')}>
            <Select
              value={converter}
              optionList={converterOptions}
              style={{ width: '100%' }}
              onChange={setConverter}
            />
          </FieldBlock>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <FieldBlock label={t('Auth')}>
            <Select
              value={authMode}
              optionList={authOptions}
              style={{ width: '100%' }}
              onChange={setAuthMode}
            />
          </FieldBlock>
        </Col>
      </Row>

      {(authMode === 'header' || authMode === 'query') && (
        <Row gutter={12} className='mt-3 pt-3 border-t border-gray-100'>
          <Col xs={24} md={12}>
            <FieldBlock label={t('Auth name')}>
              <Input
                value={route.auth?.name || ''}
                placeholder={
                  authMode === 'header' ? 'Authorization' : 'api_key'
                }
                onChange={(nextValue) => updateAuth('name', nextValue)}
              />
            </FieldBlock>
          </Col>
          <Col xs={24} md={12}>
            <FieldBlock label={t('Auth value')}>
              <Input
                value={route.auth?.value || ''}
                placeholder={
                  authMode === 'header' ? 'Bearer {api_key}' : '{api_key}'
                }
                onChange={(nextValue) => updateAuth('value', nextValue)}
              />
            </FieldBlock>
          </Col>
        </Row>
      )}
    </Card>
  );
};

const FieldBlock = ({ label, children }) => (
  <div className='mb-3'>
    <Text size='small' className='mb-1 block'>
      {label}
    </Text>
    {children}
  </div>
);

export default AdvancedCustomEditorModal;
