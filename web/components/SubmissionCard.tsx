import { formatDateTime } from '@/lib/utils'
import StatusBadge from './StatusBadge'

interface Submission {
  id: string
  po_number: string
  image_url: string
  submitted_username: string
  branch: string | null
  notes: string | null
  status: string
  created_at: string
}

interface SubmissionCardProps {
  submission: Submission
  onClick?: () => void
  showUser?: boolean
}

export default function SubmissionCard({ submission, onClick, showUser = false }: SubmissionCardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-gray-200 overflow-hidden ${onClick ? 'cursor-pointer active:bg-gray-50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-3 p-3">
        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
          <img
            src={submission.image_url}
            alt={`PO ${submission.po_number}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="font-bold text-gray-900 text-base truncate">
              {submission.po_number}
            </span>
            <StatusBadge status={submission.status} />
          </div>

          {showUser && (
            <p className="text-sm text-gray-600 mt-0.5">
              {submission.submitted_username}
              {submission.branch && ` · ${submission.branch}`}
            </p>
          )}

          <p className="text-xs text-gray-400 mt-0.5">
            {formatDateTime(submission.created_at)}
          </p>

          {submission.notes && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-1 italic">
              "{submission.notes}"
            </p>
          )}
        </div>

        {onClick && (
          <svg className="w-5 h-5 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
    </div>
  )
}
