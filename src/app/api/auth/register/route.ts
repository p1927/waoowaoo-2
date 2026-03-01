import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { logAuthAction } from '@/lib/logging/semantic'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const POST = apiHandler(async (request: NextRequest) => {
  let name = 'unknown'
  const body = await request.json()
  name = body.name || 'unknown'
  const { password } = body

  // Validate input
  if (!name || !password) {
    logAuthAction('REGISTER', name, { error: 'Missing credentials' })
    throw new ApiError('INVALID_PARAMS')
  }

  if (password.length < 6) {
    logAuthAction('REGISTER', name, { error: 'Password too short' })
    throw new ApiError('INVALID_PARAMS')
  }

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { name }
  })

  if (existingUser) {
    logAuthAction('REGISTER', name, { error: 'Phone number already exists' })
    throw new ApiError('INVALID_PARAMS')
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12)

  // Create user (transaction)
  const user = await prisma.$transaction(async (tx) => {
    // Create user
    const newUser = await tx.user.create({
      data: {
        name,
        password: hashedPassword}
    })

    // Create user balance record (initial 0)
    await tx.userBalance.create({
      data: {
        userId: newUser.id,
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0
      }
    })

    return newUser
  })

  logAuthAction('REGISTER', name, { userId: user.id, success: true })

  return NextResponse.json(
    {
      message: "Registration successful",
      user: {
        id: user.id,
        name: user.name
      }
    },
    { status: 201 }
  )
})
