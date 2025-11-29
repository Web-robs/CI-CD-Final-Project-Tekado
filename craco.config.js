// Override CRA webpack config via CRACO.
// We remove ModuleScopePlugin so dev tooling (react-refresh) can import its runtime without scope errors.
module.exports = {
  webpack: {
    configure: (config) => {
      if (config.resolve && Array.isArray(config.resolve.plugins)) {
        config.resolve.plugins = config.resolve.plugins.filter(
          (plugin) => plugin.constructor && plugin.constructor.name !== 'ModuleScopePlugin'
        );
      }
      return config;
    },
  },
};
