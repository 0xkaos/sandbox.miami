import * as Tone from 'tone';

export class AudioEngine {
    constructor() {
        this.isReady = false;
        this.isPlaying = false;
        this.bpm = 60;
        this.currentPatternName = "Ethereal";
        
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

    async init() {
        await Tone.start();
        Tone.Transport.bpm.value = this.bpm;
        
        // Load Patterns from Cloud
        try {
            const res = await fetch('/api/audio');
            if (res.ok) {
                const cloudPatterns = await res.json();
                if (Object.keys(cloudPatterns).length > 0) {
                    this.patterns = cloudPatterns;
                    console.log("Loaded patterns from cloud:", Object.keys(this.patterns));
                }
            }
        } catch (e) {
            console.warn("Failed to load cloud patterns, using defaults", e);
        }
        
        // Setup Realtime Graph
        this.realtimeInstruments = this.createGraph(Tone.Destination);
        this.isReady = true;
        console.log("Audio Engine Initialized");
    }

    createGraph(destination) {
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
            oscillator: { type: "fatsawtooth" },
            envelope: { attack: 2, decay: 3, sustain: 0.8, release: 5 },
            modulation: { type: "sine" },
            modulationEnvelope: { attack: 1, decay: 3, sustain: 0.8, release: 5 }
        }).connect(reverb);
        pad.volume.value = this.params.vol.pad;

        // 2. Keys (Melody/Arp)
        const keys = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: "triangle" },
            envelope: { attack: 0.02, decay: 0.3, sustain: 0.1, release: 1.5 }
        }).connect(delay);
        keys.volume.value = this.params.vol.keys;

        // 3. Bass (Grounding)
        const bass = new Tone.MonoSynth({
            oscillator: { type: "square" },
            filter: { Q: 2, type: "lowpass", rolloff: -24 },
            envelope: { attack: 0.1, decay: 0.5, sustain: 0.4, release: 2 },
            filterEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 2, baseFrequency: 50, octaves: 2 }
        }).connect(limiter);
        bass.volume.value = this.params.vol.bass;

        // 4. Attractor Synth (Shadow Simulation)
        const attractorSynth = new Tone.DuoSynth({
            vibratoAmount: 0.5,
            vibratoRate: 5,
            harmonicity: 1.5,
            voice0: {
                volume: -10,
                portamento: 0,
                oscillator: { type: "sine" },
                filterEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 },
                envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 }
            },
            voice1: {
                volume: -10,
                portamento: 0,
                oscillator: { type: "triangle" },
                filterEnvelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 },
                envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.5 }
            }
        }).connect(reverb);
        attractorSynth.volume.value = -60; // Start silent, user enables it

        return { pad, keys, bass, attractorSynth, reverb, delay, limiter };
    }

    updateAttractorState(x, y, z) {
        if (!this.realtimeInstruments || !this.realtimeInstruments.attractorSynth) return;
        
        const synth = this.realtimeInstruments.attractorSynth;
        
        // Safety check
        if (isNaN(x) || isNaN(y) || isNaN(z)) return;

        // Map X to Frequency (Pitch)
        // Scale roughly -20 to 20 -> 100Hz to 800Hz
        const freq = 200 + (Math.abs(x) * 20);
        
        // Use frequency.rampTo instead of setNote for continuous updates
        // Clamp frequency to safe range
        const safeFreq = Math.max(20, Math.min(20000, freq));
        synth.frequency.rampTo(safeFreq, 0.1);
        
        // Map Y to Harmonicity
        const harm = 0.5 + (Math.abs(y) * 0.1);
        synth.harmonicity.rampTo(harm, 0.1);
        
        // Map Z to Vibrato Rate
        const vib = 1 + (Math.abs(z) * 0.5);
        synth.vibratoRate.rampTo(vib, 0.1);
    }

    scheduleEvents(instruments, transport, trajectoryData) {
        const pattern = this.patterns[this.currentPatternName];
        const chords = pattern.chords;
        const bassNotes = pattern.bass;
        
        // 1. Chord Loop (Pad) - Slow changes
        const chordLoop = new Tone.Loop(time => {
            // Get current measure index
            // Note: In Offline context, transport.position might be different format or we need to calculate from seconds
            // But Tone.Loop handles 'time' correctly relative to transport
            
            // We need a way to track measure index that works in both contexts
            // Tone.Transport.position is a string "BAR:BEAT:SIXTEENTH"
            // transport.position is what we should use
            
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
            // trajectoryData is array of { time, x, y, z }
            // We need to schedule automation
            const synth = instruments.attractorSynth;
            
            // Trigger attack at start
            synth.triggerAttack(200, 0);
            
            trajectoryData.forEach(point => {
                const t = point.time;
                const x = point.x;
                const y = point.y;
                const z = point.z;
                
                const freq = 200 + (Math.abs(x) * 20);
                const harm = 0.5 + (Math.abs(y) * 0.1);
                const vib = 1 + (Math.abs(z) * 0.5);
                
                synth.frequency.setValueAtTime(freq, t);
                synth.harmonicity.setValueAtTime(harm, t);
                synth.vibratoRate.setValueAtTime(vib, t);
            });
            
            // Release at end (handled by duration usually, but good to be safe)
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
            if (this.isPlaying) {
                this.start(); // Restart to apply pattern
            }
        }
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
