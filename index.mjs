import Beats4Wled from './Beats4Wled.mjs'
import config from './config.json' assert { type: 'json' };

const beats4Wled = new Beats4Wled(config);

beats4Wled.init().catch(console.error);