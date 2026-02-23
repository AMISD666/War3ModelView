export const shiftModelKeyframes = (modelData: any, targetSequenceIndex: number, deltaMs: number) => {
    if (!modelData || deltaMs === 0) return modelData;

    let newData;
    try {
        newData = structuredClone(modelData);
    } catch (e) {
        console.warn('structuredClone failed, falling back to JSON clone which might corrupt TypedArrays', e);
        newData = JSON.parse(JSON.stringify(modelData));
    }

    if (!newData.Sequences || targetSequenceIndex < 0 || targetSequenceIndex >= newData.Sequences.length) return newData;

    const targetSeq = newData.Sequences[targetSequenceIndex];
    if (!targetSeq.Interval || targetSeq.Interval.length < 2) return newData;

    const startTime = targetSeq.Interval[0];
    const splitTime = targetSeq.Interval[1]; // The end of the target sequence is the split time
    const oldDuration = splitTime - startTime;
    const scale = oldDuration > 0 ? (oldDuration + deltaMs) / oldDuration : 1;

    // 1. Extend the target sequence itself
    targetSeq.Interval[1] += deltaMs;

    // 2. Shift all subsequent sequences
    newData.Sequences.forEach((seq: any, index: number) => {
        if (index === targetSequenceIndex) return; // targetSeq is already extended
        if (!seq.Interval || seq.Interval.length < 2) return;

        // If the sequence starts exactly at or after the splitTime
        if (seq.Interval[0] >= splitTime) {
            seq.Interval[0] += deltaMs;
            seq.Interval[1] += deltaMs;
        }
    });

    // 3. Helper to shift and scale tracks (keyframes)
    let shiftedCount = 0;
    let scaledCount = 0;
    const processedTracks = new Set<any>();

    const shiftTrack = (track: any) => {
        if (!track || !Array.isArray(track.Keys)) return;
        if (processedTracks.has(track)) return;
        processedTracks.add(track);
        // GlobalSequenceId / GlobalSeqId means the track is independent of normal sequence time bounds
        // WARNING: In JS, `null >= 0` evaluates to `true`! Must explicitly check !== null
        if (track.GlobalSeqId !== undefined && track.GlobalSeqId !== null && track.GlobalSeqId >= 0) return;
        if (track.GlobalSequenceId !== undefined && track.GlobalSequenceId !== null && track.GlobalSequenceId >= 0) return;

        track.Keys.forEach((key: any) => {
            if (key.Frame > splitTime) {
                key.Frame += deltaMs;
                shiftedCount++;
            } else if (key.Frame >= startTime && key.Frame <= splitTime) {
                if (oldDuration > 0) {
                    key.Frame = startTime + Math.round((key.Frame - startTime) * scale);
                    scaledCount++;
                } else {
                    key.Frame += deltaMs;
                    shiftedCount++;
                }
            }
        });
    };

    const shiftEventTrack = (obj: any, propName: string = 'EventTrack') => {
        if (!obj[propName]) return;
        if (obj.GlobalSeqId !== undefined && obj.GlobalSeqId !== null && obj.GlobalSeqId >= 0) return;
        if (obj.GlobalSequenceId !== undefined && obj.GlobalSequenceId !== null && obj.GlobalSequenceId >= 0) return;

        // Handle both Array and TypedArray
        const track = obj[propName];
        if (processedTracks.has(track)) return;
        processedTracks.add(track);

        const isTyped = track instanceof Uint32Array || track instanceof Int32Array || track instanceof Float32Array;
        const newTrack = isTyped ? new (track.constructor as any)(track.length) : [];

        for (let i = 0; i < track.length; i++) {
            let frame = track[i];
            if (frame > splitTime) {
                frame += deltaMs;
                shiftedCount++;
            } else if (frame >= startTime && frame <= splitTime) {
                if (oldDuration > 0) {
                    frame = startTime + Math.round((frame - startTime) * scale);
                    scaledCount++;
                } else {
                    frame += deltaMs;
                    shiftedCount++;
                }
            }
            if (isTyped) {
                newTrack[i] = frame;
            } else {
                newTrack.push(frame);
            }
        }
        obj[propName] = newTrack;
    };

    const shiftAllTracksInObject = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        for (const propName in obj) {
            const track = obj[propName];
            if (track && typeof track === 'object') {
                if (Array.isArray(track.Keys)) {
                    shiftTrack(track);
                } else if (propName === 'EventTrack' || propName === 'EventTrack2') {
                    shiftEventTrack(obj, propName);
                }
            }
        }
    };

    // Traverse all basic nodes
    const allNodes: any[] = [];
    const nodeTypes = [
        'Nodes', 'Bones', 'Helpers', 'Lights', 'Attachments',
        'ParticleEmitters', 'ParticleEmitters2', 'RibbonEmitters',
        'EventObjects', 'CollisionShapes', 'ParticleEmitterPopcorns'
    ];

    nodeTypes.forEach(type => {
        if (newData[type] && Array.isArray(newData[type])) {
            allNodes.push(...newData[type]);
        }
    });

    allNodes.forEach((node: any) => {
        shiftAllTracksInObject(node);
    });

    // Traverse Materials
    if (newData.Materials) {
        newData.Materials.forEach((mat: any) => {
            shiftAllTracksInObject(mat);
            if (mat.Layers) {
                mat.Layers.forEach((layer: any) => {
                    shiftAllTracksInObject(layer);
                });
            }
        });
    }

    // Traverse TextureAnimations
    if (newData.TextureAnimations) {
        newData.TextureAnimations.forEach((tAnim: any) => {
            shiftAllTracksInObject(tAnim);
        });
    }

    // Traverse GeosetAnimations
    if (newData.GeosetAnimations) {
        newData.GeosetAnimations.forEach((gAnim: any) => {
            shiftAllTracksInObject(gAnim);
        });
    }

    // Traverse Cameras
    if (newData.Cameras) {
        newData.Cameras.forEach((cam: any) => {
            shiftAllTracksInObject(cam);
        });
    }

    console.log(`[TimeShiftService] Scaling Summary:
    - Delta: ${deltaMs}ms
    - Scale: ${scale.toFixed(4)}
    - Mode: ${deltaMs > 0 ? 'Extend' : 'Shrink'}
    - Tracks Found/Scaled: ${scaledCount}
    - Tracks Shifted: ${shiftedCount}`);

    return newData;
};
