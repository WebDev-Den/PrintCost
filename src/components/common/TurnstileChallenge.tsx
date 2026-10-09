import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnstileAction } from '../../domain/turnstile.ts';
import { isLocalCaptchaBypass } from '../../services/turnstileService.ts';
import { Button } from './Button.tsx';

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    action: TurnstileAction;
    theme: 'auto';
    language: 'uk';
    size: 'flexible';
    retry: 'never';
    'response-field': false;
    'refresh-expired': 'auto';
    'refresh-timeout': 'manual';
    callback(token: string): void;
    'expired-callback'(): void;
    'error-callback'(): void;
    'timeout-callback'(): void;
  }): string;
  remove(widgetId: string): void;
}

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const captchaWindow = () => window as Window & { turnstile?: TurnstileApi };
let loader: { promise: Promise<TurnstileApi>; users: number; cancel: () => void } | null = null;

function acquireTurnstile() {
  if (!loader) {
    let cancel = () => {};
    const promise = new Promise<TurnstileApi>((resolve, reject) => {
      const existingApi = captchaWindow().turnstile;
      const script = existingApi ? null : document.createElement('script');
      let settled = false;
      const cleanup = () => {
        window.clearTimeout(timer);
        script?.removeEventListener('load', onLoad);
        script?.removeEventListener('error', onError);
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        script?.remove();
        reject(new Error('Не вдалося завантажити перевірку Cloudflare. Перевірте інтернет або блокувальник вмісту й повторіть спробу.'));
      };
      const onLoad = () => {
        const api = captchaWindow().turnstile;
        if (!api) { fail(); return; }
        if (settled) return;
        // The script's load event is ready; Turnstile.ready rejects async script tags.
        settled = true;
        cleanup();
        resolve(api);
      };
      const onError = () => fail();
      const timer = window.setTimeout(fail, 30_000);
      cancel = fail;
      if (script) {
        script.src = scriptUrl;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', onLoad);
        script.addEventListener('error', onError);
        try { document.head.appendChild(script); } catch { fail(); }
      } else onLoad();
    });
    const request = { promise, users: 0, cancel };
    loader = request;
    void promise.catch(() => { if (loader === request) loader = null; });
  }
  const request = loader;
  request.users += 1;
  return {
    promise: request.promise,
    release: () => {
      request.users -= 1;
      // React StrictMode may immediately mount a second consumer of the same script.
      queueMicrotask(() => {
        if (request.users === 0 && loader === request) {
          loader = null;
          request.cancel();
        }
      });
    },
  };
}

export const TurnstileChallenge: React.FC<{
  action: TurnstileAction;
  onToken: (token: string) => void;
}> = ({ action, onToken }) => {
  const container = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || '';

  useEffect(() => {
    if (!sitekey || !container.current) return;
    let active = true;
    const revision = ++generation.current;
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    const invalidate = (message: string) => {
      if (!active || generation.current !== revision) return;
      onTokenRef.current('');
      setIsLoading(false);
      setError(message);
    };
    setIsLoading(true);
    setError(null);
    onTokenRef.current('');
    const request = acquireTurnstile();
    void request.promise.then(loaded => {
      if (!active || generation.current !== revision || !container.current) return;
      api = loaded;
      widgetId = loaded.render(container.current, {
        sitekey, action, theme: 'auto', language: 'uk', size: 'flexible', retry: 'never',
        'response-field': false, 'refresh-expired': 'auto', 'refresh-timeout': 'manual',
        callback: token => {
          if (!active || generation.current !== revision) return;
          onTokenRef.current(token);
          setIsLoading(false);
          setError(null);
        },
        'expired-callback': () => invalidate('Термін перевірки вичерпано. Пройдіть перевірку ще раз.'),
        'error-callback': () => invalidate('Перевірка Cloudflare не вдалася. Повторіть спробу.'),
        'timeout-callback': () => invalidate('Час перевірки вичерпано. Повторіть спробу.'),
      });
      if (active) setIsLoading(false);
    }).catch(error => invalidate(error instanceof Error ? error.message : 'Перевірка Cloudflare недоступна. Повторіть спробу.'));
    return () => {
      active = false;
      if (widgetId !== undefined) {
        try { api?.remove(widgetId); } catch { /* The provider may already have removed an expired widget. */ }
      }
      container.current?.replaceChildren();
      request.release();
    };
  }, [sitekey, action, attempt]);

  if (!sitekey) return <p role="alert" className="text-xs text-red-600 dark:text-red-400">Перевірку Cloudflare ще не налаштовано. Зверніться до адміністратора сайту.</p>;

  return <div className="min-w-0 space-y-2">
    <div ref={container} aria-label="Перевірка Cloudflare" />
    {isLoading && <p role="status" className="text-xs text-neutral-500 dark:text-neutral-400">Завантаження перевірки Cloudflare…</p>}
    {error && <div className="space-y-2">
      <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => {
        generation.current += 1;
        onTokenRef.current('');
        setAttempt(value => value + 1);
      }}>Повторити перевірку</Button>
    </div>}
  </div>;
};

export function useTurnstile(action: TurnstileAction, enabled = true) {
  const [token, setToken] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const reset = useCallback(() => {
    generation.current += 1;
    setToken('');
    setRevision(value => value + 1);
  }, []);
  const onToken = useCallback((next: string) => {
    if (generation.current === revision) setToken(next);
  }, [revision]);
  const bypass = isLocalCaptchaBypass();
  return {
    token,
    ready: enabled && (bypass || Boolean(token)),
    reset,
    field: enabled && !bypass ? <TurnstileChallenge key={revision} action={action} onToken={onToken} /> : null,
  };
}
