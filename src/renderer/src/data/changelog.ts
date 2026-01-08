export interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: 'v1.0.0',
        date: '2026-01-06',
        changes: [
            '初始发布 (Initial release)',
            '支持 MDX/MDL 模型查看和编辑',
            '支持批量预览功能'
        ]
    }
];
