import React, { useEffect } from 'react'
import { Button, Form, Input, Space } from 'antd'
import { NodeEditorStandaloneShell } from '../common/NodeEditorStandaloneShell'
import { DraggableModal } from '../DraggableModal'
import { uiText } from '../../constants/uiText'

interface RenameNodeDialogProps {
    visible: boolean
    nodeId: number | null
    currentName: string
    onRename: (newName: string) => void
    onCancel: () => void
    /** 独立 WebView 不再套一层 DraggableModal，避免双标题栏。 */
    isStandalone?: boolean
}

export const RenameNodeDialog: React.FC<RenameNodeDialogProps> = ({
    visible,
    currentName,
    onRename,
    onCancel,
    isStandalone,
}) => {
    const [form] = Form.useForm()

    useEffect(() => {
        if (visible) form.setFieldsValue({ name: currentName })
    }, [visible, currentName, form])

    const handleOk = () => {
        form.validateFields().then((values) => {
            onRename(values.name)
            form.resetFields()
        })
    }

    const formBody = (
        <Form form={form} layout="vertical">
            <Form.Item
                name="name"
                label={uiText.renameNodeDialog.nameLabel}
                rules={[{ required: true, message: uiText.renameNodeDialog.nameRequired }]}
            >
                <Input placeholder={uiText.renameNodeDialog.placeholder} autoFocus onPressEnter={handleOk} />
            </Form.Item>
        </Form>
    )

    if (isStandalone) {
        if (!visible) return null
        return (
            <NodeEditorStandaloneShell>
                <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
                    {formBody}
                    <Space style={{ marginTop: 12 }}>
                        <Button type="primary" onClick={handleOk}>{uiText.renameNodeDialog.confirm}</Button>
                        <Button onClick={onCancel}>{uiText.renameNodeDialog.cancel}</Button>
                    </Space>
                </div>
            </NodeEditorStandaloneShell>
        )
    }

    return (
        <DraggableModal title={uiText.renameNodeDialog.title} open={visible} onOk={handleOk} onCancel={onCancel} destroyOnClose>
            {formBody}
        </DraggableModal>
    )
}
