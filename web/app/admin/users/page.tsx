import UserManagementClient from '@/components/UserManagementClient'

export const dynamic = 'force-dynamic'

export default function AdminUsersPage() {
  return <UserManagementClient mode="admin" />
}
