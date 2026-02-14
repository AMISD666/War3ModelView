import React from 'react';
import { Button, Checkbox } from 'antd';


const fieldsetStyle: React.CSSProperties = {
    border: '1px solid #484848',
    padding: '4px 8px',
    marginBottom: 4,
    backgroundColor: 'transparent',
    borderRadius: 0,
    height: '100%'
};

const legendStyle: React.CSSProperties = {
    fontSize: 12,
    color: '#ccc',
    padding: '0 6px',
    width: 'auto',
    marginLeft: 4,
    marginBottom: 0
};

interface DynamicFieldProps {
    label: string; // The legend label
    isDynamic: boolean; // Whether the checkbox is checked
    onDynamicChange: (checked: boolean) => void; // Callback for checkbox
    onEdit?: () => void; // Callback for Edit button
    buttonLabel?: string; // Custom label for the button (default: label)
    children?: React.ReactNode; // Content below the button (static fields)
}

const DynamicField: React.FC<DynamicFieldProps> = ({
    label,
    isDynamic,
    onDynamicChange,
    onEdit,
    buttonLabel,
    children
}) => {
    return (
        <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>{label}</legend>
            <div style={{ marginBottom: 6 }}>
                <Checkbox
                    checked={isDynamic}
                    onChange={(e) => onDynamicChange(e.target.checked)}
                    style={{ color: '#888', fontSize: 12 }}
                >
                    动态化
                </Checkbox>
            </div>
            <Button
                size="small"
                disabled={!isDynamic}
                onClick={onEdit}
                style={{
                    width: '100%',
                    marginBottom: 6,
                    backgroundColor: '#333',
                    borderColor: '#484848',
                    color: isDynamic ? '#fff' : '#666'
                }}
            >
                {buttonLabel || label}
            </Button>
            {children}
        </fieldset>
    );
};

export default DynamicField;
