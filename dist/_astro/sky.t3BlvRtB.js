import{G as C,n as P,f as b,o as R,B as _,r as w,g as G,Q as I,T as B,p as E,i as F}from"./OrbitControls.C-pumBRA.js";const g=900,m=[{weight:.76,colour:[1,.72,.52],size:.55},{weight:.12,colour:[1,.86,.68],size:.75},{weight:.076,colour:[1,.97,.9],size:.95},{weight:.03,colour:[.86,.92,1],size:1.3},{weight:.014,colour:[.68,.79,1],size:1.9}];function $(t){let e=t();for(const u of m)if(e-=u.weight,e<=0)return u;return m[0]}function k(t){let e=t>>>0;return()=>(e=e*1664525+1013904223>>>0,e/4294967296)}const j=`
  attribute float size;
  attribute vec3 tint;
  varying vec3 vTint;
  void main() {
    vTint = tint;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = size;
  }
`,q=`
  varying vec3 vTint;
  void main() {
    vec2 offset = gl_PointCoord - vec2(0.5);
    float d = length(offset) * 2.0;
    if (d > 1.0) discard;
    float halo = pow(1.0 - d, 2.2);
    float core = pow(max(0.0, 1.0 - d * 2.6), 3.0);
    vec3 colour = mix(vTint, vec3(1.0), core * 0.8);
    gl_FragColor = vec4(pow(colour, vec3(2.2)), halo * 0.85 + core);
  }
`;function x(t,e,u){const i=new Float32Array(e*3),o=new Float32Array(e*3),r=new Float32Array(e);for(let n=0;n<e;n+=1){const c=t()*2-1,l=t()*Math.PI*2,p=u>0?Math.sign(c)*Math.pow(Math.abs(c),u):c,d=Math.sqrt(Math.max(0,1-p*p));i[n*3]=Math.cos(l)*d*g,i[n*3+1]=p*g,i[n*3+2]=Math.sin(l)*d*g;const h=$(t),M=.9+t()*.2;o[n*3]=Math.min(1,h.colour[0]*M),o[n*3+1]=Math.min(1,h.colour[1]*M),o[n*3+2]=Math.min(1,h.colour[2]*M),r[n]=h.size*(.6+t()*t()*2.4)}const a=new _;a.setAttribute("position",new w(i,3)),a.setAttribute("tint",new w(o,3)),a.setAttribute("size",new w(r,1));const s=new G({vertexShader:j,fragmentShader:q,transparent:!0,depthWrite:!1,blending:b}),f=new I(a,s);return f.frustumCulled=!1,f}function O(t,e){const i=document.createElement("canvas");i.width=256,i.height=256;const o=i.getContext("2d");if(!o)return new B;const r=256/2;o.fillStyle="rgba(0,0,0,0)",o.fillRect(0,0,256,256),o.globalCompositeOperation="lighter";const a=l=>`rgba(${Math.round(e[0]*255)},${Math.round(e[1]*255)},${Math.round(e[2]*255)},${l})`,s=o.createRadialGradient(r,r,0,r,r,r);s.addColorStop(0,a(.5)),s.addColorStop(.18,a(.16)),s.addColorStop(.55,a(.04)),s.addColorStop(1,"rgba(0,0,0,0)"),o.fillStyle=s,o.fillRect(0,0,256,256);const f=2,n=2.6+t()*1.4;for(let l=0;l<f;l+=1){const p=l/f*Math.PI*2+t()*.4;for(let d=0;d<1400;d+=1){const h=d/1400,M=.08+h*.44,y=.012+h*.055,v=p+n*Math.log(M/.06)+(t()-.5)*1.1*(.3+h),S=M+(t()-.5)*y*2,A=r+Math.cos(v)*S*256,T=r+Math.sin(v)*S*256,z=(1-h)*.5+.06;o.fillStyle=t()<.12?`rgba(180,210,255,${z*.8})`:a(z*.35),o.beginPath(),o.arc(A,T,.4+t()*1.5,0,Math.PI*2),o.fill()}}const c=new E(i);return c.colorSpace=F,c}function W(){const t=k(24301),e=new C,u=x(t,5200,0),i=x(t,4200,3.2);i.rotation.set(.5,.2,.9),e.add(u,i);const o=[[.86,.88,1],[1,.9,.78],[.78,.86,1],[1,.84,.86],[.84,.94,.96]],r=[],a=[];for(let s=0;s<7;s+=1){const f=O(t,o[s%o.length]);a.push(f);const n=new P({map:f,transparent:!0,depthWrite:!1,blending:b,opacity:.28+t()*.32,rotation:t()*Math.PI*2}),c=new R(n),l=t()*2-1,p=t()*Math.PI*2,d=Math.sqrt(Math.max(0,1-l*l));c.position.set(Math.cos(p)*d*g,l*g,Math.sin(p)*d*g);const h=g*(.05+t()*.11);c.scale.set(h,h,1),c.material.depthTest=!1,r.push(c),e.add(c)}return e.renderOrder=-1,{group:e,dispose:()=>{for(const s of[u,i])s.geometry.dispose(),s.material.dispose();for(const s of r)s.material.dispose();for(const s of a)s.dispose()}}}export{W as c};
