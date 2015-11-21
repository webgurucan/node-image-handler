'use strict';

var assert = require('assert');

var sharp = require('../../index');
var fixtures = require('../fixtures');

sharp.cache(0);

describe('Sharpen', function() {

  it('specific radius 10', function(done) {
    sharp(fixtures.inputJpg)
      .resize(320, 240)
      .sharpen(10)
      .toBuffer(function(err, data, info) {
        assert.strictEqual('jpeg', info.format);
        assert.strictEqual(320, info.width);
        assert.strictEqual(240, info.height);
        fixtures.assertSimilar(fixtures.expected('sharpen-10.jpg'), data, done);
      });
  });

  it('specific radius 3 and levels 0.5, 2.5', function(done) {
    sharp(fixtures.inputJpg)
      .resize(320, 240)
      .sharpen(3, 0.5, 2.5)
      .toBuffer(function(err, data, info) {
        assert.strictEqual('jpeg', info.format);
        assert.strictEqual(320, info.width);
        assert.strictEqual(240, info.height);
        fixtures.assertSimilar(fixtures.expected('sharpen-3-0.5-2.5.jpg'), data, done);
      });
  });

  it('specific radius 5 and levels 2, 4', function(done) {
    sharp(fixtures.inputJpg)
      .resize(320, 240)
      .sharpen(5, 2, 4)
      .toBuffer(function(err, data, info) {
        assert.strictEqual('jpeg', info.format);
        assert.strictEqual(320, info.width);
        assert.strictEqual(240, info.height);
        fixtures.assertSimilar(fixtures.expected('sharpen-5-2-4.jpg'), data, done);
      });
  });

  it('mild sharpen', function(done) {
    sharp(fixtures.inputJpg)
      .resize(320, 240)
      .sharpen()
      .toBuffer(function(err, data, info) {
        assert.strictEqual('jpeg', info.format);
        assert.strictEqual(320, info.width);
        assert.strictEqual(240, info.height);
        fixtures.assertSimilar(fixtures.expected('sharpen-mild.jpg'), data, done);
      });
  });

  it('invalid radius', function() {
    assert.throws(function() {
      sharp(fixtures.inputJpg).sharpen(1.5);
    });
  });

  it('invalid flat', function() {
    assert.throws(function() {
      sharp(fixtures.inputJpg).sharpen(1, -1);
    });
  });

  it('invalid jagged', function() {
    assert.throws(function() {
      sharp(fixtures.inputJpg).sharpen(1, 1, -1);
    });
  });

  it('sharpened image is larger than non-sharpened', function(done) {
    sharp(fixtures.inputJpg)
      .resize(320, 240)
      .sharpen(false)
      .toBuffer(function(err, notSharpened, info) {
        assert.strictEqual(true, notSharpened.length > 0);
        assert.strictEqual('jpeg', info.format);
        assert.strictEqual(320, info.width);
        assert.strictEqual(240, info.height);
        sharp(fixtures.inputJpg)
          .resize(320, 240)
          .sharpen(true)
          .toBuffer(function(err, sharpened, info) {
            assert.strictEqual(true, sharpened.length > 0);
            assert.strictEqual(true, sharpened.length > notSharpened.length);
            assert.strictEqual('jpeg', info.format);
            assert.strictEqual(320, info.width);
            assert.strictEqual(240, info.height);
            done();
          });
      });
  });

});
