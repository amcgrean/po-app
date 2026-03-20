const LOG_PREFIX = '[po-pics]'

export function logInfo(message: string, meta?: Record<string, unknown>) {
  if (meta) {
    console.info(LOG_PREFIX, message, meta)
    return
  }
  console.info(LOG_PREFIX, message)
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
  if (meta) {
    console.warn(LOG_PREFIX, message, meta)
    return
  }
  console.warn(LOG_PREFIX, message)
}

export function logError(
  message: string,
  error?: unknown,
  meta?: Record<string, unknown>
) {
  if (error || meta) {
    console.error(LOG_PREFIX, message, { error, ...meta })
    return
  }
  console.error(LOG_PREFIX, message)
}

export function requestLogContext(request: { nextUrl: { pathname: string } }) {
  return {
    path: request.nextUrl.pathname,
  }
}
