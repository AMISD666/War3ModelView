import React from 'react'
import { Button, Modal } from 'antd'
import type { StandalonePerfEntry } from '../../utils/standalonePerf'

interface StandalonePerfModalProps {
    open: boolean
    onClose: () => void
    onClear: () => void
    entries: StandalonePerfEntry[]
}

type SummaryRow = {
    windowLabel: string
    openRequestedMs: number | null
    windowShownMs: number | null
    snapshotAppliedMs: number | null
    firstContentRenderedMs: number | null
    latestMark: string
    latestAt: number
    eventCount: number
    snapshotSentCount: number
    snapshotReceivedCount: number
    patchSentCount: number
    patchReceivedCount: number
    directEmitCount: number
    fallbackCount: number
    skippedSnapshotCount: number
}

const getTargetWindowLabel = (entry: StandalonePerfEntry): string => {
    const detailWindowId = entry.detail?.windowId
    return typeof detailWindowId === 'string' && detailWindowId.length > 0
        ? detailWindowId
        : entry.windowLabel
}

const formatClock = (epochMs: number): string => {
    const date = new Date(epochMs)
    return date.toLocaleTimeString('zh-CN', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }) + `.${String(date.getMilliseconds()).padStart(3, '0')}`
}

const formatDuration = (durationMs: number | null): string => {
    if (durationMs === null || !Number.isFinite(durationMs)) {
        return '--'
    }
    return `${durationMs}ms`
}

const formatDetail = (detail?: Record<string, unknown>): string => {
    if (!detail) return '--'
    try {
        const text = JSON.stringify(detail)
        return text.length > 120 ? `${text.slice(0, 117)}...` : text
    } catch {
        return '[unserializable detail]'
    }
}

const getCycleEntries = (entries: StandalonePerfEntry[]): StandalonePerfEntry[] => {
    const chronological = [...entries].sort((a, b) => a.epochMs - b.epochMs)
    for (let index = chronological.length - 1; index >= 0; index -= 1) {
        if (chronological[index].mark === 'open_requested') {
            return chronological.slice(index)
        }
    }
    return chronological
}

const getDurationFromOpen = (entries: StandalonePerfEntry[], targetMark: string): number | null => {
    const openEntry = entries.find(entry => entry.mark === 'open_requested')
    const targetEntry = entries.find(entry => entry.mark === targetMark)
    if (!openEntry || !targetEntry) return null
    return Math.max(0, targetEntry.epochMs - openEntry.epochMs)
}

const countMarks = (entries: StandalonePerfEntry[], mark: string): number => {
    return entries.filter(entry => entry.mark === mark).length
}

const buildSummaryRows = (entries: StandalonePerfEntry[]): SummaryRow[] => {
    const byWindow = new Map<string, StandalonePerfEntry[]>()

    entries.forEach(entry => {
        const groupKey = getTargetWindowLabel(entry)
        const current = byWindow.get(groupKey) || []
        current.push(entry)
        byWindow.set(groupKey, current)
    })

    return Array.from(byWindow.entries())
        .map(([windowLabel, windowEntries]) => {
            const cycleEntries = getCycleEntries(windowEntries)
            const latestEntry = cycleEntries[cycleEntries.length - 1]
            return {
                windowLabel,
                openRequestedMs: getDurationFromOpen(cycleEntries, 'open_requested'),
                windowShownMs: getDurationFromOpen(cycleEntries, 'window_shown'),
                snapshotAppliedMs: getDurationFromOpen(cycleEntries, 'snapshot_applied'),
                firstContentRenderedMs: getDurationFromOpen(cycleEntries, 'first_content_rendered'),
                latestMark: latestEntry?.mark || '--',
                latestAt: latestEntry?.epochMs || 0,
                eventCount: cycleEntries.length,
                snapshotSentCount: countMarks(cycleEntries, 'snapshot_sent'),
                snapshotReceivedCount: countMarks(cycleEntries, 'snapshot_received'),
                patchSentCount: countMarks(cycleEntries, 'patch_sent'),
                patchReceivedCount: countMarks(cycleEntries, 'patch_received'),
                directEmitCount: countMarks(cycleEntries, 'direct_window_emit'),
                fallbackCount: countMarks(cycleEntries, 'global_emit_fallback'),
                skippedSnapshotCount: countMarks(cycleEntries, 'snapshot_broadcast_skipped'),
            }
        })
        .sort((left, right) => right.latestAt - left.latestAt)
}

const summaryCardStyle: React.CSSProperties = {
    minWidth: 220,
    flex: '1 1 220px',
    backgroundColor: '#262626',
    border: '1px solid #3f3f3f',
    borderRadius: 8,
    padding: 12,
}

const labelStyle: React.CSSProperties = {
    color: '#8c8c8c',
    fontSize: 12,
    marginBottom: 4,
}

const valueStyle: React.CSSProperties = {
    color: '#f0f0f0',
    fontSize: 18,
    fontWeight: 600,
}

const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '160px 160px 240px 1fr',
    gap: 12,
    alignItems: 'start',
    padding: '8px 0',
    borderBottom: '1px solid #303030',
    fontSize: 12,
}

const StandalonePerfModal: React.FC<StandalonePerfModalProps> = ({ open, onClose, onClear, entries }) => {
    const summaryRows = buildSummaryRows(entries)
    const latestEntryLabel = entries[0] ? `${getTargetWindowLabel(entries[0])} / ${entries[0].mark}` : '--'

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="独立窗口性能打点"
            width={1240}
            footer={[
                <Button key="clear" onClick={onClear} disabled={entries.length === 0}>清空记录</Button>,
                <Button key="close" type="primary" onClick={onClose}>关闭</Button>,
            ]}
            styles={{
                body: {
                    backgroundColor: '#1f1f1f',
                    color: '#f0f0f0',
                    maxHeight: '75vh',
                    overflow: 'auto',
                },
                content: {
                    backgroundColor: '#1f1f1f',
                },
                header: {
                    backgroundColor: '#1f1f1f',
                    color: '#f0f0f0',
                    borderBottom: '1px solid #303030',
                },
                footer: {
                    backgroundColor: '#1f1f1f',
                    borderTop: '1px solid #303030',
                },
            }}
        >
            <div style={{ marginBottom: 16, color: '#bfbfbf', lineHeight: 1.6 }}>
                打开路径：顶部菜单“帮助 - 独立窗口性能打点”，或者菜单栏右侧“性能监控”按钮。面板现在优先按 `detail.windowId` 聚合事件，不再把主窗口代发事件错误地归到 `main`。
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                <div style={summaryCardStyle}>
                    <div style={labelStyle}>已记录事件</div>
                    <div style={valueStyle}>{entries.length}</div>
                </div>
                <div style={summaryCardStyle}>
                    <div style={labelStyle}>窗口数</div>
                    <div style={valueStyle}>{summaryRows.length}</div>
                </div>
                <div style={summaryCardStyle}>
                    <div style={labelStyle}>最近事件</div>
                    <div style={{ ...valueStyle, fontSize: 14 }}>{latestEntryLabel}</div>
                </div>
            </div>

            <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>最近一次打开周期摘要</div>
                {summaryRows.length === 0 ? (
                    <div style={{ color: '#8c8c8c' }}>当前还没有收到独立窗口性能事件。</div>
                ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        {summaryRows.map(row => (
                            <div key={row.windowLabel} style={summaryCardStyle}>
                                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{row.windowLabel}</div>
                                <div style={labelStyle}>最近阶段</div>
                                <div style={{ color: '#d9d9d9', marginBottom: 10 }}>{row.latestMark}</div>
                                <div style={labelStyle}>show 耗时</div>
                                <div style={{ color: '#f0f0f0', marginBottom: 8 }}>{formatDuration(row.windowShownMs)}</div>
                                <div style={labelStyle}>snapshot_applied</div>
                                <div style={{ color: '#f0f0f0', marginBottom: 8 }}>{formatDuration(row.snapshotAppliedMs)}</div>
                                <div style={labelStyle}>first_content_rendered</div>
                                <div style={{ color: '#f0f0f0', marginBottom: 8 }}>{formatDuration(row.firstContentRenderedMs)}</div>
                                <div style={labelStyle}>sync 统计</div>
                                <div style={{ color: '#f0f0f0', fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.7 }}>
                                    <div>{`snapshot ${row.snapshotSentCount} / received ${row.snapshotReceivedCount}`}</div>
                                    <div>{`patch ${row.patchSentCount} / received ${row.patchReceivedCount}`}</div>
                                    <div>{`direct ${row.directEmitCount} / fallback ${row.fallbackCount}`}</div>
                                    <div>{`skip ${row.skippedSnapshotCount} / total ${row.eventCount}`}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>事件明细</div>
                <div style={{ ...rowStyle, color: '#8c8c8c', fontWeight: 600, paddingTop: 0 }}>
                    <div>时间</div>
                    <div>目标窗口</div>
                    <div>阶段</div>
                    <div>详情</div>
                </div>
                <div style={{ maxHeight: 360, overflow: 'auto' }}>
                    {entries.length === 0 ? (
                        <div style={{ color: '#8c8c8c', padding: '12px 0' }}>暂无事件</div>
                    ) : (
                        entries.map(entry => (
                            <div key={entry.entryId} style={rowStyle}>
                                <div style={{ color: '#d9d9d9', fontFamily: 'Consolas, monospace' }}>{formatClock(entry.epochMs)}</div>
                                <div style={{ color: '#d9d9d9' }}>{getTargetWindowLabel(entry)}</div>
                                <div style={{ color: '#91caff', fontFamily: 'Consolas, monospace' }}>{entry.mark}</div>
                                <div style={{ color: '#bfbfbf', fontFamily: 'Consolas, monospace', wordBreak: 'break-all' }}>{formatDetail(entry.detail)}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Modal>
    )
}

export default StandalonePerfModal
