'use client'

import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/contexts/ToastContext"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { ContentLocaleProvider } from "@/lib/content-locale"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      <QueryProvider>
        <ContentLocaleProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ContentLocaleProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
