/**
 * DrawIO PostConfig.js — loaded AFTER app.min.js, but in this build
 * AFTER App.main() has already constructed the graph (DrawIO calls
 * checkAllLoaded → App.main, then mxscript('js/PostConfig.js')).
 *
 * Because PostConfig.js runs too late to intercept Graph's prototype
 * before instances exist, all viewer-side instrumentation lives in
 * PreConfig.js, which loads BEFORE app.min.js. This file is kept as a
 * placeholder so DrawIO's mxscript() loader doesn't 404.
 */
