import { describe, expect, it } from 'vitest'

import { validateJobID } from '@/lib/jobId'

describe('validateJobID', () => {
  it('allows empty (auto UUID)', () => {
    expect(validateJobID('')).toBeNull()
    expect(validateJobID('   ')).toBeNull()
  })

  it('accepts safe ids', () => {
    expect(validateJobID('stress-run-01')).toBeNull()
    expect(validateJobID('job.v2_test')).toBeNull()
  })

  it('rejects invalid characters', () => {
    expect(validateJobID('bad id')).toMatch(/仅允许/)
    expect(validateJobID('слот')).toMatch(/仅允许/)
  })
})
