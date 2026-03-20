#!/usr/bin/env node
/**
 * seed-admin.mjs
 *
 * Creates an initial supervisor (admin) account directly via the Supabase
 * service-role API.  Run this once on a fresh deployment before any users
 * exist, or whenever you need to bootstrap an admin account.
 *
 * Usage:
 *   node scripts/seed-admin.mjs
 *
 * Required environment variables (can be in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional overrides:
 *   ADMIN_USERNAME   (default: admin)
 *   ADMIN_PASSWORD   (default: Admin@2024!)
 *   ADMIN_DISPLAY    (default: Admin)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local if present (simple key=value parser, no dotenv dependency needed)
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  // .env.local not present — rely on shell environment
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}

const username    = process.env.ADMIN_USERNAME ?? 'admin'
const password    = process.env.ADMIN_PASSWORD ?? 'Admin@2024!'
const displayName = process.env.ADMIN_DISPLAY  ?? 'Admin'
const role        = 'supervisor'
const email       = `${username}@checkin.internal`

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

console.log(`Creating admin user "${username}" (${email}) …`)

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: displayName, role },
})

if (error) {
  if (error.message?.includes('already been registered')) {
    console.log(`User "${username}" already exists — updating password and profile role.`)
    
    // Find ID first
    const { data: existing, error: findErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single()
    
    if (findErr || !existing) {
      console.error('Failed to find existing user ID:', findErr?.message)
      process.exit(1)
    }

    // Update password
    const { error: resetErr } = await supabase.auth.admin.updateUserById(existing.id, { password })
    if (resetErr) {
      console.error('Failed to reset existing user password:', resetErr.message)
      process.exit(1)
    }

    // Update profile role
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ role: 'supervisor', display_name: displayName })
      .eq('id', existing.id)
    
    if (profileErr) {
      console.error('Profile update failed:', profileErr.message)
      process.exit(1)
    }
    console.log('User and profile updated successfully.')
    printCredentials()
    process.exit(0)
  }
  console.error('Failed to create user:', error.message)
  process.exit(1)
}

// The trigger creates the profile; update it with the correct username & role
const { error: profileError } = await supabase
  .from('profiles')
  .update({ username, display_name: displayName, role })
  .eq('id', data.user.id)

if (profileError) {
  console.error('Profile update failed:', profileError.message)
  process.exit(1)
}

console.log('Admin user created successfully!')
printCredentials()

function printCredentials() {
  console.log('')
  console.log('┌─────────────────────────────────┐')
  console.log('│        Admin Credentials         │')
  console.log('├─────────────────────────────────┤')
  console.log(`│  Username : ${username.padEnd(20)} │`)
  console.log(`│  Password : ${password.padEnd(20)} │`)
  console.log(`│  Role     : ${role.padEnd(20)} │`)
  console.log('└─────────────────────────────────┘')
  console.log('')
  console.log('Change the password after first login!')
}
