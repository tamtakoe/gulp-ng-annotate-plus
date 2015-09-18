"use strict";

var path = require('path');
var gutil = require("gulp-util");
var through = require("through2");
var ngAnnotate = require("ng-annotate");
var applySourceMap = require("vinyl-sourcemaps-apply");
var merge = require("merge");
var BufferStreams = require("bufferstreams");

var PLUGIN_NAME = "gulp-ng-annotate";

// ngAnnotate plugin which collects angular modules names
function collectModulesPlugin(collection) {
  return {
    init: function(_ctx) {},
    match: function(node) {
      if (node.$parent && node.$parent.callee && node.value) {
        var callee = node.$parent.callee;
        var object = callee.object;
        var method = callee.property;

        if (object && object.name === "angular" && method && method.name === "module") {
          collection.push(node.value);
        }
      }
    }
  };
}

// Function which handle logic for both stream and buffer modes.
function transform(file, input, opts) {
  var res = ngAnnotate(input.toString(), opts);
  if (res.errors) {
    var filename = "";
    if (file.path) {
      filename = file.relative + ": ";
    }
    throw new gutil.PluginError(PLUGIN_NAME, filename + res.errors.join("\n"));
  }

  if (opts.sourcemap && file.sourceMap) {
    var sourceMap = JSON.parse(res.map);
    // Workaround for GH-9.
    var relative = file.relative.replace(/\\/g, "/");
    if (file.sourceMap.file !== relative) {
      if (opts.gulpWarnings !== false) {
        gutil.log(PLUGIN_NAME, "workaround for GH-9: change sourcemap `file` option from `"+file.sourceMap.file+"` to `"+relative+"`; if it breaks your sourcemap setup, please comment at https://github.com/Kagami/gulp-ng-annotate/issues/9 (you can mute this warning with `gulpWarnings: false` option)");
      }
      file.sourceMap.file = relative;
    }
    sourceMap.file = file.relative;
    applySourceMap(file, sourceMap);
  }

  return new Buffer(res.src);
}

module.exports = function (options) {
  options = options || {};
  var base, flush;

  if (!options.remove) {
    options = merge({add: true}, options);
  };

  if (options.createMainModule) {
    options.plugin = options.plugin || [];
    var mainModuleName = options.createMainModule;
    var mainModuleDependencies = [];

    options.plugin.push(collectModulesPlugin(mainModuleDependencies));

    flush = function(done) {
      var dependencies = mainModuleDependencies.length ? '"' + mainModuleDependencies.join('", "') + '"' : '';
      var content = 'angular.module("' + mainModuleName + '", [' + dependencies + ']);';
      var file = new gutil.File({
        base: base,
        path: path.join(base || '', mainModuleName, '.js'),
        contents: new Buffer(content, 'utf8')
      });
      this.push(file);

      done();
    }
  }

  return through.obj(function (file, enc, done) {
    base = file.base;

    // When null just pass through.
    if (file.isNull()) {
      this.push(file);
      return done();
    }

    var opts = merge({sourcemap: !!file.sourceMap}, options);
    if (opts.sourcemap) {
      // Convert possible boolean option to object since ng-annotate
      // changed it's format in 0.14.0.
      if (typeof opts.sourcemap === "boolean") {
        opts.sourcemap = {};
      }
      if (file.path) {
        opts.sourcemap.inFile = file.relative;
      }
    }

    // Buffer input.
    if (file.isBuffer()) {
      try {
        file.contents = transform(file, file.contents, opts);
      } catch (e) {
        this.emit("error", e);
        return done();
      }
    // Dealing with stream input.
    } else {
      file.contents = file.contents.pipe(new BufferStreams(function(err, buf, cb) {
        if (err) return cb(new gutil.PluginError(PLUGIN_NAME, err));
        try {
          var transformed = transform(file, buf, opts)
        } catch (e) {
          return cb(e);
        }
        cb(null, transformed);
      }));
    }

    this.push(file);
    done();
  }, flush);
};
