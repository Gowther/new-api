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

// 聚焦当前展开的 Semi Select 下拉内的搜索框。
// Semi 的 autoFocus 属性在 searchPosition='dropdown' 时有缺陷：openMenu 回调
// 触发时下拉面板（Portal）尚未挂载，focusDropdownInput 会因 ref 为空而丢失，
// 导致搜索框仍需手动点击。因此在下一帧从最新的 Portal 中查找搜索框再聚焦。
export const focusSelectDropdownSearch = (visible) => {
  if (!visible) return;
  requestAnimationFrame(() => {
    const portals = document.querySelectorAll('.semi-portal');
    const portal = portals[portals.length - 1];
    const input = portal
      ? portal.querySelector('.semi-select-dropdown-search-wrapper input')
      : null;
    if (input) input.focus();
  });
};
