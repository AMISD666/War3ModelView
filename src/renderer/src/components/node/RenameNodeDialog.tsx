import React, { useEffect } from 'react';
import { Form, Input } from 'antd';
import { DraggableModal } from '../DraggableModal';

interface RenameNodeDialogProps {
    visible: boolean;
    nodeId: number | null;
    currentName: string;
    onRename: (newName: string) => void;
    onCancel: () => void;
}

export const RenameNodeDialog: React.FC<RenameNodeDialogProps> = ({
    visible,

    currentName,
    onRename,
    onCancel
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

    return (
        <DraggableModal
            title="重命名节点"
            open={visible}
            onOk={handleOk}
            onCancel={onCancel}
            destroyOnClose
        >
            <Form form={form} layout="vertical">
                <Form.Item
                    name="name"
                    label="节点名称"
                    rules={[{ required: true, message: '请输入节点名称' }]}
                >
                    <Input placeholder="输入新名称" autoFocus onPressEnter={handleOk} />
                </Form.Item>
            </Form>
        </DraggableModal>
    );
};
