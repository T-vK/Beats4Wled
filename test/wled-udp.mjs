import dgram from 'dgram';

class WledRealtimeClient {
    constructor(wledControllerIp, numPixels, udpPort = 21324, maxPixelsPerPacket = 126) {
        this.wledControllerIp = wledControllerIp;
        this.numPixels = numPixels;
        this.udpPort = udpPort;
        this.maxPixelsPerPacket = maxPixelsPerPacket;
        this.sock = dgram.createSocket('udp4');
        this.prevPixels = Buffer.alloc(3 * this.numPixels, 253);
        this.pixels = Buffer.alloc(3 * this.numPixels, 1);
    }

    update() {
        // Truncate values and cast to integer
        for (let i = 0; i < this.pixels.length; i++) {
            this.pixels[i] = Math.max(0, Math.min(255, this.pixels[i]));
        }

        const p = Buffer.from(this.pixels);
        const idx = [];
        for (let i = 0; i < p.length; i += 3) {
            if (!this.areArraysEqual(p.slice(i, i + 3), this.prevPixels.slice(i, i + 3))) {
                idx.push(i / 3);
            }
        }

        const numPixels = idx.length;
        const nPackets = Math.ceil(numPixels / this.maxPixelsPerPacket);
        const idxSplit = [];
        for (let i = 0; i < nPackets; i++) {
            idxSplit.push(idx.slice(i * this.maxPixelsPerPacket, (i + 1) * this.maxPixelsPerPacket));
        }

        const header = Buffer.from([1, 2]); // WARLS protocol header
        for (const packetIndices of idxSplit) {
            const data = Buffer.alloc(header.length + packetIndices.length * 4);
            header.copy(data, 0);
            let dataIndex = header.length;
            for (const i of packetIndices) {
                data.writeUInt8(i, dataIndex++);
                p.copy(data, dataIndex, i * 3, i * 3 + 3);
                dataIndex += 3;
            }
            this.sock.send(data, 0, data.length, this.udpPort, this.wledControllerIp);
        }

        this.prevPixels = Buffer.from(p);
    }

    areArraysEqual(arr1, arr2) {
        if (arr1.length !== arr2.length) {
            return false;
        }
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) {
                return false;
            }
        }
        return true;
    }
    
    setLeds(pixels) {
        for (let i = 0; i < pixels.length; i++) {
            const pixel = pixels[i]
            this.pixels[i * 3] = pixel[0]; // Red
            this.pixels[i * 3 + 1] = pixel[1]; // Green
            this.pixels[i * 3 + 2] = pixel[2]; // Blue
        }
    }
}

////////////////////////////////// LED blink test //////////////////////////////////
const WLED_CONTROLLER_IP = '192.168.x.x';
const NUM_PIXELS = 1; // Amount of LEDs on your strip
import { performance } from 'perf_hooks';

const RED = [255,0,0];
const OFF = [0,0,255];

const wled = new WledRealtimeClient(WLED_CONTROLLER_IP, NUM_PIXELS);
console.log('Starting LED blink test');

const leds = []
while (true) {
    leds[0] = RED;
    wled.setLeds(leds);
    wled.update();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    leds[0] = OFF;
    wled.setLeds(leds);
    wled.update();
    await new Promise(resolve => setTimeout(resolve, 100));
}