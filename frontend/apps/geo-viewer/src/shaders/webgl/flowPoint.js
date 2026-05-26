// Optional point sprite shaders for particle heads.
export const pointVS = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D u_stateA,u_stateB; uniform vec2 u_stateTexSize,u_viewport,u_translate,u_speedRange; uniform vec4 u_rotate; uniform int u_projMode; uniform float u_size; out float v_alpha; const float PI=3.14159265359; const float TAU=6.28318530718;
vec2 pxToClip(vec2 px){return vec2(px.x/u_viewport.x*2.-1.,1.-px.y/u_viewport.y*2.);} vec2 rotateLL(vec2 ll){float lambda=radians(ll.x+u_rotate.x), phi=radians(ll.y), deltaPhi=radians(u_rotate.y), deltaGamma=radians(u_rotate.z); float cosPhi=cos(phi), x=cos(lambda)*cosPhi, y=sin(lambda)*cosPhi, z=sin(phi); float cd=cos(deltaPhi), sd=sin(deltaPhi), cg=cos(deltaGamma), sg=sin(deltaGamma); float k=z*cd+x*sd; return vec2(atan(y*cg-k*sg,x*cd-z*sd),asin(clamp(k*cg+y*sg,-1.,1.)));} vec2 project(vec2 ll,out bool ok){vec2 r=rotateLL(ll); float lambda=r.x; float phi=r.y; if(u_projMode==0){float cp=cos(phi),cl=cos(lambda),sl=sin(lambda); float cosc=cp*cl; if(cosc<=0.){ok=false; return vec2(2.);} float x=cp*sl; float y=sin(phi); ok=true; return pxToClip(vec2(u_translate.x+x*u_rotate.w,u_translate.y-y*u_rotate.w));} lambda=mod(lambda+PI,TAU)-PI; 
if(u_projMode==1){
  if(abs(phi) > 1.48442223){
    ok=false;
    return vec2(2.0);
  }

  float y=log(tan(.78539816339+phi*.5));
  ok=true;
  return pxToClip(vec2(
    u_translate.x + lambda * u_rotate.w,
    u_translate.y - y * u_rotate.w
  ));
}
if(u_projMode==3){float p2=phi*phi,p4=p2*p2,p6=p4*p2,p8=p4*p4,p10=p8*p2,p12=p10*p2; float x=lambda*(.8707-.131979*p2-.013791*p4+.003971*p10-.001529*p12); float y=phi*(1.007226+.015085*p2-.044475*p6+.028874*p8-.005916*p10); ok=true; return pxToClip(vec2(u_translate.x+x*u_rotate.w,u_translate.y-y*u_rotate.w));} ok=true; return pxToClip(vec2(u_translate.x+lambda*u_rotate.w,u_translate.y-phi*u_rotate.w));}
void main(){int pid=gl_VertexID; ivec2 st=ivec2(pid%int(u_stateTexSize.x),pid/int(u_stateTexSize.x)); vec4 a=texelFetch(u_stateA,st,0); vec4 b=texelFetch(u_stateB,st,0); bool ok; vec2 clip=project(a.xy,ok); if(!ok){gl_Position=vec4(2,2,1,1); gl_PointSize=0.; v_alpha=0.; return;} gl_Position=vec4(clip,0,1); gl_PointSize=u_size; float spd=length(b.zw); float ss=pow(smoothstep(u_speedRange.x,u_speedRange.y,spd),1.05); float life=1600.+fract(sin(a.w*43758.5453)*143758.5453)*2600.; float grow=smoothstep(0.,900.,a.z); float die=1.-smoothstep(life*.62,life,a.z); v_alpha=mix(.025,.76,ss)*grow*die;}`;

export const pointFS = `#version 300 es
precision highp float; uniform float u_alpha; in float v_alpha; out vec4 outColor; void main(){vec2 c=gl_PointCoord-vec2(.5); float m=smoothstep(.52,.06,length(c)); outColor=vec4(.86,.91,1.0,u_alpha*v_alpha*m);}`;
