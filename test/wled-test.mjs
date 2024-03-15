const WLED_CONTROLLER_HOST = "192.168.x.x";

const oscillateMax = 128;
const oscillateEffect = (() => { let v = 0, d = 1; return () => (v = (v + d) % (oscillateMax*2)) > oscillateMax-1 ? (d = -1, v) : (v === 0 ? (d = 1, v) : v); })();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const fps = 60;

async function main() {
  const wled = new WledClient(`ws://${WLED_CONTROLLER_HOST}/ws`);
  await wled.connect();
  const segments = await wled.getSegments();
  console.log('Segments:', segments);
  const firstSegmentId = segments[0].id;

  while (true) {
    const value = oscillateEffect(); // oscillates between 0 and 255
    const color = [value,value,value];
    const leds = Array(segments[0].len).fill(color);
    const timeBeforeUpdate = performance.now();
    await wled.updateSegmentLeds(firstSegmentId, leds);
    const updateDuration = performance.now()-timeBeforeUpdate;
    console.log(`Setting color to ${color} took ${updateDuration.toFixed(3)}ms.`);
    await sleep(1000/fps);
  }
}

import WebSocket from 'ws';

export default class WledClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => {
        console.log('Connected to WLED WebSocket server');
        resolve();
      });

      this.ws.on('error', (err) => {
        console.error('Error connecting to WLED WebSocket:', err);
        reject(err);
      });
    });
  }

  async getSegments() {
    await this.ensureConnected();
    this.ws.send(JSON.stringify({ type: 'get_segments' }));
    return new Promise((resolve, reject) => {
      this.ws.once('message', (data) => {
        try {
          const segments = JSON.parse(data.toString()).state.seg;
          resolve(segments);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async updateSegmentLeds(segmentId, leds) {
      await this.ensureConnected();
      
      const wledMsg = {
        "seg": {
          "i": []
        }
      };
    
      leds.forEach((color, ledPos) => {
        wledMsg.seg.i.push(ledPos, color); // Push LED index and color to the array
      });
    
      this.ws.send(JSON.stringify(wledMsg));
    }
    

  async ensureConnected() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
  }
};

main().catch(console.error);