import { NextResponse } from 'next/server'
import { getBalance } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET /api/user/balance
 * Get current user balance
 */
export const GET = apiHandler(async () => {
    // Auth verification
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const balance = await getBalance(session.user.id)

    return NextResponse.json({
        success: true,
        currency: BILLING_CURRENCY,
        balance: balance.balance,
        frozenAmount: balance.frozenAmount,
        totalSpent: balance.totalSpent
    })
})
