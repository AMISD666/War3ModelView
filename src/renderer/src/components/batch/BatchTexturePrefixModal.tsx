import React, { useState } from 'react';
import { Modal, Input, Radio, Typography, Divider, App, Tooltip } from 'antd';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface BatchTexturePrefixModalProps {
    visible: boolean;
    onClose: () => void;
    onProcess: (options: PrefixOptions) => Promise<void>;
    zIndex?: number;
}

export interface PrefixOptions {
    prefix: string;
    mode: 'overwrite' | 'keep';
    scope: 'all' | 'excludeNative';
    whitelist: string[];
}

export const BatchTexturePrefixModal: React.FC<BatchTexturePrefixModalProps> = ({
    visible,
    onClose,
    onProcess,
    zIndex = 1000
}) => {
    const { message } = App.useApp();
    const [prefix, setPrefix] = useState('war3mapImported\\');
    const [mode, setMode] = useState<'overwrite' | 'keep'>('overwrite');
    const [scope, setScope] = useState<'all' | 'excludeNative'>('excludeNative');
    const [whitelistStr, setWhitelistStr] = useState('');
    const [loading, setLoading] = useState(false);

    const handleOk = async () => {
        setLoading(true);
        try {
            await onProcess({
                prefix,
                mode,
                scope,
                whitelist: whitelistStr.split('\n').map(s => s.trim()).filter(s => s !== '')
            });
            onClose();
        } catch (err) {
            console.error(err);
            message.error('处理失败: ' + String(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="批量修改贴图路径前缀"
            open={visible}
            onOk={handleOk}
            onCancel={onClose}
            confirmLoading={loading}
            okText="确定"
            cancelText="取消"
            width={500}
            zIndex={zIndex}
            styles={{
                content: { backgroundColor: '#1e1e1e', color: '#ccc' },
                header: { backgroundColor: '#1e1e1e', color: '#ccc', borderBottom: '1px solid #333' },
                body: { padding: '20px' }
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                    <Text style={{ color: '#aaa', display: 'block', marginBottom: 8 }}>新路径前缀 (留空则去除所有前缀):</Text>
                    <Input
                        value={prefix}
                        onChange={e => setPrefix(e.target.value)}
                        placeholder="例如: war3mapImported\"
                        style={{ backgroundColor: '#2a2a2a', borderColor: '#444', color: '#eee' }}
                    />
                </div>

                <Divider style={{ borderColor: '#333', margin: '4px 0' }} />

                <div>
                    <Text style={{ color: '#aaa', display: 'block', marginBottom: 8 }}>已有前缀处理模式:</Text>
                    <Radio.Group
                        value={mode}
                        onChange={e => setMode(e.target.value)}
                        optionType="button"
                        buttonStyle="solid"
                        size="small"
                    >
                        <Tooltip title="将现有前缀替换为新前缀" mouseEnterDelay={0.5}>
                            <Radio.Button value="overwrite">覆盖</Radio.Button>
                        </Tooltip>
                        <Tooltip title="如果已有前缀则不修改" mouseEnterDelay={0.5}>
                            <Radio.Button value="keep">保留</Radio.Button>
                        </Tooltip>
                    </Radio.Group>
                </div>

                <div>
                    <Text style={{ color: '#aaa', display: 'block', marginBottom: 8 }}>贴图修改范围:</Text>
                    <Radio.Group
                        value={scope}
                        onChange={e => setScope(e.target.value)}
                        optionType="button"
                        buttonStyle="solid"
                        size="small"
                    >
                        <Tooltip title="修改模型中的所有贴图路径" mouseEnterDelay={0.5}>
                            <Radio.Button value="all">所有贴图</Radio.Button>
                        </Tooltip>
                        <Tooltip title="不修改标准路径贴图 (如 Textures\ 等)" mouseEnterDelay={0.5}>
                            <Radio.Button value="excludeNative">原生除外</Radio.Button>
                        </Tooltip>
                    </Radio.Group>
                </div>

                <div>
                    <Tooltip title="贴图路径如果以白名单中的前缀开头，则不进行修改">
                        <Text style={{ color: '#aaa', display: 'inline-block', marginBottom: 8, cursor: 'help' }}>前缀白名单 (每行一个):</Text>
                    </Tooltip>
                    <TextArea
                        value={whitelistStr}
                        onChange={e => setWhitelistStr(e.target.value)}
                        placeholder="输入需要忽略的前缀..."
                        rows={4}
                        style={{ backgroundColor: '#2a2a2a', borderColor: '#444', color: '#eee' }}
                    />
                </div>
            </div>

            <style>{`
                .ant-modal-title { color: #eee !important; }
                .ant-modal-close { color: #aaa !important; }
                .ant-radio-button-wrapper { background-color: #2a2a2a !important; border-color: #444 !important; color: #aaa !important; }
                .ant-radio-button-wrapper-checked { background-color: #1677ff !important; color: #fff !important; }
            `}</style>
        </Modal>
    );
};
