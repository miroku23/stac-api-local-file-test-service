// Trail compositing shaders for fading and copying the offscreen trail buffer.
export const fadeFS = `#version 300 es
precision highp float; uniform float u_retain; out vec4 outColor; void main(){outColor=vec4(0,0,0,u_retain);}`;

export const copyFS = `#version 300 es
precision highp float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 outColor; void main(){vec4 c=texture(u_tex,v_uv); outColor=vec4(c.rgb,c.a);}`;
