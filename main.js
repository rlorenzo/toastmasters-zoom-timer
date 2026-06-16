// Browser entry point. app.js exports init() rather than auto-booting so it can
// be imported under test without firing camera/network/loop side effects; this
// thin entry kicks the real boot.
import { init } from './app.js';

init();
