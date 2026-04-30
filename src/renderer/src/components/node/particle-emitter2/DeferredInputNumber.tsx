import { SmartInputNumber as BaseInputNumber } from '@renderer/components/common/SmartInputNumber';
import React from 'react';

export const DeferredCommitContext = React.createContext<(() => void) | null>(null);

export const InputNumber = React.forwardRef<any, React.ComponentProps<typeof BaseInputNumber>>((props, ref) => {
    const commitDeferredChanges = React.useContext(DeferredCommitContext);
    const { onBlur, onChange, onPressEnter, ...rest } = props as any;

    return (
        <BaseInputNumber
            ref={ref}
            {...rest}
            onChange={onChange}
            onBlur={(event: any) => {
                onBlur?.(event);
                commitDeferredChanges?.();
            }}
            onPressEnter={(event: any) => {
                onPressEnter?.(event);
                commitDeferredChanges?.();
            }}
        />
    );
});

InputNumber.displayName = 'ParticleEmitter2DeferredInputNumber';
