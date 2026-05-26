// Particle simulation shader. Advances lon/lat state textures on the GPU.
export const simFS = `#version 300 es
precision highp float; precision highp sampler2D; in vec2 v_uv; layout(location=0) out vec4 outA; layout(location=1) out vec4 outB;
uniform sampler2D u_stateA,u_stateB,u_wind; uniform vec2 u_windSize,u_speedRange; uniform vec4 u_grid; uniform vec4 u_gridFlags; uniform vec4 u_rotate; uniform vec4 u_viewBounds; uniform float u_dt,u_time,u_respawn,u_speedScale; uniform int u_projMode;
float hash11(float p){vec3 p3=fract(vec3(p)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z);} vec2 hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy);} 
float wrapLon180(float lon){lon=mod(lon+180.,360.); if(lon<0.) lon+=360.; return lon-180.;}
float lonDeltaAbs(float a, float b){
  float d = abs(a - b);
  return min(d, 360.0 - d);
}

bool mercatorBadStep(vec2 a, vec2 b){
  if(u_projMode != 1) return false;

  float rawDLon = abs(a.x - b.x);
  float dLon = lonDeltaAbs(a.x, b.x);
  float dLat = abs(a.y - b.y);

  if(rawDLon > 180.0) return true;
  if(dLon > 5.0) return true;
  if(dLat > 3.5) return true;
  if(abs(a.y) > 84.5 || abs(b.y) > 84.5) return true;

  return false;
}

vec2 rotateLL(vec2 ll){float lambda=radians(ll.x+u_rotate.x), phi=radians(ll.y), deltaPhi=radians(u_rotate.y), deltaGamma=radians(u_rotate.z); float cosPhi=cos(phi), x=cos(lambda)*cosPhi, y=sin(lambda)*cosPhi, z=sin(phi); float cd=cos(deltaPhi), sd=sin(deltaPhi), cg=cos(deltaGamma), sg=sin(deltaGamma); float k=z*cd+x*sd; return vec2(atan(y*cg-k*sg,x*cd-z*sd),asin(clamp(k*cg+y*sg,-1.,1.)));}
float frontCosc(vec2 ll){vec2 r=rotateLL(ll); return cos(r.y)*cos(r.x);} bool isFront(vec2 ll){return frontCosc(ll)>0.001;}
float spawnLat(float r){return degrees(asin(r*2.-1.));}
bool inViewBounds(vec2 ll){
  float lon = ll.x;
  float lonMin = u_viewBounds.x;
  float lonMax = u_viewBounds.y;
  if(lonMax > 180.0 && lon < lonMin) lon += 360.0;
  bool inLon = lon >= lonMin - 1.0 && lon <= lonMax + 1.0;
  bool inLat = ll.y >= u_viewBounds.z - 1.0 && ll.y <= u_viewBounds.w + 1.0;
  return inLon && inLat;
}
vec2 spawn(vec2 uv,float seed,bool visibleOnly){
  vec2 r=hash21(uv+vec2(seed,seed*1.37));

  float lon;
  float lat;

  if(u_projMode==0 && !visibleOnly){
    lon = r.x * 360.0 - 180.0;
    lat = degrees(asin(r.y * 2.0 - 1.0));
  } else {
   lon = r.x * 360.0 - 180.0;
lat = degrees(asin(r.y * 2.0 - 1.0));

    if(u_projMode==0){
      lat = clamp(lat, -89.9999, 89.9999);
    }

    if(u_projMode==1){
      lat = clamp(lat, -85.05113, 85.05113);
    }
  }

  vec2 ll=vec2(lon,lat);

if(visibleOnly && u_projMode==0){
    for(int i=0;i<32;i++){
      if(isFront(ll)) break;

      r=hash21(r+vec2(float(i)*.173+seed,.619));
      lon = mix(u_viewBounds.x,u_viewBounds.y,r.x);
      lat = clamp(mix(u_viewBounds.z,u_viewBounds.w,r.y), -89.9999, 89.9999);
      ll=vec2(lon,lat);
    }
  }

  return ll;
}
vec3 sampleWind(vec2 lonLat){float lon=lonLat.x;
float latLimit = (u_projMode == 1) ? 85.05113 : 89.9999;
float lat = clamp(lonLat.y, max(u_grid.z, -latLimit), min(u_grid.w, latLimit));
float nx=max(1.,u_windSize.x); float ny=max(1.,u_windSize.y); float x; if(u_gridFlags.z>.5){float base=u_grid.x; float dx=mod((lon-base)+360.,360.); x=dx/360.*nx;}else{float n=(lon-u_grid.x)/max(1e-6,u_grid.y-u_grid.x); x=clamp(n,0.,1.)*(nx-1.);} float y=(lat-u_grid.z)/max(1e-6,u_grid.w-u_grid.z)*(ny-1.); if(u_gridFlags.x>.5) y=(ny-1.)-y; y=clamp(y,0.,ny-1.); int x0=int(floor(x)); int y0=int(floor(y)); float tx=fract(x); float ty=fract(y); int x1=x0+1; int y1=min(y0+1,int(ny)-1); if(u_gridFlags.z>.5){int nxi=int(nx); x0=int(mod(float(x0+nxi),float(nxi))); x1=int(mod(float(x1+nxi),float(nxi)));}else{x0=clamp(x0,0,int(nx)-1); x1=clamp(x1,0,int(nx)-1);} vec4 c00=texelFetch(u_wind,ivec2(x0,y0),0); vec4 c10=texelFetch(u_wind,ivec2(x1,y0),0); vec4 c01=texelFetch(u_wind,ivec2(x0,y1),0); vec4 c11=texelFetch(u_wind,ivec2(x1,y1),0); float a00=(1.-tx)*(1.-ty)*step(.5,c00.a); float a10=tx*(1.-ty)*step(.5,c10.a); float a01=(1.-tx)*ty*step(.5,c01.a); float a11=tx*ty*step(.5,c11.a); float aw=a00+a10+a01+a11; if(aw<=.001) return vec3(0.,0.,0.); vec2 w=(c00.xy*a00+c10.xy*a10+c01.xy*a01+c11.xy*a11)/aw; return vec3(clamp(w,vec2(-140.),vec2(140.)),1.);}
vec2 advanceSphere(vec2 ll,vec2 wind,float dtSec){float lon=radians(ll.x), lat=radians(ll.y); float sl=sin(lon),cl=cos(lon),sp=sin(lat),cp=cos(lat); vec3 p=vec3(cp*cl,cp*sl,sp); vec3 east=vec3(-sl,cl,0.); vec3 north=vec3(-sp*cl,-sp*sl,cp); vec3 q=normalize(p+((wind.x*east+wind.y*north)/6371000.0)*dtSec); return vec2(degrees(atan(q.y,q.x)),degrees(asin(clamp(q.z,-1.,1.))));}
void main(){vec4 a=texture(u_stateA,v_uv); vec4 b=texture(u_stateB,v_uv); vec2 pos=a.xy; float age=a.z; float seed=a.w; vec2 vel=b.zw; bool ortho=(u_projMode==0); bool bad=!(pos.x==pos.x)||!(pos.y==pos.y)||abs(pos.x)>1e8||abs(pos.y)>1e8; age+=u_dt*1000.; float prevSpeed=length(vel); float lifeSpeed=pow(smoothstep(u_speedRange.x,u_speedRange.y,prevSpeed),.85); float life=(1800.+hash11(seed+5.7)*3200.)*mix(1.35,.78,lifeSpeed); bool drop=bad||age>life||(hash11(seed+u_time*.017)<u_respawn); if(ortho&&!isFront(pos)) drop=true; if(drop){vec2 np=spawn(v_uv,seed+u_time*.013,true); outA=vec4(np,0.,fract(seed+.073)); outB=vec4(np,0.,0.); return;} float frameFactor=clamp(u_dt*60.,.85,1.15); float modelSeconds=400.*frameFactor*u_speedScale; vec3 sw0=sampleWind(pos); if(sw0.z<.5){vec2 np=spawn(v_uv,seed+u_time*.023,true); outA=vec4(np,0.,fract(seed+.317)); outB=vec4(np,0.,0.); return;} vec2 w0=sw0.xy; vec2 mid=advanceSphere(pos,w0,modelSeconds*.5); vec3 sw1=sampleWind(mid); if(sw1.z<.5){vec2 np=spawn(v_uv,seed+u_time*.029,true); outA=vec4(np,0.,fract(seed+.419)); outB=vec4(np,0.,0.); return;} vec2 w1=sw1.xy; if(length(vel)<.01) vel=w0; vel=mix(vel,w1,.35); 
vec2 next = advanceSphere(pos, vel, modelSeconds);
next.x = wrapLon180(next.x);

float latLimit = (u_projMode == 1) ? 85.05113 : 89.9999;
next.y = clamp(next.y, -latLimit, latLimit);

if(mercatorBadStep(pos, next)){
  vec2 np = spawn(v_uv, seed + u_time * .041, true);
  outA = vec4(np, 0., fract(seed + .563));
  outB = vec4(np, 0., 0.);
  return;
}

if(ortho && !isFront(next)){
  vec2 np = spawn(v_uv, seed + u_time * .019, true);
  outA = vec4(np, 0., fract(seed + .191));
  outB = vec4(np, 0., 0.);
  return;
}
seed = fract(seed + hash11(u_time + seed));
outA = vec4(next, age, seed);
outB = vec4(pos, vel);}`;
