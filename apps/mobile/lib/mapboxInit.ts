import Mapbox from "@rnmapbox/maps";

// Set the Mapbox access token at app entry — before RealmMap ever mounts — so tiles
// load on the FIRST cold launch. Setting it inside RealmMap's own module raced the
// native map initialization: tiles came up gray on the first launch and only worked
// after a relaunch (the token was cached by then). Imported early in index.ts.
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "");
