// This file is auto-generated from the corresponding file in /dev_mode
// This file is auto-generated from the corresponding file in /dev_mode
/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

const path = require('path');
const fs = require('fs-extra');
const Handlebars = require('handlebars');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const merge = require('webpack-merge').default;
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer')
  .BundleAnalyzerPlugin;
const baseConfig = require('@jupyterlab/builder/lib/webpack.config.base');
const { ModuleFederationPlugin } = webpack.container;

const Build = require('@jupyterlab/builder').Build;
const WPPlugin = require('@jupyterlab/builder').WPPlugin;
const packageData = require('./package.json');

// Handle the extensions.
const jlab = packageData.jupyterlab;
const { extensions, mimeExtensions, externalExtensions } = jlab;

// Add external extensions to the extensions/mimeExtensions data as
// appropriate
for (const pkg in externalExtensions) {
  const {
    jupyterlab: { extension, mimeExtension }
  } = require(`${pkg}/package.json`);
  if (extension !== undefined) {
    extensions[pkg] = extension === true ? '' : extension;
  }
  if (mimeExtension !== undefined) {
    mimeExtensions[pkg] = mimeExtension === true ? '' : mimeExtension;
  }
}

// Deduplicated list of extension package names.
const extensionPackages = [
  ...new Set([...Object.keys(extensions), ...Object.keys(mimeExtensions)])
];

// Ensure a clear build directory.
const buildDir = path.resolve(jlab.buildDir);
if (fs.existsSync(buildDir)) {
  fs.removeSync(buildDir);
}
fs.ensureDirSync(buildDir);

const outputDir = path.resolve(jlab.outputDir);

// Configuration to handle extension assets
const extensionAssetConfig = Build.ensureAssets({
  packageNames: extensionPackages,
  output: outputDir
});

// Create the entry point and other assets in build directory.
const source = fs.readFileSync('index.js').toString();
const template = Handlebars.compile(source);
const extData = {
  jupyterlab_extensions: extensions,
  jupyterlab_mime_extensions: mimeExtensions
};
fs.writeFileSync(path.join(buildDir, 'index.out.js'), template(extData));

// Create the bootstrap file that loads federated extensions and calls the
// initialization logic in index.out.js
const entryPoint = path.join(buildDir, 'bootstrap.js');
fs.copySync('./bootstrap.js', entryPoint);

fs.copySync('./package.json', path.join(buildDir, 'package.json'));
if (outputDir !== buildDir) {
  fs.copySync(
    path.join(outputDir, 'style.js'),
    path.join(buildDir, 'style.js')
  );
}

// Set up variables for the watch mode ignore plugins
const watched = {};
const ignoreCache = Object.create(null);
let watchNodeModules = false;
Object.keys(jlab.linkedPackages).forEach(function (name) {
  if (name in watched) {
    return;
  }
  let localPkgPath = '';
  try {
    localPkgPath = require.resolve(path.join(name, 'package.json'));
  } catch (e) {
    return;
  }
  watched[name] = path.dirname(localPkgPath);
  if (localPkgPath.indexOf('node_modules') !== -1) {
    watchNodeModules = true;
  }
});

// Set up source-map-loader to look in watched lib dirs
const sourceMapRes = Object.values(watched).reduce((res, name) => {
  res.push(new RegExp(name + '/lib'));
  return res;
}, []);

/**
 * Sync a local path to a linked package path if they are files and differ.
 * This is used by `jupyter lab --watch` to synchronize linked packages
 * and has no effect in `jupyter lab --dev-mode --watch`.
 */
function maybeSync(localPath, name, rest) {
  let stats;
  try {
    stats = fs.statSync(localPath);
  } catch (e) {
    return;
  }

  if (!stats.isFile(localPath)) {
    return;
  }
  const source = fs.realpathSync(path.join(jlab.linkedPackages[name], rest));
  if (source === fs.realpathSync(localPath)) {
    return;
  }
  fs.watchFile(source, { interval: 500 }, function (curr) {
    if (!curr || curr.nlink === 0) {
      return;
    }
    try {
      fs.copySync(source, localPath);
    } catch (err) {
      console.error(err);
    }
  });
}

/**
 * A filter function set up to exclude all files that are not
 * in a package contained by the Jupyterlab repo. Used to ignore
 * files during a `--watch` build.
 */
function ignored(checkedPath) {
  checkedPath = path.resolve(checkedPath);
  if (checkedPath in ignoreCache) {
    // Bail if already found.
    return ignoreCache[checkedPath];
  }

  // Limit the watched files to those in our local linked package dirs.
  let ignore = true;
  Object.keys(watched).some(name => {
    const rootPath = watched[name];
    const contained = checkedPath.indexOf(rootPath + path.sep) !== -1;
    if (checkedPath !== rootPath && !contained) {
      return false;
    }
    const rest = checkedPath.slice(rootPath.length);
    if (rest.indexOf('node_modules') === -1) {
      ignore = false;
      maybeSync(checkedPath, name, rest);
    }
    return true;
  });
  ignoreCache[checkedPath] = ignore;
  return ignore;
}

// Set up module federation sharing config
const shared = {};

// Make sure any resolutions are shared
for (let [pkg, requiredVersion] of Object.entries(packageData.resolutions)) {
  shared[pkg] = { requiredVersion };
}

// Add any extension packages that are not in resolutions (i.e., installed from npm)
for (let pkg of extensionPackages) {
  if (!shared[pkg]) {
    shared[pkg] = {
      requiredVersion: require(`${pkg}/package.json`).version
    };
  }
}

// Add dependencies and sharedPackage config from extension packages if they
// are not already in the shared config. This means that if there is a
// conflict, the resolutions package version is the one that is shared.
const extraShared = [];
for (let pkg of extensionPackages) {
  let pkgShared = {};
  let {
    dependencies = {},
    jupyterlab: { sharedPackages = {} } = {}
  } = require(`${pkg}/package.json`);
  for (let [dep, requiredVersion] of Object.entries(dependencies)) {
    if (!shared[dep]) {
      pkgShared[dep] = { requiredVersion };
    }
  }

  // Overwrite automatic dependency sharing with custom sharing config
  for (let [dep, config] of Object.entries(sharedPackages)) {
    if (config === false) {
      delete pkgShared[dep];
    } else {
      if ('bundled' in config) {
        config.import = config.bundled;
        delete config.bundled;
      }
      pkgShared[dep] = config;
    }
  }
  extraShared.push(pkgShared);
}

// Now merge the extra shared config
const mergedShare = {};
for (let sharedConfig of extraShared) {
  for (let [pkg, config] of Object.entries(sharedConfig)) {
    // Do not override the basic share config from resolutions
    if (shared[pkg]) {
      continue;
    }

    // Add if we haven't seen the config before
    if (!mergedShare[pkg]) {
      mergedShare[pkg] = config;
      continue;
    }

    // Choose between the existing config and this new config. We do not try
    // to merge configs, which may yield a config no one wants
    let oldConfig = mergedShare[pkg];

    // if the old one has import: false, use the new one
    if (oldConfig.import === false) {
      mergedShare[pkg] = config;
    }
  }
}

Object.assign(shared, mergedShare);

// Transform any file:// requiredVersion to the version number from the
// imported package. This assumes (for simplicity) that the version we get
// importing was installed from the file.
for (let [pkg, { requiredVersion }] of Object.entries(shared)) {
  if (requiredVersion && requiredVersion.startsWith('file:')) {
    shared[pkg].requiredVersion = require(`${pkg}/package.json`).version;
  }
}

// Add singleton package information
for (let pkg of jlab.singletonPackages) {
  shared[pkg].singleton = true;
}

const plugins = [
  new WPPlugin.NowatchDuplicatePackageCheckerPlugin({
    verbose: true,
    exclude(instance) {
      // ignore known duplicates
      return ['domelementtype', 'hash-base', 'inherits'].includes(
        instance.name
      );
    }
  }),
  new HtmlWebpackPlugin({
    chunksSortMode: 'none',
    template: path.join(__dirname, 'templates', 'template.html'),
    title: jlab.name || 'JupyterLab'
  }),
  // custom plugin for ignoring files during a `--watch` build
  new WPPlugin.FilterWatchIgnorePlugin(ignored),
  // custom plugin that copies the assets to the static directory
  new WPPlugin.FrontEndPlugin(buildDir, jlab.staticDir),
  new ModuleFederationPlugin({
    library: {
      type: 'var',
      name: ['_JUPYTERLAB', 'CORE_LIBRARY_FEDERATION']
    },
    name: 'CORE_FEDERATION',
    shared
  })
];

if (process.argv.includes('--analyze')) {
  plugins.push(new BundleAnalyzerPlugin());
}

module.exports = [
  merge(baseConfig, {
    resolve: {
      alias: {
        '@jupyterlab/application$': require.resolve(path.resolve('../../packages/application')),
        '@jupyterlab/application-extension$': require.resolve(path.resolve('../../packages/application-extension')),
        '@jupyterlab/apputils$': require.resolve(path.resolve('../../packages/apputils')),
'@jupyterlab/apputils-extension$': require.resolve(path.resolve('../../packages/apputils-extension')),
'@jupyterlab/attachments$': require.resolve(path.resolve('../../packages/attachments')),
'@jupyterlab/cells$': require.resolve(path.resolve('../../packages/cells')),
'@jupyterlab/celltags$': require.resolve(path.resolve('../../packages/celltags')),
'@jupyterlab/celltags-extension$': require.resolve(path.resolve('../../packages/celltags-extension')),
'@jupyterlab/codeeditor$': require.resolve(path.resolve('../../packages/codeeditor')),
'@jupyterlab/codemirror$': require.resolve(path.resolve('../../packages/codemirror')),
'@jupyterlab/codemirror-extension$': require.resolve(path.resolve('../../packages/codemirror-extension')),
'@jupyterlab/completer$': require.resolve(path.resolve('../../packages/completer')),
'@jupyterlab/completer-extension$': require.resolve(path.resolve('../../packages/completer-extension')),
'@jupyterlab/console$': require.resolve(path.resolve('../../packages/console')),
'@jupyterlab/console-extension$': require.resolve(path.resolve('../../packages/console-extension')),
'@jupyterlab/coreutils$': require.resolve(path.resolve('../../packages/coreutils')),
'@jupyterlab/debugger$': require.resolve(path.resolve('../../packages/debugger')),
'@jupyterlab/debugger-extension$': require.resolve(path.resolve('../../packages/debugger-extension')),
'@jupyterlab/docmanager$': require.resolve(path.resolve('../../packages/docmanager')),
'@jupyterlab/docmanager-extension$': require.resolve(path.resolve('../../packages/docmanager-extension')),
'@jupyterlab/docprovider$': require.resolve(path.resolve('../../packages/docprovider')),
'@jupyterlab/docprovider-extension$': require.resolve(path.resolve('../../packages/docprovider-extension')),
'@jupyterlab/docregistry$': require.resolve(path.resolve('../../packages/docregistry')),
'@jupyterlab/documentsearch$': require.resolve(path.resolve('../../packages/documentsearch')),
'@jupyterlab/documentsearch-extension$': require.resolve(path.resolve('../../packages/documentsearch-extension')),
'@jupyterlab/filebrowser$': require.resolve(path.resolve('../../packages/filebrowser')),
'@jupyterlab/filebrowser-extension$': require.resolve(path.resolve('../../packages/filebrowser-extension')),
'@jupyterlab/fileeditor$': require.resolve(path.resolve('../../packages/fileeditor')),
'@jupyterlab/fileeditor-extension$': require.resolve(path.resolve('../../packages/fileeditor-extension')),
'@jupyterlab/help-extension$': require.resolve(path.resolve('../../packages/help-extension')),
'@jupyterlab/htmlviewer$': require.resolve(path.resolve('../../packages/htmlviewer')),
'@jupyterlab/htmlviewer-extension$': require.resolve(path.resolve('../../packages/htmlviewer-extension')),
'@jupyterlab/hub-extension$': require.resolve(path.resolve('../../packages/hub-extension')),
'@jupyterlab/imageviewer$': require.resolve(path.resolve('../../packages/imageviewer')),
'@jupyterlab/imageviewer-extension$': require.resolve(path.resolve('../../packages/imageviewer-extension')),
'@jupyterlab/inspector$': require.resolve(path.resolve('../../packages/inspector')),
'@jupyterlab/inspector-extension$': require.resolve(path.resolve('../../packages/inspector-extension')),
'@jupyterlab/launcher$': require.resolve(path.resolve('../../packages/launcher')),
'@jupyterlab/launcher-extension$': require.resolve(path.resolve('../../packages/launcher-extension')),
'@jupyterlab/logconsole$': require.resolve(path.resolve('../../packages/logconsole')),
'@jupyterlab/logconsole-extension$': require.resolve(path.resolve('../../packages/logconsole-extension')),
'@jupyterlab/mainmenu$': require.resolve(path.resolve('../../packages/mainmenu')),
'@jupyterlab/mainmenu-extension$': require.resolve(path.resolve('../../packages/mainmenu-extension')),
'@jupyterlab/metapackage$': require.resolve(path.resolve('../../packages/metapackage')),
'@jupyterlab/nbconvert-css$': require.resolve(path.resolve('../../packages/nbconvert-css')),
'@jupyterlab/nbformat$': require.resolve(path.resolve('../../packages/nbformat')),
'@jupyterlab/notebook$': require.resolve(path.resolve('../../packages/notebook')),
'@jupyterlab/notebook-extension$': require.resolve(path.resolve('../../packages/notebook-extension')),
'@jupyterlab/observables$': require.resolve(path.resolve('../../packages/observables')),
'@jupyterlab/outputarea$': require.resolve(path.resolve('../../packages/outputarea')),
'@jupyterlab/property-inspector$': require.resolve(path.resolve('../../packages/property-inspector')),
'@jupyterlab/rendermime$': require.resolve(path.resolve('../../packages/rendermime')),
'@jupyterlab/rendermime-extension$': require.resolve(path.resolve('../../packages/rendermime-extension')),
'@jupyterlab/rendermime-interfaces$': require.resolve(path.resolve('../../packages/rendermime-interfaces')),
'@jupyterlab/running$': require.resolve(path.resolve('../../packages/running')),
'@jupyterlab/running-extension$': require.resolve(path.resolve('../../packages/running-extension')),
'@jupyterlab/services$': require.resolve(path.resolve('../../packages/services')),
'@jupyterlab/settingeditor$': require.resolve(path.resolve('../../packages/settingeditor')),
'@jupyterlab/settingeditor-extension$': require.resolve(path.resolve('../../packages/settingeditor-extension')),
'@jupyterlab/settingregistry$': require.resolve(path.resolve('../../packages/settingregistry')),
'@jupyterlab/shared-models$': require.resolve(path.resolve('../../packages/shared-models')),
'@jupyterlab/shortcuts-extension$': require.resolve(path.resolve('../../packages/shortcuts-extension')),
'@jupyterlab/statedb$': require.resolve(path.resolve('../../packages/statedb')),
'@jupyterlab/statusbar$': require.resolve(path.resolve('../../packages/statusbar')),
'@jupyterlab/statusbar-extension$': require.resolve(path.resolve('../../packages/statusbar-extension')),
'@jupyterlab/theme-dark-extension$': require.resolve(path.resolve('../../packages/theme-dark-extension')),
'@jupyterlab/theme-light-extension$': require.resolve(path.resolve('../../packages/theme-light-extension')),
'@jupyterlab/tooltip$': require.resolve(path.resolve('../../packages/tooltip')),
'@jupyterlab/tooltip-extension$': require.resolve(path.resolve('../../packages/tooltip-extension')),
'@jupyterlab/translation$': require.resolve(path.resolve('../../packages/translation')),
'@jupyterlab/translation-extension$': require.resolve(path.resolve('../../packages/translation-extension')),
'@jupyterlab/ui-components$': require.resolve(path.resolve('../../packages/ui-components')),
'@jupyterlab/ui-components-extension$': require.resolve(path.resolve('../../packages/ui-components-extension')),

      },
    },

    mode: 'development',
    entry: {
      main: ['./publicpath', 'whatwg-fetch', entryPoint]
    },
    output: {
      path: path.resolve(buildDir),
      publicPath: '{{page_config.fullStaticUrl}}/',
      filename: '[name].[contenthash].js'
    },
    optimization: {
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          jlab_core: {
            test: /[\\/]node_modules[\\/]@(jupyterlab|lumino)[\\/]/,
            name: 'jlab_core'
          }
        }
      }
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          include: sourceMapRes,
          use: ['source-map-loader'],
          enforce: 'pre'
        }
      ]
    },
    devtool: 'inline-source-map',
    externals: ['node-fetch', 'ws'],
    plugins
  })
].concat(extensionAssetConfig);

// Needed to watch changes in linked extensions in node_modules
// (jupyter lab --watch)
// See https://github.com/webpack/webpack/issues/11612
if (watchNodeModules) {
  module.exports[0].snapshot = { managedPaths: [] };
}

const logPath = path.join(buildDir, 'build_log.json');
fs.writeFileSync(logPath, JSON.stringify(module.exports, null, '  '));
