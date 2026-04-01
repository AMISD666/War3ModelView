import React, { useEffect } from 'react';
import { Button, Form, Input, Space } from 'antd';
import { DraggableModal } from '../DraggableModal';
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell';

interface RenameNodeDialogProps {
    visible: boolean;
    nodeId: number | null;
    currentName: string;
    onRename: (newName: string) => void;
    onCancel: () => void;
    /** 独立 WebView：不再套一层 DraggableModal，避免双标题栏 */
    isStandalone?: boolean;
}

export const RenameNodeDialog: React.FC<RenameNodeDialogProps> = ({
    visible,

    currentName,
    onRename,
    onCancel,
    isStandalone,
}) => {
    const [form] = Form.useForm();

    useEffect(() => {
        if (visible) {
            form.setFieldsValue({ name: currentName });
        }
    }, [visible, currentName, form]);

    const handleOk = () => {
        form.validateFields().then((values) => {
            onRename(values.name);
            form.resetFields();
        });
    };

    const formBody = (
        <Form form={form} layout="vertical">
            <Form.Item
                name="name"
                label="节点名称"
                rules={[{ required: true, message: '请输入节点名称' }]}
            >
                <Input placeholder="输入新名称" autoFocus onPressEnter={handleOk} />
            </Form.Item>
        </Form>
    );

    if (isStandalone) {
        if (!visible) return null;
        return (
            <NodeEditorStandaloneShell>
                <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
                    {formBody}
                    <Space style={{ marginTop: 12 }}>
                        <Button type="primary" onClick={handleOk}>
                            确定
                        </Button>
                        <Button onClick={onCancel}>取消</Button>
                    </Space>
                </div>
            </NodeEditorStandaloneShell>
        );
    }

    return (
        <DraggableModal
            title="重命名节点"
            open={visible}
            onOk={handleOk}
            onCancel={onCancel}
            destroyOnClose
        >
            {formBody}
        </DraggableModal>
    );
};
