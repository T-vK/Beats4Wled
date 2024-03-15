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