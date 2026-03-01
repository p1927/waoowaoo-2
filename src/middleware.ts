import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from '@/i18n';

export default createMiddleware({
    // All supported languages
    locales,

    // Default language
    defaultLocale,

    // URL path strategy: always show language prefix
    localePrefix: 'always',

    // Language detection: auto-detect based on Accept-Language header
    localeDetection: true
});

export const config = {
    // Match all paths except api, _next/static, _next/image, favicon.ico, etc.
    matcher: [
        // Match root path and all paths with language prefix
        '/',
        '/(en)/:path*',
        // Match all other paths (for redirecting to paths with language prefix)
        '/((?!api|m|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico).*)'
    ]
};
