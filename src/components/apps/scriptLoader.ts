const loadedScripts = new Map<string, Promise<void>>();
const loadedStyles = new Set<string>();

export function loadScript(src: string): Promise<void> {
  if (loadedScripts.has(src)) {
    return loadedScripts.get(src) as Promise<void>;
  }

  const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
  if (existing && existing.dataset.loaded === 'true') {
    return Promise.resolve();
  }

  const promise = new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    if (!existing) {
      document.body.appendChild(script);
    }
  });

  loadedScripts.set(src, promise);
  return promise;
}

export function loadStylesheet(href: string): void {
  if (loadedStyles.has(href)) {
    return;
  }
  if (document.querySelector(`link[href="${href}"]`)) {
    loadedStyles.add(href);
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  loadedStyles.add(href);
}
