import { clamp, lerp } from '../utils/format.js';

const PALETTES = {
  'water-paper': { bg:'#f7f7f2', water:'#b9d7db', water2:'#dcebed', ink:'#596c67', plant:'#748b79', sand:'#d8ccb7', glass:'rgba(255,255,255,.52)' },
  'moss-glass': { bg:'#f1f4f2', water:'#aac5c2', water2:'#d8e4de', ink:'#41524d', plant:'#667d6d', sand:'#c8bdab', glass:'rgba(240,247,244,.5)' },
  'sand-fiber': { bg:'#faf8f1', water:'#c8dcdd', water2:'#e5eeee', ink:'#6c645a', plant:'#879080', sand:'#cbb99d', glass:'rgba(255,252,244,.58)' },
  'moon-water': { bg:'#17211f', water:'#6d9193', water2:'#29403f', ink:'#dbe7e2', plant:'#8ca596', sand:'#9c927f', glass:'rgba(218,235,230,.10)' }
};

export class VisualEngine {
  constructor(canvas, audioEngine, bus) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: true }); this.audio = audioEngine; this.bus = bus;
    this.mode = 'waterline'; this.paletteName = 'water-paper'; this.palette = PALETTES[this.paletteName];
    this.intensity = 1; this.particleDensity = 0.55; this.reducedMotion = false; this.plantsEnabled = true;
    this.width = 1; this.height = 1; this.dpr = 1; this.running = false; this.raf = 0; this.last = performance.now();
    this.frameSamples = []; this.fps = 60; this.quality = 1; this.autoQuality = true; this.particles = []; this.trails = [];
    this.waveHistory = []; this.livingMode = 'waterline'; this.livingLastChange = 0;
    if ('ResizeObserver' in window) { this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas); }
    else { this.resizeObserver = null; window.addEventListener('resize', () => this.resize(), { passive: true }); }
    this.resize(); this.seedParticles();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(); this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0); this.seedParticles();
  }
  setMode(mode) { this.mode = mode; this.waveHistory.length = 0; }
  setPalette(name) { this.paletteName = PALETTES[name] ? name : 'water-paper'; this.palette = PALETTES[this.paletteName]; document.documentElement.dataset.palette = this.paletteName; }
  setIntensity(value) { this.intensity = clamp(Number(value), .3, 2); }
  setParticleDensity(value) { this.particleDensity = clamp(Number(value), 0, 1); this.seedParticles(); }
  setReducedMotion(value) { this.reducedMotion = Boolean(value); }
  setPlantsEnabled(value) { this.plantsEnabled = Boolean(value); }
  seedParticles() {
    const base = Math.round((100 + Math.min(this.width * this.height / 3500, 500)) * this.particleDensity * this.quality);
    while (this.particles.length < base) this.particles.push(this.makeParticle());
    this.particles.length = base;
  }
  makeParticle() { return { x:Math.random()*this.width,y:Math.random()*this.height,vx:(Math.random()-.5)*.25,vy:(Math.random()-.5)*.18,r:.7+Math.random()*3,life:Math.random(),phase:Math.random()*Math.PI*2 }; }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); this.loop(this.last); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
  loop = now => {
    if (!this.running) return;
    const dt = Math.min(40, now - this.last); this.last = now;
    const metrics = this.audio.sample(); this.measurePerformance(dt); this.draw(now/1000, dt/1000, metrics);
    this.bus.emit('visual-metrics', { ...metrics, fps:this.fps, quality:this.quality });
    this.raf = requestAnimationFrame(this.loop);
  };
  measurePerformance(dt) {
    this.frameSamples.push(dt); if (this.frameSamples.length > 90) this.frameSamples.shift();
    if (this.frameSamples.length % 30 === 0) {
      const avg = this.frameSamples.reduce((a,b)=>a+b,0)/this.frameSamples.length; this.fps = Math.round(1000/avg);
      if (this.autoQuality) {
        if (this.fps < 42 && this.quality > .45) { this.quality = Math.max(.45, this.quality-.12); this.seedParticles(); }
        else if (this.fps > 57 && this.quality < 1) { this.quality = Math.min(1, this.quality+.04); this.seedParticles(); }
      }
    }
  }
  draw(time, dt, metrics) {
    const ctx = this.ctx, p = this.palette, energy = clamp(metrics.smoothRms * 5.5 * this.intensity, 0, 1.4);
    ctx.clearRect(0,0,this.width,this.height);
    this.drawBackground(ctx, time, energy, p);
    let mode = this.mode;
    if (mode === 'living-canvas') mode = this.selectLivingMode(time, metrics);
    if (mode === 'waterline') this.drawWaterline(ctx,time,metrics,p);
    else if (mode === 'circular-garden') this.drawCircularGarden(ctx,time,metrics,p);
    else if (mode === 'paper-wave') this.drawPaperWave(ctx,time,metrics,p);
    else if (mode === 'glass-orbit') this.drawGlassOrbit(ctx,time,metrics,p);
    else if (mode === 'ink-bloom') this.drawInkBloom(ctx,time,dt,metrics,p);
    else if (mode === 'particle-pond') this.drawParticlePond(ctx,time,dt,metrics,p);
    else if (mode === 'minimal-scope') this.drawMinimalScope(ctx,time,metrics,p);
    this.drawAmbientParticles(ctx,time,dt,metrics,p, mode);
    if (this.plantsEnabled && mode !== 'circular-garden') this.drawPlants(ctx,time,metrics,p,.38);
  }
  drawBackground(ctx,time,energy,p) {
    const gradient = ctx.createRadialGradient(this.width*.5,this.height*.42,20,this.width*.5,this.height*.5,Math.max(this.width,this.height)*.75);
    gradient.addColorStop(0, p.water2); gradient.addColorStop(.48,p.bg); gradient.addColorStop(1,p.bg);
    ctx.globalAlpha = .32 + energy*.08; ctx.fillStyle = gradient; ctx.fillRect(0,0,this.width,this.height); ctx.globalAlpha=1;
    if (!this.reducedMotion) {
      ctx.save(); ctx.globalAlpha=.05+energy*.035; ctx.strokeStyle=p.water; ctx.lineWidth=1;
      for(let i=0;i<5;i++){ const y=this.height*(.18+i*.17); ctx.beginPath(); for(let x=0;x<=this.width;x+=18){ const yy=y+Math.sin(x*.008+time*(.25+i*.04))*12*(i+1)/5; x?ctx.lineTo(x,yy):ctx.moveTo(x,yy);} ctx.stroke(); } ctx.restore();
    }
  }
  selectLivingMode(time,metrics) {
    if (time - this.livingLastChange > 5) {
      const rms=metrics.smoothRms, high=metrics.bands?.Brilliance||0, bass=metrics.bands?.Bass||0;
      this.livingMode = rms<.015?'paper-wave':high>.28?'particle-pond':bass>.32?'waterline':rms>.16?'circular-garden':'glass-orbit'; this.livingLastChange=time;
    } return this.livingMode;
  }
  drawWaterline(ctx,time,m,p) {
    const wave=m.waveform, center=this.height*.53, amp=(35+m.smoothRms*280)*this.intensity;
    ctx.save(); const fill=ctx.createLinearGradient(0,center-amp,0,this.height); fill.addColorStop(0,'rgba(191,216,220,.55)'); fill.addColorStop(1,'rgba(143,175,180,.08)');
    ctx.beginPath(); ctx.moveTo(0,this.height); for(let x=0;x<=this.width;x+=4){ const idx=wave?Math.floor(x/this.width*wave.length):0; const sample=wave?((wave[idx]-128)/128):Math.sin(x*.01+time)*.02; const y=center-sample*amp-Math.sin(x*.006+time*.7)*6; ctx.lineTo(x,y);} ctx.lineTo(this.width,this.height); ctx.closePath(); ctx.fillStyle=fill;ctx.fill();
    ctx.beginPath(); for(let x=0;x<=this.width;x+=3){ const idx=wave?Math.floor(x/this.width*wave.length):0; const sample=wave?((wave[idx]-128)/128):0; const y=center-sample*amp-Math.sin(x*.006+time*.7)*6; x?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.strokeStyle=p.ink;ctx.globalAlpha=.72;ctx.lineWidth=1.4;ctx.stroke(); ctx.restore();
    this.drawRipples(ctx,time,m,p,center);
  }
  drawRipples(ctx,time,m,p,center) {
    const count=Math.floor((m.peak||0)*8*this.intensity); ctx.save(); ctx.strokeStyle=p.water; ctx.lineWidth=1;
    for(let i=0;i<count;i++){ const phase=(time*.45+i/count)%1; const radius=20+phase*Math.min(this.width,this.height)*.22; ctx.globalAlpha=(1-phase)*.18; ctx.beginPath(); ctx.ellipse(this.width*.5,center,radius,radius*.22,0,0,Math.PI*2);ctx.stroke(); } ctx.restore();
  }
  drawCircularGarden(ctx,time,m,p) {
    const freq=m.frequency, cx=this.width/2, cy=this.height/2, base=Math.min(this.width,this.height)*.15, bins=Math.floor(96*this.quality);
    ctx.save(); ctx.translate(cx,cy);
    for(let i=0;i<bins;i++){ const angle=i/bins*Math.PI*2-Math.PI/2; const idx=freq?Math.floor(i/bins*freq.length*.72):0; const value=freq?freq[idx]/255:0; const length=8+value*Math.min(this.width,this.height)*.16*this.intensity; ctx.save(); ctx.rotate(angle); ctx.beginPath(); ctx.moveTo(base,0); ctx.quadraticCurveTo(base+length*.55, Math.sin(time*1.2+i)*4*value, base+length,0); ctx.strokeStyle=i%3===0?p.plant:p.water; ctx.globalAlpha=.32+value*.55; ctx.lineWidth=1+value*2; ctx.stroke(); if(value>.58){ctx.beginPath();ctx.ellipse(base+length,0,2+value*4,1.5+value*2,angle,0,Math.PI*2);ctx.fillStyle=p.sand;ctx.fill();} ctx.restore(); }
    const pulse=base*(1+(m.smoothRms||0)*1.8*this.intensity); const g=ctx.createRadialGradient(0,0,5,0,0,pulse);g.addColorStop(0,p.glass);g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,pulse,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=p.ink;ctx.globalAlpha=.28;ctx.beginPath();ctx.arc(0,0,base,0,Math.PI*2);ctx.stroke();ctx.restore();
    if(this.plantsEnabled)this.drawPlants(ctx,time,m,p,.9);
  }
  drawPaperWave(ctx,time,m,p) {
    const wave=m.waveform; if(!wave)return; const bands=7, gap=this.height/(bands+1); ctx.save();
    for(let b=0;b<bands;b++){ const y=gap*(b+1);ctx.beginPath();for(let x=0;x<=this.width;x+=8){const idx=Math.floor(((x/this.width)+(b*.071))%1*wave.length);const sample=(wave[idx]-128)/128;const yy=y+sample*(18+b*3)*this.intensity+Math.sin(x*.012+time*.3+b)*5; x?ctx.lineTo(x,yy):ctx.moveTo(x,yy);}ctx.lineTo(this.width,y+18);ctx.lineTo(0,y+18);ctx.closePath();ctx.fillStyle=b%2?`${p.sand}44`:`${p.water}36`;ctx.fill();ctx.strokeStyle=p.ink;ctx.globalAlpha=.16+b*.025;ctx.stroke();}
    ctx.restore();
  }
  drawGlassOrbit(ctx,time,m,p) {
    const cx=this.width/2,cy=this.height/2,count=Math.floor(9+this.quality*8);ctx.save();
    for(let i=0;i<count;i++){const band=Object.values(m.bands||{})[i%7]||0;const a=time*(.05+i*.002)+i/count*Math.PI*2;const orbit=70+i*Math.min(this.width,this.height)*.018;const x=cx+Math.cos(a)*orbit*(1+band*.35);const y=cy+Math.sin(a)*orbit*.55;const r=14+band*55*this.intensity+i*.7;const grad=ctx.createRadialGradient(x-r*.3,y-r*.35,2,x,y,r);grad.addColorStop(0,'rgba(255,255,255,.38)');grad.addColorStop(1,p.glass);ctx.fillStyle=grad;ctx.globalAlpha=.38+band*.35;ctx.beginPath();ctx.ellipse(x,y,r,r*.72,a,0,Math.PI*2);ctx.fill();ctx.strokeStyle=p.water;ctx.globalAlpha=.16+band*.4;ctx.stroke();}
    ctx.restore();
  }
  drawInkBloom(ctx,time,dt,m,p) {
    if((m.peak||0)>.28 && Math.random()<.13*this.intensity){this.trails.push({x:this.width*(.2+Math.random()*.6),y:this.height*(.25+Math.random()*.5),r:4,life:1,vx:(Math.random()-.5)*10,vy:(Math.random()-.5)*8});}
    ctx.save(); for(const t of this.trails){t.life-=dt*(this.reducedMotion?.12:.045);t.r+=dt*(16+(m.smoothRms||0)*80);t.x+=t.vx*dt;t.y+=t.vy*dt;ctx.globalAlpha=Math.max(0,t.life)*.08;ctx.fillStyle=Math.random()>.5?p.plant:p.water;ctx.beginPath();ctx.arc(t.x,t.y,t.r,0,Math.PI*2);ctx.fill();}
    this.trails=this.trails.filter(t=>t.life>0).slice(-120);ctx.restore();
  }
  drawParticlePond(ctx,time,dt,m,p) { this.updateParticles(ctx,time,dt,m,p,2.2); }
  drawMinimalScope(ctx,time,m,p) {
    const wave=m.waveform,freq=m.frequency;ctx.save();ctx.strokeStyle=p.ink;ctx.globalAlpha=.78;ctx.lineWidth=1.2;ctx.beginPath();for(let x=0;x<=this.width;x+=2){const i=wave?Math.floor(x/this.width*wave.length):0;const y=this.height*.35+(wave?((wave[i]-128)/128):0)*this.height*.18;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
    const bars=64,gap=4,bw=(this.width-gap*(bars-1))/bars;for(let i=0;i<bars;i++){const idx=freq?Math.floor(i/bars*freq.length):0;const v=freq?freq[idx]/255:0;ctx.fillStyle=i<12?p.plant:p.water;ctx.globalAlpha=.2+v*.65;ctx.fillRect(i*(bw+gap),this.height*.82-v*this.height*.30,bw,v*this.height*.30);}ctx.restore();
  }
  drawAmbientParticles(ctx,time,dt,m,p,mode) { if(mode==='particle-pond')return; this.updateParticles(ctx,time,dt,m,p,.45); }
  updateParticles(ctx,time,dt,m,p,multiplier) {
    const energy=(m.smoothRms||0)*18*this.intensity;const bass=m.bands?.Bass||0,high=m.bands?.Brilliance||0;ctx.save();
    for(const q of this.particles){q.phase+=dt*(.4+high*4);q.vx+=(Math.sin(q.phase+time*.2)*.02+(q.x-this.width/2)*bass*.000004)*multiplier;q.vy-=high*.006*multiplier;q.vx*=.994;q.vy*=.996;q.x+=q.vx*(1+energy)*60*dt;q.y+=q.vy*(1+energy)*60*dt;if(q.x<-10)q.x=this.width+10;if(q.x>this.width+10)q.x=-10;if(q.y<-10)q.y=this.height+10;if(q.y>this.height+10)q.y=-10;ctx.globalAlpha=.08+high*.24;ctx.fillStyle=Math.random()>.72?p.sand:p.water;ctx.beginPath();ctx.arc(q.x,q.y,q.r*(1+high),0,Math.PI*2);ctx.fill();}ctx.restore();
  }
  drawPlants(ctx,time,m,p,alpha=1) {
    const mid=m.bands?.Mid||0,baseY=this.height;ctx.save();ctx.strokeStyle=p.plant;ctx.lineWidth=1.1;ctx.globalAlpha=.16*alpha;
    const count=Math.floor(9+this.width/130);for(let i=0;i<count;i++){const x=(i+.4)*this.width/count;const h=45+(i%5)*17+mid*85*this.intensity;const sway=Math.sin(time*.6+i*.8)*8*(.4+mid*2);ctx.beginPath();ctx.moveTo(x,baseY);ctx.quadraticCurveTo(x+sway*.4,baseY-h*.55,x+sway,baseY-h);ctx.stroke();for(let j=1;j<4;j++){const t=j/4;const px=lerp(x,x+sway,t);const py=baseY-h*t;ctx.beginPath();ctx.ellipse(px+(j%2?5:-5),py,7+mid*4,2.5+mid*2,j%2?.5:-.5,0,Math.PI*2);ctx.fillStyle=p.plant;ctx.globalAlpha=.07*alpha;ctx.fill();ctx.globalAlpha=.16*alpha;}}ctx.restore();
  }
}
