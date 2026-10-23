const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../video-preview.js'), 'utf8');
function setup(connection = {}) {
  const frames = [], timers = new Map(), observers = [];
  class Element {
    constructor() { this.handlers = {}; this.classList = {add(){},remove(){},contains(){return false;}}; }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    emit(name) { for (const fn of this.handlers[name] || []) fn(); }
    before() {} append() {} setAttribute() {} removeAttribute() {}
  }
  class Video extends Element {
    constructor(index) { super(); this.index=index; this.preload='none'; this.readyState=0; this.networkState=0; this.duration=10; this.currentTime=0; this.paused=true; this.loads=0; this.poster='poster.jpg'; this.end=0; const self=this; this.buffered={get length(){return self.end?1:0;},start(){return 0;},end(){return self.end;}}; }
    load() { this.loads++; this.networkState=1; this.end=0; this.readyState=0; this.emit('emptied'); }
    getBoundingClientRect() { return {top: this.index*200, bottom:this.index*200+150}; }
    ready(end=3) { this.readyState=3;this.end=end;this.emit('progress'); }
    play() { this.paused=false;this.emit('play'); }
  }
  const videos=Array.from({length:6},(_,i)=>new Video(i));
  const document=new Element();document.hidden=false;document.querySelectorAll=()=>videos;document.createElement=()=>new Element();
  const context={document,navigator:{connection},window:{innerHeight:700},HTMLMediaElement:{NETWORK_EMPTY:0},IntersectionObserver:class {constructor(cb){this.cb=cb;observers.push(this);}observe(){}},requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>{const id=Symbol();timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),console};
  context.window.IntersectionObserver = context.IntersectionObserver;
  vm.runInNewContext(source,context);
  const flush=()=>{while(frames.length)frames.shift()();};
  const enter=items=>{observers[0].cb(items.map(target=>({target,isIntersecting:true})));flush();};
  const leave=items=>{observers[0].cb(items.map(target=>({target,isIntersecting:false})));flush();};
  return {videos,document,flush,enter,leave,timers};
}
{
 const t=setup();t.enter(t.videos);assert.equal(t.videos.filter(v=>v.preload==='auto').length,2);
 t.videos[0].ready();t.flush();assert.equal(t.videos[0].preload,'none');assert.equal(t.videos[0].end,3);assert.equal(t.videos.filter(v=>v.preload==='auto').length,2);
 const chosen=t.videos[2];chosen.emit('pointerdown');const loads=chosen.loads;chosen.play();t.flush();assert.equal(chosen.loads,loads,'playing must not reload buffered media');assert.equal(chosen.preload,'auto');assert.equal(t.videos.filter(v=>v.preload==='auto').length,1,'background work must yield to playback');
 chosen.currentTime=5;chosen.emit('keydown');assert.equal(chosen.currentTime,5);assert.equal(chosen.loads,loads,'seeking must preserve media');
 chosen.paused=true;chosen.emit('pause');t.flush();assert.equal(t.videos.filter(v=>v.preload==='auto').length,2,'resume bounded warmups after pausing');
 console.log('PASS: concurrent preload limit, initial buffer preservation, playback priority, seeking and pause/resume');
}
{
 const t=setup();t.enter(t.videos.slice(0,2));const loads=t.videos[0].loads;t.leave([t.videos[0]]);assert.equal(t.videos[0].preload,'none');assert.equal(t.videos[0].loads,loads+1,'offscreen transfer must abort');
 t.document.hidden=true;t.document.emit('visibilitychange');assert.ok(t.videos.every(v=>v.preload==='none'));console.log('PASS: offscreen and hidden-tab cancellation');
}
for(const connection of [{saveData:true},{effectiveType:'2g'},{effectiveType:'slow-2g'}]) {const t=setup(connection);t.enter(t.videos);assert.ok(t.videos.every(v=>v.loads===0));t.videos[0].emit('pointerdown');assert.equal(t.videos[0].loads,1);}
console.log('PASS: data-saving connections skip speculative loading but allow explicit playback');
{
 const t=setup();t.enter(t.videos);const firstTimer=t.timers.values().next().value;firstTimer();t.flush();assert.equal(t.videos.filter(v=>v.preload==='auto').length,2);assert.equal(t.videos[0].preload,'none');console.log('PASS: stalled preload releases its slot');
}

{
 const t=setup();t.enter(t.videos);t.videos[0].play();t.flush();t.videos[0].paused=true;t.videos[0].emit('error');t.flush();assert.equal(t.videos.filter(v=>v.preload==='auto'&&v!==t.videos[0]).length,2);console.log('PASS: a failed playback does not block other preloads');
}
