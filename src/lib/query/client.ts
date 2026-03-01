import { QueryClient } from '@tanstack/react-query'

/**
 * Global QueryClient configuration
 * For unified management of all data request cache and state
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Data considered fresh for 5 seconds, no refetch
            staleTime: 5000,
            // Cache data retained for 10 minutes
            gcTime: 10 * 60 * 1000,
            // Auto refetch on window focus
            refetchOnWindowFocus: true,
            // Auto refetch on network reconnect
            refetchOnReconnect: true,
            // Retry once on failure
            retry: 1,
            // Retry delay
            retryDelay: 1000,
        },
        mutations: {
            // Mutations do not retry
            retry: 0,
        },
    },
})

/**
 * Get global QueryClient instance
 * For accessing cache outside React components
 */
export function getQueryClient() {
    return queryClient
}
