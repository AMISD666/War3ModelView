#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 aVertexPosition;
in vec3 aNormal;
in vec2 aTextureCoord;
in vec4 aGroup;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;

// Bone matrices stored in a floating point texture instead of uniform array
uniform sampler2D uBoneTexture;
uniform float uBoneTextureWidth;

out vec3 vNormal;
out vec2 vTextureCoord;
out vec3 vPosition;

// Fetch a bone matrix from the texture using texelFetch (WebGL 2.0)
// Each mat4 requires 4 texels (4 vec4 = 16 floats = 4 RGBA pixels)
mat4 getBoneMatrix(int boneIndex) {
    int pixelIndex = boneIndex * 4;
    int y = pixelIndex / int(uBoneTextureWidth);
    int x = pixelIndex - y * int(uBoneTextureWidth);
    
    vec4 r0 = texelFetch(uBoneTexture, ivec2(x, y), 0);
    vec4 r1 = texelFetch(uBoneTexture, ivec2(x + 1, y), 0);
    vec4 r2 = texelFetch(uBoneTexture, ivec2(x + 2, y), 0);
    vec4 r3 = texelFetch(uBoneTexture, ivec2(x + 3, y), 0);
    
    return mat4(r0, r1, r2, r3);
}

void main(void) {
    vec4 position = vec4(aVertexPosition, 1.0);
    vec4 normal = vec4(aNormal, 0.0); // Normals are vectors, w=0

    int count = 1;
    mat4 boneMatrix = getBoneMatrix(int(aGroup[0]));
    vec4 sum = boneMatrix * position;
    vec4 sumNormal = boneMatrix * normal;

    // Sentinel value check (65535 means "no bone")
    if (aGroup[1] < 65535.) {
        mat4 boneMatrix1 = getBoneMatrix(int(aGroup[1]));
        sum += boneMatrix1 * position;
        sumNormal += boneMatrix1 * normal;
        count += 1;
    }
    if (aGroup[2] < 65535.) {
        mat4 boneMatrix2 = getBoneMatrix(int(aGroup[2]));
        sum += boneMatrix2 * position;
        sumNormal += boneMatrix2 * normal;
        count += 1;
    }
    if (aGroup[3] < 65535.) {
        mat4 boneMatrix3 = getBoneMatrix(int(aGroup[3]));
        sum += boneMatrix3 * position;
        sumNormal += boneMatrix3 * normal;
        count += 1;
    }
    
    float invCount = 1.0 / float(count);
    sum.xyz *= invCount;
    sum.w = 1.0; // Enforce w=1 for position
    
    // Normal average & normalize
    sumNormal *= invCount;
    // sumNormal.w = 0.0; // Enforce w=0 for direction (implicit)

    position = sum;

    vec4 viewPos = uMVMatrix * position;
    gl_Position = uPMatrix * viewPos;
    vPosition = viewPos.xyz;
    vTextureCoord = aTextureCoord;
    
    // Transform normal to View Space
    // Use upper 3x3 of MV Matrix for rotation
    vNormal = mat3(uMVMatrix) * sumNormal.xyz;
}