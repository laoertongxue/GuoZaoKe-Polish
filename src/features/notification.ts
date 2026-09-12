// Move the native notification link; its unread state and click handlers remain
// owned by Guozaoke. Restore it when the sidebar is unavailable or hidden.
export function positionNotification(enabled: boolean) {
  const link = document.querySelector<HTMLElement>('.top-navbar .notification-indicator');
  const card = document.querySelector<HTMLElement>('.sidebar-right .usercard > .ui-header');
  const narrow = matchMedia('(max-width:991px)');
  const placeholder = document.createComment('gzk-notification');
  if (link && card) link.before(placeholder);
  function update(active = enabled) {
    enabled = active;
    if (!link || !card) return;
    const move = enabled && !narrow.matches;
    if (move) card.append(link); else placeholder.after(link);
    link.classList.toggle('gzk-notification-in-card', move);
    card.classList.toggle('gzk-account-notification', move);
  }
  const resize = () => update();
  update(); narrow.addEventListener('change', resize);
  return { update, destroy() { update(false); placeholder.remove(); narrow.removeEventListener('change', resize); } };
}
