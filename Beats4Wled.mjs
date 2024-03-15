import WledClient from './lib/WledClient.mjs';
import WledRealtimeClient from './lib/WledRealtimeClient.mjs';
import SpotifyBeatDetector from './lib/SpotifyBeatDetector.mjs'

const getModeString = mode => mode === 1 ? 'Major' : 'Minor';
const getKeyString = key => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][key];

export default class Beats4Wled {
    constructor({ spotify, wled, animation }) {
      this.config = {...arguments[0] };
      this.beatDetector = new SpotifyBeatDetector(spotify);
      if (wled.host) {
        this.wled = new WledClient(`ws://${wled.host}/ws`);
        this.wledRt = null;
      }
      this.color = [0,0,0];
      this.beatCount = 0;
      this.segments = null;
      this.beatColors = [
        [255, 255, 255], // White
        [255, 0, 0],     // Red
        [0, 255, 0],     // Green
        [0, 0, 255],     // Blue
        [0, 255, 255],   // Cyan
        [255, 255, 0],   // Yellow
        [255, 0, 255],   // Magenta
        [128, 128, 128], // Gray
        [255, 165, 0],   // Orange
        [128, 0, 128],   // Purple
        [0, 128, 128],   // Teal
        [255, 192, 203], // Pink
        [0, 0, 0],       // Black
        [128, 0, 0],     // Maroon
        [0, 128, 0],     // Green (dark)
        [0, 0, 128],     // Navy
        [128, 128, 0],   // Olive
        [128, 0, 128],   // Purple (dark)
        [0, 128, 128],   // Teal (dark)
        [192, 192, 192], // Silver
        [128, 128, 128], // Gray (dark)
        [255, 140, 0],   // Dark Orange
        [139, 0, 139],   // Dark Magenta
        [0, 128, 0],     // Green (medium)
        [0, 0, 128],     // Blue (medium)
        [46, 139, 87],   // Sea Green
        [218, 112, 214], // Orchid
        [210, 180, 140], // Tan
        [255, 0, 255],   // Magenta (bright)
        [255, 255, 224], // Light Yellow
        [128, 0, 0],     // Maroon (dark)
        [70, 130, 180]   // Steel Blue
      ];
      this.previousBeat = 0;
    }
    async init() {
      if (this.wled) {
        console.log('Connecting to WLED Controller...');
        await this.wled.connect();
        console.log(`Conencted to WLED Controller: http://${this.config.wled.host}/ws`);
        console.log("Getting segments...");
        this.segments = await this.wled.getSegments();
        console.log(`Got ${this.segments.length} segments!`);
        this.wledRt = new WledRealtimeClient(this.config.wled.host, this.segments[0].len);
      }
  
      console.log('Connecting to Spotify...');
      await this.beatDetector.init();
      console.log('Successfully connected to Spotify!');
  
      let volume = -60;

      this.beatDetector.on('track-changed', async ({ audioAnalysis, playbackState }) => {
        this.beatCount = 0;
        const tempo = Math.round(audioAnalysis.body.track.tempo);
        const key = `${getKeyString(audioAnalysis.body.track.key)} ${getModeString(audioAnalysis.body.track.mode)}`;
        const artist = playbackState.body.item.artists.map(a=>a.name).join(' &');
        const title = playbackState.body.item.name;
        const timeSig = audioAnalysis.body.track.time_signature;
        console.log(`#################################################`);
        console.log(`Detected Song: ${artist} - ${title}`);
        console.log(`Detected tempo: ${tempo} BPM`);
        console.log(`Detected time signature: ${timeSig}/4`);
        console.log(`Detected key signature: ${key}`);
        console.log(`#################################################`);
      });

      this.beatDetector.on('section', async ({ section }) => {
        //console.log('Section:', section);
      });

      this.beatDetector.on('segment', async ({ segment }) => {
        //console.log('segment:', segment);
        const previousSegmentMaxVol = this?.beatDetector?.audioAnalysis?.body?.segments[segment.index-1]?.loudness_max || -60;
        const currentSegmentMaxVol = segment.loudness_max || -60;
        const nextSegmentMaxVol = this?.beatDetector?.audioAnalysis?.body?.segments[segment.index+1]?.loudness_max || -60;
        volume = Math.max(previousSegmentMaxVol, currentSegmentMaxVol, nextSegmentMaxVol);
      });

      this.beatDetector.on('bar', async ({ bar, beat }) => {
        this.beatCount = 0;
        //console.log('Bar:', this.beatCount, bar);
      });

      this.flashType = 'beat';

      if (this.flashType === 'bar') {
        this.beatDetector.on('bar', async ({ bar, beat }) => {
          console.log('Bar:', bar);
          this.color = this.beatColors[0];
          await this.wledSync(true);
        });
      } else if (this.flashType === 'beat') {
        this.beatDetector.on('beat', async ({ beat }) => {
          const beatsPerBar = this.beatDetector.audioAnalysis.body.track.time_signature;
          if (beat.index < beatsPerBar) {
            this.beatCount = beat.index+1;
          } else {
            this.beatCount = (this.beatCount % beatsPerBar) + 1;
          }
          if (this.beatCount === 1) {
            console.log('- Beat:', `${this.beatCount}/${beatsPerBar} | Volume: ${volume}dB |`, beat);
          } else {
            console.log('. Beat:', `${this.beatCount}/${beatsPerBar} | Volume: ${volume}dB |`, beat);
          }
          // if (beatsPerBar % 2 === 0) { // Skip every second beat for even time sigs
          //   if (this.beatCount % 2 === 0) {
          //     this.color = [0,0,0];
          //   } else {
          //     this.color = this.beatColors[this.beatCount-1];
          //   }
          // } else {
            this.color = this.beatColors[this.beatCount-1];
          // }
          
          await this.wledSync(true);
          this.previousBeat = performance.now()
        });
      } else if (this.flashType === 'tatum') {
        this.beatDetector.on('tatum', async ({ tatum, bar, beat }) => {
          this.beatCount++
          console.log('Tatum:', tatum);
          this.color = this.beatColors[(this.beatCount-1) % 32];
          await this.wledSync(true);
        });
      } else if (this.flashType === 'segment') {
        this.beatDetector.on('segment', async ({ segment }) => {
          this.beatCount++
          console.log('segment:', segment);
          this.color = this.beatColors[(this.beatCount-1) % 32];
          await this.wledSync(true);
        });
      } else if (this.flashType === 'section') {
        this.beatDetector.on('section', async ({ section }) => {
          this.beatCount++
          console.log('section:', section);
          this.color = this.beatColors[(this.beatCount-1) % 32];
          await this.wledSync(true);
        });
      }
  
      this.fadeInterval = setInterval(this.fadeStep.bind(this), 1000 / this.config.wled.effectSpeed);
      if (this.wled) {
        this.wledSyncInterval = setInterval(this.wledSync.bind(this), 1000 / this.config.wled.fps);
      }
    }
  
    fadeStep() {
      const now = performance.now()
      const immunityTime = (1000 / this.config.animation.speed)
      if (now > this.previousBeat+immunityTime) {
        this.color = this.color.map(component => Math.max(0, component - 10));
      }
    }
  
    async wledSync(dontDrop=false) {
      for (const segment of this.segments) {
        const pixels = Array(segment.len).fill(this.color);
        if (this.config.wled.updateProtocol === "udp") {
          this.wledRt.setLeds(pixels);
          this.wledRt.update();
        } else if (this.config.wled.updateProtocol === "ws") {
          await this.wled.updateSegmentLeds(segment.id, pixels);
        }
        break;
      }
    }
};