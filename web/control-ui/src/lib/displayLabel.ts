/** Presentation labels only; API values and user data stay unchanged. */
const labels: Record<string, string> = {
 pending: '等待中', running: '运行中', succeeded: '已成功', failed: '已失败', stopped: '已停止', idle: '空闲', all: '全部', client: '客户端', server: '服务端', load_test: '压测', tool: '工具', admin: '管理员', viewer: '只读用户', operator: '操作员', internal: '内部认证', none: '无认证', connected: '已连接', connecting: '连接中', disconnected: '已断开', uac: '客户端（UAC）', uas: '服务端（UAS）',
}
export function displayLabel(value: string | null | undefined): string { return value ? labels[value] ?? value : '—' }
