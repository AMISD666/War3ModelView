
import React from 'react';

interface UpdateLogContentProps {
    version: string;
    date: string;
    body: string;
}

export const UpdateLogContent: React.FC<UpdateLogContentProps> = ({ version, date, body }) => {
    // Simple markdown parsing for bullets
    const lines = body.split('\n');

    return (
        <div style={{ color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#52c41a' }}>
                    {version}
                </span>
                <span style={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: '14px' }}>
                    {date}
                </span>
            </div>
            <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)', marginBottom: '15px' }} />

            <div style={{ lineHeight: '1.8', fontSize: '14px', color: 'rgba(255, 255, 255, 0.85)' }}>
                {lines.map((line, index) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                        return (
                            <div key={index} style={{ display: 'flex', marginBottom: '4px' }}>
                                <span style={{ marginRight: '8px', color: '#52c41a' }}>●</span>
                                <span>{trimmed.substring(2)}</span>
                            </div>
                        );
                    } else if (trimmed === '') {
                        return <div key={index} style={{ height: '10px' }} />;
                    } else {
                        return <div key={index}>{line}</div>;
                    }
                })}
            </div>
        </div>
    );
};
