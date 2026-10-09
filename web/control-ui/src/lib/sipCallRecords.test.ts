import { expect, it } from 'vitest'
import { parseSIPCallRecords } from './sipCallRecords'
it('preserves failed-call evidence even when summary is absent or a JSONL row is incomplete', () => {
 const parsed = parseSIPCallRecords('{"call_id":"a","success":true}\n{"call_id":"b","success":false,"error":"timeout","media":{"RTPPacketsReceived":0}}\n{"call_id":\n\n')
 expect(parsed.records).toHaveLength(2)
 expect(parsed.records[1]).toMatchObject({success:false,error:'timeout',media:{RTPPacketsReceived:0}})
 expect(parsed.invalid).toBe(1)
 expect(parseSIPCallRecords('')).toEqual({records:[],invalid:0})
})
