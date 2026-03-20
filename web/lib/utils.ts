export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function isToday(dateString: string): boolean {
  const date = new Date(dateString)
  const today = new Date()
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  )
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'reviewed':
      return 'bg-green-100 text-green-800'
    case 'flagged':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-yellow-100 text-yellow-800'
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case 'reviewed':
      return 'Reviewed'
    case 'flagged':
      return 'Flagged'
    default:
      return 'Pending'
  }
}

export function emailFromUsername(username: string): string {
  if (username.includes('@')) return username
  return `${username}@checkin.internal`
}

export function usernameFromEmail(email: string): string {
  return email.split('@')[0]
}
