import type { UnifiedErrorCode } from './codes'

export const USER_ERROR_MESSAGES_EN: Record<UnifiedErrorCode, string> = {
  UNAUTHORIZED: 'Please log in and try again.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  NOT_FOUND: 'The requested data was not found.',
  INVALID_PARAMS: 'Invalid request parameters. Please check and try again.',
  MISSING_CONFIG: 'System configuration is incomplete. Please contact the administrator.',
  CONFLICT: 'Current state conflict. Please refresh and try again.',
  TASK_NOT_READY: 'Task is still processing. Please wait.',
  NO_RESULT: 'Task completed, but no results are available.',
  RATE_LIMIT: 'Too many requests. Please try again later.',
  QUOTA_EXCEEDED: 'Quota exceeded. Please try again later.',
  EXTERNAL_ERROR: 'External service temporarily unavailable. Please try again later.',
  NETWORK_ERROR: 'Network error. Please try again later.',
  INSUFFICIENT_BALANCE: 'Insufficient balance. Please recharge first.',
  SENSITIVE_CONTENT: 'Content may contain sensitive information. Please modify and try again.',
  GENERATION_TIMEOUT: 'Generation timeout. Please try again.',
  GENERATION_FAILED: 'Generation failed. Please try again later.',
  WATCHDOG_TIMEOUT: 'Task execution timeout. The system has terminated the task.',
  WORKER_EXECUTION_ERROR: 'Task execution failed. Please try again later.',
  INTERNAL_ERROR: 'Internal system error. Please try again later.',
}

export function getUserMessageByCode(code: UnifiedErrorCode) {
  return USER_ERROR_MESSAGES_EN[code]
}
