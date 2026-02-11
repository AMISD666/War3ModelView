#version 300 es
precision highp float;

in vec3 aVertexPosition;
in vec3 aNormal;
in vec2 aTextureCoord;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;

out vec3 vNormal;
out vec2 vTextureCoord;
out vec3 vPosition;

void main(void) {
    vec4 position = vec4(aVertexPosition, 1.0);
    vec4 viewPos = uMVMatrix * position;
    gl_Position = uPMatrix * viewPos;
    vPosition = viewPos.xyz;
    vTextureCoord = aTextureCoord;
    // NOTE: If this shader is used, ensure vNormal is handled correctly for View Space
    // Current: vNormal = aNormal; (Might be World Space if CPU skinning didn't rotate normal?)
    // Leaving as is for now to minimize side effects on existing behavior.
    vNormal = aNormal;
}