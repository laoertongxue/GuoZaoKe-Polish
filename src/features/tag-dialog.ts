import { button, el, modal, toast } from '../shared/ui';

export function showTagDialog(username: string, tags: string[], save: (tags: string[]) => Promise<unknown>, viewAll: () => unknown) {
  const view = modal('设置用户标签');
  view.dialog.classList.add('gzk-tag-dialog');
  const description = el('label', '', 'gzk-tag-description');
  description.htmlFor = 'gzk-tag-input';
  description.append('对 ', el('strong', `@${username}`), ' 设置标签（用于个性化标记、筛选和快速检索），多个标签以逗号（，）分隔。');
  const input = el('textarea'); input.id = description.htmlFor; input.rows = 3;
  input.placeholder = '请输入标签，多个标签以逗号分隔'; input.value = tags.join('，');
  const error = el('p', '', 'error'); error.setAttribute('role', 'alert');
  view.body.append(description, input, error);
  const cancel = button('关闭', view.close); cancel.append(el('kbd', 'Esc'));
  let pending = false;
  const confirm = button('确认设置', async () => {
    if (pending) return;
    pending = true; confirm.disabled = true; error.textContent = '';
    try {
      await save(input.value.split(/[，,]/).map(tag => tag.trim()).filter(Boolean));
      view.close(); toast('用户标签已保存');
    } catch (reason) { error.textContent = reason instanceof Error ? reason.message : '保存失败，请重试'; }
    finally { pending = false; confirm.disabled = false; }
  }, 'gzk-button primary');
  const actions = el('div', '', 'actions'); actions.append(cancel, confirm);
  view.footer.append(button('查看全部标签', viewAll), actions); input.focus();
  return view;
}
