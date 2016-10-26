'use strict';

const path = require('path');
const util = require('util');
const stream = require('stream');
const events = require('events');

const semver = require('semver');
const color = require('color');

const sharp = require('./build/Release/sharp.node');

// Versioning
let versions = {
  vips: sharp.libvipsVersion()
};
(function () {
  // Does libvips meet minimum requirement?
  const libvipsVersionMin = require('./package.json').config.libvips;
  if (semver.lt(versions.vips, libvipsVersionMin)) {
    throw new Error('Found libvips ' + versions.vips + ' but require at least ' + libvipsVersionMin);
  }
  // Include versions of dependencies, if present
  try {
    versions = require('./lib/versions.json');
  } catch (err) {}
})();

// Limits
const maximum = {
  width: 0x3FFF,
  height: 0x3FFF,
  pixels: Math.pow(0x3FFF, 2)
};

// Constructor-factory
const Sharp = function (input, options) {
  if (!(this instanceof Sharp)) {
    return new Sharp(input, options);
  }
  stream.Duplex.call(this);
  this.options = {
    // input options
    sequentialRead: false,
    limitInputPixels: maximum.pixels,
    // ICC profiles
    iccProfilePath: path.join(__dirname, 'icc') + path.sep,
    // resize options
    topOffsetPre: -1,
    leftOffsetPre: -1,
    widthPre: -1,
    heightPre: -1,
    topOffsetPost: -1,
    leftOffsetPost: -1,
    widthPost: -1,
    heightPost: -1,
    width: -1,
    height: -1,
    canvas: 'crop',
    crop: 0,
    angle: 0,
    rotateBeforePreExtract: false,
    flip: false,
    flop: false,
    extendTop: 0,
    extendBottom: 0,
    extendLeft: 0,
    extendRight: 0,
    withoutEnlargement: false,
    kernel: 'lanczos3',
    interpolator: 'bicubic',
    // operations
    background: [0, 0, 0, 255],
    flatten: false,
    negate: false,
    blurSigma: 0,
    sharpenSigma: 0,
    sharpenFlat: 1,
    sharpenJagged: 2,
    threshold: 0,
    thresholdGrayscale: true,
    trimTolerance: 0,
    gamma: 0,
    greyscale: false,
    normalize: 0,
    booleanBufferIn: null,
    booleanFileIn: '',
    joinChannelIn: [],
    extractChannel: -1,
    colourspace: 'srgb',
    // overlay
    overlayGravity: 0,
    overlayXOffset: -1,
    overlayYOffset: -1,
    overlayTile: false,
    overlayCutout: false,
    // output
    fileOut: '',
    formatOut: 'input',
    streamOut: false,
    withMetadata: false,
    withMetadataOrientation: -1,
    // output format
    jpegQuality: 80,
    jpegProgressive: false,
    jpegChromaSubsampling: '4:2:0',
    jpegTrellisQuantisation: false,
    jpegOvershootDeringing: false,
    jpegOptimiseScans: false,
    pngProgressive: false,
    pngCompressionLevel: 6,
    pngAdaptiveFiltering: true,
    webpQuality: 80,
    tiffQuality: 80,
    tileSize: 256,
    tileOverlap: 0,
    // Function to notify of queue length changes
    queueListener: function (queueLength) {
      module.exports.queue.emit('change', queueLength);
    }
  };
  this.options.input = this._createInputDescriptor(input, options, { allowStream: true });
  return this;
};
module.exports = Sharp;
util.inherits(Sharp, stream.Duplex);

/*
  EventEmitter singleton emits queue length 'change' events
*/
module.exports.queue = new events.EventEmitter();

/*
  Supported image formats
*/
module.exports.format = sharp.format();

/*
  Version numbers of libvips and its dependencies
*/
module.exports.versions = versions;

/*
  Validation helpers
*/
const isDefined = function (val) {
  return typeof val !== 'undefined' && val !== null;
};
const isObject = function (val) {
  return typeof val === 'object';
};
const isFunction = function (val) {
  return typeof val === 'function';
};
const isBoolean = function (val) {
  return typeof val === 'boolean';
};
const isBuffer = function (val) {
  return typeof val === 'object' && val instanceof Buffer;
};
const isString = function (val) {
  return typeof val === 'string' && val.length > 0;
};
const isNumber = function (val) {
  return typeof val === 'number' && !Number.isNaN(val);
};
const isInteger = function (val) {
  return isNumber(val) && val % 1 === 0;
};
const inRange = function (val, min, max) {
  return val >= min && val <= max;
};
const contains = function (val, list) {
  return list.indexOf(val) !== -1;
};

/*
  Create Object containing input and input-related options
*/
Sharp.prototype._createInputDescriptor = function (input, inputOptions, containerOptions) {
  const inputDescriptor = {};
  if (isString(input)) {
    // filesystem
    inputDescriptor.file = input;
  } else if (isBuffer(input)) {
    // Buffer
    inputDescriptor.buffer = input;
  } else if (!isDefined(input) && isObject(containerOptions) && containerOptions.allowStream) {
    // Stream
    inputDescriptor.buffer = [];
  } else {
    throw new Error('Unsupported input ' + typeof input);
  }
  if (isObject(inputOptions)) {
    // Density
    if (isDefined(inputOptions.density)) {
      if (isInteger(inputOptions.density) && inRange(inputOptions.density, 1, 2400)) {
        inputDescriptor.density = inputOptions.density;
      } else {
        throw new Error('Invalid density (1 to 2400) ' + inputOptions.density);
      }
    }
    // Raw pixel input
    if (isDefined(inputOptions.raw)) {
      if (
        isObject(inputOptions.raw) &&
        isInteger(inputOptions.raw.width) && inRange(inputOptions.raw.width, 1, maximum.width) &&
        isInteger(inputOptions.raw.height) && inRange(inputOptions.raw.height, 1, maximum.height) &&
        isInteger(inputOptions.raw.channels) && inRange(inputOptions.raw.channels, 1, 4)
      ) {
        inputDescriptor.rawWidth = inputOptions.raw.width;
        inputDescriptor.rawHeight = inputOptions.raw.height;
        inputDescriptor.rawChannels = inputOptions.raw.channels;
      } else {
        throw new Error('Expected width, height and channels for raw pixel input');
      }
    }
  } else if (isDefined(inputOptions)) {
    throw new Error('Invalid input options ' + inputOptions);
  }
  return inputDescriptor;
};

/*
  Handle incoming chunk on Writable Stream
*/
Sharp.prototype._write = function (chunk, encoding, callback) {
  if (Array.isArray(this.options.input.buffer)) {
    if (isBuffer(chunk)) {
      this.options.input.buffer.push(chunk);
      callback();
    } else {
      callback(new Error('Non-Buffer data on Writable Stream'));
    }
  } else {
    callback(new Error('Unexpected data on Writable Stream'));
  }
};

/*
  Flattens the array of chunks accumulated in input.buffer
*/
Sharp.prototype._flattenBufferIn = function () {
  if (this._isStreamInput()) {
    this.options.input.buffer = Buffer.concat(this.options.input.buffer);
  }
};
Sharp.prototype._isStreamInput = function () {
  return Array.isArray(this.options.input.buffer);
};

// Weighting to apply to image crop
module.exports.gravity = {
  center: 0,
  centre: 0,
  north: 1,
  east: 2,
  south: 3,
  west: 4,
  northeast: 5,
  southeast: 6,
  southwest: 7,
  northwest: 8
};

// Strategies for automagic behaviour
module.exports.strategy = {
  entropy: 16,
  attention: 17
};

/*
  What part of the image should be retained when cropping?
*/
Sharp.prototype.crop = function (crop) {
  this.options.canvas = 'crop';
  if (!isDefined(crop)) {
    // Default
    this.options.crop = module.exports.gravity.center;
  } else if (isInteger(crop) && inRange(crop, 0, 8)) {
    // Gravity (numeric)
    this.options.crop = crop;
  } else if (isString(crop) && isInteger(module.exports.gravity[crop])) {
    // Gravity (string)
    this.options.crop = module.exports.gravity[crop];
  } else if (isInteger(crop) && crop >= module.exports.strategy.entropy) {
    // Strategy
    this.options.crop = crop;
  } else {
    throw new Error('Unsupported crop ' + crop);
  }
  return this;
};

Sharp.prototype.extract = function (options) {
  const suffix = this.options.width === -1 && this.options.height === -1 ? 'Pre' : 'Post';
  ['left', 'top', 'width', 'height'].forEach(function (name) {
    const value = options[name];
    if (isInteger(value) && value >= 0) {
      this.options[name + (name === 'left' || name === 'top' ? 'Offset' : '') + suffix] = value;
    } else {
      throw new Error('Non-integer value for ' + name + ' of ' + value);
    }
  }, this);
  // Ensure existing rotation occurs before pre-resize extraction
  if (suffix === 'Pre' && this.options.angle !== 0) {
    this.options.rotateBeforePreExtract = true;
  }
  return this;
};

Sharp.prototype.extractChannel = function (channel) {
  if (channel === 'red') {
    channel = 0;
  } else if (channel === 'green') {
    channel = 1;
  } else if (channel === 'blue') {
    channel = 2;
  }
  if (isInteger(channel) && inRange(channel, 0, 4)) {
    this.options.extractChannel = channel;
  } else {
    throw new Error('Cannot extract invalid channel ' + channel);
  }
  return this;
};

/*
  Set the background colour for embed and flatten operations.
  Delegates to the 'Color' module, which can throw an Error
  but is liberal in what it accepts, clamping values to sensible min/max.
*/
Sharp.prototype.background = function (rgba) {
  const colour = color(rgba);
  this.options.background = colour.rgbArray();
  this.options.background.push(colour.alpha() * 255);
  return this;
};

Sharp.prototype.embed = function () {
  this.options.canvas = 'embed';
  return this;
};

Sharp.prototype.max = function () {
  this.options.canvas = 'max';
  return this;
};

Sharp.prototype.min = function () {
  this.options.canvas = 'min';
  return this;
};

/*
  Ignoring the aspect ratio of the input, stretch the image to
  the exact width and/or height provided via the resize method.
*/
Sharp.prototype.ignoreAspectRatio = function () {
  this.options.canvas = 'ignore_aspect';
  return this;
};

Sharp.prototype.flatten = function (flatten) {
  this.options.flatten = isBoolean(flatten) ? flatten : true;
  return this;
};

Sharp.prototype.negate = function (negate) {
  this.options.negate = isBoolean(negate) ? negate : true;
  return this;
};

/*
  Bitwise boolean operations between images
*/
Sharp.prototype.boolean = function (operand, operator, options) {
  this.options.boolean = this._createInputDescriptor(operand, options);
  if (isString(operator) && contains(operator, ['and', 'or', 'eor'])) {
    this.options.booleanOp = operator;
  } else {
    throw new Error('Invalid boolean operation ' + operator);
  }
  return this;
};

/*
  Overlay with another image, using an optional gravity
*/
Sharp.prototype.overlayWith = function (overlay, options) {
  this.options.overlay = this._createInputDescriptor(overlay, options, {
    allowStream: false
  });
  if (isObject(options)) {
    if (isDefined(options.tile)) {
      if (isBoolean(options.tile)) {
        this.options.overlayTile = options.tile;
      } else {
        throw new Error('Invalid overlay tile ' + options.tile);
      }
    }
    if (isDefined(options.cutout)) {
      if (isBoolean(options.cutout)) {
        this.options.overlayCutout = options.cutout;
      } else {
        throw new Error('Invalid overlay cutout ' + options.cutout);
      }
    }
    if (isDefined(options.left) || isDefined(options.top)) {
      if (
        isInteger(options.left) && inRange(options.left, 0, maximum.width) &&
        isInteger(options.top) && inRange(options.top, 0, maximum.height)
      ) {
        this.options.overlayXOffset = options.left;
        this.options.overlayYOffset = options.top;
      } else {
        throw new Error('Invalid overlay left ' + options.left + ' and/or top ' + options.top);
      }
    }
    if (isDefined(options.gravity)) {
      if (isInteger(options.gravity) && inRange(options.gravity, 0, 8)) {
        this.options.overlayGravity = options.gravity;
      } else if (isString(options.gravity) && isInteger(module.exports.gravity[options.gravity])) {
        this.options.overlayGravity = module.exports.gravity[options.gravity];
      } else {
        throw new Error('Unsupported overlay gravity ' + options.gravity);
      }
    }
  }
  return this;
};

/*
  Add another color channel to the image
*/
Sharp.prototype.joinChannel = function (images, options) {
  if (Array.isArray(images)) {
    images.forEach(function (image) {
      this.options.joinChannelIn.push(this._createInputDescriptor(image, options));
    }, this);
  } else {
    this.options.joinChannelIn.push(this._createInputDescriptor(images, options));
  }
  return this;
};

/*
  Rotate output image by 0, 90, 180 or 270 degrees
  Auto-rotation based on the EXIF Orientation tag is represented by an angle of -1
*/
Sharp.prototype.rotate = function (angle) {
  if (!isDefined(angle)) {
    this.options.angle = -1;
  } else if (isInteger(angle) && contains(angle, [0, 90, 180, 270])) {
    this.options.angle = angle;
  } else {
    throw new Error('Unsupported angle (0, 90, 180, 270) ' + angle);
  }
  return this;
};

/*
  Flip the image vertically, about the Y axis
*/
Sharp.prototype.flip = function (flip) {
  this.options.flip = isBoolean(flip) ? flip : true;
  return this;
};

/*
  Flop the image horizontally, about the X axis
*/
Sharp.prototype.flop = function (flop) {
  this.options.flop = isBoolean(flop) ? flop : true;
  return this;
};

/*
  Do not enlarge the output if the input width *or* height are already less than the required dimensions
  This is equivalent to GraphicsMagick's ">" geometry option:
    "change the dimensions of the image only if its width or height exceeds the geometry specification"
*/
Sharp.prototype.withoutEnlargement = function (withoutEnlargement) {
  this.options.withoutEnlargement = isBoolean(withoutEnlargement) ? withoutEnlargement : true;
  return this;
};

/*
  Blur the output image.
  Call without a sigma to use a fast, mild blur.
  Call with a sigma to use a slower, more accurate Gaussian blur.
*/
Sharp.prototype.blur = function (sigma) {
  if (!isDefined(sigma)) {
    // No arguments: default to mild blur
    this.options.blurSigma = -1;
  } else if (isBoolean(sigma)) {
    // Boolean argument: apply mild blur?
    this.options.blurSigma = sigma ? -1 : 0;
  } else if (isNumber(sigma) && inRange(sigma, 0.3, 1000)) {
    // Numeric argument: specific sigma
    this.options.blurSigma = sigma;
  } else {
    throw new Error('Invalid blur sigma (0.3 - 1000.0) ' + sigma);
  }
  return this;
};

/*
  Convolve the image with a kernel.
*/
Sharp.prototype.convolve = function (kernel) {
  if (!isObject(kernel) || !Array.isArray(kernel.kernel) ||
      !isInteger(kernel.width) || !isInteger(kernel.height) ||
      !inRange(kernel.width, 3, 1001) || !inRange(kernel.height, 3, 1001) ||
      kernel.height * kernel.width !== kernel.kernel.length
     ) {
    // must pass in a kernel
    throw new Error('Invalid convolution kernel');
  }
  // Default scale is sum of kernel values
  if (!isInteger(kernel.scale)) {
    kernel.scale = kernel.kernel.reduce(function (a, b) {
      return a + b;
    }, 0);
  }
  // Clamp scale to a minimum value of 1
  if (kernel.scale < 1) {
    kernel.scale = 1;
  }
  if (!isInteger(kernel.offset)) {
    kernel.offset = 0;
  }
  this.options.convKernel = kernel;
  return this;
};

/*
  Sharpen the output image.
  Call without a radius to use a fast, mild sharpen.
  Call with a radius to use a slow, accurate sharpen using the L of LAB colour space.
    sigma - sigma of mask
    flat - level of "flat" area sharpen, default 1
    jagged - level of "jagged" area sharpen, default 2
*/
Sharp.prototype.sharpen = function (sigma, flat, jagged) {
  if (!isDefined(sigma)) {
    // No arguments: default to mild sharpen
    this.options.sharpenSigma = -1;
  } else if (isBoolean(sigma)) {
    // Boolean argument: apply mild sharpen?
    this.options.sharpenSigma = sigma ? -1 : 0;
  } else if (isNumber(sigma) && inRange(sigma, 0.01, 10000)) {
    // Numeric argument: specific sigma
    this.options.sharpenSigma = sigma;
    // Control over flat areas
    if (isDefined(flat)) {
      if (isNumber(flat) && inRange(flat, 0, 10000)) {
        this.options.sharpenFlat = flat;
      } else {
        throw new Error('Invalid sharpen level for flat areas (0 - 10000) ' + flat);
      }
    }
    // Control over jagged areas
    if (isDefined(jagged)) {
      if (isNumber(jagged) && inRange(jagged, 0, 10000)) {
        this.options.sharpenJagged = jagged;
      } else {
        throw new Error('Invalid sharpen level for jagged areas (0 - 10000) ' + jagged);
      }
    }
  } else {
    throw new Error('Invalid sharpen sigma (0.01 - 10000) ' + sigma);
  }
  return this;
};

Sharp.prototype.threshold = function (threshold, options) {
  if (!isDefined(threshold)) {
    this.options.threshold = 128;
  } else if (isBoolean(threshold)) {
    this.options.threshold = threshold ? 128 : 0;
  } else if (isInteger(threshold) && inRange(threshold, 0, 255)) {
    this.options.threshold = threshold;
  } else {
    throw new Error('Invalid threshold (0 to 255) ' + threshold);
  }
  if (!isObject(options) || options.greyscale === true || options.grayscale === true) {
    this.options.thresholdGrayscale = true;
  } else {
    this.options.thresholdGrayscale = false;
  }
  return this;
};

/*
  Automatically remove "boring" image edges.
    tolerance - if present, is a percentaged tolerance level between 0 and 100 to trim away similar color values
      Defaulting to 10 when no tolerance is given.
 */
Sharp.prototype.trim = function (tolerance) {
  if (!isDefined(tolerance)) {
    this.options.trimTolerance = 10;
  } else if (isInteger(tolerance) && inRange(tolerance, 1, 99)) {
    this.options.trimTolerance = tolerance;
  } else {
    throw new Error('Invalid trim tolerance (1 to 99) ' + tolerance);
  }
  return this;
};

/*
  Darken image pre-resize (1/gamma) and brighten post-resize (gamma).
  Improves brightness of resized image in non-linear colour spaces.
*/
Sharp.prototype.gamma = function (gamma) {
  if (!isDefined(gamma)) {
    // Default gamma correction of 2.2 (sRGB)
    this.options.gamma = 2.2;
  } else if (isNumber(gamma) && inRange(gamma, 1, 3)) {
    this.options.gamma = gamma;
  } else {
    throw new Error('Invalid gamma correction (1.0 to 3.0) ' + gamma);
  }
  return this;
};

/*
  Enhance output image contrast by stretching its luminance to cover the full dynamic range
*/
Sharp.prototype.normalize = function (normalize) {
  this.options.normalize = isBoolean(normalize) ? normalize : true;
  return this;
};
Sharp.prototype.normalise = Sharp.prototype.normalize;

/*
  Perform boolean/bitwise operation on image color channels - results in one channel image
*/
Sharp.prototype.bandbool = function (boolOp) {
  if (isString(boolOp) && contains(boolOp, ['and', 'or', 'eor'])) {
    this.options.bandBoolOp = boolOp;
  } else {
    throw new Error('Invalid bandbool operation ' + boolOp);
  }
  return this;
};

/*
  Convert to greyscale
*/
Sharp.prototype.greyscale = function (greyscale) {
  this.options.greyscale = isBoolean(greyscale) ? greyscale : true;
  return this;
};
Sharp.prototype.grayscale = Sharp.prototype.greyscale;

/*
  Set output colourspace
*/
Sharp.prototype.toColourspace = function (colourspace) {
  if (!isString(colourspace)) {
    throw new Error('Invalid output colourspace ' + colourspace);
  }
  this.options.colourspace = colourspace;
  return this;
};
Sharp.prototype.toColorspace = Sharp.prototype.toColourspace;

Sharp.prototype.sequentialRead = function (sequentialRead) {
  this.options.sequentialRead = isBoolean(sequentialRead) ? sequentialRead : true;
  return this;
};

// Deprecated output options
Sharp.prototype.quality = util.deprecate(function (quality) {
  const formatOut = this.options.formatOut;
  const options = { quality: quality };
  this.jpeg(options).webp(options).tiff(options);
  this.options.formatOut = formatOut;
  return this;
}, 'quality: use jpeg({ quality: ... }), webp({ quality: ... }) and/or tiff({ quality: ... }) instead');
Sharp.prototype.progressive = util.deprecate(function (progressive) {
  const formatOut = this.options.formatOut;
  const options = { progressive: (progressive !== false) };
  this.jpeg(options).png(options);
  this.options.formatOut = formatOut;
  return this;
}, 'progressive: use jpeg({ progressive: ... }) and/or png({ progressive: ... }) instead');
Sharp.prototype.compressionLevel = util.deprecate(function (compressionLevel) {
  const formatOut = this.options.formatOut;
  this.png({ compressionLevel: compressionLevel });
  this.options.formatOut = formatOut;
  return this;
}, 'compressionLevel: use png({ compressionLevel: ... }) instead');
Sharp.prototype.withoutAdaptiveFiltering = util.deprecate(function (withoutAdaptiveFiltering) {
  const formatOut = this.options.formatOut;
  this.png({ adaptiveFiltering: (withoutAdaptiveFiltering === false) });
  this.options.formatOut = formatOut;
  return this;
}, 'withoutAdaptiveFiltering: use png({ adaptiveFiltering: ... }) instead');
Sharp.prototype.withoutChromaSubsampling = util.deprecate(function (withoutChromaSubsampling) {
  const formatOut = this.options.formatOut;
  this.jpeg({ chromaSubsampling: (withoutChromaSubsampling === false) ? '4:2:0' : '4:4:4' });
  this.options.formatOut = formatOut;
  return this;
}, 'withoutChromaSubsampling: use jpeg({ chromaSubsampling: "4:4:4" }) instead');
Sharp.prototype.trellisQuantisation = util.deprecate(function (trellisQuantisation) {
  const formatOut = this.options.formatOut;
  this.jpeg({ trellisQuantisation: (trellisQuantisation !== false) });
  this.options.formatOut = formatOut;
  return this;
}, 'trellisQuantisation: use jpeg({ trellisQuantisation: ... }) instead');
Sharp.prototype.trellisQuantization = Sharp.prototype.trellisQuantisation;
Sharp.prototype.overshootDeringing = util.deprecate(function (overshootDeringing) {
  const formatOut = this.options.formatOut;
  this.jpeg({ overshootDeringing: (overshootDeringing !== false) });
  this.options.formatOut = formatOut;
  return this;
}, 'overshootDeringing: use jpeg({ overshootDeringing: ... }) instead');
Sharp.prototype.optimiseScans = util.deprecate(function (optimiseScans) {
  const formatOut = this.options.formatOut;
  this.jpeg({ optimiseScans: (optimiseScans !== false) });
  this.options.formatOut = formatOut;
  return this;
}, 'optimiseScans: use jpeg({ optimiseScans: ... }) instead');
Sharp.prototype.optimizeScans = Sharp.prototype.optimiseScans;

/*
  Include all metadata (EXIF, XMP, IPTC) from the input image in the output image
  Optionally provide an Object with attributes to update:
    orientation: numeric value for EXIF Orientation tag
*/
Sharp.prototype.withMetadata = function (withMetadata) {
  this.options.withMetadata = isBoolean(withMetadata) ? withMetadata : true;
  if (isObject(withMetadata)) {
    if (isDefined(withMetadata.orientation)) {
      if (isInteger(withMetadata.orientation) && inRange(withMetadata.orientation, 1, 8)) {
        this.options.withMetadataOrientation = withMetadata.orientation;
      } else {
        throw new Error('Invalid orientation (1 to 8) ' + withMetadata.orientation);
      }
    }
  }
  return this;
};

/*
  Tile-based deep zoom output options: size, overlap, layout
*/
Sharp.prototype.tile = function (tile) {
  if (isObject(tile)) {
    // Size of square tiles, in pixels
    if (isDefined(tile.size)) {
      if (isInteger(tile.size) && inRange(tile.size, 1, 8192)) {
        this.options.tileSize = tile.size;
      } else {
        throw new Error('Invalid tile size (1 to 8192) ' + tile.size);
      }
    }
    // Overlap of tiles, in pixels
    if (isDefined(tile.overlap)) {
      if (isInteger(tile.overlap) && inRange(tile.overlap, 0, 8192)) {
        if (tile.overlap > this.options.tileSize) {
          throw new Error('Tile overlap ' + tile.overlap + ' cannot be larger than tile size ' + this.options.tileSize);
        }
        this.options.tileOverlap = tile.overlap;
      } else {
        throw new Error('Invalid tile overlap (0 to 8192) ' + tile.overlap);
      }
    }
    // Container
    if (isDefined(tile.container)) {
      if (isString(tile.container) && contains(tile.container, ['fs', 'zip'])) {
        this.options.tileContainer = tile.container;
      } else {
        throw new Error('Invalid tile container ' + tile.container);
      }
    }
    // Layout
    if (isDefined(tile.layout)) {
      if (isString(tile.layout) && contains(tile.layout, ['dz', 'google', 'zoomify'])) {
        this.options.tileLayout = tile.layout;
      } else {
        throw new Error('Invalid tile layout ' + tile.layout);
      }
    }
  }
  return this;
};

/*
  Extend edges
*/
Sharp.prototype.extend = function (extend) {
  if (isInteger(extend) && extend > 0) {
    this.options.extendTop = extend;
    this.options.extendBottom = extend;
    this.options.extendLeft = extend;
    this.options.extendRight = extend;
  } else if (
    isObject(extend) &&
    isInteger(extend.top) && extend.top >= 0 &&
    isInteger(extend.bottom) && extend.bottom >= 0 &&
    isInteger(extend.left) && extend.left >= 0 &&
    isInteger(extend.right) && extend.right >= 0
  ) {
    this.options.extendTop = extend.top;
    this.options.extendBottom = extend.bottom;
    this.options.extendLeft = extend.left;
    this.options.extendRight = extend.right;
  } else {
    throw new Error('Invalid edge extension ' + extend);
  }
  return this;
};

// Kernels for reduction
module.exports.kernel = {
  cubic: 'cubic',
  lanczos2: 'lanczos2',
  lanczos3: 'lanczos3'
};
// Interpolators for enlargement
module.exports.interpolator = {
  nearest: 'nearest',
  bilinear: 'bilinear',
  bicubic: 'bicubic',
  nohalo: 'nohalo',
  lbb: 'lbb',
  locallyBoundedBicubic: 'lbb',
  vsqbs: 'vsqbs',
  vertexSplitQuadraticBasisSpline: 'vsqbs'
};
// Boolean operations for bandbool
module.exports.bool = {
  and: 'and',
  or: 'or',
  eor: 'eor'
};
// Colourspaces
module.exports.colourspace = {
  multiband: 'multiband',
  'b-w': 'b-w',
  bw: 'b-w',
  cmyk: 'cmyk',
  srgb: 'srgb'
};
module.exports.colorspace = module.exports.colourspace;

/*
  Resize image to width x height pixels
  options.kernel is the kernel to use for reductions, default 'lanczos3'
  options.interpolator is the interpolator to use for enlargements, default 'bicubic'
*/
Sharp.prototype.resize = function (width, height, options) {
  if (isDefined(width)) {
    if (isInteger(width) && inRange(width, 1, maximum.width)) {
      this.options.width = width;
    } else {
      throw new Error('Invalid width (1 to ' + maximum.width + ') ' + width);
    }
  } else {
    this.options.width = -1;
  }
  if (isDefined(height)) {
    if (isInteger(height) && inRange(height, 1, maximum.height)) {
      this.options.height = height;
    } else {
      throw new Error('Invalid height (1 to ' + maximum.height + ') ' + height);
    }
  } else {
    this.options.height = -1;
  }
  if (isObject(options)) {
    // Kernel
    if (isDefined(options.kernel)) {
      if (isString(module.exports.kernel[options.kernel])) {
        this.options.kernel = module.exports.kernel[options.kernel];
      } else {
        throw new Error('Invalid kernel ' + options.kernel);
      }
    }
    // Interpolator
    if (isDefined(options.interpolator)) {
      if (isString(module.exports.interpolator[options.interpolator])) {
        this.options.interpolator = module.exports.interpolator[options.interpolator];
      } else {
        throw new Error('Invalid interpolator ' + options.interpolator);
      }
    }
  }
  return this;
};

/*
  Limit the total number of pixels for input images
  Assumes the image dimensions contained in the file header can be trusted.
  Alternatively can use boolean to disable or reset to default (maximum pixels)
*/
Sharp.prototype.limitInputPixels = function (limit) {
  // if we pass in false we represent the integer as 0 to disable
  if (limit === false) {
    limit = 0;
  } else if (limit === true) {
    limit = maximum.pixels;
  }
  if (typeof limit === 'number' && !Number.isNaN(limit) && limit % 1 === 0 && limit >= 0) {
    this.options.limitInputPixels = limit;
  } else {
    throw new Error('Invalid pixel limit (1 to ' + maximum.pixels + ') ' + limit);
  }
  return this;
};

/**
 * Write output image data to a file
 * @throws {Error} if an attempt has been made to force Buffer/Stream output type
 */
Sharp.prototype.toFile = function (fileOut, callback) {
  if (!fileOut || fileOut.length === 0) {
    const errOutputInvalid = new Error('Invalid output');
    if (isFunction(callback)) {
      callback(errOutputInvalid);
    } else {
      return Promise.reject(errOutputInvalid);
    }
  } else {
    if (this.options.input.file === fileOut) {
      const errOutputIsInput = new Error('Cannot use same file for input and output');
      if (isFunction(callback)) {
        callback(errOutputIsInput);
      } else {
        return Promise.reject(errOutputIsInput);
      }
    } else {
      this.options.fileOut = fileOut;
      return this._pipeline(callback);
    }
  }
  return this;
};

/**
 * Write output to a Buffer.
 * @param {Function} [callback]
 * @returns {Promise} when no callback is provided
 */
Sharp.prototype.toBuffer = function (callback) {
  return this._pipeline(callback);
};

/**
 * Update the output format unless options.force is false,
 * in which case revert to input format.
 * @private
 * @param {String} formatOut
 * @param {Object} [options]
 * @param {Boolean} [options.force=true] - force output format, otherwise attempt to use input format
 * @returns {Object} this
 */
Sharp.prototype._updateFormatOut = function (formatOut, options) {
  this.options.formatOut = (isObject(options) && options.force === false) ? 'input' : formatOut;
  return this;
};

/**
 * Update a Boolean attribute of the this.options Object.
 * @private
 * @param {String} key
 * @param {Boolean} val
 * @returns {void}
 */
Sharp.prototype._setBooleanOption = function (key, val) {
  if (isBoolean(val)) {
    this.options[key] = val;
  } else {
    throw new Error('Invalid ' + key + ' (boolean) ' + val);
  }
};

/**
 * Use these JPEG options for output image.
 * @param {Object} [options] - output options
 * @param {Number} [options.quality=80] - quality, integer 1-100
 * @param {Boolean} [options.progressive=false] - use progressive (interlace) scan
 * @param {String} [options.chromaSubsampling='4:2:0'] - set to '4:4:4' to prevent chroma subsampling when quality <= 90
 * @param {Boolean} [trellisQuantisation=false] - apply trellis quantisation, requires mozjpeg
 * @param {Boolean} [overshootDeringing=false] - apply overshoot deringing, requires mozjpeg
 * @param {Boolean} [optimiseScans=false] - optimise progressive scans, assumes progressive=true, requires mozjpeg
 * @param {Boolean} [options.force=true] - force JPEG output, otherwise attempt to use input format
 * @returns {Object} this
 * @throws {Error} Invalid options
 */
Sharp.prototype.jpeg = function (options) {
  if (isObject(options)) {
    if (isDefined(options.quality)) {
      if (isInteger(options.quality) && inRange(options.quality, 1, 100)) {
        this.options.jpegQuality = options.quality;
      } else {
        throw new Error('Invalid quality (integer, 1-100) ' + options.quality);
      }
    }
    if (isDefined(options.progressive)) {
      this._setBooleanOption('jpegProgressive', options.progressive);
    }
    if (isDefined(options.chromaSubsampling)) {
      if (isString(options.chromaSubsampling) && contains(options.chromaSubsampling, ['4:2:0', '4:4:4'])) {
        this.options.jpegChromaSubsampling = options.chromaSubsampling;
      } else {
        throw new Error('Invalid chromaSubsampling (4:2:0, 4:4:4) ' + options.chromaSubsampling);
      }
    }
    options.trellisQuantisation = options.trellisQuantisation || options.trellisQuantization;
    if (isDefined(options.trellisQuantisation)) {
      this._setBooleanOption('jpegTrellisQuantisation', options.trellisQuantisation);
    }
    if (isDefined(options.overshootDeringing)) {
      this._setBooleanOption('jpegOvershootDeringing', options.overshootDeringing);
    }
    options.optimiseScans = options.optimiseScans || options.optimizeScans;
    if (isDefined(options.optimiseScans)) {
      this._setBooleanOption('jpegOptimiseScans', options.optimiseScans);
      if (options.optimiseScans) {
        this.options.jpegProgressive = true;
      }
    }
  }
  return this._updateFormatOut('jpeg', options);
};

/**
 * Use these PNG options for output image.
 * @param {Object} [options]
 * @param {Boolean} [options.progressive=false] - use progressive (interlace) scan
 * @param {Number} [options.compressionLevel=6] - zlib compression level
 * @param {Boolean} [options.adaptiveFiltering=true] - use adaptive row filtering
 * @param {Boolean} [options.force=true] - force PNG output, otherwise attempt to use input format
 * @returns {Object} this
 * @throws {Error} Invalid options
 */
Sharp.prototype.png = function (options) {
  if (isObject(options)) {
    if (isDefined(options.progressive)) {
      this._setBooleanOption('pngProgressive', options.progressive);
    }
    if (isDefined(options.compressionLevel)) {
      if (isInteger(options.compressionLevel) && inRange(options.compressionLevel, 0, 9)) {
        this.options.pngCompressionLevel = options.compressionLevel;
      } else {
        throw new Error('Invalid compressionLevel (integer, 0-9) ' + options.compressionLevel);
      }
    }
    if (isDefined(options.adaptiveFiltering)) {
      this._setBooleanOption('pngAdaptiveFiltering', options.adaptiveFiltering);
    }
  }
  return this._updateFormatOut('png', options);
};

/**
 * Use these WebP options for output image.
 * @param {Object} [options] - output options
 * @param {Number} [options.quality=80] - quality, integer 1-100
 * @param {Boolean} [options.force=true] - force WebP output, otherwise attempt to use input format
 * @returns {Object} this
 * @throws {Error} Invalid options
 */
Sharp.prototype.webp = function (options) {
  if (isObject(options)) {
    if (isDefined(options.quality)) {
      if (isInteger(options.quality) && inRange(options.quality, 1, 100)) {
        this.options.webpQuality = options.quality;
      } else {
        throw new Error('Invalid quality (integer, 1-100) ' + options.quality);
      }
    }
  }
  return this._updateFormatOut('webp', options);
};

/**
 * Use these TIFF options for output image.
 * @param {Object} [options] - output options
 * @param {Number} [options.quality=80] - quality, integer 1-100
 * @param {Boolean} [options.force=true] - force TIFF output, otherwise attempt to use input format
 * @returns {Object} this
 * @throws {Error} Invalid options
 */
Sharp.prototype.tiff = function (options) {
  if (isObject(options)) {
    if (isDefined(options.quality)) {
      if (isInteger(options.quality) && inRange(options.quality, 1, 100)) {
        this.options.tiffQuality = options.quality;
      } else {
        throw new Error('Invalid quality (integer, 1-100) ' + options.quality);
      }
    }
  }
  return this._updateFormatOut('tiff', options);
};

/**
 * Force output to be raw, uncompressed uint8 pixel data.
 * @returns {Object} this
 */
Sharp.prototype.raw = function () {
  return this._updateFormatOut('raw');
};

/**
 * Force output to a given format.
 * @param {String|Object} format - as a String or an Object with an 'id' attribute
 * @param {Object} options - output options
 * @returns {Object} this
 * @throws {Error} unsupported format or options
 */
Sharp.prototype.toFormat = function (format, options) {
  if (isObject(format) && isString(format.id)) {
    format = format.id;
  }
  if (!contains(format, ['jpeg', 'png', 'webp', 'tiff', 'raw'])) {
    throw new Error('Unsupported output format ' + format);
  }
  return this[format](options);
};

/*
  Used by a Writable Stream to notify that it is ready for data
*/
Sharp.prototype._read = function () {
  if (!this.options.streamOut) {
    this.options.streamOut = true;
    this._pipeline();
  }
};

/*
  Invoke the C++ image processing pipeline
  Supports callback, stream and promise variants
*/
Sharp.prototype._pipeline = function (callback) {
  const that = this;
  if (typeof callback === 'function') {
    // output=file/buffer
    if (this._isStreamInput()) {
      // output=file/buffer, input=stream
      this.on('finish', function () {
        that._flattenBufferIn();
        sharp.pipeline(that.options, callback);
      });
    } else {
      // output=file/buffer, input=file/buffer
      sharp.pipeline(this.options, callback);
    }
    return this;
  } else if (this.options.streamOut) {
    // output=stream
    if (this._isStreamInput()) {
      // output=stream, input=stream
      this.on('finish', function () {
        that._flattenBufferIn();
        sharp.pipeline(that.options, function (err, data, info) {
          if (err) {
            that.emit('error', err);
          } else {
            that.emit('info', info);
            that.push(data);
          }
          that.push(null);
        });
      });
    } else {
      // output=stream, input=file/buffer
      sharp.pipeline(this.options, function (err, data, info) {
        if (err) {
          that.emit('error', err);
        } else {
          that.emit('info', info);
          that.push(data);
        }
        that.push(null);
      });
    }
    return this;
  } else {
    // output=promise
    if (this._isStreamInput()) {
      // output=promise, input=stream
      return new Promise(function (resolve, reject) {
        that.on('finish', function () {
          that._flattenBufferIn();
          sharp.pipeline(that.options, function (err, data) {
            if (err) {
              reject(err);
            } else {
              resolve(data);
            }
          });
        });
      });
    } else {
      // output=promise, input=file/buffer
      return new Promise(function (resolve, reject) {
        sharp.pipeline(that.options, function (err, data) {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
      });
    }
  }
};

/*
  Reads the image header and returns metadata
  Supports callback, stream and promise variants
*/
Sharp.prototype.metadata = function (callback) {
  const that = this;
  if (typeof callback === 'function') {
    if (this._isStreamInput()) {
      this.on('finish', function () {
        that._flattenBufferIn();
        sharp.metadata(that.options, callback);
      });
    } else {
      sharp.metadata(this.options, callback);
    }
    return this;
  } else {
    if (this._isStreamInput()) {
      return new Promise(function (resolve, reject) {
        that.on('finish', function () {
          that._flattenBufferIn();
          sharp.metadata(that.options, function (err, metadata) {
            if (err) {
              reject(err);
            } else {
              resolve(metadata);
            }
          });
        });
      });
    } else {
      return new Promise(function (resolve, reject) {
        sharp.metadata(that.options, function (err, metadata) {
          if (err) {
            reject(err);
          } else {
            resolve(metadata);
          }
        });
      });
    }
  }
};

/*
  Clone new instance using existing options.
  Cloned instances share the same input.
*/
Sharp.prototype.clone = function () {
  const that = this;
  // Clone existing options
  const clone = new Sharp();
  util._extend(clone.options, this.options);
  // Pass 'finish' event to clone for Stream-based input
  this.on('finish', function () {
    // Clone inherits input data
    that._flattenBufferIn();
    clone.options.bufferIn = that.options.bufferIn;
    clone.emit('finish');
  });
  return clone;
};

/**
  Get and set cache memory, file and item limits
*/
module.exports.cache = function (options) {
  if (isBoolean(options)) {
    if (options) {
      // Default cache settings of 50MB, 20 files, 100 items
      return sharp.cache(50, 20, 100);
    } else {
      return sharp.cache(0, 0, 0);
    }
  } else if (isObject(options)) {
    return sharp.cache(options.memory, options.files, options.items);
  } else {
    return sharp.cache();
  }
};
// Ensure default cache settings are set
module.exports.cache(true);

/*
  Get and set size of thread pool
*/
module.exports.concurrency = function (concurrency) {
  return sharp.concurrency(isInteger(concurrency) ? concurrency : null);
};

/*
  Get internal counters
*/
module.exports.counters = function () {
  return sharp.counters();
};

/*
  Get and set use of SIMD vector unit instructions
*/
module.exports.simd = function (simd) {
  return sharp.simd(isBoolean(simd) ? simd : null);
};
// Switch off default
module.exports.simd(false);
