struct VSUniforms {
    mvMatrix: mat4x4f,
    pMatrix: mat4x4f,
}

struct FSUniforms {
    replaceableColor: vec3f,
    replaceableType: u32,
    discardAlphaLevel: f32,
    wireframe: u32,
    tVertexAnim: mat3x3f,
    geosetColor: vec3f,
    layerAlpha: f32,
    geosetAlpha: f32,
}

@group(0) @binding(0) var<uniform> vsUniforms: VSUniforms;
@group(0) @binding(1) var boneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> boneTextureWidth: f32;
@group(1) @binding(0) var<uniform> fsUniforms: FSUniforms;
@group(1) @binding(1) var fsUniformSampler: sampler;
@group(1) @binding(2) var fsUniformTexture: texture_2d<f32>;

struct VSIn {
    @location(0) vertexPosition: vec3f,
    @location(1) normal: vec3f,
    @location(2) textureCoord: vec2f,
    @location(3) group: vec4<u32>,
}

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) textureCoord: vec2f,
}

// Fetch a bone matrix from the texture
// Each mat4 requires 4 texels (4 vec4 = 16 floats = 4 RGBA pixels)
fn getBoneMatrix(boneIndex: u32) -> mat4x4f {
    let pixelIndex: f32 = f32(boneIndex * 4u);
    let y: i32 = i32(floor(pixelIndex / boneTextureWidth));
    let x: i32 = i32(pixelIndex) % i32(boneTextureWidth);
    
    let r0: vec4f = textureLoad(boneTexture, vec2i(x, y), 0);
    let r1: vec4f = textureLoad(boneTexture, vec2i(x + 1, y), 0);
    let r2: vec4f = textureLoad(boneTexture, vec2i(x + 2, y), 0);
    let r3: vec4f = textureLoad(boneTexture, vec2i(x + 3, y), 0);
    
    return mat4x4f(r0, r1, r2, r3);
}

@vertex fn vs(
    in: VSIn
) -> VSOut {
    var position: vec4f = vec4f(in.vertexPosition, 1.0);
    var count: i32 = 1;
    var sum: vec4f = getBoneMatrix(in.group[0]) * position;

    // Using a large sentinel value instead of MAX_NODES template
    if (in.group[1] < 65535u) {
        sum += getBoneMatrix(in.group[1]) * position;
        count += 1;
    }
    if (in.group[2] < 65535u) {
        sum += getBoneMatrix(in.group[2]) * position;
        count += 1;
    }
    if (in.group[3] < 65535u) {
        sum += getBoneMatrix(in.group[3]) * position;
        count += 1;
    }
    sum /= f32(count);
    sum.w = 1.;
    position = sum;

    var out: VSOut;
    out.position = vsUniforms.pMatrix * vsUniforms.mvMatrix * position;
    out.textureCoord = in.textureCoord;
    out.normal = in.normal;
    return out;
}

fn hypot(z: vec2f) -> f32 {
    var t: f32 = 0;
    var x: f32 = abs(z.x);
    let y: f32 = abs(z.y);
    t = min(x, y);
    x = max(x, y);
    t = t / x;
    if (z.x == 0.0 && z.y == 0.0) {
        return 0.0;
    }
    return x * sqrt(1.0 + t * t);
}

@fragment fn fs(
    in: VSOut
) -> @location(0) vec4f {
    if (fsUniforms.wireframe > 0) {
        return vec4f(1);
    }

    let texCoord: vec2f = (fsUniforms.tVertexAnim * vec3f(in.textureCoord.x, in.textureCoord.y, 1.)).xy;
    var color: vec4f = vec4f(0.0);

    if (fsUniforms.replaceableType == 0) {
        color = textureSample(fsUniformTexture, fsUniformSampler, texCoord);
    } else if (fsUniforms.replaceableType == 1) {
        color = vec4f(fsUniforms.replaceableColor, 1.0);
    } else if (fsUniforms.replaceableType == 2) {
        let dist: f32 = hypot(texCoord - vec2(0.5, 0.5)) * 2.;
        let truncateDist: f32 = clamp(1. - dist * 1.4, 0., 1.);
        let alpha: f32 = sin(truncateDist);
        color = vec4f(fsUniforms.replaceableColor * alpha, 1.0);
    }

    // Match WebGL: apply geoset color/alpha before alpha-test.
    color = vec4f(
        color.rgb * fsUniforms.geosetColor,
        color.a * fsUniforms.layerAlpha * fsUniforms.geosetAlpha
    );

    // hand-made alpha-test
    if (color.a < fsUniforms.discardAlphaLevel) {
        discard;
    }

    return color;
}
