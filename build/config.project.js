module.exports = function (config) {
  // nothing; pure defaults
  config.client_autosound.push('!client/sounds/LD57-sfx.wav');
  config.extra_index.push({
    // example .zip for itch.io publishing
    name: 'itch',
    defines: {
      ...config.default_defines,
      PLATFORM: 'web',
    },
    zip: true,
  });
};
