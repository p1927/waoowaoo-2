#!/usr/bin/env tsx
/**
 * Check existing users in the database
 * Optionally create a test user
 */

import { prisma } from '../src/lib/prisma'
import bcrypt from 'bcryptjs'

async function main() {
  console.log('🔍 Checking users in database...\n')

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      password: true, // We'll check if password exists, not show it
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  if (users.length === 0) {
    console.log('❌ No users found in database.\n')
    console.log('📝 To create a user:')
    console.log('   1. Visit http://localhost:3000/auth/signup')
    console.log('   2. Or use the API: POST /api/auth/register')
    console.log('      Body: { "name": "your-username", "password": "your-password" }')
    console.log('')
    
    // Ask if user wants to create a test user
    const args = process.argv.slice(2)
    if (args.includes('--create-test')) {
      const testUsername = 'test'
      const testPassword = 'test123'
      
      console.log(`\n✨ Creating test user...`)
      console.log(`   Username: ${testUsername}`)
      console.log(`   Password: ${testPassword}\n`)
      
      const hashedPassword = await bcrypt.hash(testPassword, 12)
      
      const user = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: testUsername,
            password: hashedPassword,
          },
        })

        await tx.userBalance.create({
          data: {
            userId: newUser.id,
            balance: 0,
            frozenAmount: 0,
            totalSpent: 0,
          },
        })

        return newUser
      })

      console.log(`✅ Test user created successfully!`)
      console.log(`   User ID: ${user.id}`)
      console.log(`   Username: ${user.name}`)
      console.log(`\n🔐 You can now login with:`)
      console.log(`   Username: ${testUsername}`)
      console.log(`   Password: ${testPassword}`)
      console.log(`\n   Visit: http://localhost:3000/auth/signin`)
    } else {
      console.log('\n💡 Tip: Run with --create-test flag to create a test user')
      console.log('   Example: npm run check:users -- --create-test')
    }
  } else {
    console.log(`✅ Found ${users.length} user(s):\n`)
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. Username: ${user.name}`)
      console.log(`   Email: ${user.email || '(not set)'}`)
      console.log(`   Has Password: ${user.password ? '✅ Yes' : '❌ No'}`)
      console.log(`   Created: ${user.createdAt.toLocaleString()}`)
      console.log(`   ID: ${user.id}`)
      console.log('')
    })

    console.log('🔐 To login, visit: http://localhost:3000/auth/signin')
    console.log('📝 To create a new user, visit: http://localhost:3000/auth/signup')
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
