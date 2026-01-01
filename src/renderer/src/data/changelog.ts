export interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: "1.0.1",
        date: "2026-01-01",
        changes: [
            "修复了骨骼组超过255个时模型拉伸的问题",
            "修复了 MDL 保存/加载时的语法错误",
            "修复了修改材质动态贴图id错误",
            "修复了修改多边形材质id错误",
            "修复了分离多边形缺失顶点错误",
            "更新了解析器以支持 16 位顶点组索引"
        ]
    },
];
