import { defineRouting } from 'next-intl/routing';

export const locales = ['en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const routing = defineRouting({
    // Supported languages
    locales,

    // Default language
    defaultLocale,

    // URL path strategy: always show language prefix
    localePrefix: 'always'
});
