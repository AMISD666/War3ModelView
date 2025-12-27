import React from 'react'
import { useRendererStore } from '../store/rendererStore'

/**
 * MissingTextureWarning - Displays missing texture paths in a stylized warning box
 * Style: Black background, yellow border, direct list display
 */
export const MissingTextureWarning: React.FC = () => {
    const missingTextures = useRendererStore(state => state.missingTextures)

    if (missingTextures.length === 0) {
        return null
    }

    // Custom Warning Icon SVG (Black exclamation in yellow triangle)
    const WarningIcon = () => (
        <svg width="20" height="18" viewBox="0 0 24 22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 20H22L12 2Z" fill="#ffc107" stroke="#ffc107" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 8V13" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1.5" fill="black" />
        </svg>
    );

    return (
        <div
            style={{
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                border: '1.5px solid #ffc107',
                borderRadius: '4px',
                padding: '10px 14px',
                color: '#fff',
                width: 'auto',
                minWidth: '240px',
                maxWidth: '450px',
                boxShadow: '0 4px 15px rgba(0, 0, 0, 0.6)',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                pointerEvents: 'auto'
            }}
        >
            {/* Header Row */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                borderBottom: '1px solid rgba(255, 193, 7, 0.3)',
                paddingBottom: '6px'
            }}>
                <WarningIcon />
                <span style={{
                    fontSize: '15px',
                    fontWeight: 'bold',
                    color: '#ffc107',
                    letterSpacing: '1px'
                }}>
                    贴图缺少
                </span>
            </div>

            {/* Paths List */}
            <div style={{
                fontSize: '12px',
                fontFamily: 'Consolas, "Courier New", monospace',
                maxHeight: '200px',
                overflowY: 'auto',
                paddingRight: '4px'
            }}>
                {missingTextures.map((path, index) => {
                    const parts = path.split('.');
                    const ext = parts.length > 1 ? parts.pop() : '';
                    const base = parts.join('.');
                    const isUnsupported = ext && !['blp', 'tga'].includes(ext.toLowerCase());

                    return (
                        <div
                            key={index}
                            style={{
                                padding: '4px 0',
                                color: '#eee',
                                wordBreak: 'break-all',
                                opacity: 0.9
                            }}
                        >
                            {base}
                            {ext && (
                                <span style={{
                                    color: isUnsupported ? '#ff4d4f' : '#eee', // Highlight in red if unsupported
                                    fontWeight: isUnsupported ? 'bold' : 'normal',
                                    paddingLeft: '1px'
                                }}>
                                    .{ext}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    )
}
