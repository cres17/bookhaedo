import type { Directive } from 'vue';
type DialogElement = HTMLElement & { dialogCleanup?: () => void };
export const dialog: Directive<DialogElement> = {
  mounted(el) {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]',
        ),
      );
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        el.querySelector<HTMLButtonElement>('.modal-close')?.click();
      }
      if (event.key === 'Tab') {
        const items = focusable(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener('keydown', handler);
    requestAnimationFrame(() => {
      if (el.isConnected)
        (el.querySelector<HTMLElement>('input,select') || focusable()[0])?.focus();
    });
    el.dialogCleanup = () => {
      el.removeEventListener('keydown', handler);
      if (previous?.isConnected) previous.focus();
    };
  },
  unmounted(el) {
    el.dialogCleanup?.();
  },
};
