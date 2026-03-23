'use client'

import { Suspense } from 'react'
import UserManagementClient from '@/components/UserManagementClient'

function SetupPageContent() {
  return <UserManagementClient mode="setup" />
}

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupPageContent />
    </Suspense>
  )
}
