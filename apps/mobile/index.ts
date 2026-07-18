// MUST be first: installs the TextDecoder polyfill before h3-js (via App) loads.
import './polyfills';
// Set the Mapbox token before the map screen mounts (fixes gray tiles on first launch).
import './lib/mapboxInit';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
