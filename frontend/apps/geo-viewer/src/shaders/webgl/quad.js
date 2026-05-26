// Shared fullscreen quad vertex shader.
export const quadVS = `#version 300 es
precision highp float; out vec2 v_uv; const vec2 P[4]=vec2[4](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(1,1)); void main(){vec2 p=P[gl_VertexID]; v_uv=p*.5+.5; gl_Position=vec4(p,0,1);}`;
