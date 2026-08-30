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
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CHANNEL_CREATED_EVENT,
  channelConnectionPasteClaim,
  isAdmin,
  parseChannelConnectionString,
  readClipboardWhenAllowed,
  showSuccess,
} from '../../helpers';
import { UserContext } from '../../context/User';
import EditChannelModal from '../table/channels/modals/EditChannelModal';

const EMPTY_CHANNEL = {};

/** 与弹窗关闭动画对齐，密钥留到弹窗真正消失之后再清掉 */
const MODAL_EXIT_MS = 300;

/**
 * 把「渠道连接信息」的粘贴变成一个直接打开的新建渠道弹窗，不必先切到渠道管理页。
 *
 * 走 paste 事件而不是 navigator.clipboard.readText()：事件自带剪贴板数据，
 * 既不需要读取权限，也不需要额外的按钮。
 */
const ChannelPasteListener = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [userState] = useContext(UserContext);
  const [pasted, setPasted] = useState(null);
  const [visible, setVisible] = useState(false);
  // 剪贴板里那份配置会一直躺着，所以记住已经提过什么：反复切标签页不该重复弹，
  // 用户关掉之后再切回来也不该再弹。只放内存，密钥不该写进 localStorage。
  const offeredRef = useRef(null);

  const offer = useCallback(
    (text, config) => {
      offeredRef.current = text;
      setPasted(config);
      setVisible(true);
      showSuccess(t('连接信息已填入'));
    },
    [t],
  );

  useEffect(() => {
    if (!isAdmin()) return;

    const onPaste = (event) => {
      const text = event.clipboardData?.getData('text');
      const config = channelConnectionPasteClaim(text, event.target);
      if (!config || !text) return;
      event.preventDefault();
      offer(text, config);
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // isAdmin() 读的是 localStorage，登录后要跟着重新判定
  }, [offer, userState?.user]);

  // 复制发生在另一个标签页，那时本页在后台、根本读不了剪贴板。切回来是第一个
  // 允许读的时机，所以在这时候提示，不需要按键。
  useEffect(() => {
    if (!isAdmin()) return;

    const onFocus = async () => {
      const text = await readClipboardWhenAllowed();
      if (text === null || text === offeredRef.current) return;
      // 用户已经开着弹窗时不要再叠一个
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return;
      }
      const config = parseChannelConnectionString(text);
      if (config) offer(text, config);
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [offer, userState?.user]);

  // 弹窗消失后再丢掉粘贴进来的密钥，留出关闭动画的时间
  useEffect(() => {
    if (visible || !pasted) return;
    const timer = window.setTimeout(() => setPasted(null), MODAL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [visible, pasted]);

  // 加完渠道通常紧接着要调优先级、或者把它设成临时单渠道，这两件事都在路由表里。
  // 创建响应不带渠道 ID，但路由表是按模型组织的，所以点名一个该渠道服务的模型就够
  // 落到它那一行——工作台会从这个模型推出 vendor。
  const followToRouting = useCallback(
    (createdModels) => {
      const [firstByName] = [...createdModels].sort((a, b) =>
        a.localeCompare(b),
      );
      if (!firstByName) return;
      const params = new URLSearchParams({
        tab: 'routing',
        routing_model: firstByName,
      });
      navigate(`/console/models?${params.toString()}`);
    },
    [navigate],
  );

  const initialValues = useMemo(() => {
    if (!pasted) return undefined;
    const values = { key: pasted.key, base_url: pasted.url };
    if (pasted.name) values.name = pasted.name;
    if (pasted.remark) values.remark = pasted.remark;
    return values;
  }, [pasted]);

  if (!pasted) return null;

  return (
    <EditChannelModal
      visible={visible}
      editingChannel={EMPTY_CHANNEL}
      initialValues={initialValues}
      onCreated={followToRouting}
      handleClose={() => setVisible(false)}
      refresh={() => {
        // 渠道管理页可能已经挂载，通知它自己刷新
        window.dispatchEvent(new Event(CHANNEL_CREATED_EVENT));
      }}
    />
  );
};

export default ChannelPasteListener;
