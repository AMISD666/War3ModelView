import React from 'react';
import { DraggableModal } from '../DraggableModal';
import { CHANGELOG } from '../../data/changelog';

interface ChangelogModalProps {
    open: boolean;
    onClose: () => void;
}

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ open, onClose }) => {
    return (
        <DraggableModal
            open={open}
            onCancel={onClose}
            title="更新日志 (Update Log)"
            width={600}
            footer={null}
        >
            <div style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '10px' }}>
                {CHANGELOG.map((entry, index) => (
                    <div key={index} style={{ marginBottom: '24px' }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                            paddingBottom: '8px',
                            marginBottom: '12px'
                        }}>
                            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#4caf50' }}>{entry.version}</span>
                            <span style={{ fontSize: '12px', color: '#888' }}>{entry.date}</span>
                        </div>
                        <ul style={{ paddingLeft: '20px', margin: 0 }}>
                            {entry.changes.map((change, idx) => (
                                <li key={idx} style={{ marginBottom: '6px', color: '#ddd', fontSize: '14px' }}>{change}</li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </DraggableModal>
    );
};

export default ChangelogModal;
