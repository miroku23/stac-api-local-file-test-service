// Flow trail shaders. Render curved wind/current segments from particle state.
export const lineVS = `#version 300 es
precision highp float; precision highp sampler2D; uniform sampler2D u_stateA,u_stateB,u_wind; uniform vec2 u_stateTexSize,u_viewport,u_translate,u_windSize,u_speedRange; uniform vec4 u_rotate,u_grid,u_gridFlags; uniform int u_projMode; uniform float u_headPass,u_zoomScale,u_pxOffset; out float v_alpha; out float v_edge; out float v_along; const float PI=3.14159265359; const float TAU=6.28318530718; const int CURVE_STEPS=5;
vec2 pxToClip(vec2 px){return vec2(px.x/u_viewport.x*2.-1.,1.-px.y/u_viewport.y*2.);} 
vec2 rotateLL(vec2 ll){float lambda=radians(ll.x+u_rotate.x), phi=radians(ll.y), deltaPhi=radians(u_rotate.y), deltaGamma=radians(u_rotate.z); float cosPhi=cos(phi), x=cos(lambda)*cosPhi, y=sin(lambda)*cosPhi, z=sin(phi); float cd=cos(deltaPhi), sd=sin(deltaPhi), cg=cos(deltaGamma), sg=sin(deltaGamma); float k=z*cd+x*sd; return vec2(atan(y*cg-k*sg,x*cd-z*sd),asin(clamp(k*cg+y*sg,-1.,1.)));}
float frontCosc(vec2 ll){vec2 r=rotateLL(ll); return cos(r.y)*cos(r.x);} 
float angDeg(vec2 a,vec2 b){vec2 ar=radians(a),br=radians(b); float c=sin(ar.y)*sin(br.y)+cos(ar.y)*cos(br.y)*cos(ar.x-br.x); return degrees(acos(clamp(c,-1.,1.)));}
float wrap180(float x){
  x = mod(x + 180.0, 360.0);
  if(x < 0.0) x += 360.0;
  return x - 180.0;
}
vec2 project(vec2 ll,out bool ok){vec2 r=rotateLL(ll); float lambda=r.x; float phi=r.y; if(u_projMode==0){float cp=cos(phi), cl=cos(lambda), sl=sin(lambda); float cosc=cp*cl; if(cosc<=0.){ok=false; return vec2(2.);} float x=cp*sl; float y=sin(phi); vec2 px=vec2(u_translate.x+x*u_rotate.w,u_translate.y-y*u_rotate.w); ok=true; return pxToClip(px);} lambda=mod(lambda+PI,TAU)-PI; 
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
vec3 sampleWind(vec2 lonLat){float lon=lonLat.x; float latLimit=(u_projMode==1)?85.05113:89.9999; float lat=clamp(lonLat.y,max(u_grid.z,-latLimit),min(u_grid.w,latLimit)); float nx=max(1.,u_windSize.x); float ny=max(1.,u_windSize.y); float x; if(u_gridFlags.z>.5){float base=u_grid.x; float dx=mod((lon-base)+360.,360.); x=dx/360.*nx;}else{float n=(lon-u_grid.x)/max(1e-6,u_grid.y-u_grid.x); x=clamp(n,0.,1.)*(nx-1.);} float y=(lat-u_grid.z)/max(1e-6,u_grid.w-u_grid.z)*(ny-1.); if(u_gridFlags.x>.5)y=(ny-1.)-y; y=clamp(y,0.,ny-1.); int x0=int(floor(x)); int y0=int(floor(y)); float tx=fract(x); float ty=fract(y); int x1=x0+1; int y1=min(y0+1,int(ny)-1); if(u_gridFlags.z>.5){int nxi=int(nx); x0=int(mod(float(x0+nxi),float(nxi))); x1=int(mod(float(x1+nxi),float(nxi)));}else{x0=clamp(x0,0,int(nx)-1); x1=clamp(x1,0,int(nx)-1);} vec4 c00=texelFetch(u_wind,ivec2(x0,y0),0); vec4 c10=texelFetch(u_wind,ivec2(x1,y0),0); vec4 c01=texelFetch(u_wind,ivec2(x0,y1),0); vec4 c11=texelFetch(u_wind,ivec2(x1,y1),0); float a00=(1.-tx)*(1.-ty)*step(.5,c00.a); float a10=tx*(1.-ty)*step(.5,c10.a); float a01=(1.-tx)*ty*step(.5,c01.a); float a11=tx*ty*step(.5,c11.a); float aw=a00+a10+a01+a11; if(aw<=.001) return vec3(0.,0.,0.); vec2 w=(c00.xy*a00+c10.xy*a10+c01.xy*a01+c11.xy*a11)/aw; return vec3(clamp(w,vec2(-140.),vec2(140.)),1.);}
vec2 advanceSphere(vec2 ll,vec2 wind,float dtSec){float lon=radians(ll.x), lat=radians(ll.y); float sl=sin(lon),cl=cos(lon),sp=sin(lat),cp=cos(lat); vec3 p=vec3(cp*cl,cp*sl,sp); vec3 east=vec3(-sl,cl,0.); vec3 north=vec3(-sp*cl,-sp*sl,cp); vec3 q=normalize(p+((wind.x*east+wind.y*north)/6371000.0)*dtSec); return vec2(degrees(atan(q.y,q.x)),degrees(asin(clamp(q.z,-1.,1.))));}
vec2 traceBack(vec2 ll,int count,float seconds){vec2 p=ll; for(int i=0;i<CURVE_STEPS;i++){if(i>=count)break; vec3 sw=sampleWind(p); if(sw.z<.5)return vec2(9999.); p=advanceSphere(p,-sw.xy,seconds); p.x=wrap180(p.x);} return p;}
void main(){int quad=gl_VertexID/6; int pid=quad/CURVE_STEPS; int segId=quad-pid*CURVE_STEPS; int vid=gl_VertexID-quad*6; float along=(vid==1||vid==4||vid==5)?1.:0.; float side=(vid==2||vid==3||vid==5)?1.:-1.; ivec2 st=ivec2(pid%int(u_stateTexSize.x),pid/int(u_stateTexSize.x)); vec4 a=texelFetch(u_stateA,st,0); vec4 b=texelFetch(u_stateB,st,0); float spd=length(b.zw); float speedNorm=smoothstep(u_speedRange.x,u_speedRange.y,spd); float ss=pow(speedNorm,.82); float currentStyle=1.-step(5.,u_speedRange.y); float zoomBoost=smoothstep(1.05,8.,u_zoomScale); float lengthBoost=mix(1.00,1.90,pow(speedNorm,.70)); float stepSeconds=mix(160.,380.,ss)*lengthBoost*mix(1.,1.28,zoomBoost)*mix(1.,1.35,u_headPass)*mix(1.,6.,currentStyle); int back0=CURVE_STEPS-segId; int back1=back0-1; vec2 p0=traceBack(a.xy,back0,stepSeconds); vec2 p1=traceBack(a.xy,back1,stepSeconds); bool ok0,ok1; vec2 c0=project(p0,ok0); vec2 c1=project(p1,ok1);
float rawDLon = abs(p1.x - p0.x);
float dLon = min(rawDLon, 360.0 - rawDLon);
float dLat = abs(p1.y - p0.y);
float seg = angDeg(p1, p0);

vec2 screenDelta = c1 - c0;
float clipLen = length(screenDelta);

bool mercator = u_projMode == 1;
bool ortho = u_projMode == 0;
bool nearPole = max(abs(p1.y), abs(p0.y)) > (mercator ? 80.0 : 70.0);

float maxClipLen = mercator ? 0.018 : (ortho ? 0.20 : 0.035);
float maxScreenJump = nearPole
  ? (mercator ? 0.025 : (ortho ? 0.32 : 0.07))
  : maxClipLen;

float maxLatJump = mercator
  ? (nearPole ? 2.2 : 3.0)
  : (nearPole ? 18.0 : 6.0);

float maxSegDeg = mercator
  ? (nearPole ? 4.5 : 6.0)
  : (nearPole ? 28.0 : 10.0);

bool seamJump = rawDLon > 180.0 || dLon > (mercator ? 5.0 : 8.0);

bool invalid =
  (!ok0) || (!ok1) ||
  abs(p0.x) > 900.0 || abs(p1.x) > 900.0 ||
  !(seg == seg) ||
  seamJump ||
  dLat > maxLatJump ||
  seg > maxSegDeg ||
  clipLen > maxScreenJump;

if(mercator){
  invalid = invalid ||
    abs(p0.y) > 84.5 ||
    abs(p1.y) > 84.5;
}

if(ortho){
  invalid = invalid ||
    frontCosc(p1) <= -0.01 ||
    frontCosc(p0) <= -0.01;
}
if(invalid){gl_Position=vec4(2,2,1,1); v_alpha=0.; v_edge=1.; v_along=0.; return;} vec2 d=c1-c0; vec2 dpx=d*vec2(u_viewport.x*.5,u_viewport.y*.5); float lenPx=length(dpx); float minPx=mix((u_projMode==0)?2.3:1.8,(u_projMode==0)?8.8:7.0,pow(speedNorm,.82))*mix(1.,1.45,zoomBoost)*mix(1.,1.25,u_headPass)*mix(1.,.58,currentStyle); float scale=(lenPx>1e-5)?max(1.,minPx/lenPx):1.; vec2 end=c0+d*scale; vec2 clip=mix(c0,end,along); vec2 dir=(lenPx>1e-5)?(dpx/lenPx):vec2(1.,0.); float halfWidth=u_pxOffset*mix(.70,1.34,pow(speedNorm,.75))*mix(1.,1.50,zoomBoost)*mix(1.,.46,currentStyle); vec2 npx=vec2(-dir.y,dir.x)*side*halfWidth; vec2 noff=vec2(npx.x/u_viewport.x*2.,npx.y/u_viewport.y*2.); gl_Position=vec4(clip+noff,0,1); float life=(2400.+fract(sin(a.w*43758.5453)*143758.5453)*4600.)*mix(1.25,.82,pow(speedNorm,.80)); float grow=smoothstep(0.,900.,a.z); float die=1.-smoothstep(life*.82,life,a.z); float phase=fract(a.z*.00036+a.w*11.37); float pulse=.76+.24*smoothstep(.04,.28,phase)*(1.-smoothstep(.78,.99,phase)); float head=mix(1.,pulse,u_headPass); float speedAlpha=pow(speedNorm,1.04); v_edge=side; v_along=(float(segId)+along)/float(CURVE_STEPS); v_alpha=mix(.09,1.18,speedAlpha)*grow*die*head*mix(.92,1.10,zoomBoost);}`;

export const lineFS = `#version 300 es
precision highp float; uniform float u_alpha; uniform float u_headPass; in float v_alpha; in float v_edge; in float v_along; out vec4 outColor; void main(){float edge=1.-smoothstep(.72,1.,abs(v_edge)); edge=mix(.36,1.,edge); float tail=mix(1.,smoothstep(.00,.22,v_along),u_headPass); float nose=mix(1.,1.-smoothstep(.94,1.,v_along),u_headPass); outColor=vec4(.74,.76,.76,u_alpha*v_alpha*edge*tail*nose);}`;
