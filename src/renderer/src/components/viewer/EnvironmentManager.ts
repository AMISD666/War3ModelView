/**
 * EnvironmentManager - Manages environmental lighting with full parameter control
 */

import { vec3 } from 'gl-matrix';

// Light preset definition
export interface LightPreset {
    name: string;
    lightIntensity: number;
    ambientIntensity: number;
    lightColor: [number, number, number];
    ambientColor: [number, number, number];
}

// Built-in presets
export const DNC_PRESETS: Record<string, LightPreset> = {
    lordaeron: {
        name: '洛丹伦 (夏)',
        lightIntensity: 1.0,
        ambientIntensity: 0.3,
        lightColor: [255, 255, 255],
        ambientColor: [255, 255, 255]
    }
};

// Custom presets storage key
const CUSTOM_PRESETS_KEY = 'war3view_custom_light_presets';

export interface EnvironmentLightParams {
    lightDirection: vec3;
    lightColor: vec3;
    ambientColor: vec3;
    enabled: boolean;
}

export class EnvironmentManager {
    private currentPreset: string = 'lordaeron';
    private enabled = true;

    // Adjustable parameters (should match lordaeron preset defaults)
    private _lightIntensity = 1.0;
    private _ambientIntensity = 0.3;
    private _lightColorRGB: [number, number, number] = [255, 255, 255];
    private _ambientColorRGB: [number, number, number] = [255, 255, 255];

    // Cached light parameters (computed)
    private _lightDirection: vec3 = vec3.fromValues(1, -1, 1);
    private _lightColor: vec3 = vec3.fromValues(1, 1, 1);
    private _ambientColor: vec3 = vec3.fromValues(1, 1, 1);

    // Custom presets
    private _customPresets: Record<string, LightPreset> = {};

    constructor() {
        vec3.normalize(this._lightDirection, this._lightDirection);
        this.loadCustomPresets();
        this.updateColors();
    }

    /**
     * Load custom presets from localStorage.
     */
    private loadCustomPresets(): void {
        try {
            const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
            if (saved) {
                this._customPresets = JSON.parse(saved);
            }
        } catch (e) {
            console.error('[EnvironmentManager] Failed to load custom presets:', e);
        }
    }

    /**
     * Save custom presets to localStorage.
     */
    private saveCustomPresets(): void {
        try {
            localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(this._customPresets));
        } catch (e) {
            console.error('[EnvironmentManager] Failed to save custom presets:', e);
        }
    }

    /**
     * Update computed colors from RGB and intensity values.
     */
    private updateColors(): void {
        // Convert RGB (0-255) to (0-1) and multiply by intensity
        vec3.set(
            this._lightColor,
            (this._lightColorRGB[0] / 255) * this._lightIntensity,
            (this._lightColorRGB[1] / 255) * this._lightIntensity,
            (this._lightColorRGB[2] / 255) * this._lightIntensity
        );
        vec3.set(
            this._ambientColor,
            (this._ambientColorRGB[0] / 255) * this._ambientIntensity,
            (this._ambientColorRGB[1] / 255) * this._ambientIntensity,
            (this._ambientColorRGB[2] / 255) * this._ambientIntensity
        );
    }

    /**
     * Get all presets (built-in + custom).
     */
    public getAllPresets(): Record<string, LightPreset> {
        return { ...DNC_PRESETS, ...this._customPresets };
    }

    /**
     * Load a preset by key.
     */
    public async loadPreset(presetKey: string): Promise<boolean> {
        const allPresets = this.getAllPresets();
        const preset = allPresets[presetKey];
        if (!preset) {
            console.error(`[EnvironmentManager] Unknown preset: ${presetKey}`);
            return false;
        }

        this._lightIntensity = preset.lightIntensity;
        this._ambientIntensity = preset.ambientIntensity;
        this._lightColorRGB = [...preset.lightColor];
        this._ambientColorRGB = [...preset.ambientColor];
        this.updateColors();

        this.currentPreset = presetKey;
        this.enabled = true;

        console.log(`[EnvironmentManager] Loaded: ${preset.name}`);
        return true;
    }

    /**
     * Save current settings as a custom preset.
     */
    public saveAsPreset(name: string): string {
        const key = `custom_${Date.now()}`;
        this._customPresets[key] = {
            name,
            lightIntensity: this._lightIntensity,
            ambientIntensity: this._ambientIntensity,
            lightColor: [...this._lightColorRGB],
            ambientColor: [...this._ambientColorRGB]
        };
        this.saveCustomPresets();
        console.log(`[EnvironmentManager] Saved preset: ${name}`);
        return key;
    }

    /**
     * Delete a custom preset.
     */
    public deletePreset(key: string): boolean {
        if (DNC_PRESETS[key]) {
            console.warn('[EnvironmentManager] Cannot delete built-in preset');
            return false;
        }
        if (this._customPresets[key]) {
            delete this._customPresets[key];
            this.saveCustomPresets();
            return true;
        }
        return false;
    }

    // Getters and setters
    public setLightIntensity(v: number): void {
        this._lightIntensity = Math.max(0, Math.min(3, v));
        this.updateColors();
    }
    public getLightIntensity(): number { return this._lightIntensity; }

    public setAmbientIntensity(v: number): void {
        this._ambientIntensity = Math.max(0, Math.min(3, v));
        this.updateColors();
    }
    public getAmbientIntensity(): number { return this._ambientIntensity; }

    public setLightColorRGB(r: number, g: number, b: number): void {
        this._lightColorRGB = [r, g, b];
        this.updateColors();
    }
    public getLightColorRGB(): [number, number, number] { return [...this._lightColorRGB]; }

    public setAmbientColorRGB(r: number, g: number, b: number): void {
        this._ambientColorRGB = [r, g, b];
        this.updateColors();
    }
    public getAmbientColorRGB(): [number, number, number] { return [...this._ambientColorRGB]; }

    public update(_delta: number): void {
        // Static values, no animation
    }

    public getLightParams(): EnvironmentLightParams {
        return {
            lightDirection: this._lightDirection,
            lightColor: this._lightColor,
            ambientColor: this._ambientColor,
            enabled: this.enabled
        };
    }

    public setEnabled(enabled: boolean): void { this.enabled = enabled; }
    public isEnabled(): boolean { return this.enabled; }
    public getCurrentPreset(): string { return this.currentPreset; }
    public unload(): void { this.enabled = false; }
}

// Singleton
let _environmentManager: EnvironmentManager | null = null;
export function getEnvironmentManager(): EnvironmentManager {
    if (!_environmentManager) {
        _environmentManager = new EnvironmentManager();
    }
    return _environmentManager;
}
