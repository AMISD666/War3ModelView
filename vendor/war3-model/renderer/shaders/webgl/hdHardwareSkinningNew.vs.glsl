#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 aVertexPosition;
in vec3 aNormal;
in vec2 aTextureCoord;
in vec4 aSkin;
in vec4 aBoneWeight;
in vec4 aTangent;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;

// Bone matrices stored in a floating point texture instead of uniform array
uniform sampler2D uBoneTexture;
uniform float uBoneTextureWidth;

out vec3 vNormal;
out vec3 vTangent;
out vec3 vBinormal;
out vec2 vTextureCoord;
out mat3 vTBN;
out vec3 vFragPos;

// Fetch a bone matrix from the texture
// Each mat4 requires 4 texels (4 vec4 = 16 floats = 4 RGBA pixels)
mat4 getBoneMatrix(int boneIndex) {
    float pixelIndex = float(boneIndex * 4);
    float y = floor(pixelIndex / uBoneTextureWidth);
    float x = mod(pixelIndex, uBoneTextureWidth);
    
    vec4 r0 = texelFetch(uBoneTexture, ivec2(int(x), int(y)), 0);
    vec4 r1 = texelFetch(uBoneTexture, ivec2(int(x) + 1, int(y)), 0);
    vec4 r2 = texelFetch(uBoneTexture, ivec2(int(x) + 2, int(y)), 0);
    vec4 r3 = texelFetch(uBoneTexture, ivec2(int(x) + 3, int(y)), 0);
    
    return mat4(r0, r1, r2, r3);
}

void main(void) {
    vec4 position = vec4(aVertexPosition, 1.0);
    mat4 sum;

    sum += getBoneMatrix(int(aSkin[0])) * aBoneWeight[0];
    sum += getBoneMatrix(int(aSkin[1])) * aBoneWeight[1];
    sum += getBoneMatrix(int(aSkin[2])) * aBoneWeight[2];
    sum += getBoneMatrix(int(aSkin[3])) * aBoneWeight[3];

    mat3 rotation = mat3(sum);

    position = sum * position;
    position.w = 1.;

    gl_Position = uPMatrix * uMVMatrix * position;
    vTextureCoord = aTextureCoord;

    vec3 normal = aNormal;
    vec3 tangent = aTangent.xyz;

    // https://learnopengl.com/Advanced-Lighting/Normal-Mapping
    tangent = normalize(tangent - dot(tangent, normal) * normal);

    vec3 binormal = cross(normal, tangent) * aTangent.w;

    normal = normalize(rotation * normal);
    tangent = normalize(rotation * tangent);
    binormal = normalize(rotation * binormal);

    vNormal = normal;
    vTangent = tangent;
    vBinormal = binormal;

    vTBN = mat3(tangent, binormal, normal);

    vFragPos = position.xyz;
}