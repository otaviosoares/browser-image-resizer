import ExifReader from 'exifreader';

const DEFAULT_CONFIG = {
  quality: 0.5,
  maxWidth: 800,
  maxHeight: 600,
  autoRotate: true,
  debug: false,
  mimeType: 'image/jpeg'
};

const _browser_quirks = {};

function dataURItoBuffer(dataURI) {
  var byteString = atob(dataURI.split(',')[1]);
  var ab = new ArrayBuffer(byteString.length);
  var ia = new Uint8Array(ab);
  for (var i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return ab;
}

export function readAndCompressImage(file, userConfig) {
  return new Promise(resolve => {
    var img = document.createElement('img');
    var reader = new FileReader();
    var config = Object.assign({}, DEFAULT_CONFIG, userConfig);

    reader.onload = function (e) {
      img.src = e.target.result;
      img.onload = async function () {
        if (config.autoRotate) {
          if (config.debug)
            console.log(
              'browser-image-resizer: detecting image orientation...'
            );
          var buffer = dataURItoBuffer(img.src);
          let Orientation = {};
          try {
            const Result = ExifReader.load(buffer);
            Orientation = Result.Orientation || {};
          } catch (err) {}
          if (config.debug) {
            console.log(
              'browser-image-resizer: image orientation from EXIF tag = ' +
                Orientation
            );
          }
          resolve(
            scaleImage(
              img,
              config,
              await dropOrientationIfNeeded(Orientation.value)
            )
          );
        }
      };
    };

    reader.readAsDataURL(file);
  });
}

function scaleImage(img, config, orientation = 1) {
  var canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  var ctx = canvas.getContext('2d');
  ctx.save();

  // EXIF
  exifApplied(canvas, ctx, orientation, img);

  let maxWidth = findMaxWidth(config, canvas);

  while (canvas.width >= 2 * maxWidth) {
    canvas = getHalfScaleCanvas(canvas);
  }

  if (canvas.width > maxWidth) {
    canvas = scaleCanvasWithAlgorithm(
      canvas,
      Object.assign(config, { outputWidth: maxWidth })
    );
  }

  let imageData = canvas.toDataURL(config.mimeType, config.quality);
  if (typeof config.onScale === 'function') config.onScale(imageData);
  return dataURIToBlob(imageData);
}

function findMaxWidth(config, canvas) {
  //Let's find the max available width for scaled image
  var ratio = canvas.width / canvas.height;
  var mWidth = Math.min(
    canvas.width,
    config.maxWidth,
    ratio * config.maxHeight
  );
  if (
    config.maxSize > 0 &&
    config.maxSize < (canvas.width * canvas.height) / 1000
  )
    mWidth = Math.min(
      mWidth,
      Math.floor((config.maxSize * 1000) / canvas.height)
    );
  if (!!config.scaleRatio)
    mWidth = Math.min(mWidth, Math.floor(config.scaleRatio * canvas.width));

  if (config.debug) {
    console.log(
      'browser-image-resizer: original image size = ' +
        canvas.width +
        ' px (width) X ' +
        canvas.height +
        ' px (height)'
    );
    console.log(
      'browser-image-resizer: scaled image size = ' +
        mWidth +
        ' px (width) X ' +
        Math.floor(mWidth / ratio) +
        ' px (height)'
    );
  }
  if (mWidth <= 0) {
    mWidth = 1;
    console.warning('browser-image-resizer: image size is too small');
  }

  return mWidth;
}

function exifApplied(canvas, ctx, orientation, img) {
  var width = canvas.width;
  var styleWidth = canvas.style.width;
  var height = canvas.height;
  var styleHeight = canvas.style.height;
  if (orientation > 4) {
    canvas.width = height;
    canvas.style.width = styleHeight;
    canvas.height = width;
    canvas.style.height = styleWidth;
  }
  switch (orientation) {
    case 2:
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4:
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5:
      ctx.rotate(0.5 * Math.PI);
      ctx.scale(1, -1);
      break;
    case 6:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(0, -height);
      break;
    case 7:
      ctx.rotate(0.5 * Math.PI);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8:
      ctx.rotate(-0.5 * Math.PI);
      ctx.translate(-width, 0);
      break;
  }
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function dataURIToBlob(dataURI) {
  // convert base64 to raw binary data held in a string
  // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
  var byteString = atob(dataURI.split(',')[1]);

  // separate out the mime component
  var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];

  // write the bytes of the string to an ArrayBuffer
  var ab = new ArrayBuffer(byteString.length);

  // create a view into the buffer
  var ia = new Uint8Array(ab);

  // set the bytes of the buffer to the correct values
  for (var i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  // write the ArrayBuffer to a blob, and you're done
  var blob = new Blob([ab], { type: mimeString });
  return blob;
}

function scaleCanvasWithAlgorithm(canvas, config) {
  var scaledCanvas = document.createElement('canvas');

  var scale = config.outputWidth / canvas.width;

  scaledCanvas.width = canvas.width * scale;
  scaledCanvas.height = canvas.height * scale;

  var srcImgData = canvas
    .getContext('2d')
    .getImageData(0, 0, canvas.width, canvas.height);
  var destImgData = scaledCanvas
    .getContext('2d')
    .createImageData(scaledCanvas.width, scaledCanvas.height);

  applyBilinearInterpolation(srcImgData, destImgData, scale);

  scaledCanvas.getContext('2d').putImageData(destImgData, 0, 0);

  return scaledCanvas;
}

function getHalfScaleCanvas(canvas) {
  var halfCanvas = document.createElement('canvas');
  halfCanvas.width = canvas.width / 2;
  halfCanvas.height = canvas.height / 2;

  halfCanvas
    .getContext('2d')
    .drawImage(canvas, 0, 0, halfCanvas.width, halfCanvas.height);

  return halfCanvas;
}

function applyBilinearInterpolation(srcCanvasData, destCanvasData, scale) {
  function inner(f00, f10, f01, f11, x, y) {
    var un_x = 1.0 - x;
    var un_y = 1.0 - y;
    return f00 * un_x * un_y + f10 * x * un_y + f01 * un_x * y + f11 * x * y;
  }
  var i, j;
  var iyv, iy0, iy1, ixv, ix0, ix1;
  var idxD, idxS00, idxS10, idxS01, idxS11;
  var dx, dy;
  var r, g, b, a;
  for (i = 0; i < destCanvasData.height; ++i) {
    iyv = i / scale;
    iy0 = Math.floor(iyv);
    // Math.ceil can go over bounds
    iy1 =
      Math.ceil(iyv) > srcCanvasData.height - 1
        ? srcCanvasData.height - 1
        : Math.ceil(iyv);
    for (j = 0; j < destCanvasData.width; ++j) {
      ixv = j / scale;
      ix0 = Math.floor(ixv);
      // Math.ceil can go over bounds
      ix1 =
        Math.ceil(ixv) > srcCanvasData.width - 1
          ? srcCanvasData.width - 1
          : Math.ceil(ixv);
      idxD = (j + destCanvasData.width * i) * 4;
      // matrix to vector indices
      idxS00 = (ix0 + srcCanvasData.width * iy0) * 4;
      idxS10 = (ix1 + srcCanvasData.width * iy0) * 4;
      idxS01 = (ix0 + srcCanvasData.width * iy1) * 4;
      idxS11 = (ix1 + srcCanvasData.width * iy1) * 4;
      // overall coordinates to unit square
      dx = ixv - ix0;
      dy = iyv - iy0;
      // I let the r, g, b, a on purpose for debugging
      r = inner(
        srcCanvasData.data[idxS00],
        srcCanvasData.data[idxS10],
        srcCanvasData.data[idxS01],
        srcCanvasData.data[idxS11],
        dx,
        dy
      );
      destCanvasData.data[idxD] = r;

      g = inner(
        srcCanvasData.data[idxS00 + 1],
        srcCanvasData.data[idxS10 + 1],
        srcCanvasData.data[idxS01 + 1],
        srcCanvasData.data[idxS11 + 1],
        dx,
        dy
      );
      destCanvasData.data[idxD + 1] = g;

      b = inner(
        srcCanvasData.data[idxS00 + 2],
        srcCanvasData.data[idxS10 + 2],
        srcCanvasData.data[idxS01 + 2],
        srcCanvasData.data[idxS11 + 2],
        dx,
        dy
      );
      destCanvasData.data[idxD + 2] = b;

      a = inner(
        srcCanvasData.data[idxS00 + 3],
        srcCanvasData.data[idxS10 + 3],
        srcCanvasData.data[idxS01 + 3],
        srcCanvasData.data[idxS11 + 3],
        dx,
        dy
      );
      destCanvasData.data[idxD + 3] = a;
    }
  }
}

// Some browsers will automatically draw images respecting their EXIF orientation
// while others won't, and the safest way to detect that is to examine how it
// is done on a known image.
// See https://github.com/w3c/csswg-drafts/issues/4666
// and https://github.com/blueimp/JavaScript-Load-Image/commit/1e4df707821a0afcc11ea0720ee403b8759f3881
const dropOrientationIfNeeded = orientation =>
  new Promise(resolve => {
    switch (_browser_quirks['image-orientation-automatic']) {
      case true:
        resolve(1);
        break;
      case false:
        resolve(orientation);
        break;
      default:
        // black 2x1 JPEG, with the following meta information set:
        // - EXIF Orientation: 6 (Rotated 90° CCW)
        const testImageURL =
          'data:image/jpeg;base64,/9j/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAA' +
          'AAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBA' +
          'QEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE' +
          'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAgMBEQACEQEDEQH/x' +
          'ABKAAEAAAAAAAAAAAAAAAAAAAALEAEAAAAAAAAAAAAAAAAAAAAAAQEAAAAAAAAAAAAAAAA' +
          'AAAAAEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8H//2Q==';
        const img = new Image();
        img.onload = () => {
          const automatic = img.width === 1 && img.height === 2;
          _browser_quirks['image-orientation-automatic'] = automatic;
          resolve(automatic ? 1 : orientation);
        };
        img.onerror = () => {
          _browser_quirks['image-orientation-automatic'] = false;
          resolve(orientation);
        };
        img.src = testImageURL;
    }
  });
