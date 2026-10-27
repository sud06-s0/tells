// src/pip.ts
// Video call check "Pop out": a small always-on-top window (Document Picture-in-Picture,
// Chrome and Edge on desktop) so reminders stay visible over your call.

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

const api = () => (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;

export const canPopOut = () => !!api();

/** Opens the pop-out window and moves `content` into it. Resolves with the new window. */
export async function popOut(content: HTMLElement, title: string, onClose: () => void) {
  const pip = await api()!.requestWindow({ width: 340, height: 320 });

  // Bring the page's styles along (inline rules where readable, otherwise the <link>).
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
      pip.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = pip.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pip.document.head.appendChild(link);
      }
    }
  }
  pip.document.title = title;
  pip.document.documentElement.lang = document.documentElement.lang;
  pip.document.body.className = document.body.className;
  pip.document.body.style.margin = '0';
  pip.document.body.append(content);
  pip.addEventListener('pagehide', onClose, { once: true });
  return pip;
}
