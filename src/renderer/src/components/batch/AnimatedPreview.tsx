import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
// @ts-ignore
import { parseMDX, parseMDL, ModelRenderer } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { loadAllTextures, loadTeamColorTextures } from '../viewer/textureLoader';
import { mat4, vec3, quat } from 'gl-matrix';

interface AnimatedPreviewProps {
    filePath: string;
    animation?: string;
    width?: number;
    height?: number;
}

// Pre-allocate matrices to avoid garbage collection pressure
const DEFAULT_P_MATRIX = mat4.create();
const DEFAULT_MV_MATRIX = mat4.create();
const QUAT_HEAP = quat.create();
const VEC_HEAP = vec3.create();
const DIR_X = vec3.fromValues(1, 0, 0);
const DIR_Y = vec3.fromValues(0, 1, 0);

export const AnimatedPreview: React.FC<AnimatedPreviewProps> = React.memo(({
    filePath,
    animation,
    width = 512,
    height = 512
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<WebGLRenderingContext | WebGL2RenderingContext | null>(null);
    const rendererRef = useRef<ModelRenderer | null>(null);
    const modelRef = useRef<any>(null);
    const animationFrameRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Orbit camera state
    const cameraRef = useRef({
        horizontalAngle: Math.PI / 2 + Math.PI / 4,
        verticalAngle: Math.PI / 3,
        distance: 200,
        target: vec3.create(),
        position: vec3.create(),
        minDistance: 5,
        maxDistance: 10000,
        rotationSpeed: 0.005
    });

    const mouseRef = useRef({
        isLeftDown: false,
        isRightDown: false,
        lastX: 0,
        lastY: 0
    });

    const updateCamera = useCallback(() => {
        const cam = cameraRef.current;
        cam.verticalAngle = Math.min(Math.max(0.01, cam.verticalAngle), Math.PI - 0.01);

        quat.identity(QUAT_HEAP);
        quat.rotateZ(QUAT_HEAP, QUAT_HEAP, cam.horizontalAngle);
        quat.rotateX(QUAT_HEAP, QUAT_HEAP, cam.verticalAngle);

        vec3.set(cam.position, 0, 0, 1);
        vec3.transformQuat(cam.position, cam.position, QUAT_HEAP);
        vec3.scale(cam.position, cam.position, cam.distance);
        vec3.add(cam.position, cam.position, cam.target);
    }, []);

    // Initialize WebGL and Load Model
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let active = true;
        let renderer: any = null;

        const init = async () => {
            // Slight delay to allow previous component to finish cleanup
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!active) return;

            setIsLoading(true);
            setError(null);

            try {
                const contextAttributes: WebGLContextAttributes = {
                    alpha: true,
                    premultipliedAlpha: true,
                    preserveDrawingBuffer: false,
                    antialias: true,
                    powerPreference: 'high-performance'
                };

                let gl: WebGLRenderingContext | WebGL2RenderingContext | null =
                    canvas.getContext('webgl2', contextAttributes);
                if (!gl) gl = canvas.getContext('webgl', contextAttributes);
                if (!gl) throw new Error('WebGL not supported');

                glRef.current = gl;

                // Setup WebGL State
                gl.clearColor(0.05, 0.05, 0.05, 1);
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.CULL_FACE);

                // Log WebGL version
                const version = gl.getParameter(gl.VERSION);
                console.log(`[AnimatedPreview] GL Version: ${version}`);

                const buffer = await readFile(filePath);
                if (!active) return;

                let model: any;
                if (filePath.toLowerCase().endsWith('.mdl')) {
                    model = parseMDL(new TextDecoder().decode(buffer));
                } else {
                    model = parseMDX(buffer.buffer);
                }
                if (!model) throw new Error('Failed to parse model');
                modelRef.current = model;

                renderer = new ModelRenderer(model);
                renderer.initGL(gl);
                rendererRef.current = renderer;

                await loadAllTextures(model, renderer, filePath);
                if (!active) return;
                await loadTeamColorTextures(renderer, 0);

                // Initial sequence and update to initialize buffers
                if (renderer.setSequence && model.Sequences?.length > 0) {
                    renderer.setSequence(0);
                }

                // Warm up loop - update twice to ensure all matrices are calculated
                renderer.update(0);
                renderer.update(16);

                // Camera target based on model
                if (model.Info?.Extent) {
                    const { Min, Max } = model.Info.Extent;
                    vec3.add(cameraRef.current.target, Min as any, Max as any);
                    vec3.scale(cameraRef.current.target, cameraRef.current.target, 0.5);
                    const diag = vec3.dist(Min as any, Max as any);
                    cameraRef.current.distance = Math.max(diag * 0.7, 100);
                }

                updateCamera();
                if (active) setIsLoading(false);
            } catch (err) {
                console.error('AnimatedPreview init failed:', err);
                if (active) {
                    setError(String(err));
                    setIsLoading(false);
                }
            }
        };

        init();

        return () => {
            active = false;
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

            // Null all refs to allow garbage collection
            // Note: We don't call loseContext() as it can cause issues with pending async operations
            // The browser will clean up the context when the canvas is removed from the DOM
            rendererRef.current = null;
            modelRef.current = null;
            glRef.current = null;
        };
    }, [filePath, updateCamera]);

    // Animation control
    useEffect(() => {
        const renderer = rendererRef.current;
        const model = modelRef.current;
        if (!renderer || !model || !animation) return;

        const seqIndex = model.Sequences?.findIndex((s: any) => s.Name === animation);
        if (seqIndex >= 0 && renderer.setSequence) {
            renderer.setSequence(seqIndex);
        }
    }, [animation]);

    // Render loop
    useEffect(() => {
        if (isLoading || error) return;
        const gl = glRef.current;
        const renderer = rendererRef.current;
        const canvas = canvasRef.current;
        if (!gl || !renderer || !canvas) return;

        const render = (time: number) => {
            const delta = lastTimeRef.current ? (time - lastTimeRef.current) : 16;
            lastTimeRef.current = time;

            renderer.update(delta);

            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            mat4.perspective(DEFAULT_P_MATRIX, Math.PI / 4, canvas.width / canvas.height, 1, 20000);
            mat4.lookAt(DEFAULT_MV_MATRIX, cameraRef.current.position, cameraRef.current.target, [0, 0, 1]);

            if (renderer.render) {
                try {
                    renderer.render(DEFAULT_MV_MATRIX, DEFAULT_P_MATRIX, { wireframe: false, enableLighting: true } as any);
                } catch (e) { }
            }

            animationFrameRef.current = requestAnimationFrame(render);
        };

        animationFrameRef.current = requestAnimationFrame(render);
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [isLoading, error]);

    // Manual event listeners to avoid React passive warning and ensure pan/zoom works correctly
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const cam = cameraRef.current;
            cam.distance = Math.max(cam.minDistance, Math.min(cam.maxDistance, cam.distance * (1 + (e.deltaY / 1000))));
            updateCamera();
        };

        const onMouseDown = (e: MouseEvent) => {
            if (e.button === 0) mouseRef.current.isLeftDown = true;
            else if (e.button === 2) mouseRef.current.isRightDown = true;
            mouseRef.current.lastX = e.clientX;
            mouseRef.current.lastY = e.clientY;
        };

        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 0) mouseRef.current.isLeftDown = false;
            else if (e.button === 2) mouseRef.current.isRightDown = false;
        };

        const onMouseMove = (e: MouseEvent) => {
            const dx = e.clientX - mouseRef.current.lastX;
            const dy = e.clientY - mouseRef.current.lastY;
            mouseRef.current.lastX = e.clientX;
            mouseRef.current.lastY = e.clientY;

            const cam = cameraRef.current;
            if (mouseRef.current.isLeftDown) {
                cam.horizontalAngle -= dx * cam.rotationSpeed;
                cam.verticalAngle -= dy * cam.rotationSpeed;
                updateCamera();
            } else if (mouseRef.current.isRightDown) {
                quat.identity(QUAT_HEAP);
                quat.rotateZ(QUAT_HEAP, QUAT_HEAP, cam.horizontalAngle);
                quat.rotateX(QUAT_HEAP, QUAT_HEAP, cam.verticalAngle);

                vec3.set(DIR_X, 1, 0, 0);
                vec3.transformQuat(DIR_X, DIR_X, QUAT_HEAP);
                vec3.set(DIR_Y, 0, 1, 0);
                vec3.transformQuat(DIR_Y, DIR_Y, QUAT_HEAP);

                const panScale = cam.distance * 0.002;
                vec3.scale(VEC_HEAP, DIR_X, -dx * panScale);
                vec3.add(cam.target, cam.target, VEC_HEAP);
                vec3.scale(VEC_HEAP, DIR_Y, dy * panScale);
                vec3.add(cam.target, cam.target, VEC_HEAP);
                updateCamera();
            }
        };

        const onContextMenu = (e: MouseEvent) => e.preventDefault();

        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('contextmenu', onContextMenu);

        return () => {
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('contextmenu', onContextMenu);
        };
    }, [updateCamera]);

    return (
        <div style={{
            width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center',
            background: '#0a0a0a', borderRadius: 4, overflow: 'hidden', border: '1px solid #333'
        }}>
            {isLoading && <div style={{ color: '#888', fontSize: 13 }}>模型加载中...</div>}
            {error && <div style={{ color: '#ff4d4f', fontSize: 11, padding: 8 }}>渲染出错</div>}
            <canvas ref={canvasRef} width={width} height={height} style={{
                display: isLoading || error ? 'none' : 'block',
                width: '100%', height: '100%', cursor: 'grab'
            }} />
        </div>
    );
});
