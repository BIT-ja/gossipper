import { describe, expect, it } from 'vitest'

import { buildLoadTestEngine, parseDirector, defaultLoadTestDraft, draftToLoadTestRequest } from './loadTestWizard'

describe('parseDirector', () => {
  it('parses host:port', () => {
    expect(parseDirector('10.0.0.5:5060')).toEqual({ host: '10.0.0.5', port: 5060 })
  })
  it('defaults port 5060', () => {
    expect(parseDirector('sbc.lab')).toEqual({ host: 'sbc.lab', port: 5060 })
  })
  it('parses sip URI', () => {
    expect(parseDirector('sip:10.0.0.5:5060')).toEqual({ host: '10.0.0.5', port: 5060 })
  })
})

describe('buildLoadTestEngine', () => {
  it('includes sip and health fields', () => {
    const engine = buildLoadTestEngine({
      job_id: '',
      director: '1.2.3.4:5060',
      scenario_id: 'invite_media',
      total_calls: 5,
      rate: 2,
      max_concurrent: 1,
      run_timeout_ms: 0,
      sip_from: 'sip:a@b',
      sip_pai: 'a@b',
      sip_provider: 'tok',
      record_wav: false,
      record_wav_duplex: false,
      health_enabled: true,
      health_min_success_ratio: 0.9,
      health_max_failed_calls: 0,
      soak_unlimited: false,
    })
    expect(engine).toMatchObject({
      total_calls: 5,
      remote_host: '1.2.3.4',
      remote_port: 5060,
      sip_from: 'sip:a@b',
      sip_pai: 'a@b',
      sip_provider: 'tok',
      health_min_success_ratio: 0.9,
      health_max_failed_calls: 0,
    })
  })
})


describe('SIP capture request', () => {
  it('keeps capture opt-in and sends retention without a disk quota', () => {
    const draft = defaultLoadTestDraft()
    expect(draftToLoadTestRequest(draft)).not.toHaveProperty('sip_capture')
    expect(draftToLoadTestRequest({ ...draft, sip_capture: true }).sip_capture)
      .toEqual({ enabled: true, retention_days: 7 })
  })
})
