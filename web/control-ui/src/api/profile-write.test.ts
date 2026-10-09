import { afterEach, expect, it, vi } from 'vitest'
import { createClient, updateClient, createServer, updateServer } from './v2'
import { scenarioMatchesRole } from '../lib/scenarioSelect'

afterEach(() => vi.unstubAllGlobals())

it('writes editable profiles without list-only runtime, preserving the source row', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const row = { id: 'test', name: 'Test', transports: [], runtime: { status: 'idle' as const } }
  await createClient(row, {})
  await updateClient(row.id, row, {})
  await createServer(row, {})
  await updateServer(row.id, row, {})
  for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
    const body = JSON.parse(call[1].body as string)
    expect(body).toEqual({ id: 'test', name: 'Test', transports: [] })
  }
  expect(row.runtime.status).toBe('idle')
})

it('accepts role values emitted by the scenario editor without mixing UAC and UAS', () => {
  expect(scenarioMatchesRole('client', 'uac')).toBe(true)
  expect(scenarioMatchesRole('client', 'uas')).toBe(false)
  expect(scenarioMatchesRole('server', 'uas')).toBe(true)
  expect(scenarioMatchesRole('server', 'uac')).toBe(false)
  expect(scenarioMatchesRole('uac', 'uac')).toBe(true)
  expect(scenarioMatchesRole('', 'uac')).toBe(true)
})
