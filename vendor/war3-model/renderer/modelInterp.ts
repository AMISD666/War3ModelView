import { AnimKeyframe, AnimVector } from '../model';
import { findKeyframes, interpNum, interpVec3, interpQuat, coalesceAnimVectorKeys } from './interp';
import { vec3, quat } from 'gl-matrix';
import { RendererData } from './rendererData';

const findLocalFrameRes = {
    frame: 0,
    from: 0,
    to: 0
};

export class ModelInterp {
    public static maxAnimVectorVal(vector: AnimVector | number | null | undefined): number {
        if (typeof vector === 'number') {
            return vector;
        }

        if (!vector || vector.Keys == null) {
            return 0;
        }

        const keysArr = coalesceAnimVectorKeys(vector.Keys);
        if (!keysArr || keysArr.length === 0) {
            return 0;
        }

        let max = keysArr[0]?.Vector?.[0] ?? 0;

        for (let i = 1; i < keysArr.length; ++i) {
            const v = keysArr[i]?.Vector?.[0];
            if (typeof v === 'number' && v > max) {
                max = v;
            }
        }

        return max;
    }

    private rendererData: RendererData;

    constructor(rendererData: RendererData) {
        this.rendererData = rendererData;
    }

    public num(animVector: AnimVector): number | null {
        const res = this.findKeyframes(animVector);
        if (!res) {
            return null;
        }
        return interpNum(res.frame, res.left, res.right, animVector.LineType);
    }

    public vec3(out: vec3, animVector: AnimVector): vec3 | null {
        const res = this.findKeyframes(animVector);
        if (!res) {
            return null;
        }
        return interpVec3(out, res.frame, res.left, res.right, animVector.LineType);
    }

    public quat(out: quat, animVector: AnimVector): quat | null {
        const res = this.findKeyframes(animVector);
        if (!res) {
            return null;
        }
        return interpQuat(out, res.frame, res.left, res.right, animVector.LineType);
    }

    public animVectorVal(vector: AnimVector | number, defaultVal: number): number {
        let res;

        if (typeof vector === 'number') {
            res = vector;
        } else {
            res = this.num(vector);
            if (res === null) {
                res = defaultVal;
            }
        }

        return res;
    }

    public findKeyframes(animVector: AnimVector): null | { frame: number, left: AnimKeyframe, right: AnimKeyframe } {
        if (!animVector) {
            return null;
        }

        const { frame, from, to } = this.findLocalFrame(animVector);

        return findKeyframes(animVector, frame, from, to);
    }

    public findLocalFrame(animVector: AnimVector): { frame: number, from: number, to: number } {
        // Warcraft tracks use -1 as "no global sequence".
        // Treat negative ids as local sequence time, same as null/undefined.
        if (typeof animVector.GlobalSeqId === 'number' && animVector.GlobalSeqId >= 0) {
            const globalSeqDuration = this.rendererData.model.GlobalSequences[animVector.GlobalSeqId];

            // Handle GlobalSequence with duration 0: treat as static (use first keyframe)
            // This prevents the frame reset loop that causes flickering
            if (globalSeqDuration === 0 || globalSeqDuration === undefined) {
                // Use the first keyframe's frame as both from/to (static)
                const firstKeyFrame = animVector.Keys?.[0]?.Frame ?? 0;
                findLocalFrameRes.frame = firstKeyFrame;
                findLocalFrameRes.from = firstKeyFrame;
                findLocalFrameRes.to = firstKeyFrame;
            } else {
                findLocalFrameRes.frame = this.rendererData.globalSequencesFrames[animVector.GlobalSeqId];
                findLocalFrameRes.from = 0;
                findLocalFrameRes.to = globalSeqDuration;
            }
        } else {
            if (!this.rendererData.animationInfo) {
                findLocalFrameRes.frame = 0;
                findLocalFrameRes.from = 0;
                findLocalFrameRes.to = 0;
            } else {
                findLocalFrameRes.frame = this.rendererData.frame;
                findLocalFrameRes.from = this.rendererData.animationInfo.Interval[0];
                findLocalFrameRes.to = this.rendererData.animationInfo.Interval[1];
            }
        }
        return findLocalFrameRes;
    }
}
