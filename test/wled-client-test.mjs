import { WLEDClient } from 'wled-client';

const wled = new WLEDClient({
  host: "192.168.x.x",
  websocket: true
});

wled.on('error', (e) => {
  console.error(e);
})

const colors = [[255,0,0], [0,0,0], [0,0,0]];
const segmentId = 0;

async function main() {
  await wled.init();
  await wled.updateSegment(segmentId, { colors: colors });
}

main().catch(console.error);