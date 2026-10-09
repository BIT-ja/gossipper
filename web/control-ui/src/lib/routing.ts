export type NavId =
  | 'sip'
  | 'dashboard'
  | 'servers'
  | 'clients'
  | 'scenarios'
  | 'jobs'
  | 'reports'
  | 'load'
  | 'media'
  | 'audit'
  | 'users'
  | 'settings'
  | 'about'

const VALID: NavId[] = [
  'dashboard',
  'servers',
  'clients',
  'scenarios',
  'jobs',
  'reports',
  'load',
  'media',
  'audit',
  'users',
  'settings',
  'about',
]

export type HashRoute = { nav: NavId; jobId?: string; reportJobId?: string; callId?: string }

export function parseHashRoute(hash = window.location.hash): HashRoute {
  const raw = hash.replace(/^#\/?/, '').trim()
  if (!raw) return { nav: 'dashboard' }
  const [path, query] = raw.split('?')
  const parts = path.split('/').filter(Boolean)
  const nav = (parts[0] ?? 'dashboard') as NavId
  const safeNav = nav === 'jobs' && parts[2] === 'sip' ? 'sip' : VALID.includes(nav) ? nav : 'dashboard'
  const params = new URLSearchParams(query ?? '')
  const jobId = parts[1] ?? params.get('job') ?? undefined
  const reportJobId = params.get('report') ?? undefined
  return { callId: params.get('call_id') ?? '', nav: safeNav, jobId: jobId || undefined, reportJobId: reportJobId || undefined }
}

export function setHashRoute(nav: NavId, opts?: { jobId?: string; report?: string }) {
  let path = `#/${nav}`
  if (opts?.jobId && (nav === 'jobs' || nav === 'load')) path += `/${encodeURIComponent(opts.jobId)}`
  const q = new URLSearchParams()
  if (opts?.report) q.set('report', opts.report)
  const qs = q.toString()
  const next = qs ? `${path}?${qs}` : path
  if (window.location.hash !== next) window.location.hash = next
}
