import { assets } from "./assets/AssetClient";
import { settings } from "./settings";

type Bus = "music" | "sfx" | "voice" | "ambience";
export type MusicState = "calm" | "tense" | "combat";

/**
 * Plain Web Audio: buses with volume from settings, crossfading music, looping ambience beds and
 * positional (HRTF) emitters. decodeAudioData runs off the main thread in all target browsers.
 */
class AudioSystem {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private music: { id: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private beds = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  musicTracks: Partial<Record<MusicState, string>> = {};
  musicState: MusicState | null = null;

  /** Must be called from a user gesture (first click/keypress). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const b of ["music", "sfx", "voice", "ambience"] as Bus[]) {
        this.buses[b] = this.ctx.createGain();
        this.buses[b].connect(this.master);
      }
      this.applyVolumes();
      settings.on(() => this.applyVolumes());
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const s = settings.value;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(s.voice, t, 0.05);
  }

  load(id: string): Promise<AudioBuffer> {
    let p = this.buffers.get(id);
    if (!p) {
      p = assets.get(id).then((buf) => {
        if (!this.ctx) throw new Error("audio not unlocked");
        return this.ctx.decodeAudioData(buf);
      });
      p.catch(() => this.buffers.delete(id));
      this.buffers.set(id, p);
    }
    return p;
  }

  isLoaded(id: string) {
    return this.buffers.has(id);
  }

  async playMusic(id: string, { fade = 3, volume = 1, loop = true } = {}) {
    if (!this.ctx || this.music?.id === id) return;
    const buf = await this.load(id);
    const t = this.ctx.currentTime;
    this.stopMusic(fade);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + fade);
    src.connect(gain).connect(this.buses.music);
    src.start();
    this.music = { id, src, gain };
  }

  stopMusic(fade = 2) {
    if (!this.ctx || !this.music) return;
    const { src, gain } = this.music;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fade);
    src.stop(t + fade + 0.05);
    this.music = null;
  }

  /** Switch between calm / tense / combat tracks registered in musicTracks. */
  setMusicState(state: MusicState) {
    if (this.musicState === state) return;
    this.musicState = state;
    const id = this.musicTracks[state];
    if (id) void this.playMusic(id, { fade: state === "combat" ? 1 : 4 });
  }

  async startBed(key: string, id: string, volume = 1, fade = 2, bus: Bus = "ambience") {
    if (!this.ctx || this.beds.has(key)) return;
    const buf = await this.load(id);
    if (this.beds.has(key)) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + fade);
    src.connect(gain).connect(this.buses[bus]);
    src.start(0, Math.random() * buf.duration);
    this.beds.set(key, { src, gain });
  }

  setBedVolume(key: string, volume: number, time = 0.5) {
    const b = this.beds.get(key);
    if (b && this.ctx) b.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, time / 3);
  }

  setBedRate(key: string, rate: number) {
    const b = this.beds.get(key);
    if (b && this.ctx) b.src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.2);
  }

  stopBed(key: string, fade = 1.5) {
    const b = this.beds.get(key);
    if (!b || !this.ctx) return;
    const t = this.ctx.currentTime;
    b.gain.gain.cancelScheduledValues(t);
    b.gain.gain.setValueAtTime(b.gain.gain.value, t);
    b.gain.gain.linearRampToValueAtTime(0, t + fade);
    b.src.stop(t + fade + 0.05);
    this.beds.delete(key);
  }

  stopAllBeds(fade = 1.5) {
    for (const k of [...this.beds.keys()]) this.stopBed(k, fade);
  }

  /** A positional emitter whose position is updated by the caller each frame. */
  emitter(bus: Bus = "sfx") {
    if (!this.ctx) return null;
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2;
    panner.maxDistance = 200;
    panner.rolloffFactor = 1;
    panner.connect(this.buses[bus]);
    return panner;
  }

  /** Plays a looping buffer through a panner (e.g. hooves, wheels). */
  async loopAt(id: string, panner: PannerNode, volume = 1) {
    if (!this.ctx) return null;
    const buf = await this.load(id);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(panner);
    src.start(0, Math.random() * buf.duration);
    return { src, gain: g };
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
    const l = this.ctx?.listener;
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(px, t);
      l.positionY.setValueAtTime(py, t);
      l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Short synthesized UI tick (no asset needed). */
  uiTick(kind: "move" | "select" = "move") {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = kind === "select" ? 1800 : 1200;
    o.type = "triangle";
    o.frequency.setValueAtTime(kind === "select" ? 220 : 330, t);
    o.frequency.exponentialRampToValueAtTime(kind === "select" ? 110 : 280, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === "select" ? 0.25 : 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "select" ? 0.5 : 0.15));
    o.connect(f).connect(g).connect(this.buses.sfx);
    o.start(t);
    o.stop(t + 0.6);
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }
}

export const audio = new AudioSystem();
