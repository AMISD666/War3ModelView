#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 vNormal;
in vec2 vTextureCoord;

out vec4 FragColor;

uniform sampler2D uSampler;
uniform vec3 uReplaceableColor;
uniform float uReplaceableType;
uniform float uDiscardAlphaLevel;
uniform mat3 uTVertexAnim;
uniform float uWireframe;
uniform vec3 uGeosetColor;
uniform float uLayerAlpha;
uniform float uGeosetAlpha;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbientColor;
uniform float uUnshaded;
uniform float uEnableLighting;

const int MAX_LIGHTS = 8;

struct Light {
    int type; // 0: Point, 1: Directional, 2: Ambient
    vec3 position; // View Space (for Point)
    vec3 direction; // View Space (for Directional)
    vec3 color;
    float intensity;
    vec3 attenuation; // x: Constant, y: Linear, z: Quadratic
    float attenuationStart;
    float attenuationEnd;
};

uniform Light uLights[MAX_LIGHTS];
uniform int uLightCount;

in vec3 vPosition; // View Space Position

float hypot (vec2 z) {
    float t;
    float x = abs(z.x);
    float y = abs(z.y);
    t = min(x, y);
    x = max(x, y);
    if (x == 0.0) return 0.0;
    t = t / x;
    return x * sqrt(1.0 + t * t);
}

void main(void) {
    if (uWireframe > 0.) {
        FragColor = vec4(1.);
        return;
    }

    vec2 texCoord = (uTVertexAnim * vec3(vTextureCoord.s, vTextureCoord.t, 1.)).st;

    if (uReplaceableType == 0.) {
        FragColor = texture(uSampler, texCoord);
    } else if (uReplaceableType == 1.) {
        FragColor = vec4(uReplaceableColor, 1.0);
    } else if (uReplaceableType == 2.) {
        float dist = hypot(texCoord - vec2(0.5, 0.5)) * 2.;
        float truncateDist = clamp(1. - dist * 1.4, 0., 1.);
        float alpha = sin(truncateDist);
        FragColor = vec4(uReplaceableColor * alpha, 1.0);
    }

    // Apply Geoset Color/Alpha (BEFORE lighting, preserves base color)
    FragColor.rgb *= uGeosetColor;
    FragColor.a *= uLayerAlpha * uGeosetAlpha;

    // --- Lighting Calculation ---
    // Only calculate if lighting is enabled and alpha is high enough (optimization)
    if (uEnableLighting > 0.5 && FragColor.a > 0.01) {
        // 1. Unshaded Override (Fire, Magic, UI) -> Skip lighting
        if (uUnshaded < 0.5) {
            // 2. Normal Handling (Double-sided support)
            // Renormalize Normal to correct for interpolation errors
            vec3 normal = normalize(vNormal);
            if (!gl_FrontFacing) {
               normal = -normal;
            }

            // 3. Ambient
            vec3 finalLight = uAmbientColor;
            
            // 4. Directional Sun (Global)
            // Use existing uLightDir/uLightColor for the main sun/global directional light
            vec3 lightDir = normalize(uLightDir);
            float diff = max(dot(normal, lightDir), 0.0);
            finalLight += diff * uLightColor;

            // 5. Local Lights (Point / Directional from Model)
            for (int i = 0; i < uLightCount; i++) {
                Light light = uLights[i];
                float attenuation = 1.0;
                vec3 lDir;

                if (light.type == 0) { // Point Light
                    vec3 distVec = light.position - vPosition;
                    float dist = length(distVec);
                    lDir = normalize(distVec);

                    // WC3-matched Attenuation
                    // Game uses tighter range (200-400), we need to scale similarly
                    float start = light.attenuationStart;
                    float end = light.attenuationEnd;
                    
                    // Use smoothstep with extended range for softer falloff
                    // The game's falloff appears to have a wider effective area
                    attenuation = 1.0 - smoothstep(start * 0.5, end * 1.5, dist);
                } else if (light.type == 1) { // Directional Light
                    lDir = normalize(-light.direction);
                    attenuation = 1.0; 
                } else {
                    continue; // Skip Ambient/Unknown in this loop
                }

                // Diffuse (for Directional) 
                float NdotL = max(dot(normal, lDir), 0.0);
                
                // Add to final color
                // WC3 point lights have a subtle tinting effect
                if (light.type == 0) {
                    // Point Light: WC3-matched intensity
                    float diffuseFactor = max(NdotL, 0.15); // 15% minimum for back faces
                    // Scale intensity: 3% to match WC3 (game intensity 20 ≈ our effect)
                    float scaledIntensity = light.intensity * 0.03;
                    finalLight += light.color * scaledIntensity * attenuation * diffuseFactor;
                } else {
                    // Directional Light: Standard diffuse
                    finalLight += light.color * light.intensity * NdotL * attenuation;
                }
            }

            FragColor.rgb *= finalLight;
        }
    }


    // hand-made alpha-test
    if (FragColor.a < uDiscardAlphaLevel) {
        discard;
    }
}
