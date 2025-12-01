import * as Tone from 'tone';

const DEFAULT_SYNTHS = {
    pad: {
        vol: -12,
        osc: "fatsawtooth",
        env: { attack: 2, decay: 3, sustain: 0.8, release: 5 }
    },
    keys: {
        vol: -10,
        osc: "triangle",
        env: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 1.5 }
    },
    bass: {
        vol: -8,
        osc: "square",
        env: { attack: 0.1, decay: 0.5, sustain: 0.4, release: 2 }
    },
    attractor: {
        vol: -60,
        osc0: "sine",
        osc1: "triangle",
        env: { attack: 0.1, decay: 0.1, sustain: 1, release: 1 },
        mappings: {
            x: { param: "frequency", min: 100, max: 800 },
            y: { param: "harmonicity", min: 0.5, max: 2.0 },
            z: { param: "vibratoRate", min: 1, max: 10 }
        }
    }
};

export class AudioEngine {
    constructor() {
        this.isReady = false;
        this.isPlaying = false;
        this.bpm = 60;
        this.currentPatternName = "Ethereal";
        this.synthConfig = JSON.parse(JSON.stringify(DEFAULT_SYNTHS));
        
        // Realtime instances
        this.realtimeInstruments = null;
        this.realtimeLoops = [];
        
        // Parameters (stored to apply to both contexts)
        this.params = {
            vol: { pad: -12, keys: -10, bass: -8, master: -10 },
            fx: { reverb: 0.5, delay: 0.3 }
        };

        // --- Patterns (Chord Progressions) ---
        this.patterns = {
            "Ethereal": {
                chords: [
                    ["C3", "G3", "B3", "E4"], // CMaj7
                    ["A2", "E3", "G3", "C4"], // Am7
                    ["F2", "C3", "E3", "A3"], // FMaj7
                    ["G2", "D3", "F3", "B3"]  // G7
                ],
                bass: ["C2", "A1", "F1", "G1"]
            },
            "Dark Space": {
                chords: [
                    ["C3", "Eb3", "G3", "Bb3"], // Cm7
                    ["Ab2", "Eb3", "G3", "C4"], // AbMaj7
                    ["F2", "C3", "Eb3", "Ab3"], // Fm7
                    ["G2", "D3", "F3", "B3"]    // G7
                ],
                bass: ["C2", "Ab1", "F1", "G1"]
            },
            "Mystery": {
                chords: [
                    ["D3", "F3", "A3", "C4"], // Dm7
                    ["Bb2", "F3", "A3", "D4"], // BbMaj7
                    ["G2", "D3", "F3", "Bb3"], // Gm7
                    ["A2", "E3", "G3", "C4"]   // Am7
                ],
                bass: ["D2", "Bb1", "G1", "A1"]
            },
            "Drone": {
                chords: [
                    ["C3", "G3", "C4"],
                    ["C3", "G3", "D4"],
                    ["C3", "F3", "C4"],
                    ["C3", "G3", "B3"]
                ],
                bass: ["C2", "C2", "C2", "C2"]
            }
        };
    }

    async loadPatterns() {
        try {
            const res = await fetch('/api/audio');
            if (res.ok) {
                const cloudPatterns = await res.json();
                if (Object.keys(cloudPatterns).length > 0) {
                    this.patterns = cloudPatterns;
                    console.log("Loaded patterns from cloud:", Object.keys(this.patterns));
                    return Object.keys(this.patterns);
                }
            }
        } catch (e) {
            console.warn("Failed to load cloud patterns, using defaults", e);
        }
        return Object.keys(this.patterns);
    }

    async init() {
        await Tone.start();
        Tone.Transport.bpm.value = this.bpm;
        
        // Setup Realtime Graph
        this.realtimeInstruments = this.createGraph(Tone.Destination);
        this.isReady = true;
        console.log("Audio Engine Initialized");
    }

    createGraph(destination) {
        const cfg = this.synthConfig;

        // --- Master Effects ---
        const limiter = new Tone.Limiter(-1).connect(destination);
        
        const reverb = new Tone.Reverb({
            decay: 10,
            wet: this.params.fx.reverb,
            preDelay: 0.2
        }).connect(limiter);

        const delay = new Tone.PingPongDelay({
            delayTime: "8n.",
            feedback: 0.4,
            wet: this.params.fx.delay
        }).connect(reverb);

        // --- Instruments ---
        
        // 1. Pad (Atmosphere)
        const pad = new Tone.PolySynth(Tone.FMSynth, {
            harmonicity: 0.5,
            modulationIndex: 1.2,
            oscillator: { type: cfg.pad.osc },
            envelope: cfg.pad.env,
            modulation: { type: "sine" },
            modulationEnvelope: { attack: 1, decay: 3, sustain: 0.8, release: 5 }
        }).connect(reverb);
        pad.volume.value = cfg.pad.vol;

        // 2. Keys (Melody/Arp)
        const keys = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: cfg.keys.osc },
            envelope: cfg.keys.env
        }).connect(delay);
        keys.volume.value = cfg.keys.vol;

        // 3. Bass (Grounding)
        const bass = new Tone.MonoSynth({
            oscillator: { type: cfg.bass.osc },
            filter: { Q: 2, type: "lowpass", rolloff: -24 },
            envelope: cfg.bass.env,
            filterEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 2, baseFrequency: 50, octaves: 2 }
        }).connect(limiter);
        bass.volume.value = cfg.bass.vol;

        // 4. Attractor Synth (Shadow Simulation)
        const attractorSynth = new Tone.DuoSynth({
            vibratoAmount: 0.5,
            vibratoRate: 5,
            harmonicity: 1.5,
            voice0: {
                volume: -10,
                portamento: 0,
                oscillator: { type: cfg.attractor.osc0 },
                filterEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 },
                envelope: cfg.attractor.env
            },
            voice1: {
                volume: -10,
                portamento: 0,
                oscillator: { type: cfg.attractor.osc1 },
                filterEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 },
                envelope: cfg.attractor.env
            }
        }).connect(reverb);
        attractorSynth.volume.value = -60; // Start silent, user enables it

        return { pad, keys, bass, attractorSynth, reverb, delay, limiter };
    }

    updateAttractorState(x, y, z) {
        if (!this.realtimeInstruments || !this.realtimeInstruments.attractorSynth) return;
        
        const synth = this.realtimeInstruments.attractorSynth;
        const mappings = this.synthConfig.attractor.mappings;
        
        // Safety check
        if (isNaN(x) || isNaN(y) || isNaN(z)) return;

        ['x', 'y', 'z'].forEach(axis => {
            const map = mappings[axis];
            const val = (axis === 'x') ? x : (axis === 'y') ? y : z;
            const absVal = Math.abs(val);
            
            // Map 0..20 to min..max (approximate range of attractors)
            const norm = Math.min(1, absVal / 20); 
            const target = map.min + (map.max - map.min) * norm;
            
            if (map.param === 'frequency') {
                const safeFreq = Math.max(20, Math.min(20000, target));
                synth.frequency.rampTo(safeFreq, 0.1);
            }
            if (map.param === 'harmonicity') synth.harmonicity.rampTo(target, 0.1);
            if (map.param === 'vibratoRate') synth.vibratoRate.rampTo(target, 0.1);
            if (map.param === 'vibratoAmount') synth.vibratoAmount.rampTo(target, 0.1);
            if (map.param === 'volume') synth.volume.rampTo(target, 0.1);
        });
    }

    scheduleEvents(instruments, transport, trajectoryData) {
        const pattern = this.patterns[this.currentPatternName];
        const chords = pattern.chords;
        const bassNotes = pattern.bass;
        
        // 1. Chord Loop (Pad) - Slow changes
        const chordLoop = new Tone.Loop(time => {
            const pos = transport.position.toString().split(":");
            const i = Math.floor(parseFloat(pos[0])) % chords.length;
            const chord = chords[i];
            
            instruments.pad.triggerAttackRelease(chord, "1m", time);
            
            if(bassNotes && bassNotes[i]) {
                instruments.bass.triggerAttackRelease(bassNotes[i], "1m", time);
            }

        }, "1m").start(0);

        // 2. Arpeggio Loop (Keys)
        const arpLoop = new Tone.Loop(time => {
            const pos = transport.position.toString().split(":");
            const i = Math.floor(parseFloat(pos[0])) % chords.length;
            const chord = chords[i];
            
            if (Math.random() > 0.3) {
                const note = chord[Math.floor(Math.random() * chord.length)];
                const highNote = Tone.Frequency(note).transpose(12);
                instruments.keys.triggerAttackRelease(highNote, "16n", time);
            }
        }, "8n").start(0);

        // 3. Attractor Automation (Offline Only)
        if (trajectoryData && instruments.attractorSynth) {
            const synth = instruments.attractorSynth;
            const mappings = this.synthConfig.attractor.mappings;
            
            synth.triggerAttack(200, 0);
            
            trajectoryData.forEach(point => {
                const t = point.time;
                
                ['x', 'y', 'z'].forEach(axis => {
                    const map = mappings[axis];
                    const val = (axis === 'x') ? point.x : (axis === 'y') ? point.y : point.z;
                    const absVal = Math.abs(val);
                    const norm = Math.min(1, absVal / 20); 
                    const target = map.min + (map.max - map.min) * norm;
                    
                    if (map.param === 'frequency') synth.frequency.setValueAtTime(Math.max(20, target), t);
                    if (map.param === 'harmonicity') synth.harmonicity.setValueAtTime(target, t);
                    if (map.param === 'vibratoRate') synth.vibratoRate.setValueAtTime(target, t);
                    if (map.param === 'vibratoAmount') synth.vibratoAmount.setValueAtTime(target, t);
                    if (map.param === 'volume') synth.volume.setValueAtTime(target, t);
                });
            });
        }

        return [chordLoop, arpLoop];
    }

    start() {
        if (!this.isReady) return;
        
        Tone.Transport.stop();
        Tone.Transport.cancel();
        
        // Dispose old loops
        this.realtimeLoops.forEach(l => l.dispose());
        
        // Trigger Attractor Synth for Realtime
        if (this.realtimeInstruments.attractorSynth) {
            this.realtimeInstruments.attractorSynth.triggerRelease(); // Reset
            this.realtimeInstruments.attractorSynth.triggerAttack(200);
        }

        this.realtimeLoops = this.scheduleEvents(this.realtimeInstruments, Tone.Transport);
        Tone.Transport.start();
        this.isPlaying = true;
    }

    stop() {
        Tone.Transport.stop();
        if (this.realtimeInstruments && this.realtimeInstruments.attractorSynth) {
            this.realtimeInstruments.attractorSynth.triggerRelease();
        }
        this.isPlaying = false;
    }

    setPattern(name) {
        if (this.patterns[name]) {
            this.currentPatternName = name;
            
            // Update Config
            if (this.patterns[name].synths) {
                this.synthConfig = this.patterns[name].synths;
            } else {
                this.synthConfig = JSON.parse(JSON.stringify(DEFAULT_SYNTHS));
            }
            
            // Apply to running instruments
            if (this.realtimeInstruments) {
                this.updateSynthParams(this.realtimeInstruments);
            }

            if (this.isPlaying) {
                this.start(); // Restart to apply pattern
            }
        }
    }
    
    updateSynthParams(instruments) {
        const cfg = this.synthConfig;
        
        // Pad
        instruments.pad.set({
            oscillator: { type: cfg.pad.osc },
            envelope: cfg.pad.env
        });
        instruments.pad.volume.rampTo(cfg.pad.vol, 0.1);
        
        // Keys
        instruments.keys.set({
            oscillator: { type: cfg.keys.osc },
            envelope: cfg.keys.env
        });
        instruments.keys.volume.rampTo(cfg.keys.vol, 0.1);
        
        // Bass
        instruments.bass.set({
            oscillator: { type: cfg.bass.osc },
            envelope: cfg.bass.env
        });
        instruments.bass.volume.rampTo(cfg.bass.vol, 0.1);
        
        // Attractor
        instruments.attractorSynth.voice0.set({ oscillator: { type: cfg.attractor.osc0 }, envelope: cfg.attractor.env });
        instruments.attractorSynth.voice1.set({ oscillator: { type: cfg.attractor.osc1 }, envelope: cfg.attractor.env });
    }

    setVolume(instrument, db) {
        this.params.vol[instrument] = db;
        if (this.realtimeInstruments && this.realtimeInstruments[instrument]) {
            this.realtimeInstruments[instrument].volume.rampTo(db, 0.1);
        }
    }

    setParam(param, value) {
        switch(param) {
            case 'bpm':
                this.bpm = value;
                Tone.Transport.bpm.rampTo(value, 1);
                break;
            case 'reverb':
                this.params.fx.reverb = value;
                if (this.realtimeInstruments) this.realtimeInstruments.reverb.wet.rampTo(value, 0.5);
                break;
            case 'delay':
                this.params.fx.delay = value;
                if (this.realtimeInstruments) this.realtimeInstruments.delay.wet.rampTo(value, 0.5);
                break;
        }
    }

    setMasterVolume(db) {
        this.params.vol.master = db;
        Tone.Destination.volume.rampTo(db, 0.1);
    }
    
    async renderOffline(duration, trajectoryData) {
        // Tone.Offline returns a Promise<AudioBuffer>
        const buffer = await Tone.Offline(({ transport, destination }) => {
             // We need to set BPM on this transport
             transport.bpm.value = this.bpm;
             
             const instruments = this.createGraph(destination);
             
             // Set volumes
             instruments.pad.volume.value = this.params.vol.pad;
             instruments.keys.volume.value = this.params.vol.keys;
             instruments.bass.volume.value = this.params.vol.bass;
             // Attractor synth volume needs to be set if we want it audible
             // We'll assume the user set it in UI, so we use the stored param if we had one
             // But we didn't store attractor volume in params.vol yet.
             // Let's add it to params.vol default or just read from realtime if available?
             // Better to use a stored value.
             instruments.attractorSynth.volume.value = this.params.vol.attractor || -60;

             this.scheduleEvents(instruments, transport, trajectoryData);
             
             transport.start();
        }, duration);
        
        return buffer;
    }
}

export function bufferToWave(abuffer, len) {
  var numOfChan = abuffer.numberOfChannels,
      length = len * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [], i, sample,
      offset = 0,
      pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded in this example)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while(pos < len) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true);  // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return buffer;

  function setUint16(data) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}
