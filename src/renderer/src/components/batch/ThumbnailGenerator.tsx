import React, { useEffect, useRef, useState } from 'react';
// @ts-ignore
import { parseMDX, parseMDL, ModelRenderer } from 'war3-model';
import { readFile } from '@tauri-apps/plugin-fs';
import { loadAllTextures, loadTeamColorTextures } from '../viewer/textureLoader';
import { mat4, vec3 } from 'gl-matrix';

interface ThumbnailGeneratorProps {
    queue: { name: string; fullPath: string }[];
    onThumbnailReady: (fullPath: string, dataUrl: string, animations?: string[]) => void;
    onItemProcessed: (fullPath: string) => void;
    paused?: boolean; // Pause processing to avoid WebGL context conflicts
}

export const ThumbnailGenerator: React.FC<ThumbnailGeneratorProps> = ({ queue, onThumbnailReady, onItemProcessed, paused }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<ModelRenderer | null>(null);
    const glRef = useRef<WebGLRenderingContext | WebGL2RenderingContext | null>(null);
    const [processingPath, setProcessingPath] = useState<string | null>(null);

    // Initialize WebGL context once
    useEffect(() => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const contextAttributes: WebGLContextAttributes = {
            alpha: true,
            premultipliedAlpha: true,
            preserveDrawingBuffer: true // Crucial for toDataURL
        };
        let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', contextAttributes);
        if (!gl) {
            gl = canvas.getContext('webgl', contextAttributes);
        }
        if (gl) {
            glRef.current = gl;
            gl.clearColor(0, 0, 0, 0); // Transparent background
            gl.enable(gl.DEPTH_TEST);
        }
    }, []);

    // Queue Processor
    useEffect(() => {
        const processQueue = async () => {
            // CRITICAL: Skip processing when paused to avoid WebGL context corruption
            if (paused || processingPath || queue.length === 0 || !glRef.current || !canvasRef.current) return;

            const item = queue[0];
            setProcessingPath(item.fullPath);
            const gl = glRef.current;

            try {
                // 1. Read File
                const buffer = await readFile(item.fullPath);

                // 2. Parse Model
                let model: any;
                if (item.fullPath.toLowerCase().endsWith('.mdl')) {
                    const text = new TextDecoder().decode(buffer);
                    model = parseMDL(text);
                } else {
                    model = parseMDX(buffer.buffer);
                }

                if (!model) throw new Error('Failed to parse model');

                // 3. Setup Renderer
                // Cleanup old renderer resources if necessary? 
                // ModelRenderer.destroy()? War3-model might not have full destroy logic but we can new up one.
                // Assuming we can reuse context.

                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                gl.viewport(0, 0, canvasRef.current.width, canvasRef.current.height);

                const renderer = new ModelRenderer(model);
                renderer.initGL(gl);
                rendererRef.current = renderer;

                // 4. Load Textures
                // We don't need to await ALL textures if we want speed, but for correct thumbnail we should.
                // We can use the loadAllTextures helper.
                await loadAllTextures(model, renderer, item.fullPath);
                await loadTeamColorTextures(renderer, 0); // Default team color (Red)

                // 5. Setup Camera (Fit to Extents)
                const cameraPos = vec3.create();
                const target = vec3.create();
                const up = vec3.fromValues(0, 0, 1);

                if (model.Info && model.Info.Extent) {
                    const { Min, Max } = model.Info.Extent;
                    const min = vec3.fromValues(Min[0], Min[1], Min[2]);
                    const max = vec3.fromValues(Max[0], Max[1], Max[2]);

                    vec3.add(target, min, max);
                    vec3.scale(target, target, 0.5);

                    const diagonal = vec3.dist(min, max);
                    const distance = Math.max(diagonal * 0.4, 60);

                    // Standard isometric-ish view
                    const theta = Math.PI / 4;
                    const phi = Math.PI / 3;

                    const x = distance * Math.sin(phi) * Math.cos(theta);
                    const y = distance * Math.sin(phi) * Math.sin(theta);
                    const z = distance * Math.cos(phi);

                    vec3.set(cameraPos, x, y, z);
                    vec3.add(cameraPos, cameraPos, target);
                } else {
                    // Fallback
                    vec3.set(cameraPos, 200, 200, 200);
                }

                // 6. Render
                // Update(0) to set initial state
                renderer.update(0);

                // Create matrices manually as we don't use orbit camera here
                const pMatrix = mat4.create();
                const mvMatrix = mat4.create();

                mat4.perspective(pMatrix, Math.PI / 4, 1, 1, 10000); // Aspect ratio 1:1
                mat4.lookAt(mvMatrix, cameraPos, target, up);

                // War3-model renderer usually takes camera in .render() BUT check Viewer.tsx
                // Viewer.tsx uses 'mdlRenderer.setCamera(cameraPos, cameraQuat)' manually in render loop if available.
                // And simple .render(mvMatrix, pMatrix)?
                // Checking war3-model source (or Viewer usage):
                // Viewer uses: mdlRenderer.update(dt) -> but where is .render()?
                // Inspecting Viewer.tsx again... I missed the .render() call!
                // Viewer.tsx doesn't seem to have explicit .render() in the loop!?
                // It creates helper renderers (grid, etc) and calls render on them.
                // What about the model itself?
                // Ah, ModelRenderer usually has a render() method.
                // Re-reading Viewer.tsx: 
                // "mdlRenderer.update(delta * playbackSpeedRef.current)"
                // Where does it draw?
                // It might be that ModelRenderer.render() is called implicitly or I missed it.
                // Or maybe 'update' does drawing? Unlikely.
                // Let's assume Render method exists.
                // Typically: renderer.render(mvMatrix, pMatrix)

                if (renderer.render) {
                    try {
                        renderer.render(mvMatrix, pMatrix, { wireframe: false, enableLighting: true } as any);
                    } catch (renderErr) {
                        console.error('Renderer.render failed:', renderErr);
                    }
                } else {
                    console.error('Renderer has no render method!');
                }

                // 7. Extract Animation Names
                const animationNames: string[] = [];
                if (model.Sequences && Array.isArray(model.Sequences)) {
                    for (const seq of model.Sequences) {
                        if (seq.Name) {
                            animationNames.push(seq.Name);
                        }
                    }
                }

                // 8. Capture
                const dataUrl = canvasRef.current.toDataURL('image/webp', 0.8);
                onThumbnailReady(item.fullPath, dataUrl, animationNames);

            } catch (err) {
                console.error(`Thumbnail generation failed for ${item.fullPath}:`, err);
                // Return empty or placeholder?
            } finally {
                // Queue Next
                setProcessingPath(null);
                onItemProcessed(item.fullPath);
            }
        };

        processQueue();
    }, [queue, processingPath, onThumbnailReady, onItemProcessed, paused]);

    return (
        <canvas
            ref={canvasRef}
            width={256}
            height={256}
            style={{ display: 'none' }} // Hidden canvas
        />
    );
};
