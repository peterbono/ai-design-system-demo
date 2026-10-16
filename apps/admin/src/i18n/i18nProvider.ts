import type { I18nProvider } from 'ra-core';
import { en, type Messages } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';

const DICTS: Record<Locale, Messages> = { en, fr };

function lookup(dict: Messages, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Polyglot-compatible formatting: `%{name}` placeholders and `one |||| many` plural forms. */
export function format(message: string, options: Record<string, unknown> = {}, locale: Locale = 'en'): string {
  let text = message;
  if (text.includes('||||')) {
    const forms = text.split('||||').map((f) => f.trim());
    const count = Number(options.smart_count ?? 0);
    const singular = locale === 'fr' ? count <= 1 : count === 1;
    text = (singular ? forms[0] : forms[1] ?? forms[0]) ?? '';
  }
  return text.replace(/%\{(\w+)\}/g, (_, name: string) => (options[name] ?? options.smart_count ?? '') + '');
}

/**
 * Minimal i18n provider for ra-core: nested dictionaries, French falling back to English, and the
 * polyglot message syntax ra-core emits for its own notifications.
 */
export function createI18nProvider(locale: Locale): I18nProvider {
  return {
    translate: (key: string, options: Record<string, unknown> = {}) => {
      const message = lookup(DICTS[locale], key) ?? lookup(en, key) ?? (options._ as string | undefined) ?? key;
      return format(message, options, locale);
    },
    changeLocale: () => Promise.resolve(),
    getLocale: () => locale,
    getLocales: () => [
      { locale: 'en', name: 'English' },
      { locale: 'fr', name: 'Français' },
    ],
  };
}
