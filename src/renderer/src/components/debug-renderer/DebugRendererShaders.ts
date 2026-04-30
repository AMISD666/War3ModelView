export const lineVertexShaderSource = `
  attribute vec3 aPosition;
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  uniform float uPointSize;
  uniform float uDepthBias;
  void main() {
    gl_Position = uPMatrix * uMVMatrix * vec4(aPosition, 1.0);
    if (uDepthBias != 0.0) {
        gl_Position.z -= uDepthBias * gl_Position.w;
    }
    gl_PointSize = uPointSize;
  }
`

export const lineFragmentShaderSource = `
  precision mediump float;
  uniform vec4 uColor;
  void main() {
    gl_FragColor = uColor;
  }
`

export const litVertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uMVMatrix;
  uniform mat4 uPMatrix;
  uniform mat3 uNormalMatrix;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec4 worldPos = uMVMatrix * vec4(aPosition, 1.0);
    gl_Position = uPMatrix * worldPos;
    vNormal = uNormalMatrix * aNormal;
    vPosition = worldPos.xyz;
  }
`

export const litFragmentShaderSource = `
  precision mediump float;
  uniform vec4 uColor;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(vec3(-0.2, 0.5, 1.0));
    float lighting = 0.4 + 0.6 * max(dot(normal, lightDir), 0.0);
    vec3 finalColor = uColor.rgb * lighting;
    gl_FragColor = vec4(finalColor, uColor.a);
  }
`
