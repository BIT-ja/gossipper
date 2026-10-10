import { describe, it, expect } from 'vitest'
import { latestProgress } from './JobProgress'
import { buildEnginePayload } from './EngineOverridesForm'
describe('job progress', () => {
 it('does not fabricate counters from legacy heartbeats', () => { expect(latestProgress(['{"kind":"stats","ts":12}'])).toBeNull() })
 it('keeps latest valid counters despite non JSON log lines', () => {
 const p = {kind:'stats',target_calls:30,total_calls:20,success_calls:10,failed_calls:2,active_calls:8}
 expect(latestProgress([JSON.stringify(p),'partial'])).toEqual(p)
 })
 it('preserves unlimited overrides and omits inherited fields', () => { expect(buildEnginePayload({total_calls:0,global_timeout_ms:0,rate:undefined})).toEqual({total_calls:0,global_timeout_ms:0}) })
})
