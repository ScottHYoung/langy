export function highlightFocus(sentence) {
  if (!sentence || !sentence.text || !sentence.focus) {
    return '';
  }
  const focus = sentence.focus;
  const escaped = focus.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlight = `<span class="rounded-md bg-amber-200 px-1 text-slate-900">${focus}</span>`;
  return sentence.text.replace(new RegExp(escaped, 'g'), highlight);
}
