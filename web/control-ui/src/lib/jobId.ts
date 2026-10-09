// validateJobID checks optional custom job ids against uistore safe-id rules.
export function validateJobID(id: string): string | null {
  const x = id.trim()
  if (x === '') return null
  if (x.length > 64) return '任务 ID 最多为 64 个字符'
  if (!/^[a-zA-Z0-9._-]+$/.test(x)) {
    return '任务 ID 仅允许字母、数字及 . _ -'
  }
  return null
}
