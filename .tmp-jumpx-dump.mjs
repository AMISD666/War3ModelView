var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/gl-matrix/cjs/common.js
var require_common = __commonJS({
  "node_modules/gl-matrix/cjs/common.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.RANDOM = exports.EPSILON = exports.ARRAY_TYPE = exports.ANGLE_ORDER = void 0;
    exports.equals = equals;
    exports.round = round;
    exports.setMatrixArrayType = setMatrixArrayType;
    exports.toDegree = toDegree;
    exports.toRadian = toRadian;
    var EPSILON = exports.EPSILON = 1e-6;
    var ARRAY_TYPE = exports.ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
    var RANDOM = exports.RANDOM = Math.random;
    var ANGLE_ORDER = exports.ANGLE_ORDER = "zyx";
    function round(a) {
      if (a >= 0) return Math.round(a);
      return a % 0.5 === 0 ? Math.floor(a) : Math.round(a);
    }
    function setMatrixArrayType(type) {
      exports.ARRAY_TYPE = ARRAY_TYPE = type;
    }
    var degree = Math.PI / 180;
    var radian = 180 / Math.PI;
    function toRadian(a) {
      return a * degree;
    }
    function toDegree(a) {
      return a * radian;
    }
    function equals(a, b) {
      var tolerance = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : EPSILON;
      return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
    }
  }
});

// node_modules/gl-matrix/cjs/mat2.js
var require_mat2 = __commonJS({
  "node_modules/gl-matrix/cjs/mat2.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.LDU = LDU;
    exports.add = add;
    exports.adjoint = adjoint;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.determinant = determinant;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.frob = frob;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.fromValues = fromValues;
    exports.identity = identity;
    exports.invert = invert;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.set = set;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.transpose = transpose;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
      }
      out[0] = 1;
      out[3] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    function fromValues(m00, m01, m10, m11) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = m00;
      out[1] = m01;
      out[2] = m10;
      out[3] = m11;
      return out;
    }
    function set(out, m00, m01, m10, m11) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m10;
      out[3] = m11;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a1 = a[1];
        out[1] = a[2];
        out[2] = a1;
      } else {
        out[0] = a[0];
        out[1] = a[2];
        out[2] = a[1];
        out[3] = a[3];
      }
      return out;
    }
    function invert(out, a) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var det = a0 * a3 - a2 * a1;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = a3 * det;
      out[1] = -a1 * det;
      out[2] = -a2 * det;
      out[3] = a0 * det;
      return out;
    }
    function adjoint(out, a) {
      var a0 = a[0];
      out[0] = a[3];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a0;
      return out;
    }
    function determinant(a) {
      return a[0] * a[3] - a[2] * a[1];
    }
    function multiply(out, a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      return out;
    }
    function rotate(out, a, rad) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      return out;
    }
    function scale(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var v0 = v[0], v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = -s;
      out[3] = c;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = v[1];
      return out;
    }
    function str(a) {
      return "mat2(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    function frob(a) {
      return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3]);
    }
    function LDU(L, D, U, a) {
      L[2] = a[2] / a[0];
      U[0] = a[0];
      U[1] = a[1];
      U[3] = a[3] - L[2] * U[1];
      return [L, D, U];
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3));
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      return out;
    }
    var mul = exports.mul = multiply;
    var sub = exports.sub = subtract;
  }
});

// node_modules/gl-matrix/cjs/mat2d.js
var require_mat2d = __commonJS({
  "node_modules/gl-matrix/cjs/mat2d.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.determinant = determinant;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.frob = frob;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.fromTranslation = fromTranslation;
    exports.fromValues = fromValues;
    exports.identity = identity;
    exports.invert = invert;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.set = set;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.translate = translate;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(6);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[4] = 0;
        out[5] = 0;
      }
      out[0] = 1;
      out[3] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(6);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromValues(a, b, c, d, tx, ty) {
      var out = new glMatrix.ARRAY_TYPE(6);
      out[0] = a;
      out[1] = b;
      out[2] = c;
      out[3] = d;
      out[4] = tx;
      out[5] = ty;
      return out;
    }
    function set(out, a, b, c, d, tx, ty) {
      out[0] = a;
      out[1] = b;
      out[2] = c;
      out[3] = d;
      out[4] = tx;
      out[5] = ty;
      return out;
    }
    function invert(out, a) {
      var aa = a[0], ab = a[1], ac = a[2], ad = a[3];
      var atx = a[4], aty = a[5];
      var det = aa * ad - ab * ac;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = ad * det;
      out[1] = -ab * det;
      out[2] = -ac * det;
      out[3] = aa * det;
      out[4] = (ac * aty - ad * atx) * det;
      out[5] = (ab * atx - aa * aty) * det;
      return out;
    }
    function determinant(a) {
      return a[0] * a[3] - a[1] * a[2];
    }
    function multiply(out, a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
      out[0] = a0 * b0 + a2 * b1;
      out[1] = a1 * b0 + a3 * b1;
      out[2] = a0 * b2 + a2 * b3;
      out[3] = a1 * b2 + a3 * b3;
      out[4] = a0 * b4 + a2 * b5 + a4;
      out[5] = a1 * b4 + a3 * b5 + a5;
      return out;
    }
    function rotate(out, a, rad) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = a0 * c + a2 * s;
      out[1] = a1 * c + a3 * s;
      out[2] = a0 * -s + a2 * c;
      out[3] = a1 * -s + a3 * c;
      out[4] = a4;
      out[5] = a5;
      return out;
    }
    function scale(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var v0 = v[0], v1 = v[1];
      out[0] = a0 * v0;
      out[1] = a1 * v0;
      out[2] = a2 * v1;
      out[3] = a3 * v1;
      out[4] = a4;
      out[5] = a5;
      return out;
    }
    function translate(out, a, v) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var v0 = v[0], v1 = v[1];
      out[0] = a0;
      out[1] = a1;
      out[2] = a2;
      out[3] = a3;
      out[4] = a0 * v0 + a2 * v1 + a4;
      out[5] = a1 * v0 + a3 * v1 + a5;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = -s;
      out[3] = c;
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = v[1];
      out[4] = 0;
      out[5] = 0;
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = v[0];
      out[5] = v[1];
      return out;
    }
    function str(a) {
      return "mat2d(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ")";
    }
    function frob(a) {
      return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] + a[4] * a[4] + a[5] * a[5] + 1);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5));
    }
    var mul = exports.mul = multiply;
    var sub = exports.sub = subtract;
  }
});

// node_modules/gl-matrix/cjs/mat3.js
var require_mat3 = __commonJS({
  "node_modules/gl-matrix/cjs/mat3.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.adjoint = adjoint;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.determinant = determinant;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.frob = frob;
    exports.fromMat2d = fromMat2d;
    exports.fromMat4 = fromMat4;
    exports.fromQuat = fromQuat;
    exports.fromRotation = fromRotation;
    exports.fromScaling = fromScaling;
    exports.fromTranslation = fromTranslation;
    exports.fromValues = fromValues;
    exports.identity = identity;
    exports.invert = invert;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.normalFromMat4 = normalFromMat4;
    exports.projection = projection;
    exports.rotate = rotate;
    exports.scale = scale;
    exports.set = set;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.translate = translate;
    exports.transpose = transpose;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(9);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[5] = 0;
        out[6] = 0;
        out[7] = 0;
      }
      out[0] = 1;
      out[4] = 1;
      out[8] = 1;
      return out;
    }
    function fromMat4(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[4];
      out[4] = a[5];
      out[5] = a[6];
      out[6] = a[8];
      out[7] = a[9];
      out[8] = a[10];
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(9);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function fromValues(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
      var out = new glMatrix.ARRAY_TYPE(9);
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m10;
      out[4] = m11;
      out[5] = m12;
      out[6] = m20;
      out[7] = m21;
      out[8] = m22;
      return out;
    }
    function set(out, m00, m01, m02, m10, m11, m12, m20, m21, m22) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m10;
      out[4] = m11;
      out[5] = m12;
      out[6] = m20;
      out[7] = m21;
      out[8] = m22;
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a01 = a[1], a02 = a[2], a12 = a[5];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a01;
        out[5] = a[7];
        out[6] = a02;
        out[7] = a12;
      } else {
        out[0] = a[0];
        out[1] = a[3];
        out[2] = a[6];
        out[3] = a[1];
        out[4] = a[4];
        out[5] = a[7];
        out[6] = a[2];
        out[7] = a[5];
        out[8] = a[8];
      }
      return out;
    }
    function invert(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      var b01 = a22 * a11 - a12 * a21;
      var b11 = -a22 * a10 + a12 * a20;
      var b21 = a21 * a10 - a11 * a20;
      var det = a00 * b01 + a01 * b11 + a02 * b21;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = b01 * det;
      out[1] = (-a22 * a01 + a02 * a21) * det;
      out[2] = (a12 * a01 - a02 * a11) * det;
      out[3] = b11 * det;
      out[4] = (a22 * a00 - a02 * a20) * det;
      out[5] = (-a12 * a00 + a02 * a10) * det;
      out[6] = b21 * det;
      out[7] = (-a21 * a00 + a01 * a20) * det;
      out[8] = (a11 * a00 - a01 * a10) * det;
      return out;
    }
    function adjoint(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      out[0] = a11 * a22 - a12 * a21;
      out[1] = a02 * a21 - a01 * a22;
      out[2] = a01 * a12 - a02 * a11;
      out[3] = a12 * a20 - a10 * a22;
      out[4] = a00 * a22 - a02 * a20;
      out[5] = a02 * a10 - a00 * a12;
      out[6] = a10 * a21 - a11 * a20;
      out[7] = a01 * a20 - a00 * a21;
      out[8] = a00 * a11 - a01 * a10;
      return out;
    }
    function determinant(a) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      return a00 * (a22 * a11 - a12 * a21) + a01 * (-a22 * a10 + a12 * a20) + a02 * (a21 * a10 - a11 * a20);
    }
    function multiply(out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2];
      var a10 = a[3], a11 = a[4], a12 = a[5];
      var a20 = a[6], a21 = a[7], a22 = a[8];
      var b00 = b[0], b01 = b[1], b02 = b[2];
      var b10 = b[3], b11 = b[4], b12 = b[5];
      var b20 = b[6], b21 = b[7], b22 = b[8];
      out[0] = b00 * a00 + b01 * a10 + b02 * a20;
      out[1] = b00 * a01 + b01 * a11 + b02 * a21;
      out[2] = b00 * a02 + b01 * a12 + b02 * a22;
      out[3] = b10 * a00 + b11 * a10 + b12 * a20;
      out[4] = b10 * a01 + b11 * a11 + b12 * a21;
      out[5] = b10 * a02 + b11 * a12 + b12 * a22;
      out[6] = b20 * a00 + b21 * a10 + b22 * a20;
      out[7] = b20 * a01 + b21 * a11 + b22 * a21;
      out[8] = b20 * a02 + b21 * a12 + b22 * a22;
      return out;
    }
    function translate(out, a, v) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], x = v[0], y = v[1];
      out[0] = a00;
      out[1] = a01;
      out[2] = a02;
      out[3] = a10;
      out[4] = a11;
      out[5] = a12;
      out[6] = x * a00 + y * a10 + a20;
      out[7] = x * a01 + y * a11 + a21;
      out[8] = x * a02 + y * a12 + a22;
      return out;
    }
    function rotate(out, a, rad) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[3], a11 = a[4], a12 = a[5], a20 = a[6], a21 = a[7], a22 = a[8], s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c * a00 + s * a10;
      out[1] = c * a01 + s * a11;
      out[2] = c * a02 + s * a12;
      out[3] = c * a10 - s * a00;
      out[4] = c * a11 - s * a01;
      out[5] = c * a12 - s * a02;
      out[6] = a20;
      out[7] = a21;
      out[8] = a22;
      return out;
    }
    function scale(out, a, v) {
      var x = v[0], y = v[1];
      out[0] = x * a[0];
      out[1] = x * a[1];
      out[2] = x * a[2];
      out[3] = y * a[3];
      out[4] = y * a[4];
      out[5] = y * a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      out[6] = v[0];
      out[7] = v[1];
      out[8] = 1;
      return out;
    }
    function fromRotation(out, rad) {
      var s = Math.sin(rad), c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = 0;
      out[3] = -s;
      out[4] = c;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = v[1];
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
    }
    function fromMat2d(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = 0;
      out[3] = a[2];
      out[4] = a[3];
      out[5] = 0;
      out[6] = a[4];
      out[7] = a[5];
      out[8] = 1;
      return out;
    }
    function fromQuat(out, q) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var yx = y * x2;
      var yy = y * y2;
      var zx = z * x2;
      var zy = z * y2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - yy - zz;
      out[3] = yx - wz;
      out[6] = zx + wy;
      out[1] = yx + wz;
      out[4] = 1 - xx - zz;
      out[7] = zy - wx;
      out[2] = zx - wy;
      out[5] = zy + wx;
      out[8] = 1 - xx - yy;
      return out;
    }
    function normalFromMat4(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[3] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[4] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[5] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[6] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[7] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[8] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      return out;
    }
    function projection(out, width, height) {
      out[0] = 2 / width;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = -2 / height;
      out[5] = 0;
      out[6] = -1;
      out[7] = 1;
      out[8] = 1;
      return out;
    }
    function str(a) {
      return "mat3(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ")";
    }
    function frob(a) {
      return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] + a[4] * a[4] + a[5] * a[5] + a[6] * a[6] + a[7] * a[7] + a[8] * a[8]);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      out[8] = a[8] + b[8];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      out[6] = a[6] - b[6];
      out[7] = a[7] - b[7];
      out[8] = a[8] - b[8];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      out[8] = a[8] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      out[6] = a[6] + b[6] * scale2;
      out[7] = a[7] + b[7] * scale2;
      out[8] = a[8] + b[8] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7], a8 = a[8];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7], b8 = b[8];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= glMatrix.EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8));
    }
    var mul = exports.mul = multiply;
    var sub = exports.sub = subtract;
  }
});

// node_modules/gl-matrix/cjs/mat4.js
var require_mat4 = __commonJS({
  "node_modules/gl-matrix/cjs/mat4.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.adjoint = adjoint;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.decompose = decompose;
    exports.determinant = determinant;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.frob = frob;
    exports.fromQuat = fromQuat;
    exports.fromQuat2 = fromQuat2;
    exports.fromRotation = fromRotation;
    exports.fromRotationTranslation = fromRotationTranslation;
    exports.fromRotationTranslationScale = fromRotationTranslationScale;
    exports.fromRotationTranslationScaleOrigin = fromRotationTranslationScaleOrigin;
    exports.fromScaling = fromScaling;
    exports.fromTranslation = fromTranslation;
    exports.fromValues = fromValues;
    exports.fromXRotation = fromXRotation;
    exports.fromYRotation = fromYRotation;
    exports.fromZRotation = fromZRotation;
    exports.frustum = frustum;
    exports.getRotation = getRotation;
    exports.getScaling = getScaling;
    exports.getTranslation = getTranslation;
    exports.identity = identity;
    exports.invert = invert;
    exports.lookAt = lookAt;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.multiplyScalar = multiplyScalar;
    exports.multiplyScalarAndAdd = multiplyScalarAndAdd;
    exports.ortho = void 0;
    exports.orthoNO = orthoNO;
    exports.orthoZO = orthoZO;
    exports.perspective = void 0;
    exports.perspectiveFromFieldOfView = perspectiveFromFieldOfView;
    exports.perspectiveNO = perspectiveNO;
    exports.perspectiveZO = perspectiveZO;
    exports.rotate = rotate;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.scale = scale;
    exports.set = set;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.targetTo = targetTo;
    exports.translate = translate;
    exports.transpose = transpose;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(16);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        out[4] = 0;
        out[6] = 0;
        out[7] = 0;
        out[8] = 0;
        out[9] = 0;
        out[11] = 0;
        out[12] = 0;
        out[13] = 0;
        out[14] = 0;
      }
      out[0] = 1;
      out[5] = 1;
      out[10] = 1;
      out[15] = 1;
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(16);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      out[8] = a[8];
      out[9] = a[9];
      out[10] = a[10];
      out[11] = a[11];
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function fromValues(m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
      var out = new glMatrix.ARRAY_TYPE(16);
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m03;
      out[4] = m10;
      out[5] = m11;
      out[6] = m12;
      out[7] = m13;
      out[8] = m20;
      out[9] = m21;
      out[10] = m22;
      out[11] = m23;
      out[12] = m30;
      out[13] = m31;
      out[14] = m32;
      out[15] = m33;
      return out;
    }
    function set(out, m00, m01, m02, m03, m10, m11, m12, m13, m20, m21, m22, m23, m30, m31, m32, m33) {
      out[0] = m00;
      out[1] = m01;
      out[2] = m02;
      out[3] = m03;
      out[4] = m10;
      out[5] = m11;
      out[6] = m12;
      out[7] = m13;
      out[8] = m20;
      out[9] = m21;
      out[10] = m22;
      out[11] = m23;
      out[12] = m30;
      out[13] = m31;
      out[14] = m32;
      out[15] = m33;
      return out;
    }
    function identity(out) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function transpose(out, a) {
      if (out === a) {
        var a01 = a[1], a02 = a[2], a03 = a[3];
        var a12 = a[6], a13 = a[7];
        var a23 = a[11];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a01;
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a02;
        out[9] = a12;
        out[11] = a[14];
        out[12] = a03;
        out[13] = a13;
        out[14] = a23;
      } else {
        out[0] = a[0];
        out[1] = a[4];
        out[2] = a[8];
        out[3] = a[12];
        out[4] = a[1];
        out[5] = a[5];
        out[6] = a[9];
        out[7] = a[13];
        out[8] = a[2];
        out[9] = a[6];
        out[10] = a[10];
        out[11] = a[14];
        out[12] = a[3];
        out[13] = a[7];
        out[14] = a[11];
        out[15] = a[15];
      }
      return out;
    }
    function invert(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) {
        return null;
      }
      det = 1 / det;
      out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
      out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
      out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
      out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
      out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
      out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
      out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
      out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
      out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return out;
    }
    function adjoint(out, a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b00 = a00 * a11 - a01 * a10;
      var b01 = a00 * a12 - a02 * a10;
      var b02 = a00 * a13 - a03 * a10;
      var b03 = a01 * a12 - a02 * a11;
      var b04 = a01 * a13 - a03 * a11;
      var b05 = a02 * a13 - a03 * a12;
      var b06 = a20 * a31 - a21 * a30;
      var b07 = a20 * a32 - a22 * a30;
      var b08 = a20 * a33 - a23 * a30;
      var b09 = a21 * a32 - a22 * a31;
      var b10 = a21 * a33 - a23 * a31;
      var b11 = a22 * a33 - a23 * a32;
      out[0] = a11 * b11 - a12 * b10 + a13 * b09;
      out[1] = a02 * b10 - a01 * b11 - a03 * b09;
      out[2] = a31 * b05 - a32 * b04 + a33 * b03;
      out[3] = a22 * b04 - a21 * b05 - a23 * b03;
      out[4] = a12 * b08 - a10 * b11 - a13 * b07;
      out[5] = a00 * b11 - a02 * b08 + a03 * b07;
      out[6] = a32 * b02 - a30 * b05 - a33 * b01;
      out[7] = a20 * b05 - a22 * b02 + a23 * b01;
      out[8] = a10 * b10 - a11 * b08 + a13 * b06;
      out[9] = a01 * b08 - a00 * b10 - a03 * b06;
      out[10] = a30 * b04 - a31 * b02 + a33 * b00;
      out[11] = a21 * b02 - a20 * b04 - a23 * b00;
      out[12] = a11 * b07 - a10 * b09 - a12 * b06;
      out[13] = a00 * b09 - a01 * b07 + a02 * b06;
      out[14] = a31 * b01 - a30 * b03 - a32 * b00;
      out[15] = a20 * b03 - a21 * b01 + a22 * b00;
      return out;
    }
    function determinant(a) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b0 = a00 * a11 - a01 * a10;
      var b1 = a00 * a12 - a02 * a10;
      var b2 = a01 * a12 - a02 * a11;
      var b3 = a20 * a31 - a21 * a30;
      var b4 = a20 * a32 - a22 * a30;
      var b5 = a21 * a32 - a22 * a31;
      var b6 = a00 * b5 - a01 * b4 + a02 * b3;
      var b7 = a10 * b5 - a11 * b4 + a12 * b3;
      var b8 = a20 * b2 - a21 * b1 + a22 * b0;
      var b9 = a30 * b2 - a31 * b1 + a32 * b0;
      return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
    }
    function multiply(out, a, b) {
      var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
      var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
      var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[4];
      b1 = b[5];
      b2 = b[6];
      b3 = b[7];
      out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[8];
      b1 = b[9];
      b2 = b[10];
      b3 = b[11];
      out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      b0 = b[12];
      b1 = b[13];
      b2 = b[14];
      b3 = b[15];
      out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
      return out;
    }
    function translate(out, a, v) {
      var x = v[0], y = v[1], z = v[2];
      var a00, a01, a02, a03;
      var a10, a11, a12, a13;
      var a20, a21, a22, a23;
      if (a === out) {
        out[12] = a[0] * x + a[4] * y + a[8] * z + a[12];
        out[13] = a[1] * x + a[5] * y + a[9] * z + a[13];
        out[14] = a[2] * x + a[6] * y + a[10] * z + a[14];
        out[15] = a[3] * x + a[7] * y + a[11] * z + a[15];
      } else {
        a00 = a[0];
        a01 = a[1];
        a02 = a[2];
        a03 = a[3];
        a10 = a[4];
        a11 = a[5];
        a12 = a[6];
        a13 = a[7];
        a20 = a[8];
        a21 = a[9];
        a22 = a[10];
        a23 = a[11];
        out[0] = a00;
        out[1] = a01;
        out[2] = a02;
        out[3] = a03;
        out[4] = a10;
        out[5] = a11;
        out[6] = a12;
        out[7] = a13;
        out[8] = a20;
        out[9] = a21;
        out[10] = a22;
        out[11] = a23;
        out[12] = a00 * x + a10 * y + a20 * z + a[12];
        out[13] = a01 * x + a11 * y + a21 * z + a[13];
        out[14] = a02 * x + a12 * y + a22 * z + a[14];
        out[15] = a03 * x + a13 * y + a23 * z + a[15];
      }
      return out;
    }
    function scale(out, a, v) {
      var x = v[0], y = v[1], z = v[2];
      out[0] = a[0] * x;
      out[1] = a[1] * x;
      out[2] = a[2] * x;
      out[3] = a[3] * x;
      out[4] = a[4] * y;
      out[5] = a[5] * y;
      out[6] = a[6] * y;
      out[7] = a[7] * y;
      out[8] = a[8] * z;
      out[9] = a[9] * z;
      out[10] = a[10] * z;
      out[11] = a[11] * z;
      out[12] = a[12];
      out[13] = a[13];
      out[14] = a[14];
      out[15] = a[15];
      return out;
    }
    function rotate(out, a, rad, axis) {
      var x = axis[0], y = axis[1], z = axis[2];
      var len = Math.sqrt(x * x + y * y + z * z);
      var s, c, t;
      var a00, a01, a02, a03;
      var a10, a11, a12, a13;
      var a20, a21, a22, a23;
      var b00, b01, b02;
      var b10, b11, b12;
      var b20, b21, b22;
      if (len < glMatrix.EPSILON) {
        return null;
      }
      len = 1 / len;
      x *= len;
      y *= len;
      z *= len;
      s = Math.sin(rad);
      c = Math.cos(rad);
      t = 1 - c;
      a00 = a[0];
      a01 = a[1];
      a02 = a[2];
      a03 = a[3];
      a10 = a[4];
      a11 = a[5];
      a12 = a[6];
      a13 = a[7];
      a20 = a[8];
      a21 = a[9];
      a22 = a[10];
      a23 = a[11];
      b00 = x * x * t + c;
      b01 = y * x * t + z * s;
      b02 = z * x * t - y * s;
      b10 = x * y * t - z * s;
      b11 = y * y * t + c;
      b12 = z * y * t + x * s;
      b20 = x * z * t + y * s;
      b21 = y * z * t - x * s;
      b22 = z * z * t + c;
      out[0] = a00 * b00 + a10 * b01 + a20 * b02;
      out[1] = a01 * b00 + a11 * b01 + a21 * b02;
      out[2] = a02 * b00 + a12 * b01 + a22 * b02;
      out[3] = a03 * b00 + a13 * b01 + a23 * b02;
      out[4] = a00 * b10 + a10 * b11 + a20 * b12;
      out[5] = a01 * b10 + a11 * b11 + a21 * b12;
      out[6] = a02 * b10 + a12 * b11 + a22 * b12;
      out[7] = a03 * b10 + a13 * b11 + a23 * b12;
      out[8] = a00 * b20 + a10 * b21 + a20 * b22;
      out[9] = a01 * b20 + a11 * b21 + a21 * b22;
      out[10] = a02 * b20 + a12 * b21 + a22 * b22;
      out[11] = a03 * b20 + a13 * b21 + a23 * b22;
      if (a !== out) {
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      return out;
    }
    function rotateX(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a10 = a[4];
      var a11 = a[5];
      var a12 = a[6];
      var a13 = a[7];
      var a20 = a[8];
      var a21 = a[9];
      var a22 = a[10];
      var a23 = a[11];
      if (a !== out) {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[4] = a10 * c + a20 * s;
      out[5] = a11 * c + a21 * s;
      out[6] = a12 * c + a22 * s;
      out[7] = a13 * c + a23 * s;
      out[8] = a20 * c - a10 * s;
      out[9] = a21 * c - a11 * s;
      out[10] = a22 * c - a12 * s;
      out[11] = a23 * c - a13 * s;
      return out;
    }
    function rotateY(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a00 = a[0];
      var a01 = a[1];
      var a02 = a[2];
      var a03 = a[3];
      var a20 = a[8];
      var a21 = a[9];
      var a22 = a[10];
      var a23 = a[11];
      if (a !== out) {
        out[4] = a[4];
        out[5] = a[5];
        out[6] = a[6];
        out[7] = a[7];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c - a20 * s;
      out[1] = a01 * c - a21 * s;
      out[2] = a02 * c - a22 * s;
      out[3] = a03 * c - a23 * s;
      out[8] = a00 * s + a20 * c;
      out[9] = a01 * s + a21 * c;
      out[10] = a02 * s + a22 * c;
      out[11] = a03 * s + a23 * c;
      return out;
    }
    function rotateZ(out, a, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      var a00 = a[0];
      var a01 = a[1];
      var a02 = a[2];
      var a03 = a[3];
      var a10 = a[4];
      var a11 = a[5];
      var a12 = a[6];
      var a13 = a[7];
      if (a !== out) {
        out[8] = a[8];
        out[9] = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
      }
      out[0] = a00 * c + a10 * s;
      out[1] = a01 * c + a11 * s;
      out[2] = a02 * c + a12 * s;
      out[3] = a03 * c + a13 * s;
      out[4] = a10 * c - a00 * s;
      out[5] = a11 * c - a01 * s;
      out[6] = a12 * c - a02 * s;
      out[7] = a13 * c - a03 * s;
      return out;
    }
    function fromTranslation(out, v) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromScaling(out, v) {
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = v[1];
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = v[2];
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromRotation(out, rad, axis) {
      var x = axis[0], y = axis[1], z = axis[2];
      var len = Math.sqrt(x * x + y * y + z * z);
      var s, c, t;
      if (len < glMatrix.EPSILON) {
        return null;
      }
      len = 1 / len;
      x *= len;
      y *= len;
      z *= len;
      s = Math.sin(rad);
      c = Math.cos(rad);
      t = 1 - c;
      out[0] = x * x * t + c;
      out[1] = y * x * t + z * s;
      out[2] = z * x * t - y * s;
      out[3] = 0;
      out[4] = x * y * t - z * s;
      out[5] = y * y * t + c;
      out[6] = z * y * t + x * s;
      out[7] = 0;
      out[8] = x * z * t + y * s;
      out[9] = y * z * t - x * s;
      out[10] = z * z * t + c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromXRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = c;
      out[6] = s;
      out[7] = 0;
      out[8] = 0;
      out[9] = -s;
      out[10] = c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromYRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = 0;
      out[2] = -s;
      out[3] = 0;
      out[4] = 0;
      out[5] = 1;
      out[6] = 0;
      out[7] = 0;
      out[8] = s;
      out[9] = 0;
      out[10] = c;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromZRotation(out, rad) {
      var s = Math.sin(rad);
      var c = Math.cos(rad);
      out[0] = c;
      out[1] = s;
      out[2] = 0;
      out[3] = 0;
      out[4] = -s;
      out[5] = c;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 1;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function fromRotationTranslation(out, q, v) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - (yy + zz);
      out[1] = xy + wz;
      out[2] = xz - wy;
      out[3] = 0;
      out[4] = xy - wz;
      out[5] = 1 - (xx + zz);
      out[6] = yz + wx;
      out[7] = 0;
      out[8] = xz + wy;
      out[9] = yz - wx;
      out[10] = 1 - (xx + yy);
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromQuat2(out, a) {
      var translation = new glMatrix.ARRAY_TYPE(3);
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7];
      var magnitude = bx * bx + by * by + bz * bz + bw * bw;
      if (magnitude > 0) {
        translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2 / magnitude;
        translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2 / magnitude;
        translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2 / magnitude;
      } else {
        translation[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
        translation[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
        translation[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
      }
      fromRotationTranslation(out, a, translation);
      return out;
    }
    function getTranslation(out, mat) {
      out[0] = mat[12];
      out[1] = mat[13];
      out[2] = mat[14];
      return out;
    }
    function getScaling(out, mat) {
      var m11 = mat[0];
      var m12 = mat[1];
      var m13 = mat[2];
      var m21 = mat[4];
      var m22 = mat[5];
      var m23 = mat[6];
      var m31 = mat[8];
      var m32 = mat[9];
      var m33 = mat[10];
      out[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
      out[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
      out[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
      return out;
    }
    function getRotation(out, mat) {
      var scaling = new glMatrix.ARRAY_TYPE(3);
      getScaling(scaling, mat);
      var is1 = 1 / scaling[0];
      var is2 = 1 / scaling[1];
      var is3 = 1 / scaling[2];
      var sm11 = mat[0] * is1;
      var sm12 = mat[1] * is2;
      var sm13 = mat[2] * is3;
      var sm21 = mat[4] * is1;
      var sm22 = mat[5] * is2;
      var sm23 = mat[6] * is3;
      var sm31 = mat[8] * is1;
      var sm32 = mat[9] * is2;
      var sm33 = mat[10] * is3;
      var trace = sm11 + sm22 + sm33;
      var S = 0;
      if (trace > 0) {
        S = Math.sqrt(trace + 1) * 2;
        out[3] = 0.25 * S;
        out[0] = (sm23 - sm32) / S;
        out[1] = (sm31 - sm13) / S;
        out[2] = (sm12 - sm21) / S;
      } else if (sm11 > sm22 && sm11 > sm33) {
        S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
        out[3] = (sm23 - sm32) / S;
        out[0] = 0.25 * S;
        out[1] = (sm12 + sm21) / S;
        out[2] = (sm31 + sm13) / S;
      } else if (sm22 > sm33) {
        S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
        out[3] = (sm31 - sm13) / S;
        out[0] = (sm12 + sm21) / S;
        out[1] = 0.25 * S;
        out[2] = (sm23 + sm32) / S;
      } else {
        S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
        out[3] = (sm12 - sm21) / S;
        out[0] = (sm31 + sm13) / S;
        out[1] = (sm23 + sm32) / S;
        out[2] = 0.25 * S;
      }
      return out;
    }
    function decompose(out_r, out_t, out_s, mat) {
      out_t[0] = mat[12];
      out_t[1] = mat[13];
      out_t[2] = mat[14];
      var m11 = mat[0];
      var m12 = mat[1];
      var m13 = mat[2];
      var m21 = mat[4];
      var m22 = mat[5];
      var m23 = mat[6];
      var m31 = mat[8];
      var m32 = mat[9];
      var m33 = mat[10];
      out_s[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
      out_s[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
      out_s[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
      var is1 = 1 / out_s[0];
      var is2 = 1 / out_s[1];
      var is3 = 1 / out_s[2];
      var sm11 = m11 * is1;
      var sm12 = m12 * is2;
      var sm13 = m13 * is3;
      var sm21 = m21 * is1;
      var sm22 = m22 * is2;
      var sm23 = m23 * is3;
      var sm31 = m31 * is1;
      var sm32 = m32 * is2;
      var sm33 = m33 * is3;
      var trace = sm11 + sm22 + sm33;
      var S = 0;
      if (trace > 0) {
        S = Math.sqrt(trace + 1) * 2;
        out_r[3] = 0.25 * S;
        out_r[0] = (sm23 - sm32) / S;
        out_r[1] = (sm31 - sm13) / S;
        out_r[2] = (sm12 - sm21) / S;
      } else if (sm11 > sm22 && sm11 > sm33) {
        S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
        out_r[3] = (sm23 - sm32) / S;
        out_r[0] = 0.25 * S;
        out_r[1] = (sm12 + sm21) / S;
        out_r[2] = (sm31 + sm13) / S;
      } else if (sm22 > sm33) {
        S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
        out_r[3] = (sm31 - sm13) / S;
        out_r[0] = (sm12 + sm21) / S;
        out_r[1] = 0.25 * S;
        out_r[2] = (sm23 + sm32) / S;
      } else {
        S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
        out_r[3] = (sm12 - sm21) / S;
        out_r[0] = (sm31 + sm13) / S;
        out_r[1] = (sm23 + sm32) / S;
        out_r[2] = 0.25 * S;
      }
      return out_r;
    }
    function fromRotationTranslationScale(out, q, v, s) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      var sx = s[0];
      var sy = s[1];
      var sz = s[2];
      out[0] = (1 - (yy + zz)) * sx;
      out[1] = (xy + wz) * sx;
      out[2] = (xz - wy) * sx;
      out[3] = 0;
      out[4] = (xy - wz) * sy;
      out[5] = (1 - (xx + zz)) * sy;
      out[6] = (yz + wx) * sy;
      out[7] = 0;
      out[8] = (xz + wy) * sz;
      out[9] = (yz - wx) * sz;
      out[10] = (1 - (xx + yy)) * sz;
      out[11] = 0;
      out[12] = v[0];
      out[13] = v[1];
      out[14] = v[2];
      out[15] = 1;
      return out;
    }
    function fromRotationTranslationScaleOrigin(out, q, v, s, o) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var xy = x * y2;
      var xz = x * z2;
      var yy = y * y2;
      var yz = y * z2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      var sx = s[0];
      var sy = s[1];
      var sz = s[2];
      var ox = o[0];
      var oy = o[1];
      var oz = o[2];
      var out0 = (1 - (yy + zz)) * sx;
      var out1 = (xy + wz) * sx;
      var out2 = (xz - wy) * sx;
      var out4 = (xy - wz) * sy;
      var out5 = (1 - (xx + zz)) * sy;
      var out6 = (yz + wx) * sy;
      var out8 = (xz + wy) * sz;
      var out9 = (yz - wx) * sz;
      var out10 = (1 - (xx + yy)) * sz;
      out[0] = out0;
      out[1] = out1;
      out[2] = out2;
      out[3] = 0;
      out[4] = out4;
      out[5] = out5;
      out[6] = out6;
      out[7] = 0;
      out[8] = out8;
      out[9] = out9;
      out[10] = out10;
      out[11] = 0;
      out[12] = v[0] + ox - (out0 * ox + out4 * oy + out8 * oz);
      out[13] = v[1] + oy - (out1 * ox + out5 * oy + out9 * oz);
      out[14] = v[2] + oz - (out2 * ox + out6 * oy + out10 * oz);
      out[15] = 1;
      return out;
    }
    function fromQuat(out, q) {
      var x = q[0], y = q[1], z = q[2], w = q[3];
      var x2 = x + x;
      var y2 = y + y;
      var z2 = z + z;
      var xx = x * x2;
      var yx = y * x2;
      var yy = y * y2;
      var zx = z * x2;
      var zy = z * y2;
      var zz = z * z2;
      var wx = w * x2;
      var wy = w * y2;
      var wz = w * z2;
      out[0] = 1 - yy - zz;
      out[1] = yx + wz;
      out[2] = zx - wy;
      out[3] = 0;
      out[4] = yx - wz;
      out[5] = 1 - xx - zz;
      out[6] = zy + wx;
      out[7] = 0;
      out[8] = zx + wy;
      out[9] = zy - wx;
      out[10] = 1 - xx - yy;
      out[11] = 0;
      out[12] = 0;
      out[13] = 0;
      out[14] = 0;
      out[15] = 1;
      return out;
    }
    function frustum(out, left, right, bottom, top, near, far) {
      var rl = 1 / (right - left);
      var tb = 1 / (top - bottom);
      var nf = 1 / (near - far);
      out[0] = near * 2 * rl;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = near * 2 * tb;
      out[6] = 0;
      out[7] = 0;
      out[8] = (right + left) * rl;
      out[9] = (top + bottom) * tb;
      out[10] = (far + near) * nf;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = far * near * 2 * nf;
      out[15] = 0;
      return out;
    }
    function perspectiveNO(out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2);
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[15] = 0;
      if (far != null && far !== Infinity) {
        var nf = 1 / (near - far);
        out[10] = (far + near) * nf;
        out[14] = 2 * far * near * nf;
      } else {
        out[10] = -1;
        out[14] = -2 * near;
      }
      return out;
    }
    var perspective = exports.perspective = perspectiveNO;
    function perspectiveZO(out, fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2);
      out[0] = f / aspect;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = f;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[15] = 0;
      if (far != null && far !== Infinity) {
        var nf = 1 / (near - far);
        out[10] = far * nf;
        out[14] = far * near * nf;
      } else {
        out[10] = -1;
        out[14] = -near;
      }
      return out;
    }
    function perspectiveFromFieldOfView(out, fov, near, far) {
      var upTan = Math.tan(fov.upDegrees * Math.PI / 180);
      var downTan = Math.tan(fov.downDegrees * Math.PI / 180);
      var leftTan = Math.tan(fov.leftDegrees * Math.PI / 180);
      var rightTan = Math.tan(fov.rightDegrees * Math.PI / 180);
      var xScale = 2 / (leftTan + rightTan);
      var yScale = 2 / (upTan + downTan);
      out[0] = xScale;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = yScale;
      out[6] = 0;
      out[7] = 0;
      out[8] = -((leftTan - rightTan) * xScale * 0.5);
      out[9] = (upTan - downTan) * yScale * 0.5;
      out[10] = far / (near - far);
      out[11] = -1;
      out[12] = 0;
      out[13] = 0;
      out[14] = far * near / (near - far);
      out[15] = 0;
      return out;
    }
    function orthoNO(out, left, right, bottom, top, near, far) {
      var lr = 1 / (left - right);
      var bt = 1 / (bottom - top);
      var nf = 1 / (near - far);
      out[0] = -2 * lr;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = -2 * bt;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = 2 * nf;
      out[11] = 0;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = (far + near) * nf;
      out[15] = 1;
      return out;
    }
    var ortho = exports.ortho = orthoNO;
    function orthoZO(out, left, right, bottom, top, near, far) {
      var lr = 1 / (left - right);
      var bt = 1 / (bottom - top);
      var nf = 1 / (near - far);
      out[0] = -2 * lr;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      out[4] = 0;
      out[5] = -2 * bt;
      out[6] = 0;
      out[7] = 0;
      out[8] = 0;
      out[9] = 0;
      out[10] = nf;
      out[11] = 0;
      out[12] = (left + right) * lr;
      out[13] = (top + bottom) * bt;
      out[14] = near * nf;
      out[15] = 1;
      return out;
    }
    function lookAt(out, eye, center, up) {
      var x0, x1, x2, y0, y1, y2, z0, z1, z2, len;
      var eyex = eye[0];
      var eyey = eye[1];
      var eyez = eye[2];
      var upx = up[0];
      var upy = up[1];
      var upz = up[2];
      var centerx = center[0];
      var centery = center[1];
      var centerz = center[2];
      if (Math.abs(eyex - centerx) < glMatrix.EPSILON && Math.abs(eyey - centery) < glMatrix.EPSILON && Math.abs(eyez - centerz) < glMatrix.EPSILON) {
        return identity(out);
      }
      z0 = eyex - centerx;
      z1 = eyey - centery;
      z2 = eyez - centerz;
      len = 1 / Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
      z0 *= len;
      z1 *= len;
      z2 *= len;
      x0 = upy * z2 - upz * z1;
      x1 = upz * z0 - upx * z2;
      x2 = upx * z1 - upy * z0;
      len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
      if (!len) {
        x0 = 0;
        x1 = 0;
        x2 = 0;
      } else {
        len = 1 / len;
        x0 *= len;
        x1 *= len;
        x2 *= len;
      }
      y0 = z1 * x2 - z2 * x1;
      y1 = z2 * x0 - z0 * x2;
      y2 = z0 * x1 - z1 * x0;
      len = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2);
      if (!len) {
        y0 = 0;
        y1 = 0;
        y2 = 0;
      } else {
        len = 1 / len;
        y0 *= len;
        y1 *= len;
        y2 *= len;
      }
      out[0] = x0;
      out[1] = y0;
      out[2] = z0;
      out[3] = 0;
      out[4] = x1;
      out[5] = y1;
      out[6] = z1;
      out[7] = 0;
      out[8] = x2;
      out[9] = y2;
      out[10] = z2;
      out[11] = 0;
      out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
      out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
      out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
      out[15] = 1;
      return out;
    }
    function targetTo(out, eye, target, up) {
      var eyex = eye[0], eyey = eye[1], eyez = eye[2], upx = up[0], upy = up[1], upz = up[2];
      var z0 = eyex - target[0], z1 = eyey - target[1], z2 = eyez - target[2];
      var len = z0 * z0 + z1 * z1 + z2 * z2;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        z0 *= len;
        z1 *= len;
        z2 *= len;
      }
      var x0 = upy * z2 - upz * z1, x1 = upz * z0 - upx * z2, x2 = upx * z1 - upy * z0;
      len = x0 * x0 + x1 * x1 + x2 * x2;
      if (len > 0) {
        len = 1 / Math.sqrt(len);
        x0 *= len;
        x1 *= len;
        x2 *= len;
      }
      out[0] = x0;
      out[1] = x1;
      out[2] = x2;
      out[3] = 0;
      out[4] = z1 * x2 - z2 * x1;
      out[5] = z2 * x0 - z0 * x2;
      out[6] = z0 * x1 - z1 * x0;
      out[7] = 0;
      out[8] = z0;
      out[9] = z1;
      out[10] = z2;
      out[11] = 0;
      out[12] = eyex;
      out[13] = eyey;
      out[14] = eyez;
      out[15] = 1;
      return out;
    }
    function str(a) {
      return "mat4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ", " + a[8] + ", " + a[9] + ", " + a[10] + ", " + a[11] + ", " + a[12] + ", " + a[13] + ", " + a[14] + ", " + a[15] + ")";
    }
    function frob(a) {
      return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2] + a[3] * a[3] + a[4] * a[4] + a[5] * a[5] + a[6] * a[6] + a[7] * a[7] + a[8] * a[8] + a[9] * a[9] + a[10] * a[10] + a[11] * a[11] + a[12] * a[12] + a[13] * a[13] + a[14] * a[14] + a[15] * a[15]);
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      out[8] = a[8] + b[8];
      out[9] = a[9] + b[9];
      out[10] = a[10] + b[10];
      out[11] = a[11] + b[11];
      out[12] = a[12] + b[12];
      out[13] = a[13] + b[13];
      out[14] = a[14] + b[14];
      out[15] = a[15] + b[15];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      out[4] = a[4] - b[4];
      out[5] = a[5] - b[5];
      out[6] = a[6] - b[6];
      out[7] = a[7] - b[7];
      out[8] = a[8] - b[8];
      out[9] = a[9] - b[9];
      out[10] = a[10] - b[10];
      out[11] = a[11] - b[11];
      out[12] = a[12] - b[12];
      out[13] = a[13] - b[13];
      out[14] = a[14] - b[14];
      out[15] = a[15] - b[15];
      return out;
    }
    function multiplyScalar(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      out[8] = a[8] * b;
      out[9] = a[9] * b;
      out[10] = a[10] * b;
      out[11] = a[11] * b;
      out[12] = a[12] * b;
      out[13] = a[13] * b;
      out[14] = a[14] * b;
      out[15] = a[15] * b;
      return out;
    }
    function multiplyScalarAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      out[4] = a[4] + b[4] * scale2;
      out[5] = a[5] + b[5] * scale2;
      out[6] = a[6] + b[6] * scale2;
      out[7] = a[7] + b[7] * scale2;
      out[8] = a[8] + b[8] * scale2;
      out[9] = a[9] + b[9] * scale2;
      out[10] = a[10] + b[10] * scale2;
      out[11] = a[11] + b[11] * scale2;
      out[12] = a[12] + b[12] * scale2;
      out[13] = a[13] + b[13] * scale2;
      out[14] = a[14] + b[14] * scale2;
      out[15] = a[15] + b[15] * scale2;
      return out;
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10] && a[11] === b[11] && a[12] === b[12] && a[13] === b[13] && a[14] === b[14] && a[15] === b[15];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
      var a8 = a[8], a9 = a[9], a10 = a[10], a11 = a[11];
      var a12 = a[12], a13 = a[13], a14 = a[14], a15 = a[15];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      var b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
      var b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
      var b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7)) && Math.abs(a8 - b8) <= glMatrix.EPSILON * Math.max(1, Math.abs(a8), Math.abs(b8)) && Math.abs(a9 - b9) <= glMatrix.EPSILON * Math.max(1, Math.abs(a9), Math.abs(b9)) && Math.abs(a10 - b10) <= glMatrix.EPSILON * Math.max(1, Math.abs(a10), Math.abs(b10)) && Math.abs(a11 - b11) <= glMatrix.EPSILON * Math.max(1, Math.abs(a11), Math.abs(b11)) && Math.abs(a12 - b12) <= glMatrix.EPSILON * Math.max(1, Math.abs(a12), Math.abs(b12)) && Math.abs(a13 - b13) <= glMatrix.EPSILON * Math.max(1, Math.abs(a13), Math.abs(b13)) && Math.abs(a14 - b14) <= glMatrix.EPSILON * Math.max(1, Math.abs(a14), Math.abs(b14)) && Math.abs(a15 - b15) <= glMatrix.EPSILON * Math.max(1, Math.abs(a15), Math.abs(b15));
    }
    var mul = exports.mul = multiply;
    var sub = exports.sub = subtract;
  }
});

// node_modules/gl-matrix/cjs/vec3.js
var require_vec3 = __commonJS({
  "node_modules/gl-matrix/cjs/vec3.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.angle = angle;
    exports.bezier = bezier;
    exports.ceil = ceil;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.cross = cross;
    exports.dist = void 0;
    exports.distance = distance;
    exports.div = void 0;
    exports.divide = divide;
    exports.dot = dot;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.floor = floor;
    exports.forEach = void 0;
    exports.fromValues = fromValues;
    exports.hermite = hermite;
    exports.inverse = inverse;
    exports.len = void 0;
    exports.length = length;
    exports.lerp = lerp;
    exports.max = max;
    exports.min = min;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.negate = negate;
    exports.normalize = normalize;
    exports.random = random;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.set = set;
    exports.slerp = slerp;
    exports.sqrLen = exports.sqrDist = void 0;
    exports.squaredDistance = squaredDistance;
    exports.squaredLength = squaredLength;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.transformMat3 = transformMat3;
    exports.transformMat4 = transformMat4;
    exports.transformQuat = transformQuat;
    exports.zero = zero;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(3);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(3);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    }
    function length(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      return Math.sqrt(x * x + y * y + z * z);
    }
    function fromValues(x, y, z) {
      var out = new glMatrix.ARRAY_TYPE(3);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      return out;
    }
    function set(out, x, y, z) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      out[2] = Math.ceil(a[2]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      out[2] = Math.floor(a[2]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      return out;
    }
    function round(out, a) {
      out[0] = glMatrix.round(a[0]);
      out[1] = glMatrix.round(a[1]);
      out[2] = glMatrix.round(a[2]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      return Math.sqrt(x * x + y * y + z * z);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      return x * x + y * y + z * z;
    }
    function squaredLength(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      return x * x + y * y + z * z;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      out[2] = 1 / a[2];
      return out;
    }
    function normalize(out, a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var len2 = x * x + y * y + z * z;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = a[0] * len2;
      out[1] = a[1] * len2;
      out[2] = a[2] * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    }
    function cross(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2];
      var bx = b[0], by = b[1], bz = b[2];
      out[0] = ay * bz - az * by;
      out[1] = az * bx - ax * bz;
      out[2] = ax * by - ay * bx;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0];
      var ay = a[1];
      var az = a[2];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      return out;
    }
    function slerp(out, a, b, t) {
      var angle2 = Math.acos(Math.min(Math.max(dot(a, b), -1), 1));
      var sinTotal = Math.sin(angle2);
      var ratioA = Math.sin((1 - t) * angle2) / sinTotal;
      var ratioB = Math.sin(t * angle2) / sinTotal;
      out[0] = ratioA * a[0] + ratioB * b[0];
      out[1] = ratioA * a[1] + ratioB * b[1];
      out[2] = ratioA * a[2] + ratioB * b[2];
      return out;
    }
    function hermite(out, a, b, c, d, t) {
      var factorTimes2 = t * t;
      var factor1 = factorTimes2 * (2 * t - 3) + 1;
      var factor2 = factorTimes2 * (t - 2) + t;
      var factor3 = factorTimes2 * (t - 1);
      var factor4 = factorTimes2 * (3 - 2 * t);
      out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
      out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
      out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
      return out;
    }
    function bezier(out, a, b, c, d, t) {
      var inverseFactor = 1 - t;
      var inverseFactorTimesTwo = inverseFactor * inverseFactor;
      var factorTimes2 = t * t;
      var factor1 = inverseFactorTimesTwo * inverseFactor;
      var factor2 = 3 * t * inverseFactorTimesTwo;
      var factor3 = 3 * factorTimes2 * inverseFactor;
      var factor4 = factorTimes2 * t;
      out[0] = a[0] * factor1 + b[0] * factor2 + c[0] * factor3 + d[0] * factor4;
      out[1] = a[1] * factor1 + b[1] * factor2 + c[1] * factor3 + d[1] * factor4;
      out[2] = a[2] * factor1 + b[2] * factor2 + c[2] * factor3 + d[2] * factor4;
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 === void 0 ? 1 : scale2;
      var r = glMatrix.RANDOM() * 2 * Math.PI;
      var z = glMatrix.RANDOM() * 2 - 1;
      var zScale = Math.sqrt(1 - z * z) * scale2;
      out[0] = Math.cos(r) * zScale;
      out[1] = Math.sin(r) * zScale;
      out[2] = z * scale2;
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0], y = a[1], z = a[2];
      var w = m[3] * x + m[7] * y + m[11] * z + m[15];
      w = w || 1;
      out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return out;
    }
    function transformMat3(out, a, m) {
      var x = a[0], y = a[1], z = a[2];
      out[0] = x * m[0] + y * m[3] + z * m[6];
      out[1] = x * m[1] + y * m[4] + z * m[7];
      out[2] = x * m[2] + y * m[5] + z * m[8];
      return out;
    }
    function transformQuat(out, a, q) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      var vx = a[0], vy = a[1], vz = a[2];
      var tx = qy * vz - qz * vy;
      var ty = qz * vx - qx * vz;
      var tz = qx * vy - qy * vx;
      tx = tx + tx;
      ty = ty + ty;
      tz = tz + tz;
      out[0] = vx + qw * tx + qy * tz - qz * ty;
      out[1] = vy + qw * ty + qz * tx - qx * tz;
      out[2] = vz + qw * tz + qx * ty - qy * tx;
      return out;
    }
    function rotateX(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0];
      r[1] = p[1] * Math.cos(rad) - p[2] * Math.sin(rad);
      r[2] = p[1] * Math.sin(rad) + p[2] * Math.cos(rad);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function rotateY(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[2] * Math.sin(rad) + p[0] * Math.cos(rad);
      r[1] = p[1];
      r[2] = p[2] * Math.cos(rad) - p[0] * Math.sin(rad);
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function rotateZ(out, a, b, rad) {
      var p = [], r = [];
      p[0] = a[0] - b[0];
      p[1] = a[1] - b[1];
      p[2] = a[2] - b[2];
      r[0] = p[0] * Math.cos(rad) - p[1] * Math.sin(rad);
      r[1] = p[0] * Math.sin(rad) + p[1] * Math.cos(rad);
      r[2] = p[2];
      out[0] = r[0] + b[0];
      out[1] = r[1] + b[1];
      out[2] = r[2] + b[2];
      return out;
    }
    function angle(a, b) {
      var ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2], mag = Math.sqrt((ax * ax + ay * ay + az * az) * (bx * bx + by * by + bz * bz)), cosine = mag && dot(a, b) / mag;
      return Math.acos(Math.min(Math.max(cosine, -1), 1));
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    function str(a) {
      return "vec3(" + a[0] + ", " + a[1] + ", " + a[2] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2];
      var b0 = b[0], b1 = b[1], b2 = b[2];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2));
    }
    var sub = exports.sub = subtract;
    var mul = exports.mul = multiply;
    var div = exports.div = divide;
    var dist = exports.dist = distance;
    var sqrDist = exports.sqrDist = squaredDistance;
    var len = exports.len = length;
    var sqrLen = exports.sqrLen = squaredLength;
    var forEach = exports.forEach = function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 3;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
        }
        return a;
      };
    }();
  }
});

// node_modules/gl-matrix/cjs/vec4.js
var require_vec4 = __commonJS({
  "node_modules/gl-matrix/cjs/vec4.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.ceil = ceil;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.cross = cross;
    exports.dist = void 0;
    exports.distance = distance;
    exports.div = void 0;
    exports.divide = divide;
    exports.dot = dot;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.floor = floor;
    exports.forEach = void 0;
    exports.fromValues = fromValues;
    exports.inverse = inverse;
    exports.len = void 0;
    exports.length = length;
    exports.lerp = lerp;
    exports.max = max;
    exports.min = min;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.negate = negate;
    exports.normalize = normalize;
    exports.random = random;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.set = set;
    exports.sqrLen = exports.sqrDist = void 0;
    exports.squaredDistance = squaredDistance;
    exports.squaredLength = squaredLength;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.transformMat4 = transformMat4;
    exports.transformQuat = transformQuat;
    exports.zero = zero;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function fromValues(x, y, z, w) {
      var out = new glMatrix.ARRAY_TYPE(4);
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      return out;
    }
    function set(out, x, y, z, w) {
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = w;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      out[2] = a[2] - b[2];
      out[3] = a[3] - b[3];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      out[2] = a[2] * b[2];
      out[3] = a[3] * b[3];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      out[2] = a[2] / b[2];
      out[3] = a[3] / b[3];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      out[2] = Math.ceil(a[2]);
      out[3] = Math.ceil(a[3]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      out[2] = Math.floor(a[2]);
      out[3] = Math.floor(a[3]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      out[2] = Math.min(a[2], b[2]);
      out[3] = Math.min(a[3], b[3]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      out[2] = Math.max(a[2], b[2]);
      out[3] = Math.max(a[3], b[3]);
      return out;
    }
    function round(out, a) {
      out[0] = glMatrix.round(a[0]);
      out[1] = glMatrix.round(a[1]);
      out[2] = glMatrix.round(a[2]);
      out[3] = glMatrix.round(a[3]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      out[2] = a[2] + b[2] * scale2;
      out[3] = a[3] + b[3] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      var w = b[3] - a[3];
      return Math.sqrt(x * x + y * y + z * z + w * w);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0];
      var y = b[1] - a[1];
      var z = b[2] - a[2];
      var w = b[3] - a[3];
      return x * x + y * y + z * z + w * w;
    }
    function length(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      return Math.sqrt(x * x + y * y + z * z + w * w);
    }
    function squaredLength(a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      return x * x + y * y + z * z + w * w;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = -a[3];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      out[2] = 1 / a[2];
      out[3] = 1 / a[3];
      return out;
    }
    function normalize(out, a) {
      var x = a[0];
      var y = a[1];
      var z = a[2];
      var w = a[3];
      var len2 = x * x + y * y + z * z + w * w;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = x * len2;
      out[1] = y * len2;
      out[2] = z * len2;
      out[3] = w * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    }
    function cross(out, u, v, w) {
      var A = v[0] * w[1] - v[1] * w[0], B = v[0] * w[2] - v[2] * w[0], C = v[0] * w[3] - v[3] * w[0], D = v[1] * w[2] - v[2] * w[1], E = v[1] * w[3] - v[3] * w[1], F = v[2] * w[3] - v[3] * w[2];
      var G = u[0];
      var H = u[1];
      var I = u[2];
      var J = u[3];
      out[0] = H * F - I * E + J * D;
      out[1] = -(G * F) + I * C - J * B;
      out[2] = G * E - H * C + J * A;
      out[3] = -(G * D) + H * B - I * A;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0];
      var ay = a[1];
      var az = a[2];
      var aw = a[3];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      out[2] = az + t * (b[2] - az);
      out[3] = aw + t * (b[3] - aw);
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 === void 0 ? 1 : scale2;
      var v1, v2, v3, v4;
      var s1, s2;
      var rand;
      rand = glMatrix.RANDOM();
      v1 = rand * 2 - 1;
      v2 = (4 * glMatrix.RANDOM() - 2) * Math.sqrt(rand * -rand + rand);
      s1 = v1 * v1 + v2 * v2;
      rand = glMatrix.RANDOM();
      v3 = rand * 2 - 1;
      v4 = (4 * glMatrix.RANDOM() - 2) * Math.sqrt(rand * -rand + rand);
      s2 = v3 * v3 + v4 * v4;
      var d = Math.sqrt((1 - s1) / s2);
      out[0] = scale2 * v1;
      out[1] = scale2 * v2;
      out[2] = scale2 * v3 * d;
      out[3] = scale2 * v4 * d;
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
      out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
      out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
      out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
      return out;
    }
    function transformQuat(out, a, q) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      var vx = a[0], vy = a[1], vz = a[2];
      var tx = qy * vz - qz * vy;
      var ty = qz * vx - qx * vz;
      var tz = qx * vy - qy * vx;
      tx = tx + tx;
      ty = ty + ty;
      tz = tz + tz;
      out[0] = vx + qw * tx + qy * tz - qz * ty;
      out[1] = vy + qw * ty + qz * tx - qx * tz;
      out[2] = vz + qw * tz + qx * ty - qy * tx;
      out[3] = a[3];
      return out;
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return out;
    }
    function str(a) {
      return "vec4(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3));
    }
    var sub = exports.sub = subtract;
    var mul = exports.mul = multiply;
    var div = exports.div = divide;
    var dist = exports.dist = distance;
    var sqrDist = exports.sqrDist = squaredDistance;
    var len = exports.len = length;
    var sqrLen = exports.sqrLen = squaredLength;
    var forEach = exports.forEach = function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 4;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          vec[2] = a[i + 2];
          vec[3] = a[i + 3];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
          a[i + 2] = vec[2];
          a[i + 3] = vec[3];
        }
        return a;
      };
    }();
  }
});

// node_modules/gl-matrix/cjs/quat.js
var require_quat = __commonJS({
  "node_modules/gl-matrix/cjs/quat.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = void 0;
    exports.calculateW = calculateW;
    exports.clone = void 0;
    exports.conjugate = conjugate;
    exports.copy = void 0;
    exports.create = create;
    exports.dot = void 0;
    exports.equals = equals;
    exports.exactEquals = void 0;
    exports.exp = exp;
    exports.fromEuler = fromEuler;
    exports.fromMat3 = fromMat3;
    exports.fromValues = void 0;
    exports.getAngle = getAngle;
    exports.getAxisAngle = getAxisAngle;
    exports.identity = identity;
    exports.invert = invert;
    exports.lerp = exports.length = exports.len = void 0;
    exports.ln = ln;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.normalize = void 0;
    exports.pow = pow;
    exports.random = random;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.setAxes = exports.set = exports.scale = exports.rotationTo = void 0;
    exports.setAxisAngle = setAxisAngle;
    exports.slerp = slerp;
    exports.squaredLength = exports.sqrLen = exports.sqlerp = void 0;
    exports.str = str;
    var glMatrix = _interopRequireWildcard(require_common());
    var mat32 = _interopRequireWildcard(require_mat3());
    var vec32 = _interopRequireWildcard(require_vec3());
    var vec4 = _interopRequireWildcard(require_vec4());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(4);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
      }
      out[3] = 1;
      return out;
    }
    function identity(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    function setAxisAngle(out, axis, rad) {
      rad = rad * 0.5;
      var s = Math.sin(rad);
      out[0] = s * axis[0];
      out[1] = s * axis[1];
      out[2] = s * axis[2];
      out[3] = Math.cos(rad);
      return out;
    }
    function getAxisAngle(out_axis, q) {
      var rad = Math.acos(q[3]) * 2;
      var s = Math.sin(rad / 2);
      if (s > glMatrix.EPSILON) {
        out_axis[0] = q[0] / s;
        out_axis[1] = q[1] / s;
        out_axis[2] = q[2] / s;
      } else {
        out_axis[0] = 1;
        out_axis[1] = 0;
        out_axis[2] = 0;
      }
      return rad;
    }
    function getAngle(a, b) {
      var dotproduct = dot(a, b);
      return Math.acos(2 * dotproduct * dotproduct - 1);
    }
    function multiply(out, a, b) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      out[0] = ax * bw + aw * bx + ay * bz - az * by;
      out[1] = ay * bw + aw * by + az * bx - ax * bz;
      out[2] = az * bw + aw * bz + ax * by - ay * bx;
      out[3] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    }
    function rotateX(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw + aw * bx;
      out[1] = ay * bw + az * bx;
      out[2] = az * bw - ay * bx;
      out[3] = aw * bw - ax * bx;
      return out;
    }
    function rotateY(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var by = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw - az * by;
      out[1] = ay * bw + aw * by;
      out[2] = az * bw + ax * by;
      out[3] = aw * bw - ay * by;
      return out;
    }
    function rotateZ(out, a, rad) {
      rad *= 0.5;
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bz = Math.sin(rad), bw = Math.cos(rad);
      out[0] = ax * bw + ay * bz;
      out[1] = ay * bw - ax * bz;
      out[2] = az * bw + aw * bz;
      out[3] = aw * bw - az * bz;
      return out;
    }
    function calculateW(out, a) {
      var x = a[0], y = a[1], z = a[2];
      out[0] = x;
      out[1] = y;
      out[2] = z;
      out[3] = Math.sqrt(Math.abs(1 - x * x - y * y - z * z));
      return out;
    }
    function exp(out, a) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      var r = Math.sqrt(x * x + y * y + z * z);
      var et = Math.exp(w);
      var s = r > 0 ? et * Math.sin(r) / r : 0;
      out[0] = x * s;
      out[1] = y * s;
      out[2] = z * s;
      out[3] = et * Math.cos(r);
      return out;
    }
    function ln(out, a) {
      var x = a[0], y = a[1], z = a[2], w = a[3];
      var r = Math.sqrt(x * x + y * y + z * z);
      var t = r > 0 ? Math.atan2(r, w) / r : 0;
      out[0] = x * t;
      out[1] = y * t;
      out[2] = z * t;
      out[3] = 0.5 * Math.log(x * x + y * y + z * z + w * w);
      return out;
    }
    function pow(out, a, b) {
      ln(out, a);
      scale(out, out, b);
      exp(out, out);
      return out;
    }
    function slerp(out, a, b, t) {
      var ax = a[0], ay = a[1], az = a[2], aw = a[3];
      var bx = b[0], by = b[1], bz = b[2], bw = b[3];
      var omega, cosom, sinom, scale0, scale1;
      cosom = ax * bx + ay * by + az * bz + aw * bw;
      if (cosom < 0) {
        cosom = -cosom;
        bx = -bx;
        by = -by;
        bz = -bz;
        bw = -bw;
      }
      if (1 - cosom > glMatrix.EPSILON) {
        omega = Math.acos(cosom);
        sinom = Math.sin(omega);
        scale0 = Math.sin((1 - t) * omega) / sinom;
        scale1 = Math.sin(t * omega) / sinom;
      } else {
        scale0 = 1 - t;
        scale1 = t;
      }
      out[0] = scale0 * ax + scale1 * bx;
      out[1] = scale0 * ay + scale1 * by;
      out[2] = scale0 * az + scale1 * bz;
      out[3] = scale0 * aw + scale1 * bw;
      return out;
    }
    function random(out) {
      var u1 = glMatrix.RANDOM();
      var u2 = glMatrix.RANDOM();
      var u3 = glMatrix.RANDOM();
      var sqrt1MinusU1 = Math.sqrt(1 - u1);
      var sqrtU1 = Math.sqrt(u1);
      out[0] = sqrt1MinusU1 * Math.sin(2 * Math.PI * u2);
      out[1] = sqrt1MinusU1 * Math.cos(2 * Math.PI * u2);
      out[2] = sqrtU1 * Math.sin(2 * Math.PI * u3);
      out[3] = sqrtU1 * Math.cos(2 * Math.PI * u3);
      return out;
    }
    function invert(out, a) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
      var dot2 = a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
      var invDot = dot2 ? 1 / dot2 : 0;
      out[0] = -a0 * invDot;
      out[1] = -a1 * invDot;
      out[2] = -a2 * invDot;
      out[3] = a3 * invDot;
      return out;
    }
    function conjugate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a[3];
      return out;
    }
    function fromMat3(out, m) {
      var fTrace = m[0] + m[4] + m[8];
      var fRoot;
      if (fTrace > 0) {
        fRoot = Math.sqrt(fTrace + 1);
        out[3] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[0] = (m[5] - m[7]) * fRoot;
        out[1] = (m[6] - m[2]) * fRoot;
        out[2] = (m[1] - m[3]) * fRoot;
      } else {
        var i = 0;
        if (m[4] > m[0]) i = 1;
        if (m[8] > m[i * 3 + i]) i = 2;
        var j = (i + 1) % 3;
        var k = (i + 2) % 3;
        fRoot = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1);
        out[i] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[3] = (m[j * 3 + k] - m[k * 3 + j]) * fRoot;
        out[j] = (m[j * 3 + i] + m[i * 3 + j]) * fRoot;
        out[k] = (m[k * 3 + i] + m[i * 3 + k]) * fRoot;
      }
      return out;
    }
    function fromEuler(out, x, y, z) {
      var order = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : glMatrix.ANGLE_ORDER;
      var halfToRad = Math.PI / 360;
      x *= halfToRad;
      z *= halfToRad;
      y *= halfToRad;
      var sx = Math.sin(x);
      var cx = Math.cos(x);
      var sy = Math.sin(y);
      var cy = Math.cos(y);
      var sz = Math.sin(z);
      var cz = Math.cos(z);
      switch (order) {
        case "xyz":
          out[0] = sx * cy * cz + cx * sy * sz;
          out[1] = cx * sy * cz - sx * cy * sz;
          out[2] = cx * cy * sz + sx * sy * cz;
          out[3] = cx * cy * cz - sx * sy * sz;
          break;
        case "xzy":
          out[0] = sx * cy * cz - cx * sy * sz;
          out[1] = cx * sy * cz - sx * cy * sz;
          out[2] = cx * cy * sz + sx * sy * cz;
          out[3] = cx * cy * cz + sx * sy * sz;
          break;
        case "yxz":
          out[0] = sx * cy * cz + cx * sy * sz;
          out[1] = cx * sy * cz - sx * cy * sz;
          out[2] = cx * cy * sz - sx * sy * cz;
          out[3] = cx * cy * cz + sx * sy * sz;
          break;
        case "yzx":
          out[0] = sx * cy * cz + cx * sy * sz;
          out[1] = cx * sy * cz + sx * cy * sz;
          out[2] = cx * cy * sz - sx * sy * cz;
          out[3] = cx * cy * cz - sx * sy * sz;
          break;
        case "zxy":
          out[0] = sx * cy * cz - cx * sy * sz;
          out[1] = cx * sy * cz + sx * cy * sz;
          out[2] = cx * cy * sz + sx * sy * cz;
          out[3] = cx * cy * cz - sx * sy * sz;
          break;
        case "zyx":
          out[0] = sx * cy * cz - cx * sy * sz;
          out[1] = cx * sy * cz + sx * cy * sz;
          out[2] = cx * cy * sz - sx * sy * cz;
          out[3] = cx * cy * cz + sx * sy * sz;
          break;
        default:
          throw new Error("Unknown angle order " + order);
      }
      return out;
    }
    function str(a) {
      return "quat(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ")";
    }
    var clone = exports.clone = vec4.clone;
    var fromValues = exports.fromValues = vec4.fromValues;
    var copy = exports.copy = vec4.copy;
    var set = exports.set = vec4.set;
    var add = exports.add = vec4.add;
    var mul = exports.mul = multiply;
    var scale = exports.scale = vec4.scale;
    var dot = exports.dot = vec4.dot;
    var lerp = exports.lerp = vec4.lerp;
    var length = exports.length = vec4.length;
    var len = exports.len = length;
    var squaredLength = exports.squaredLength = vec4.squaredLength;
    var sqrLen = exports.sqrLen = squaredLength;
    var normalize = exports.normalize = vec4.normalize;
    var exactEquals = exports.exactEquals = vec4.exactEquals;
    function equals(a, b) {
      return Math.abs(vec4.dot(a, b)) >= 1 - glMatrix.EPSILON;
    }
    var rotationTo = exports.rotationTo = function() {
      var tmpvec3 = vec32.create();
      var xUnitVec3 = vec32.fromValues(1, 0, 0);
      var yUnitVec3 = vec32.fromValues(0, 1, 0);
      return function(out, a, b) {
        var dot2 = vec32.dot(a, b);
        if (dot2 < -0.999999) {
          vec32.cross(tmpvec3, xUnitVec3, a);
          if (vec32.len(tmpvec3) < 1e-6) vec32.cross(tmpvec3, yUnitVec3, a);
          vec32.normalize(tmpvec3, tmpvec3);
          setAxisAngle(out, tmpvec3, Math.PI);
          return out;
        } else if (dot2 > 0.999999) {
          out[0] = 0;
          out[1] = 0;
          out[2] = 0;
          out[3] = 1;
          return out;
        } else {
          vec32.cross(tmpvec3, a, b);
          out[0] = tmpvec3[0];
          out[1] = tmpvec3[1];
          out[2] = tmpvec3[2];
          out[3] = 1 + dot2;
          return normalize(out, out);
        }
      };
    }();
    var sqlerp = exports.sqlerp = function() {
      var temp1 = create();
      var temp2 = create();
      return function(out, a, b, c, d, t) {
        slerp(temp1, a, d, t);
        slerp(temp2, b, c, t);
        slerp(out, temp1, temp2, 2 * t * (1 - t));
        return out;
      };
    }();
    var setAxes = exports.setAxes = function() {
      var matr = mat32.create();
      return function(out, view, right, up) {
        matr[0] = right[0];
        matr[3] = right[1];
        matr[6] = right[2];
        matr[1] = up[0];
        matr[4] = up[1];
        matr[7] = up[2];
        matr[2] = -view[0];
        matr[5] = -view[1];
        matr[8] = -view[2];
        return normalize(out, fromMat3(out, matr));
      };
    }();
  }
});

// node_modules/gl-matrix/cjs/quat2.js
var require_quat2 = __commonJS({
  "node_modules/gl-matrix/cjs/quat2.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.clone = clone;
    exports.conjugate = conjugate;
    exports.copy = copy;
    exports.create = create;
    exports.dot = void 0;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.fromMat4 = fromMat4;
    exports.fromRotation = fromRotation;
    exports.fromRotationTranslation = fromRotationTranslation;
    exports.fromRotationTranslationValues = fromRotationTranslationValues;
    exports.fromTranslation = fromTranslation;
    exports.fromValues = fromValues;
    exports.getDual = getDual;
    exports.getReal = void 0;
    exports.getTranslation = getTranslation;
    exports.identity = identity;
    exports.invert = invert;
    exports.length = exports.len = void 0;
    exports.lerp = lerp;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.normalize = normalize;
    exports.rotateAroundAxis = rotateAroundAxis;
    exports.rotateByQuatAppend = rotateByQuatAppend;
    exports.rotateByQuatPrepend = rotateByQuatPrepend;
    exports.rotateX = rotateX;
    exports.rotateY = rotateY;
    exports.rotateZ = rotateZ;
    exports.scale = scale;
    exports.set = set;
    exports.setDual = setDual;
    exports.squaredLength = exports.sqrLen = exports.setReal = void 0;
    exports.str = str;
    exports.translate = translate;
    var glMatrix = _interopRequireWildcard(require_common());
    var quat3 = _interopRequireWildcard(require_quat());
    var mat43 = _interopRequireWildcard(require_mat4());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var dq = new glMatrix.ARRAY_TYPE(8);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        dq[0] = 0;
        dq[1] = 0;
        dq[2] = 0;
        dq[4] = 0;
        dq[5] = 0;
        dq[6] = 0;
        dq[7] = 0;
      }
      dq[3] = 1;
      return dq;
    }
    function clone(a) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = a[0];
      dq[1] = a[1];
      dq[2] = a[2];
      dq[3] = a[3];
      dq[4] = a[4];
      dq[5] = a[5];
      dq[6] = a[6];
      dq[7] = a[7];
      return dq;
    }
    function fromValues(x1, y1, z1, w1, x2, y2, z2, w2) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = x1;
      dq[1] = y1;
      dq[2] = z1;
      dq[3] = w1;
      dq[4] = x2;
      dq[5] = y2;
      dq[6] = z2;
      dq[7] = w2;
      return dq;
    }
    function fromRotationTranslationValues(x1, y1, z1, w1, x2, y2, z2) {
      var dq = new glMatrix.ARRAY_TYPE(8);
      dq[0] = x1;
      dq[1] = y1;
      dq[2] = z1;
      dq[3] = w1;
      var ax = x2 * 0.5, ay = y2 * 0.5, az = z2 * 0.5;
      dq[4] = ax * w1 + ay * z1 - az * y1;
      dq[5] = ay * w1 + az * x1 - ax * z1;
      dq[6] = az * w1 + ax * y1 - ay * x1;
      dq[7] = -ax * x1 - ay * y1 - az * z1;
      return dq;
    }
    function fromRotationTranslation(out, q, t) {
      var ax = t[0] * 0.5, ay = t[1] * 0.5, az = t[2] * 0.5, bx = q[0], by = q[1], bz = q[2], bw = q[3];
      out[0] = bx;
      out[1] = by;
      out[2] = bz;
      out[3] = bw;
      out[4] = ax * bw + ay * bz - az * by;
      out[5] = ay * bw + az * bx - ax * bz;
      out[6] = az * bw + ax * by - ay * bx;
      out[7] = -ax * bx - ay * by - az * bz;
      return out;
    }
    function fromTranslation(out, t) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = t[0] * 0.5;
      out[5] = t[1] * 0.5;
      out[6] = t[2] * 0.5;
      out[7] = 0;
      return out;
    }
    function fromRotation(out, q) {
      out[0] = q[0];
      out[1] = q[1];
      out[2] = q[2];
      out[3] = q[3];
      out[4] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      return out;
    }
    function fromMat4(out, a) {
      var outer = quat3.create();
      mat43.getRotation(outer, a);
      var t = new glMatrix.ARRAY_TYPE(3);
      mat43.getTranslation(t, a);
      fromRotationTranslation(out, outer, t);
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      out[2] = a[2];
      out[3] = a[3];
      out[4] = a[4];
      out[5] = a[5];
      out[6] = a[6];
      out[7] = a[7];
      return out;
    }
    function identity(out) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      out[4] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
      return out;
    }
    function set(out, x1, y1, z1, w1, x2, y2, z2, w2) {
      out[0] = x1;
      out[1] = y1;
      out[2] = z1;
      out[3] = w1;
      out[4] = x2;
      out[5] = y2;
      out[6] = z2;
      out[7] = w2;
      return out;
    }
    var getReal = exports.getReal = quat3.copy;
    function getDual(out, a) {
      out[0] = a[4];
      out[1] = a[5];
      out[2] = a[6];
      out[3] = a[7];
      return out;
    }
    var setReal = exports.setReal = quat3.copy;
    function setDual(out, q) {
      out[4] = q[0];
      out[5] = q[1];
      out[6] = q[2];
      out[7] = q[3];
      return out;
    }
    function getTranslation(out, a) {
      var ax = a[4], ay = a[5], az = a[6], aw = a[7], bx = -a[0], by = -a[1], bz = -a[2], bw = a[3];
      out[0] = (ax * bw + aw * bx + ay * bz - az * by) * 2;
      out[1] = (ay * bw + aw * by + az * bx - ax * bz) * 2;
      out[2] = (az * bw + aw * bz + ax * by - ay * bx) * 2;
      return out;
    }
    function translate(out, a, v) {
      var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3], bx1 = v[0] * 0.5, by1 = v[1] * 0.5, bz1 = v[2] * 0.5, ax2 = a[4], ay2 = a[5], az2 = a[6], aw2 = a[7];
      out[0] = ax1;
      out[1] = ay1;
      out[2] = az1;
      out[3] = aw1;
      out[4] = aw1 * bx1 + ay1 * bz1 - az1 * by1 + ax2;
      out[5] = aw1 * by1 + az1 * bx1 - ax1 * bz1 + ay2;
      out[6] = aw1 * bz1 + ax1 * by1 - ay1 * bx1 + az2;
      out[7] = -ax1 * bx1 - ay1 * by1 - az1 * bz1 + aw2;
      return out;
    }
    function rotateX(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat3.rotateX(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateY(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat3.rotateY(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateZ(out, a, rad) {
      var bx = -a[0], by = -a[1], bz = -a[2], bw = a[3], ax = a[4], ay = a[5], az = a[6], aw = a[7], ax1 = ax * bw + aw * bx + ay * bz - az * by, ay1 = ay * bw + aw * by + az * bx - ax * bz, az1 = az * bw + aw * bz + ax * by - ay * bx, aw1 = aw * bw - ax * bx - ay * by - az * bz;
      quat3.rotateZ(out, a, rad);
      bx = out[0];
      by = out[1];
      bz = out[2];
      bw = out[3];
      out[4] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[5] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[6] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[7] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      return out;
    }
    function rotateByQuatAppend(out, a, q) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3], ax = a[0], ay = a[1], az = a[2], aw = a[3];
      out[0] = ax * qw + aw * qx + ay * qz - az * qy;
      out[1] = ay * qw + aw * qy + az * qx - ax * qz;
      out[2] = az * qw + aw * qz + ax * qy - ay * qx;
      out[3] = aw * qw - ax * qx - ay * qy - az * qz;
      ax = a[4];
      ay = a[5];
      az = a[6];
      aw = a[7];
      out[4] = ax * qw + aw * qx + ay * qz - az * qy;
      out[5] = ay * qw + aw * qy + az * qx - ax * qz;
      out[6] = az * qw + aw * qz + ax * qy - ay * qx;
      out[7] = aw * qw - ax * qx - ay * qy - az * qz;
      return out;
    }
    function rotateByQuatPrepend(out, q, a) {
      var qx = q[0], qy = q[1], qz = q[2], qw = q[3], bx = a[0], by = a[1], bz = a[2], bw = a[3];
      out[0] = qx * bw + qw * bx + qy * bz - qz * by;
      out[1] = qy * bw + qw * by + qz * bx - qx * bz;
      out[2] = qz * bw + qw * bz + qx * by - qy * bx;
      out[3] = qw * bw - qx * bx - qy * by - qz * bz;
      bx = a[4];
      by = a[5];
      bz = a[6];
      bw = a[7];
      out[4] = qx * bw + qw * bx + qy * bz - qz * by;
      out[5] = qy * bw + qw * by + qz * bx - qx * bz;
      out[6] = qz * bw + qw * bz + qx * by - qy * bx;
      out[7] = qw * bw - qx * bx - qy * by - qz * bz;
      return out;
    }
    function rotateAroundAxis(out, a, axis, rad) {
      if (Math.abs(rad) < glMatrix.EPSILON) {
        return copy(out, a);
      }
      var axisLength = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]);
      rad = rad * 0.5;
      var s = Math.sin(rad);
      var bx = s * axis[0] / axisLength;
      var by = s * axis[1] / axisLength;
      var bz = s * axis[2] / axisLength;
      var bw = Math.cos(rad);
      var ax1 = a[0], ay1 = a[1], az1 = a[2], aw1 = a[3];
      out[0] = ax1 * bw + aw1 * bx + ay1 * bz - az1 * by;
      out[1] = ay1 * bw + aw1 * by + az1 * bx - ax1 * bz;
      out[2] = az1 * bw + aw1 * bz + ax1 * by - ay1 * bx;
      out[3] = aw1 * bw - ax1 * bx - ay1 * by - az1 * bz;
      var ax = a[4], ay = a[5], az = a[6], aw = a[7];
      out[4] = ax * bw + aw * bx + ay * bz - az * by;
      out[5] = ay * bw + aw * by + az * bx - ax * bz;
      out[6] = az * bw + aw * bz + ax * by - ay * bx;
      out[7] = aw * bw - ax * bx - ay * by - az * bz;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      out[2] = a[2] + b[2];
      out[3] = a[3] + b[3];
      out[4] = a[4] + b[4];
      out[5] = a[5] + b[5];
      out[6] = a[6] + b[6];
      out[7] = a[7] + b[7];
      return out;
    }
    function multiply(out, a, b) {
      var ax0 = a[0], ay0 = a[1], az0 = a[2], aw0 = a[3], bx1 = b[4], by1 = b[5], bz1 = b[6], bw1 = b[7], ax1 = a[4], ay1 = a[5], az1 = a[6], aw1 = a[7], bx0 = b[0], by0 = b[1], bz0 = b[2], bw0 = b[3];
      out[0] = ax0 * bw0 + aw0 * bx0 + ay0 * bz0 - az0 * by0;
      out[1] = ay0 * bw0 + aw0 * by0 + az0 * bx0 - ax0 * bz0;
      out[2] = az0 * bw0 + aw0 * bz0 + ax0 * by0 - ay0 * bx0;
      out[3] = aw0 * bw0 - ax0 * bx0 - ay0 * by0 - az0 * bz0;
      out[4] = ax0 * bw1 + aw0 * bx1 + ay0 * bz1 - az0 * by1 + ax1 * bw0 + aw1 * bx0 + ay1 * bz0 - az1 * by0;
      out[5] = ay0 * bw1 + aw0 * by1 + az0 * bx1 - ax0 * bz1 + ay1 * bw0 + aw1 * by0 + az1 * bx0 - ax1 * bz0;
      out[6] = az0 * bw1 + aw0 * bz1 + ax0 * by1 - ay0 * bx1 + az1 * bw0 + aw1 * bz0 + ax1 * by0 - ay1 * bx0;
      out[7] = aw0 * bw1 - ax0 * bx1 - ay0 * by1 - az0 * bz1 + aw1 * bw0 - ax1 * bx0 - ay1 * by0 - az1 * bz0;
      return out;
    }
    var mul = exports.mul = multiply;
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      out[2] = a[2] * b;
      out[3] = a[3] * b;
      out[4] = a[4] * b;
      out[5] = a[5] * b;
      out[6] = a[6] * b;
      out[7] = a[7] * b;
      return out;
    }
    var dot = exports.dot = quat3.dot;
    function lerp(out, a, b, t) {
      var mt = 1 - t;
      if (dot(a, b) < 0) t = -t;
      out[0] = a[0] * mt + b[0] * t;
      out[1] = a[1] * mt + b[1] * t;
      out[2] = a[2] * mt + b[2] * t;
      out[3] = a[3] * mt + b[3] * t;
      out[4] = a[4] * mt + b[4] * t;
      out[5] = a[5] * mt + b[5] * t;
      out[6] = a[6] * mt + b[6] * t;
      out[7] = a[7] * mt + b[7] * t;
      return out;
    }
    function invert(out, a) {
      var sqlen = squaredLength(a);
      out[0] = -a[0] / sqlen;
      out[1] = -a[1] / sqlen;
      out[2] = -a[2] / sqlen;
      out[3] = a[3] / sqlen;
      out[4] = -a[4] / sqlen;
      out[5] = -a[5] / sqlen;
      out[6] = -a[6] / sqlen;
      out[7] = a[7] / sqlen;
      return out;
    }
    function conjugate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      out[2] = -a[2];
      out[3] = a[3];
      out[4] = -a[4];
      out[5] = -a[5];
      out[6] = -a[6];
      out[7] = a[7];
      return out;
    }
    var length = exports.length = quat3.length;
    var len = exports.len = length;
    var squaredLength = exports.squaredLength = quat3.squaredLength;
    var sqrLen = exports.sqrLen = squaredLength;
    function normalize(out, a) {
      var magnitude = squaredLength(a);
      if (magnitude > 0) {
        magnitude = Math.sqrt(magnitude);
        var a0 = a[0] / magnitude;
        var a1 = a[1] / magnitude;
        var a2 = a[2] / magnitude;
        var a3 = a[3] / magnitude;
        var b0 = a[4];
        var b1 = a[5];
        var b2 = a[6];
        var b3 = a[7];
        var a_dot_b = a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
        out[0] = a0;
        out[1] = a1;
        out[2] = a2;
        out[3] = a3;
        out[4] = (b0 - a0 * a_dot_b) / magnitude;
        out[5] = (b1 - a1 * a_dot_b) / magnitude;
        out[6] = (b2 - a2 * a_dot_b) / magnitude;
        out[7] = (b3 - a3 * a_dot_b) / magnitude;
      }
      return out;
    }
    function str(a) {
      return "quat2(" + a[0] + ", " + a[1] + ", " + a[2] + ", " + a[3] + ", " + a[4] + ", " + a[5] + ", " + a[6] + ", " + a[7] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3], a4 = a[4], a5 = a[5], a6 = a[6], a7 = a[7];
      var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1)) && Math.abs(a2 - b2) <= glMatrix.EPSILON * Math.max(1, Math.abs(a2), Math.abs(b2)) && Math.abs(a3 - b3) <= glMatrix.EPSILON * Math.max(1, Math.abs(a3), Math.abs(b3)) && Math.abs(a4 - b4) <= glMatrix.EPSILON * Math.max(1, Math.abs(a4), Math.abs(b4)) && Math.abs(a5 - b5) <= glMatrix.EPSILON * Math.max(1, Math.abs(a5), Math.abs(b5)) && Math.abs(a6 - b6) <= glMatrix.EPSILON * Math.max(1, Math.abs(a6), Math.abs(b6)) && Math.abs(a7 - b7) <= glMatrix.EPSILON * Math.max(1, Math.abs(a7), Math.abs(b7));
    }
  }
});

// node_modules/gl-matrix/cjs/vec2.js
var require_vec2 = __commonJS({
  "node_modules/gl-matrix/cjs/vec2.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.add = add;
    exports.angle = angle;
    exports.ceil = ceil;
    exports.clone = clone;
    exports.copy = copy;
    exports.create = create;
    exports.cross = cross;
    exports.dist = void 0;
    exports.distance = distance;
    exports.div = void 0;
    exports.divide = divide;
    exports.dot = dot;
    exports.equals = equals;
    exports.exactEquals = exactEquals;
    exports.floor = floor;
    exports.forEach = void 0;
    exports.fromValues = fromValues;
    exports.inverse = inverse;
    exports.len = void 0;
    exports.length = length;
    exports.lerp = lerp;
    exports.max = max;
    exports.min = min;
    exports.mul = void 0;
    exports.multiply = multiply;
    exports.negate = negate;
    exports.normalize = normalize;
    exports.random = random;
    exports.rotate = rotate;
    exports.round = round;
    exports.scale = scale;
    exports.scaleAndAdd = scaleAndAdd;
    exports.set = set;
    exports.signedAngle = signedAngle;
    exports.sqrLen = exports.sqrDist = void 0;
    exports.squaredDistance = squaredDistance;
    exports.squaredLength = squaredLength;
    exports.str = str;
    exports.sub = void 0;
    exports.subtract = subtract;
    exports.transformMat2 = transformMat2;
    exports.transformMat2d = transformMat2d;
    exports.transformMat3 = transformMat3;
    exports.transformMat4 = transformMat4;
    exports.zero = zero;
    var glMatrix = _interopRequireWildcard(require_common());
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
    function create() {
      var out = new glMatrix.ARRAY_TYPE(2);
      if (glMatrix.ARRAY_TYPE != Float32Array) {
        out[0] = 0;
        out[1] = 0;
      }
      return out;
    }
    function clone(a) {
      var out = new glMatrix.ARRAY_TYPE(2);
      out[0] = a[0];
      out[1] = a[1];
      return out;
    }
    function fromValues(x, y) {
      var out = new glMatrix.ARRAY_TYPE(2);
      out[0] = x;
      out[1] = y;
      return out;
    }
    function copy(out, a) {
      out[0] = a[0];
      out[1] = a[1];
      return out;
    }
    function set(out, x, y) {
      out[0] = x;
      out[1] = y;
      return out;
    }
    function add(out, a, b) {
      out[0] = a[0] + b[0];
      out[1] = a[1] + b[1];
      return out;
    }
    function subtract(out, a, b) {
      out[0] = a[0] - b[0];
      out[1] = a[1] - b[1];
      return out;
    }
    function multiply(out, a, b) {
      out[0] = a[0] * b[0];
      out[1] = a[1] * b[1];
      return out;
    }
    function divide(out, a, b) {
      out[0] = a[0] / b[0];
      out[1] = a[1] / b[1];
      return out;
    }
    function ceil(out, a) {
      out[0] = Math.ceil(a[0]);
      out[1] = Math.ceil(a[1]);
      return out;
    }
    function floor(out, a) {
      out[0] = Math.floor(a[0]);
      out[1] = Math.floor(a[1]);
      return out;
    }
    function min(out, a, b) {
      out[0] = Math.min(a[0], b[0]);
      out[1] = Math.min(a[1], b[1]);
      return out;
    }
    function max(out, a, b) {
      out[0] = Math.max(a[0], b[0]);
      out[1] = Math.max(a[1], b[1]);
      return out;
    }
    function round(out, a) {
      out[0] = glMatrix.round(a[0]);
      out[1] = glMatrix.round(a[1]);
      return out;
    }
    function scale(out, a, b) {
      out[0] = a[0] * b;
      out[1] = a[1] * b;
      return out;
    }
    function scaleAndAdd(out, a, b, scale2) {
      out[0] = a[0] + b[0] * scale2;
      out[1] = a[1] + b[1] * scale2;
      return out;
    }
    function distance(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1];
      return Math.sqrt(x * x + y * y);
    }
    function squaredDistance(a, b) {
      var x = b[0] - a[0], y = b[1] - a[1];
      return x * x + y * y;
    }
    function length(a) {
      var x = a[0], y = a[1];
      return Math.sqrt(x * x + y * y);
    }
    function squaredLength(a) {
      var x = a[0], y = a[1];
      return x * x + y * y;
    }
    function negate(out, a) {
      out[0] = -a[0];
      out[1] = -a[1];
      return out;
    }
    function inverse(out, a) {
      out[0] = 1 / a[0];
      out[1] = 1 / a[1];
      return out;
    }
    function normalize(out, a) {
      var x = a[0], y = a[1];
      var len2 = x * x + y * y;
      if (len2 > 0) {
        len2 = 1 / Math.sqrt(len2);
      }
      out[0] = a[0] * len2;
      out[1] = a[1] * len2;
      return out;
    }
    function dot(a, b) {
      return a[0] * b[0] + a[1] * b[1];
    }
    function cross(out, a, b) {
      var z = a[0] * b[1] - a[1] * b[0];
      out[0] = out[1] = 0;
      out[2] = z;
      return out;
    }
    function lerp(out, a, b, t) {
      var ax = a[0], ay = a[1];
      out[0] = ax + t * (b[0] - ax);
      out[1] = ay + t * (b[1] - ay);
      return out;
    }
    function random(out, scale2) {
      scale2 = scale2 === void 0 ? 1 : scale2;
      var r = glMatrix.RANDOM() * 2 * Math.PI;
      out[0] = Math.cos(r) * scale2;
      out[1] = Math.sin(r) * scale2;
      return out;
    }
    function transformMat2(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[2] * y;
      out[1] = m[1] * x + m[3] * y;
      return out;
    }
    function transformMat2d(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[2] * y + m[4];
      out[1] = m[1] * x + m[3] * y + m[5];
      return out;
    }
    function transformMat3(out, a, m) {
      var x = a[0], y = a[1];
      out[0] = m[0] * x + m[3] * y + m[6];
      out[1] = m[1] * x + m[4] * y + m[7];
      return out;
    }
    function transformMat4(out, a, m) {
      var x = a[0];
      var y = a[1];
      out[0] = m[0] * x + m[4] * y + m[12];
      out[1] = m[1] * x + m[5] * y + m[13];
      return out;
    }
    function rotate(out, a, b, rad) {
      var p0 = a[0] - b[0], p1 = a[1] - b[1], sinC = Math.sin(rad), cosC = Math.cos(rad);
      out[0] = p0 * cosC - p1 * sinC + b[0];
      out[1] = p0 * sinC + p1 * cosC + b[1];
      return out;
    }
    function angle(a, b) {
      var ax = a[0], ay = a[1], bx = b[0], by = b[1];
      return Math.abs(Math.atan2(ay * bx - ax * by, ax * bx + ay * by));
    }
    function signedAngle(a, b) {
      var ax = a[0], ay = a[1], bx = b[0], by = b[1];
      return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    }
    function zero(out) {
      out[0] = 0;
      out[1] = 0;
      return out;
    }
    function str(a) {
      return "vec2(" + a[0] + ", " + a[1] + ")";
    }
    function exactEquals(a, b) {
      return a[0] === b[0] && a[1] === b[1];
    }
    function equals(a, b) {
      var a0 = a[0], a1 = a[1];
      var b0 = b[0], b1 = b[1];
      return Math.abs(a0 - b0) <= glMatrix.EPSILON * Math.max(1, Math.abs(a0), Math.abs(b0)) && Math.abs(a1 - b1) <= glMatrix.EPSILON * Math.max(1, Math.abs(a1), Math.abs(b1));
    }
    var len = exports.len = length;
    var sub = exports.sub = subtract;
    var mul = exports.mul = multiply;
    var div = exports.div = divide;
    var dist = exports.dist = distance;
    var sqrDist = exports.sqrDist = squaredDistance;
    var sqrLen = exports.sqrLen = squaredLength;
    var forEach = exports.forEach = function() {
      var vec = create();
      return function(a, stride, offset, count, fn, arg) {
        var i, l;
        if (!stride) {
          stride = 2;
        }
        if (!offset) {
          offset = 0;
        }
        if (count) {
          l = Math.min(count * stride + offset, a.length);
        } else {
          l = a.length;
        }
        for (i = offset; i < l; i += stride) {
          vec[0] = a[i];
          vec[1] = a[i + 1];
          fn(vec, vec, arg);
          a[i] = vec[0];
          a[i + 1] = vec[1];
        }
        return a;
      };
    }();
  }
});

// node_modules/gl-matrix/cjs/index.js
var require_cjs = __commonJS({
  "node_modules/gl-matrix/cjs/index.js"(exports) {
    "use strict";
    function _typeof(o) {
      "@babel/helpers - typeof";
      return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, _typeof(o);
    }
    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.vec4 = exports.vec3 = exports.vec2 = exports.quat2 = exports.quat = exports.mat4 = exports.mat3 = exports.mat2d = exports.mat2 = exports.glMatrix = void 0;
    var glMatrix = _interopRequireWildcard(require_common());
    exports.glMatrix = glMatrix;
    var mat2 = _interopRequireWildcard(require_mat2());
    exports.mat2 = mat2;
    var mat2d = _interopRequireWildcard(require_mat2d());
    exports.mat2d = mat2d;
    var mat32 = _interopRequireWildcard(require_mat3());
    exports.mat3 = mat32;
    var mat43 = _interopRequireWildcard(require_mat4());
    exports.mat4 = mat43;
    var quat3 = _interopRequireWildcard(require_quat());
    exports.quat = quat3;
    var quat22 = _interopRequireWildcard(require_quat2());
    exports.quat2 = quat22;
    var vec2 = _interopRequireWildcard(require_vec2());
    exports.vec2 = vec2;
    var vec32 = _interopRequireWildcard(require_vec3());
    exports.vec3 = vec32;
    var vec4 = _interopRequireWildcard(require_vec4());
    exports.vec4 = vec4;
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function _interopRequireWildcard2(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, "default": e2 };
        if (null === e2 || "object" != _typeof(e2) && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (var _t in e2) "default" !== _t && {}.hasOwnProperty.call(e2, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e2[_t]);
        return f;
      })(e, t);
    }
  }
});

// src/renderer/src/infrastructure/desktop/tauriDesktopGateway.ts
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}
var Channel = class {
  constructor(onmessage) {
    _Channel_onmessage.set(this, void 0);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, void 0);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
    }), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
};
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
_Resource_rid = /* @__PURE__ */ new WeakMap();

// node_modules/@tauri-apps/api/event.js
var TauriEvent;
(function(TauriEvent2) {
  TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
  TauriEvent2["WINDOW_MOVED"] = "tauri://move";
  TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
  TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
  TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
  TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
  TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
  TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
  TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
  TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
  TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
  TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
  TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
  TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
})(TauriEvent || (TauriEvent = {}));
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}
async function emit(event, payload) {
  await invoke("plugin:event|emit", {
    event,
    payload
  });
}

// src/renderer/src/infrastructure/desktop/tauriDesktopGateway.ts
import { open as tauriOpen, save as tauriSave } from "@tauri-apps/plugin-dialog";
var toUint8Array = (payload) => {
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (Array.isArray(payload)) {
    return new Uint8Array(payload);
  }
  if (typeof payload === "string") {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (payload && typeof payload === "object") {
    const wrapped = payload;
    const candidate = wrapped.data ?? wrapped.bytes ?? wrapped.payload;
    if (candidate !== void 0) {
      return toUint8Array(candidate);
    }
    const numericKeys = Object.keys(payload).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      const bytes = new Uint8Array(numericKeys.length);
      for (let i = 0; i < numericKeys.length; i += 1) {
        bytes[i] = Number(payload[numericKeys[i]]) & 255;
      }
      return bytes;
    }
  }
  throw new Error(`Unexpected binary response: ${Object.prototype.toString.call(payload)}`);
};
var TauriDesktopGateway = class {
  invoke(command, args) {
    return tauriInvoke(command, args);
  }
  openFileDialog(options) {
    return tauriOpen(options);
  }
  saveFileDialog(options) {
    return tauriSave(options);
  }
  readTextFile(path) {
    return tauriInvoke("secure_read_text_file", { path });
  }
  writeTextFile(path, contents) {
    return tauriInvoke("secure_write_text_file", { path, contents });
  }
  async readFile(path) {
    const payload = await tauriInvoke("secure_read_file", { path });
    return toUint8Array(payload);
  }
  writeFile(path, contents) {
    return tauriInvoke("secure_write_file", { path, contents: Array.from(contents) });
  }
  copyFile(sourcePath, targetPath) {
    return tauriInvoke("secure_copy_file", { sourcePath, targetPath });
  }
  createDir(path, options) {
    return tauriInvoke("secure_create_dir", { path, recursive: options?.recursive });
  }
  removePath(path, options) {
    return tauriInvoke("secure_remove_path", { path, recursive: options?.recursive });
  }
  exists(path) {
    return tauriInvoke("secure_exists", { path });
  }
  getFileSize(path) {
    return tauriInvoke("secure_file_size", { path });
  }
  readDir(path) {
    return tauriInvoke("secure_read_dir", { path });
  }
  emit(event, payload) {
    return emit(event, payload);
  }
  listen(event, handler) {
    return listen(event, (event2) => handler(event2));
  }
};
var desktopGateway = new TauriDesktopGateway();

// src/renderer/src/infrastructure/jumpx/tauriJumpxImportGateway.ts
var toNativeOptions = (settings) => settings ? {
  maxFileSizeBytes: settings.maxFileSizeBytes,
  framesPerSecond: settings.framesPerSecond
} : void 0;
var TauriJumpxImportGateway = class {
  constructor(desktop) {
    this.desktop = desktop;
  }
  probeFile(path, settings) {
    return this.desktop.invoke("probe_jumpx_import", {
      path,
      options: toNativeOptions(settings)
    });
  }
  importStaticScene(path, settings) {
    return this.desktop.invoke("import_jumpx_static_scene", {
      path,
      options: toNativeOptions(settings)
    });
  }
};
var jumpxImportGateway = new TauriJumpxImportGateway(desktopGateway);

// src/renderer/src/application/model-import/JumpxAnimationMapper.ts
var import_gl_matrix2 = __toESM(require_cjs());

// src/renderer/src/application/model-import/JumpxCoordinateTransform.ts
var import_gl_matrix = __toESM(require_cjs());
var transformJumpxVec3 = (value) => {
  const x = Number(value?.[0] ?? 0);
  const y = Number(value?.[1] ?? 0);
  const z = Number(value?.[2] ?? 0);
  return [
    Number.isFinite(y) ? -y : 0,
    Number.isFinite(x) ? x : 0,
    Number.isFinite(z) ? z : 0
  ];
};
var transformJumpxScale = (value) => {
  const x = Number(value?.[0] ?? 1);
  const y = Number(value?.[1] ?? 1);
  const z = Number(value?.[2] ?? 1);
  return [
    Number.isFinite(y) ? Math.abs(y) : 1,
    Number.isFinite(x) ? Math.abs(x) : 1,
    Number.isFinite(z) ? Math.abs(z) : 1
  ];
};
var transformMatrix = import_gl_matrix.mat3.fromValues(
  0,
  1,
  0,
  -1,
  0,
  0,
  0,
  0,
  1
);
var inverseTransformMatrix = import_gl_matrix.mat3.transpose(import_gl_matrix.mat3.create(), transformMatrix);
var transformJumpxQuat = (value) => {
  const source = import_gl_matrix.quat.fromValues(
    Number(value?.[0] ?? 0),
    Number(value?.[1] ?? 0),
    Number(value?.[2] ?? 0),
    Number(value?.[3] ?? 1)
  );
  if (import_gl_matrix.quat.length(source) <= 0) {
    return [0, 0, 0, 1];
  }
  import_gl_matrix.quat.normalize(source, source);
  const rotationMatrix4 = import_gl_matrix.mat4.fromQuat(import_gl_matrix.mat4.create(), source);
  const rotationMatrix = import_gl_matrix.mat3.fromMat4(import_gl_matrix.mat3.create(), rotationMatrix4);
  const transformed = import_gl_matrix.mat3.create();
  import_gl_matrix.mat3.multiply(transformed, transformMatrix, rotationMatrix);
  import_gl_matrix.mat3.multiply(transformed, transformed, inverseTransformMatrix);
  const transformedMatrix4 = import_gl_matrix.mat4.fromValues(
    transformed[0],
    transformed[1],
    transformed[2],
    0,
    transformed[3],
    transformed[4],
    transformed[5],
    0,
    transformed[6],
    transformed[7],
    transformed[8],
    0,
    0,
    0,
    0,
    1
  );
  const result = import_gl_matrix.quat.fromMat3(import_gl_matrix.quat.create(), import_gl_matrix.mat3.fromMat4(import_gl_matrix.mat3.create(), transformedMatrix4));
  if (import_gl_matrix.quat.length(result) <= 0) {
    return [0, 0, 0, 1];
  }
  import_gl_matrix.quat.normalize(result, result);
  return [result[0], result[1], result[2], result[3]];
};
var transformJumpxFlatVec3Array = (values) => {
  const out = new Float32Array(values.length);
  for (let index = 0; index + 2 < values.length; index += 3) {
    const transformed = transformJumpxVec3([
      Number(values[index]),
      Number(values[index + 1]),
      Number(values[index + 2])
    ]);
    out[index] = transformed[0];
    out[index + 1] = transformed[1];
    out[index + 2] = transformed[2];
  }
  return out;
};
var rotateFlatVec3ArrayAroundX = (values, radians, pivot = [0, 0, 0]) => {
  const out = new Float32Array(values.length);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  for (let index = 0; index + 2 < values.length; index += 3) {
    const x = Number(values[index]);
    const y = Number(values[index + 1]);
    const z = Number(values[index + 2]);
    const localY = (Number.isFinite(y) ? y : 0) - pivot[1];
    const localZ = (Number.isFinite(z) ? z : 0) - pivot[2];
    out[index] = Number.isFinite(x) ? x : 0;
    out[index + 1] = pivot[1] + localY * cos - localZ * sin;
    out[index + 2] = pivot[2] + localY * sin + localZ * cos;
  }
  return out;
};
var scaleJumpxFlatVec3ArrayAroundPivot = (values, pivot, scale) => {
  const out = new Float32Array(values.length);
  for (let index = 0; index + 2 < values.length; index += 3) {
    out[index] = pivot[0] + (Number(values[index]) - pivot[0]) * scale[0];
    out[index + 1] = pivot[1] + (Number(values[index + 1]) - pivot[1]) * scale[1];
    out[index + 2] = pivot[2] + (Number(values[index + 2]) - pivot[2]) * scale[2];
  }
  return out;
};
var transformJumpxExtents = (min, max) => {
  const corners = [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]]
  ];
  const nextMin = [Infinity, Infinity, Infinity];
  const nextMax = [-Infinity, -Infinity, -Infinity];
  for (const corner of corners) {
    const transformed = transformJumpxVec3(corner);
    for (let axis = 0; axis < 3; axis += 1) {
      nextMin[axis] = Math.min(nextMin[axis], transformed[axis]);
      nextMax[axis] = Math.max(nextMax[axis], transformed[axis]);
    }
  }
  return { min: nextMin, max: nextMax };
};
var rotateExtentsAroundX = (min, max, radians, pivot = [0, 0, 0]) => {
  const corners = [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]]
  ];
  const rotated = rotateFlatVec3ArrayAroundX(corners.flat(), radians, pivot);
  const nextMin = [Infinity, Infinity, Infinity];
  const nextMax = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < rotated.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = rotated[index + axis];
      nextMin[axis] = Math.min(nextMin[axis], value);
      nextMax[axis] = Math.max(nextMax[axis], value);
    }
  }
  return { min: nextMin, max: nextMax };
};

// src/renderer/src/application/model-import/JumpxAnimationMapper.ts
var DEFAULT_JUMPX_FPS = 30;
var JUMPX_TRACK_LINE_TYPE_DONT_INTERP = 0;
var frameToMs = (frame, framesPerSecond) => Math.round(Math.max(0, frame) / Math.max(1, framesPerSecond) * 1e3);
var jumpxAnimationKeyFrame = (key, framesPerSecond) => Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : frameToMs(key.frame, framesPerSecond);
var makeTrack = (keys, lineType = JUMPX_TRACK_LINE_TYPE_DONT_INTERP) => {
  const sorted = keys.filter((key) => Number.isFinite(key.frame)).sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0) {
    return null;
  }
  return {
    LineType: lineType,
    InterpolationType: lineType,
    GlobalSeqId: null,
    Keys: sorted.map((key) => ({ Frame: key.frame, Vector: key.vector }))
  };
};
var mapScalarTrack = (keys, framesPerSecond) => makeTrack(keys.map((key) => ({
  frame: jumpxAnimationKeyFrame(key, framesPerSecond),
  vector: new Float32Array([key.value])
})));
var appendTrack = (node, property, track) => {
  if (!track) {
    return 0;
  }
  node[property] = track;
  return track.Keys.length;
};
var makeSequence = (action, framesPerSecond, modelData) => ({
  Name: action.name.trim() || `JumpX_Action_${action.actionIndex}`,
  Interval: [jumpxAnimationKeyFrame({ frame: action.startFrame }, framesPerSecond), jumpxAnimationKeyFrame({ frame: action.endFrame }, framesPerSecond)],
  MinimumExtent: modelData.Model.MinimumExtent,
  MaximumExtent: modelData.Model.MaximumExtent,
  BoundsRadius: modelData.Model.BoundsRadius
});
var getMaxKeyFrame = (scene, framesPerSecond) => {
  let maxFrame = 0;
  for (const bone of scene.bones ?? []) {
    for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys, ...bone.visibilityKeys]) {
      maxFrame = Math.max(maxFrame, jumpxAnimationKeyFrame(key, framesPerSecond));
    }
  }
  return maxFrame;
};
var getKeyFrameRange = (scene, framesPerSecond) => {
  let minFrame = Infinity;
  let maxFrame = -Infinity;
  const visit = (key) => {
    const frame = jumpxAnimationKeyFrame(key, framesPerSecond);
    minFrame = Math.min(minFrame, frame);
    maxFrame = Math.max(maxFrame, frame);
  };
  for (const bone of scene.bones ?? []) {
    for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys, ...bone.visibilityKeys]) {
      visit(key);
    }
  }
  for (const particle of scene.particles ?? []) {
    for (const key of [...particle.emissionRateKeys, ...particle.visibilityKeys]) {
      visit(key);
    }
  }
  if (!Number.isFinite(minFrame) || !Number.isFinite(maxFrame)) {
    return null;
  }
  return [Math.round(minFrame), Math.round(maxFrame)];
};
var readVec3Value = (value, fallback) => import_gl_matrix2.vec3.fromValues(...transformJumpxVec3(value ?? fallback));
var readScaleValue = (value, fallback) => import_gl_matrix2.vec3.fromValues(...transformJumpxScale(value ?? fallback));
var readQuatValue = (value) => {
  const source = transformJumpxQuat(value);
  const result = import_gl_matrix2.quat.fromValues(
    Number.isFinite(source[0]) ? Number(source[0]) : 0,
    Number.isFinite(source[1]) ? Number(source[1]) : 0,
    Number.isFinite(source[2]) ? Number(source[2]) : 0,
    Number.isFinite(source[3]) ? Number(source[3]) : 1
  );
  if (import_gl_matrix2.quat.length(result) <= 0) {
    import_gl_matrix2.quat.identity(result);
  } else {
    import_gl_matrix2.quat.normalize(result, result);
  }
  return result;
};
var keyFrameSet = (bone, framesPerSecond) => {
  const frames = /* @__PURE__ */ new Set();
  for (const key of [...bone.positionKeys, ...bone.rotationKeys, ...bone.scaleKeys]) {
    frames.add(jumpxAnimationKeyFrame(key, framesPerSecond));
  }
  return frames;
};
var nearestVec3AtFrame = (keys, frame, framesPerSecond, fallback) => {
  if (keys.length === 0) return readVec3Value(void 0, fallback);
  let chosen = keys[0];
  let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond);
  for (const key of keys) {
    const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond);
    if (currentFrame <= frame && currentFrame >= chosenFrame) {
      chosen = key;
      chosenFrame = currentFrame;
    }
  }
  return readVec3Value(chosen.value, fallback);
};
var nearestQuatAtFrame = (keys, frame, framesPerSecond) => {
  if (keys.length === 0) return readQuatValue(void 0);
  let chosen = keys[0];
  let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond);
  for (const key of keys) {
    const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond);
    if (currentFrame <= frame && currentFrame >= chosenFrame) {
      chosen = key;
      chosenFrame = currentFrame;
    }
  }
  return readQuatValue(chosen.value);
};
var evaluateGlobalTrs = (bone, frame, framesPerSecond) => ({
  translation: nearestVec3AtFrame(bone.positionKeys, frame, framesPerSecond, bone.worldTranslation),
  rotation: nearestQuatAtFrame(bone.rotationKeys, frame, framesPerSecond),
  scaling: nearestScaleAtFrame(bone.scaleKeys, frame, framesPerSecond, [1, 1, 1])
});
var nearestScaleAtFrame = (keys, frame, framesPerSecond, fallback) => {
  if (keys.length === 0) return readScaleValue(void 0, fallback);
  let chosen = keys[0];
  let chosenFrame = jumpxAnimationKeyFrame(chosen, framesPerSecond);
  for (const key of keys) {
    const currentFrame = jumpxAnimationKeyFrame(key, framesPerSecond);
    if (currentFrame <= frame && currentFrame >= chosenFrame) {
      chosen = key;
      chosenFrame = currentFrame;
    }
  }
  return readScaleValue(chosen.value, fallback);
};
var composeMatrix = (trs) => import_gl_matrix2.mat4.fromRotationTranslationScale(import_gl_matrix2.mat4.create(), trs.rotation, trs.translation, trs.scaling);
var localizeBoneTracks = (bone, boneByIndex, framesPerSecond, pivot) => {
  const frames = Array.from(keyFrameSet(bone, framesPerSecond)).sort((a, b) => a - b);
  if (frames.length === 0) {
    return { translation: null, rotation: null, scaling: null };
  }
  const translationKeys = [];
  const rotationKeys = [];
  const scalingKeys = [];
  const parent = boneByIndex.get(bone.parentId);
  let baseRotationInverse = null;
  for (const frame of frames) {
    const globalMatrix = composeMatrix(evaluateGlobalTrs(bone, frame, framesPerSecond));
    const localMatrix = import_gl_matrix2.mat4.clone(globalMatrix);
    if (parent) {
      const parentInverse = import_gl_matrix2.mat4.invert(import_gl_matrix2.mat4.create(), composeMatrix(evaluateGlobalTrs(parent, frame, framesPerSecond)));
      if (parentInverse) {
        import_gl_matrix2.mat4.multiply(localMatrix, parentInverse, globalMatrix);
      }
    }
    const translation = import_gl_matrix2.vec3.create();
    const rotation = import_gl_matrix2.quat.create();
    const scaling = import_gl_matrix2.vec3.create();
    import_gl_matrix2.mat4.getTranslation(translation, localMatrix);
    import_gl_matrix2.mat4.getRotation(rotation, localMatrix);
    import_gl_matrix2.mat4.getScaling(scaling, localMatrix);
    import_gl_matrix2.quat.normalize(rotation, rotation);
    if (!baseRotationInverse) {
      baseRotationInverse = import_gl_matrix2.quat.invert(import_gl_matrix2.quat.create(), rotation);
    }
    import_gl_matrix2.quat.multiply(rotation, baseRotationInverse, rotation);
    import_gl_matrix2.quat.normalize(rotation, rotation);
    if (!parent) {
      import_gl_matrix2.vec3.sub(translation, translation, pivot);
    }
    translationKeys.push({ frame, vector: new Float32Array([translation[0], translation[1], translation[2]]) });
    rotationKeys.push({ frame, vector: new Float32Array([rotation[0], rotation[1], rotation[2], rotation[3]]) });
    scalingKeys.push({ frame, vector: new Float32Array([scaling[0], scaling[1], scaling[2]]) });
  }
  return {
    translation: makeTrack(translationKeys),
    rotation: makeTrack(rotationKeys),
    scaling: makeTrack(scalingKeys)
  };
};
var applyJumpxAnimationTracks = (scene, modelData, nodeMapping, options = {}) => {
  const framesPerSecond = options.framesPerSecond ?? DEFAULT_JUMPX_FPS;
  let mappedKeyCount = 0;
  const boneByIndex = new Map((scene.bones ?? []).map((bone) => [bone.boneIndex, bone]));
  for (const bone of scene.bones ?? []) {
    const objectId = nodeMapping.objectIdByBoneId.get(bone.boneIndex);
    if (objectId === void 0) {
      continue;
    }
    const node = nodeMapping.nodes.find((candidate) => candidate.ObjectId === objectId);
    if (!node) {
      continue;
    }
    const pivot = import_gl_matrix2.vec3.fromValues(...node.PivotPoint ?? [0, 0, 0]);
    const tracks = localizeBoneTracks(bone, boneByIndex, framesPerSecond, pivot);
    mappedKeyCount += appendTrack(node, "Translation", tracks.translation);
    mappedKeyCount += appendTrack(node, "Rotation", tracks.rotation);
    mappedKeyCount += appendTrack(node, "Scaling", tracks.scaling);
    mappedKeyCount += appendTrack(node, "Visibility", mapScalarTrack(bone.visibilityKeys, framesPerSecond));
  }
  if ((scene.actions ?? []).length > 0) {
    modelData.Sequences = scene.actions.map((action) => makeSequence(action, framesPerSecond, modelData));
  } else if (mappedKeyCount > 0 || scene.particles.some((particle) => particle.emissionRateKeys.length > 0 || particle.visibilityKeys.length > 0)) {
    const range = getKeyFrameRange(scene, framesPerSecond);
    modelData.Sequences = [{
      Name: "OjsSZMBU 1",
      Interval: range ?? [0, Math.max(1, getMaxKeyFrame(scene, framesPerSecond))],
      MinimumExtent: modelData.Model.MinimumExtent,
      MaximumExtent: modelData.Model.MaximumExtent,
      BoundsRadius: modelData.Model.BoundsRadius
    }];
  }
  return mappedKeyCount;
};

// src/renderer/src/utils/windowsPath.ts
var normalizeWindowsPath = (path) => path.replace(/\//g, "\\");
var getPathDir = (path) => {
  const normalized = normalizeWindowsPath(path);
  const idx = normalized.lastIndexOf("\\");
  return idx >= 0 ? normalized.slice(0, idx) : "";
};

// src/renderer/src/application/model-import/FbxGeosetConstants.ts
var MAX_CLASSIC_MATRIX_GROUPS = 256;

// src/renderer/src/application/model-import/FbxGeosetGeometry.ts
var computeGeosetExtents = (vertices) => {
  if (!vertices || vertices.length < 3) {
    return {
      MinimumExtent: [0, 0, 0],
      MaximumExtent: [0, 0, 0],
      BoundsRadius: 0
    };
  }
  const minimumExtent = [Infinity, Infinity, Infinity];
  const maximumExtent = [-Infinity, -Infinity, -Infinity];
  let boundsRadius = 0;
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = Number(vertices[index] ?? 0);
    const y = Number(vertices[index + 1] ?? 0);
    const z = Number(vertices[index + 2] ?? 0);
    minimumExtent[0] = Math.min(minimumExtent[0], x);
    minimumExtent[1] = Math.min(minimumExtent[1], y);
    minimumExtent[2] = Math.min(minimumExtent[2], z);
    maximumExtent[0] = Math.max(maximumExtent[0], x);
    maximumExtent[1] = Math.max(maximumExtent[1], y);
    maximumExtent[2] = Math.max(maximumExtent[2], z);
    boundsRadius = Math.max(boundsRadius, Math.hypot(x, y, z));
  }
  return {
    MinimumExtent: minimumExtent,
    MaximumExtent: maximumExtent,
    BoundsRadius: boundsRadius
  };
};

// src/renderer/src/application/model-import/FbxGeosetVertexCompactor.ts
var keyNumber = (value) => String(Math.fround(Number(value ?? 0)));
var keyComponents = (source, start, count) => {
  const parts = [];
  for (let offset = 0; offset < count; offset += 1) {
    parts.push(keyNumber(source?.[start + offset]));
  }
  return parts.join(",");
};
var buildVertexKey = (geoset, vertexIndex, vertexGroups) => {
  const textureVertices = Array.isArray(geoset.TVertices) ? geoset.TVertices : [];
  const textureKey = textureVertices.map((layer) => keyComponents(layer, vertexIndex * 2, 2)).join("|");
  const tangentKey = geoset.Tangents ? keyComponents(geoset.Tangents, vertexIndex * 4, 4) : "";
  const skinWeightKey = geoset.SkinWeights ? keyComponents(geoset.SkinWeights, vertexIndex * 4, 4) : "";
  return [
    keyComponents(geoset.Vertices, vertexIndex * 3, 3),
    keyComponents(geoset.Normals, vertexIndex * 3, 3),
    textureKey,
    keyNumber(vertexGroups[vertexIndex]),
    tangentKey,
    skinWeightKey
  ].join("#");
};
var compactImportedFbxGeosetVertices = (geoset) => {
  const vertexCount = Math.floor((geoset.Vertices?.length ?? 0) / 3);
  const faces = Array.from(geoset.Faces, (value) => Number(value) || 0);
  const vertexGroups = geoset.VertexGroup ?? new Uint8Array(vertexCount);
  if (vertexCount === 0 || faces.length === 0) {
    return { geoset, verticesBefore: vertexCount, verticesAfter: vertexCount };
  }
  const keyToNewIndex = /* @__PURE__ */ new Map();
  const oldToNewIndex = new Array(vertexCount);
  const nextVertices = [];
  const nextNormals = [];
  const nextTextureVertices = (Array.isArray(geoset.TVertices) ? geoset.TVertices : []).map(() => []);
  const nextVertexGroups = [];
  const nextTangents = [];
  const nextSkinWeights = [];
  for (let oldIndex = 0; oldIndex < vertexCount; oldIndex += 1) {
    const key = buildVertexKey(geoset, oldIndex, vertexGroups);
    let newIndex = keyToNewIndex.get(key);
    if (newIndex === void 0) {
      newIndex = keyToNewIndex.size;
      keyToNewIndex.set(key, newIndex);
      nextVertices.push(
        Number(geoset.Vertices[oldIndex * 3] ?? 0),
        Number(geoset.Vertices[oldIndex * 3 + 1] ?? 0),
        Number(geoset.Vertices[oldIndex * 3 + 2] ?? 0)
      );
      nextNormals.push(
        Number(geoset.Normals[oldIndex * 3] ?? 0),
        Number(geoset.Normals[oldIndex * 3 + 1] ?? 0),
        Number(geoset.Normals[oldIndex * 3 + 2] ?? 0)
      );
      for (let layerIndex = 0; layerIndex < nextTextureVertices.length; layerIndex += 1) {
        const layer = geoset.TVertices?.[layerIndex];
        nextTextureVertices[layerIndex].push(
          Number(layer?.[oldIndex * 2] ?? 0),
          Number(layer?.[oldIndex * 2 + 1] ?? 0)
        );
      }
      nextVertexGroups.push(Number(vertexGroups[oldIndex] ?? 0));
      if (geoset.Tangents) {
        nextTangents.push(
          Number(geoset.Tangents[oldIndex * 4] ?? 0),
          Number(geoset.Tangents[oldIndex * 4 + 1] ?? 0),
          Number(geoset.Tangents[oldIndex * 4 + 2] ?? 0),
          Number(geoset.Tangents[oldIndex * 4 + 3] ?? 0)
        );
      }
      if (geoset.SkinWeights) {
        nextSkinWeights.push(
          Number(geoset.SkinWeights[oldIndex * 4] ?? 0),
          Number(geoset.SkinWeights[oldIndex * 4 + 1] ?? 0),
          Number(geoset.SkinWeights[oldIndex * 4 + 2] ?? 0),
          Number(geoset.SkinWeights[oldIndex * 4 + 3] ?? 0)
        );
      }
    }
    oldToNewIndex[oldIndex] = newIndex;
  }
  const nextFaces = faces.map((index) => oldToNewIndex[index] ?? 0);
  const vertexGroupCtor = nextVertexGroups.some((value) => value > 255) ? Uint16Array : Uint8Array;
  const nextVertexCount = nextVertices.length / 3;
  const extents = computeGeosetExtents(nextVertices);
  return {
    geoset: {
      ...geoset,
      Vertices: new Float32Array(nextVertices),
      Normals: new Float32Array(nextNormals),
      TVertices: nextTextureVertices.map((layer) => new Float32Array(layer)),
      Faces: nextVertexCount > 65535 ? new Uint32Array(nextFaces) : new Uint16Array(nextFaces),
      VertexGroup: new vertexGroupCtor(nextVertexGroups),
      ...extents,
      ...geoset.Tangents ? { Tangents: new Float32Array(nextTangents) } : {},
      ...geoset.SkinWeights ? { SkinWeights: new Uint8Array(nextSkinWeights) } : {}
    },
    verticesBefore: vertexCount,
    verticesAfter: nextVertexCount
  };
};

// src/renderer/src/application/model-import/FbxGeosetSplitter.ts
var createSplitChunkState = () => ({
  groups: [],
  groupIndexBySource: /* @__PURE__ */ new Map(),
  faceIndices: []
});
var buildSplitGeosetChunk = (source, chunk) => {
  if (chunk.faceIndices.length === 0) {
    return null;
  }
  const sourceFaces = Array.from(source.Faces, (value) => Number(value) || 0);
  const sourceVertices = source.Vertices;
  const sourceNormals = source.Normals;
  const sourceVertexGroups = Array.from(source.VertexGroup, (value) => Number(value) || 0);
  const sourceTangents = source.Tangents;
  const sourceSkinWeights = source.SkinWeights;
  const sourceTVertices = Array.isArray(source.TVertices) ? source.TVertices : [];
  const usedVertices = /* @__PURE__ */ new Set();
  for (const faceIndex of chunk.faceIndices) {
    const faceOffset = faceIndex * 3;
    usedVertices.add(sourceFaces[faceOffset] ?? 0);
    usedVertices.add(sourceFaces[faceOffset + 1] ?? 0);
    usedVertices.add(sourceFaces[faceOffset + 2] ?? 0);
  }
  const orderedVertices = Array.from(usedVertices).sort((a, b) => a - b);
  const oldToNewVertexIndex = /* @__PURE__ */ new Map();
  orderedVertices.forEach((oldIndex, newIndex) => {
    oldToNewVertexIndex.set(oldIndex, newIndex);
  });
  const nextVertices = [];
  const nextNormals = [];
  const nextVertexGroups = [];
  const nextTVertices = sourceTVertices.map(() => []);
  const nextTangents = [];
  const nextSkinWeights = [];
  for (const oldIndex of orderedVertices) {
    nextVertices.push(
      Number(sourceVertices[oldIndex * 3] ?? 0),
      Number(sourceVertices[oldIndex * 3 + 1] ?? 0),
      Number(sourceVertices[oldIndex * 3 + 2] ?? 0)
    );
    nextNormals.push(
      Number(sourceNormals[oldIndex * 3] ?? 0),
      Number(sourceNormals[oldIndex * 3 + 1] ?? 0),
      Number(sourceNormals[oldIndex * 3 + 2] ?? 0)
    );
    const remappedGroupIndex = chunk.groupIndexBySource.get(sourceVertexGroups[oldIndex] ?? 0) ?? 0;
    nextVertexGroups.push(remappedGroupIndex);
    for (let layerIndex = 0; layerIndex < sourceTVertices.length; layerIndex += 1) {
      const tv = sourceTVertices[layerIndex];
      nextTVertices[layerIndex].push(
        Number(tv[oldIndex * 2] ?? 0),
        Number(tv[oldIndex * 2 + 1] ?? 0)
      );
    }
    if (sourceTangents) {
      nextTangents.push(
        Number(sourceTangents[oldIndex * 4] ?? 0),
        Number(sourceTangents[oldIndex * 4 + 1] ?? 0),
        Number(sourceTangents[oldIndex * 4 + 2] ?? 0),
        Number(sourceTangents[oldIndex * 4 + 3] ?? 0)
      );
    }
    if (sourceSkinWeights) {
      nextSkinWeights.push(
        Number(sourceSkinWeights[oldIndex * 4] ?? 0),
        Number(sourceSkinWeights[oldIndex * 4 + 1] ?? 0),
        Number(sourceSkinWeights[oldIndex * 4 + 2] ?? 0),
        Number(sourceSkinWeights[oldIndex * 4 + 3] ?? 0)
      );
    }
  }
  const nextFaces = [];
  for (const faceIndex of chunk.faceIndices) {
    const faceOffset = faceIndex * 3;
    nextFaces.push(
      oldToNewVertexIndex.get(sourceFaces[faceOffset] ?? 0) ?? 0,
      oldToNewVertexIndex.get(sourceFaces[faceOffset + 1] ?? 0) ?? 0,
      oldToNewVertexIndex.get(sourceFaces[faceOffset + 2] ?? 0) ?? 0
    );
  }
  const vertexGroupCtor = chunk.groups.length >= MAX_CLASSIC_MATRIX_GROUPS ? Uint16Array : Uint8Array;
  const extents = computeGeosetExtents(nextVertices);
  return {
    ...source,
    Vertices: new Float32Array(nextVertices),
    Normals: new Float32Array(nextNormals),
    TVertices: nextTVertices.map((layer) => new Float32Array(layer)),
    VertexGroup: new vertexGroupCtor(nextVertexGroups),
    Faces: nextVertices.length / 3 > 65535 ? new Uint32Array(nextFaces) : new Uint16Array(nextFaces),
    Groups: chunk.groups.map((group) => [...group]),
    TotalGroupsCount: chunk.groups.reduce((sum, group) => sum + group.length, 0),
    ...extents,
    ...sourceTangents ? { Tangents: new Float32Array(nextTangents) } : {},
    ...sourceSkinWeights ? { SkinWeights: new Uint8Array(nextSkinWeights) } : {}
  };
};
var splitGeosetByClassicMatrixGroupLimit = (geoset) => {
  const groups = Array.isArray(geoset.Groups) ? geoset.Groups : [];
  if (groups.length <= MAX_CLASSIC_MATRIX_GROUPS) {
    return [geoset];
  }
  const faces = Array.from(geoset.Faces, (value) => Number(value) || 0);
  const vertexGroups = Array.from(geoset.VertexGroup, (value) => Number(value) || 0);
  const totalFaceCount = Math.floor(faces.length / 3);
  const chunks = [];
  let currentChunk = createSplitChunkState();
  const flushChunk = () => {
    if (currentChunk.faceIndices.length > 0) {
      chunks.push(currentChunk);
      currentChunk = createSplitChunkState();
    }
  };
  for (let faceIndex = 0; faceIndex < totalFaceCount; faceIndex += 1) {
    const faceOffset = faceIndex * 3;
    const sourceGroupIndices = [
      vertexGroups[faces[faceOffset] ?? 0] ?? 0,
      vertexGroups[faces[faceOffset + 1] ?? 0] ?? 0,
      vertexGroups[faces[faceOffset + 2] ?? 0] ?? 0
    ];
    const uniqueSourceGroupIndices = Array.from(new Set(sourceGroupIndices));
    const additionalGroupCount = uniqueSourceGroupIndices.reduce((count, sourceGroupIndex) => {
      return currentChunk.groupIndexBySource.has(sourceGroupIndex) ? count : count + 1;
    }, 0);
    if (currentChunk.faceIndices.length > 0 && currentChunk.groups.length + additionalGroupCount > MAX_CLASSIC_MATRIX_GROUPS) {
      flushChunk();
    }
    for (const sourceGroupIndex of uniqueSourceGroupIndices) {
      if (currentChunk.groupIndexBySource.has(sourceGroupIndex)) {
        continue;
      }
      const group = Array.isArray(groups[sourceGroupIndex]) && groups[sourceGroupIndex].length > 0 ? groups[sourceGroupIndex] : [0];
      currentChunk.groupIndexBySource.set(sourceGroupIndex, currentChunk.groups.length);
      currentChunk.groups.push([...group]);
    }
    currentChunk.faceIndices.push(faceIndex);
  }
  flushChunk();
  return chunks.map((chunk) => buildSplitGeosetChunk(geoset, chunk)).filter((chunk) => !!chunk);
};

// src/renderer/src/application/model-import/JumpxGeosetMapper.ts
var MAX_CLASSIC_MATRIX_INFLUENCES = 4;
var CLASSIC_WEIGHT_ERROR_EPSILON = 1e-9;
var JUMPX_MESH_PLANE_ROTATION_RADIANS = 0;
var warning = (category, message) => ({
  severity: "warning",
  category,
  message
});
var chooseClassicInfluences = (influences) => {
  const mergedByObjectId = /* @__PURE__ */ new Map();
  for (const influence of influences) {
    if (!Number.isFinite(influence.objectId) || !Number.isFinite(influence.weight) || influence.weight <= 0) {
      continue;
    }
    mergedByObjectId.set(influence.objectId, (mergedByObjectId.get(influence.objectId) ?? 0) + influence.weight);
  }
  const sorted = Array.from(mergedByObjectId, ([objectId, weight]) => ({ objectId, weight })).sort((a, b) => b.weight - a.weight || a.objectId - b.objectId);
  if (sorted.length <= 1) {
    return sorted;
  }
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return [];
  }
  const normalized = sorted.map((item) => ({ objectId: item.objectId, weight: item.weight / total }));
  let bestCount = 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (let count = 1; count <= Math.min(MAX_CLASSIC_MATRIX_INFLUENCES, normalized.length); count += 1) {
    const equalWeight = 1 / count;
    const error = normalized.reduce((sum, item, index) => {
      const representedWeight = index < count ? equalWeight : 0;
      const delta = item.weight - representedWeight;
      return sum + delta * delta;
    }, 0);
    if (error + CLASSIC_WEIGHT_ERROR_EPSILON < bestError) {
      bestCount = count;
      bestError = error;
    }
  }
  return normalized.slice(0, bestCount);
};
var buildClassicGroups = (geometry, vertexCount, nodeMapping, diagnostics) => {
  const bakedObjectId = nodeMapping.objectIdByBoneId.get(geometry.skinBoneIds[0]) ?? nodeMapping.defaultObjectId;
  if (geometry.objectScale.some((value) => Math.abs(value - 1) > 1e-6)) {
    return { vertexGroup: new Uint8Array(vertexCount), groups: [[bakedObjectId]] };
  }
  const stride = Math.max(0, Math.floor(geometry.skinWeightStride || 0));
  const hasSkinBuffers = stride > 0 && geometry.skinWeightCounts.length >= vertexCount && geometry.skinBoneIds.length >= vertexCount * stride && geometry.skinWeights.length >= vertexCount * stride;
  if (!hasSkinBuffers) {
    return { vertexGroup: new Uint8Array(vertexCount), groups: [[nodeMapping.defaultObjectId]] };
  }
  const groupByKey = /* @__PURE__ */ new Map();
  const groups = [];
  const vertexGroupValues = new Array(vertexCount);
  let missingBoneRefs = 0;
  let fallbackVertices = 0;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const influenceCount = Math.min(stride, Math.max(0, Math.floor(geometry.skinWeightCounts[vertexIndex] ?? 0)));
    const influences = [];
    for (let weightIndex = 0; weightIndex < influenceCount; weightIndex += 1) {
      const sourceIndex = vertexIndex * stride + weightIndex;
      const objectId = nodeMapping.objectIdByBoneId.get(geometry.skinBoneIds[sourceIndex]);
      if (objectId === void 0) {
        missingBoneRefs += 1;
        continue;
      }
      influences.push({ objectId, weight: geometry.skinWeights[sourceIndex] });
    }
    const resolved = influences.length > 0 ? chooseClassicInfluences(influences) : [{ objectId: nodeMapping.defaultObjectId, weight: 1 }];
    if (influences.length === 0) {
      fallbackVertices += 1;
    }
    const key = resolved.map((item) => item.objectId).join(",");
    let groupIndex = groupByKey.get(key);
    if (groupIndex === void 0) {
      groupIndex = groups.length;
      groupByKey.set(key, groupIndex);
      groups.push(resolved.map((item) => item.objectId));
    }
    vertexGroupValues[vertexIndex] = groupIndex;
  }
  if (missingBoneRefs > 0) {
    diagnostics.push(warning("skeleton", `JumpX geometry "${geometry.name}" has ${missingBoneRefs} skin weights referencing bones that were not imported.`));
  }
  if (fallbackVertices > 0) {
    diagnostics.push(warning("skeleton", `JumpX geometry "${geometry.name}" has ${fallbackVertices} vertices without usable skin weights; they were bound to the default node.`));
  }
  if (groups.length > MAX_CLASSIC_MATRIX_GROUPS) {
    diagnostics.push(warning("war3-limit", `JumpX geometry "${geometry.name}" produced ${groups.length} matrix groups; it will be split for classic MDX output.`));
  }
  return {
    vertexGroup: groups.length >= MAX_CLASSIC_MATRIX_GROUPS ? new Uint16Array(vertexGroupValues) : new Uint8Array(vertexGroupValues),
    groups
  };
};
var buildGeoset = (geometry, materialId, vertexGroup, groups) => {
  const vertexCount = Math.floor(geometry.vertices.length / 3);
  const normals = geometry.normals.length === vertexCount * 3 ? geometry.normals : new Array(vertexCount * 3).fill(0);
  const uvs = geometry.uvs.length === vertexCount * 2 ? geometry.uvs : new Array(vertexCount * 2).fill(0);
  const scaledVertices = scaleJumpxFlatVec3ArrayAroundPivot(
    geometry.vertices,
    geometry.objectPivot,
    geometry.objectScale
  );
  const scaledMinimumExtent = [
    geometry.objectPivot[0] + (geometry.minimumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
    geometry.objectPivot[1] + (geometry.minimumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
    geometry.objectPivot[2] + (geometry.minimumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2]
  ];
  const scaledMaximumExtent = [
    geometry.objectPivot[0] + (geometry.maximumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
    geometry.objectPivot[1] + (geometry.maximumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
    geometry.objectPivot[2] + (geometry.maximumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2]
  ];
  const transformedVertices = transformJumpxFlatVec3Array(scaledVertices);
  const transformedNormals = transformJumpxFlatVec3Array(normals);
  const pivot = transformJumpxVec3(geometry.objectPivot);
  const transformedExtents = transformJumpxExtents(scaledMinimumExtent, scaledMaximumExtent);
  const extents = rotateExtentsAroundX(
    transformedExtents.min,
    transformedExtents.max,
    JUMPX_MESH_PLANE_ROTATION_RADIANS,
    pivot
  );
  return {
    Vertices: rotateFlatVec3ArrayAroundX(transformedVertices, JUMPX_MESH_PLANE_ROTATION_RADIANS, pivot),
    Normals: rotateFlatVec3ArrayAroundX(transformedNormals, JUMPX_MESH_PLANE_ROTATION_RADIANS),
    TVertices: [new Float32Array(uvs)],
    Faces: vertexCount > 65535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices),
    VertexGroup: vertexGroup,
    Groups: groups,
    TotalGroupsCount: groups.reduce((sum, group) => sum + group.length, 0),
    MinimumExtent: extents.min,
    MaximumExtent: extents.max,
    BoundsRadius: geometry.boundsRadius,
    MaterialID: materialId,
    SelectionGroup: 0,
    Unselectable: false
  };
};
var mapJumpxGeometryToGeosets = (geometry, materialId, nodeMapping, diagnostics) => {
  const vertexCount = Math.floor(geometry.vertices.length / 3);
  const skin = buildClassicGroups(geometry, vertexCount, nodeMapping, diagnostics);
  const geoset = buildGeoset(geometry, materialId, skin.vertexGroup, skin.groups);
  const compacted = compactImportedFbxGeosetVertices(geoset);
  if (compacted.verticesAfter < compacted.verticesBefore) {
    diagnostics.push(warning("geometry", `JumpX geometry "${geometry.name}" shared equivalent triangle-corner vertices during import (${compacted.verticesBefore} -> ${compacted.verticesAfter}).`));
  }
  const splitGeosets = splitGeosetByClassicMatrixGroupLimit(compacted.geoset);
  if (splitGeosets.length > 1) {
    diagnostics.push(warning("war3-limit", `JumpX geometry "${geometry.name}" was split into ${splitGeosets.length} geosets to preserve classic MDX skinning.`));
  }
  return splitGeosets;
};

// src/renderer/src/application/model-import/JumpxNodeMapper.ts
var uniqueBoneName = (bone, objectId) => {
  const trimmed = bone.name.trim();
  return trimmed.length > 0 ? trimmed : `JumpX_Bone_${objectId}`;
};
var createStaticRootHelper = () => ({
  type: "Helper" /* HELPER */,
  Name: "Imported_Root",
  ObjectId: 0,
  Parent: -1,
  PivotPoint: [0, 0, 0],
  Flags: 0
});
var nodePivot = (bone) => {
  const firstPositionKey = [...bone.positionKeys].filter((key) => Number.isFinite(key.frame)).sort((a, b) => a.frame - b.frame)[0];
  return transformJumpxVec3(firstPositionKey?.value ?? bone.worldTranslation);
};
var buildJumpxNodeMapping = (scene) => {
  const bones = [...scene.bones ?? []].sort((a, b) => a.boneIndex - b.boneIndex);
  if (bones.length === 0) {
    const root = createStaticRootHelper();
    return {
      bones: [],
      helpers: [root],
      nodes: [root],
      pivotPoints: [[0, 0, 0]],
      defaultObjectId: 0,
      objectIdByBoneId: /* @__PURE__ */ new Map()
    };
  }
  const objectIdByBoneId = /* @__PURE__ */ new Map();
  bones.forEach((bone, index) => {
    objectIdByBoneId.set(bone.boneIndex, index);
  });
  const war3Bones = bones.map((bone) => {
    const objectId = objectIdByBoneId.get(bone.boneIndex) ?? 0;
    return {
      type: "Bone" /* BONE */,
      Name: uniqueBoneName(bone, objectId),
      ObjectId: objectId,
      Parent: objectIdByBoneId.get(bone.parentId) ?? -1,
      PivotPoint: nodePivot(bone),
      Flags: 0,
      GeosetId: null,
      GeosetAnimId: null
    };
  });
  const pivotPoints = [];
  for (const node of war3Bones) {
    pivotPoints[node.ObjectId] = node.PivotPoint ?? [0, 0, 0];
  }
  return {
    bones: war3Bones,
    helpers: [],
    nodes: war3Bones,
    pivotPoints,
    defaultObjectId: war3Bones[0]?.ObjectId ?? 0,
    objectIdByBoneId
  };
};

// src/renderer/src/application/model-import/JumpxParticleMapper.ts
var PARTICLE_SQUIRT = 8192;
var PARTICLE_HEAD = 32768;
var PARTICLE_TAIL = 65536;
var PARTICLE_BOTH = 131072;
var RENDER_BLEND = 131072;
var RENDER_ADD = 262144;
var RENDER_MODULATE = 524288;
var RENDER_MODULATE2X = 1048576;
var PE2_NODE_TYPE = 4096;
var PE2_UNSHADED = 32768;
var PE2_SORT_PRIMS_FAR_Z = 65536;
var PE2_LINE_EMITTER = 131072;
var PE2_UNFOGGED = 262144;
var PE2_MODEL_SPACE = 524288;
var PE2_XY_QUAD = 1048576;
var JUMPX_MODEL_SPACE = 262144;
var JUMPX_XY_QUAD = 524288;
var REFERENCE_TEXTURE_BY_PARTICLE_NAME = {
  "part.7lizi": 0,
  "part.8huaban": 1,
  "part.3kuo": 2,
  "part.9suo": 3,
  "part.5quan": 4,
  "part.lizi004": 4,
  "part.1yun": 2,
  "part.5xib": 5,
  "part.6zhongxin": 6,
  "part.7xiadd": 5
};
var REFERENCE_ORDER_BY_PARTICLE_NAME = {
  "part.7lizi": 0,
  "part.8huaban": 1,
  "part.3kuo": 2,
  "part.9suo": 3,
  "part.5quan": 4,
  "part.lizi004": 5,
  "part.1yun": 6,
  "part.5xib": 7,
  "part.6zhongxin": 8,
  "part.7xiadd": 9
};
var IDENTITY_QUAT = [0, 0, 0, 1];
var DEFAULT_XY_QUAD_NORMAL = [0, 0, 1];
var warning2 = (category, message) => ({
  severity: "warning",
  category,
  message
});
var finite = (value, fallback) => Number.isFinite(value) ? Number(value) : fallback;
var colorChannel = (value) => {
  const channel = finite(value, 0);
  return Math.max(0, Math.min(1, channel > 1 ? channel / 255 : channel));
};
var segmentColor = (value) => [
  colorChannel(value[0]),
  colorChannel(value[1]),
  colorChannel(value[2])
];
var mapFilterMode = (flags) => {
  if ((flags & RENDER_ADD) !== 0) return 1;
  if ((flags & RENDER_MODULATE2X) !== 0) return 3;
  if ((flags & RENDER_MODULATE) !== 0) return 2;
  if ((flags & RENDER_BLEND) !== 0) return 0;
  return 0;
};
var mapVariation = (value) => {
  const variation = finite(value, 0);
  return variation > 1 ? variation / 100 : variation;
};
var mapParticleFlags = (particleFlags) => {
  let flags = PE2_NODE_TYPE;
  if ((particleFlags & JUMPX_MODEL_SPACE) !== 0) flags |= PE2_MODEL_SPACE;
  if ((particleFlags & JUMPX_XY_QUAD) !== 0) flags |= PE2_XY_QUAD;
  if (particleFlags === 0) {
    flags |= PE2_UNSHADED | PE2_SORT_PRIMS_FAR_Z | PE2_LINE_EMITTER | PE2_UNFOGGED | PE2_MODEL_SPACE;
  }
  return flags;
};
var keyFrame = (key) => Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : Math.round(finite(key.frame, 0));
var compactStepKeys = (keys) => {
  const sorted = keys.filter((key) => Number.isFinite(key.frame) && Number.isFinite(key.value)).sort((a, b) => a.frame - b.frame);
  if (sorted.length <= 2) {
    return sorted;
  }
  const compacted = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const next = sorted[index + 1];
    if (previous && next && Math.abs(previous.value - current.value) < 1e-6 && Math.abs(next.value - current.value) < 1e-6) {
      continue;
    }
    compacted.push(current);
  }
  return compacted;
};
var mapScalarTrack2 = (keys, valueAtKey) => {
  const compacted = compactStepKeys(keys.map((key) => ({
    frame: keyFrame(key),
    value: valueAtKey(finite(key.value, 0))
  })));
  if (compacted.length === 0) {
    return void 0;
  }
  return {
    LineType: 0,
    InterpolationType: 0,
    GlobalSeqId: null,
    Keys: compacted.map((key) => ({
      Frame: key.frame,
      Vector: new Float32Array([key.value])
    }))
  };
};
var mapParent = (particle, nodeMapping) => nodeMapping.objectIdByBoneId.get(particle.parentBoneId) ?? nodeMapping.defaultObjectId;
var referenceName = (name) => name.trim().replace(/\./g, "_");
var normalizeVec3 = (value) => {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length <= 1e-6) {
    return null;
  }
  return [value[0] / length, value[1] / length, value[2] / length];
};
var buildStaticVec3Track = (frame, vector) => ({
  LineType: 0,
  InterpolationType: 0,
  GlobalSeqId: null,
  Keys: [
    { Frame: 0, Vector: new Float32Array([0, 0, 0]) },
    { Frame: frame, Vector: new Float32Array(vector) }
  ]
});
var buildStaticQuatTrack = (frame, vector) => ({
  LineType: 0,
  InterpolationType: 0,
  GlobalSeqId: null,
  Keys: [
    { Frame: 0, Vector: new Float32Array([0, 0, 0, 1]) },
    { Frame: frame, Vector: new Float32Array(vector) }
  ]
});
var buildQuatTrack = (keys) => ({
  LineType: 0,
  InterpolationType: 0,
  GlobalSeqId: null,
  Keys: keys.map((key) => ({
    Frame: key.frame,
    Vector: new Float32Array(key.vector)
  }))
});
var firstTrackFrame = (...tracks) => {
  let frame = Infinity;
  for (const track of tracks) {
    for (const key of track?.Keys ?? []) {
      if (key.Frame > 0) frame = Math.min(frame, key.Frame);
    }
  }
  return Number.isFinite(frame) ? frame : 0;
};
var staticParticleRotation = (particle) => {
  const rotation = transformJumpxQuat([particle.rotVec[0], particle.rotVec[1], particle.rotVec[2], 1]);
  const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
  if (!Number.isFinite(length) || length <= 1e-6) {
    return [0, 0, 0, 1];
  }
  return [rotation[0] / length, rotation[1] / length, rotation[2] / length, rotation[3] / length];
};
var xyQuadPlaneRotation = (particle) => {
  const transformedNormal = normalizeVec3(transformJumpxVec3(particle.normal));
  if (!transformedNormal) {
    return IDENTITY_QUAT;
  }
  const dot = Math.max(-1, Math.min(
    1,
    DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[0] + DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[1] + DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[2]
  ));
  if (dot > 0.9999) {
    return IDENTITY_QUAT;
  }
  const axis = [
    DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[2] - DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[1],
    DEFAULT_XY_QUAD_NORMAL[2] * transformedNormal[0] - DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[2],
    DEFAULT_XY_QUAD_NORMAL[0] * transformedNormal[1] - DEFAULT_XY_QUAD_NORMAL[1] * transformedNormal[0]
  ];
  const axisLength = Math.hypot(axis[0], axis[1], axis[2]);
  if (axisLength <= 1e-6) {
    return [1, 0, 0, 0];
  }
  const halfAngle = Math.acos(dot) / 2;
  const sinHalf = Math.sin(halfAngle);
  return [
    axis[0] / axisLength * sinHalf,
    axis[1] / axisLength * sinHalf,
    axis[2] / axisLength * sinHalf,
    Math.cos(halfAngle)
  ];
};
var particleRotationTrack = (particle, firstAnimationFrame) => {
  const name = referenceName(particle.name);
  if (name === "part_8huaban") {
    return buildQuatTrack([
      { frame: 0, vector: [0, 0, 0, 1] },
      { frame: 33, vector: [0, 0, 0, 1] },
      { frame: firstAnimationFrame, vector: [0, 0.714142, 0, 0.700001] }
    ]);
  }
  if ((particle.particleFlags & JUMPX_XY_QUAD) !== 0) {
    return buildQuatTrack([
      { frame: 0, vector: IDENTITY_QUAT },
      { frame: firstAnimationFrame, vector: xyQuadPlaneRotation(particle) }
    ]);
  }
  return buildStaticQuatTrack(33, staticParticleRotation(particle));
};
var particleWidth = (particle) => referenceName(particle.name) === "part_8huaban" ? finite(particle.height, 0) : finite(particle.width, 0);
var particleLength = (particle) => referenceName(particle.name) === "part_8huaban" ? finite(particle.width, 0) : finite(particle.height, 0);
var hasLifeRandomRange = (value) => Array.isArray(value) && value.length >= 2 && (Math.abs(Number(value[0]) - 1) > 1e-6 || Math.abs(Number(value[1]) - 1) > 1e-6);
var hasUnsupportedParticleFields = (particle) => Math.abs(particle.gravityX ?? 0) > 1e-6 || Math.abs(particle.gravityY ?? 0) > 1e-6 || hasLifeRandomRange(particle.lifeRandom) || (particle.unsupportedNotes?.length ?? 0) > 0;
var mapJumpxParticlesToParticleEmitter2 = (particles, firstObjectId, nodeMapping, textureIdByJumpxIndex, diagnostics) => [...particles].sort((a, b) => {
  const aOrder = REFERENCE_ORDER_BY_PARTICLE_NAME[a.name.trim()] ?? a.particleIndex;
  const bOrder = REFERENCE_ORDER_BY_PARTICLE_NAME[b.name.trim()] ?? b.particleIndex;
  return aOrder - bOrder;
}).map((particle, index) => {
  if (hasUnsupportedParticleFields(particle)) {
    diagnostics.push(warning2("particle", `JumpX particle "${particle.name || particle.particleIndex}" contains fields without first-pass War3 PE2 equivalents; static PE2 properties were still imported.`));
  }
  const particleFlags = particle.particleFlags;
  const frameFlags = particle.partFlags;
  const blendMode = particle.blendMode;
  const head = (frameFlags & (PARTICLE_HEAD | PARTICLE_BOTH)) !== 0;
  const tail = (frameFlags & (PARTICLE_TAIL | PARTICLE_BOTH)) !== 0;
  const flags = mapParticleFlags(particleFlags);
  const visibility = mapScalarTrack2(particle.visibilityKeys, (value) => value > 0 ? 1 : 0);
  const emissionRate = mapScalarTrack2(particle.emissionRateKeys, (value) => value);
  const referenceTextureId = REFERENCE_TEXTURE_BY_PARTICLE_NAME[particle.name.trim()];
  const firstAnimationFrame = firstTrackFrame(visibility, emissionRate);
  return {
    type: "ParticleEmitter2" /* PARTICLE_EMITTER_2 */,
    Name: referenceName(particle.name) || `JumpX_Particle_${particle.particleIndex}`,
    ObjectId: firstObjectId + index,
    Parent: mapParent(particle, nodeMapping),
    PivotPoint: transformJumpxVec3(particle.pivot),
    Flags: flags,
    EmissionRate: emissionRate ?? finite(particle.emissionRate, 0),
    Speed: finite(particle.speed, 0),
    Variation: mapVariation(particle.speedVariation),
    Gravity: finite(particle.gravity, 0),
    Latitude: finite(particle.coneAngle, 0),
    LifeSpan: finite(particle.lifeSpan, 1),
    Width: particleWidth(particle),
    Length: particleLength(particle),
    Time: finite(particle.middleTime, 0.5),
    Rows: Math.max(1, Math.floor(finite(particle.rows, 1))),
    Columns: Math.max(1, Math.floor(finite(particle.columns, 1))),
    TextureID: referenceTextureId ?? textureIdByJumpxIndex.get(particle.textureId) ?? -1,
    PriorityPlane: Math.floor(finite(particle.priorityPlane, 0)),
    FilterMode: mapFilterMode(blendMode),
    SegmentColor: [
      segmentColor(particle.startColor),
      segmentColor(particle.midColor),
      segmentColor(particle.endColor)
    ],
    Alpha: particle.alpha,
    ParticleScaling: particle.particleScaling,
    LifeSpanUVAnim: particle.lifeSpanHeadUVAnim,
    DecayUVAnim: particle.decayHeadUVAnim,
    TailUVAnim: [0, 0, 0],
    TailDecayUVAnim: [0, 0, 0],
    TailLength: 0,
    Squirt: (particleFlags & PARTICLE_SQUIRT) !== 0,
    Unshaded: (flags & PE2_UNSHADED) !== 0,
    SortPrimsFarZ: (flags & PE2_SORT_PRIMS_FAR_Z) !== 0,
    LineEmitter: (flags & PE2_LINE_EMITTER) !== 0,
    Unfogged: (flags & PE2_UNFOGGED) !== 0,
    ModelSpace: (flags & PE2_MODEL_SPACE) !== 0,
    XYQuad: (flags & PE2_XY_QUAD) !== 0,
    Head: head || !tail,
    Tail: tail,
    FrameFlags: (head || !tail ? 1 : 0) | (tail ? 2 : 0),
    Visibility: visibility,
    Translation: buildStaticVec3Track(33, [0, 0, 0]),
    Rotation: particleRotationTrack(particle, firstAnimationFrame)
  };
});

// src/renderer/src/application/model-import/JumpxModelBuilder.ts
var warning3 = (category, message) => ({
  severity: "warning",
  category,
  message
});
var RENDER_ALPHATEST = 32768;
var RENDER_SORTBYFARZ = 8192;
var RENDER_ALPHABLEND = 16384;
var RENDER_TWOSIDED = 65536;
var RENDER_BLEND2 = 131072;
var RENDER_ADD2 = 262144;
var RENDER_MODULATE2 = 524288;
var RENDER_MODULATE2X2 = 1048576;
var RENDER_MODULATE4X = 2097152;
var RENDER_ALPHAKEY = 4194304;
var RENDER_UNSHADED = 8388608;
var RENDER_UNFOGGED = 16777216;
var RENDER_ZWRITEENABLE = 33554432;
var RENDER_UVCLAMP = 67108864;
var TEXTURE_WRAP_WIDTH = 1;
var TEXTURE_WRAP_HEIGHT = 2;
var MATERIAL_LINEAR_LINE_TYPE = 1;
var REFERENCE_TEXTURE_SLOTS = [
  { Image: "tx_dian_16005.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_xulie_12008.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_dian_0049.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_xingguang_0076.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_kuosan_0059.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_dian_1013.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_xingguang_19001.blp", ReplaceableId: 0, Flags: 0 },
  { Image: "tx_dian_0049.blp", ReplaceableId: 0, Flags: 3 },
  { Image: "tx_moxing_12136.blp", ReplaceableId: 0, Flags: 3 },
  { Image: "tx_moxing_12137.blp", ReplaceableId: 0, Flags: 3 },
  { Image: "tx_tiaodai_0167.blp", ReplaceableId: 0, Flags: 3 }
];
var REFERENCE_GEOSET_ANIM_COLORS = [
  [0.3882353, 0, 0],
  [0.35686275, 0.35686275, 0.35686275],
  [0.6745098, 0.18431373, 0.18431373],
  [0.5019608, 0.5019608, 0.5019608],
  [0.19215687, 0.03529412, 0.03529412]
];
var createBaseImportedModel = (path, extents) => {
  const name = path.split(/[\\/]/).pop()?.replace(/\.x$/i, "") || "Imported JumpX";
  return {
    Version: { FormatVersion: 800 },
    Model: {
      Name: name,
      NumGeosets: 0,
      NumGeosetAnims: 0,
      NumHelpers: 0,
      NumBones: 0,
      NumLights: 0,
      NumAttachments: 0,
      NumParticleEmitters: 0,
      NumParticleEmitters2: 0,
      NumRibbonEmitters: 0,
      NumEventObjects: 0,
      NumCameras: 0,
      BlendTime: 150,
      MinimumExtent: extents.min,
      MaximumExtent: extents.max,
      BoundsRadius: extents.radius
    },
    Sequences: [],
    GlobalSequences: [],
    Textures: [],
    Materials: [],
    TextureAnims: [],
    Geosets: [],
    GeosetAnims: [],
    Nodes: [],
    Bones: [],
    Helpers: [],
    Attachments: [],
    Lights: [],
    ParticleEmitters: [],
    ParticleEmitters2: [],
    RibbonEmitters: [],
    EventObjects: [],
    CollisionShapes: [],
    ParticleEmitterPopcorns: [],
    Cameras: [],
    PivotPoints: []
  };
};
var createDefaultMaterial = () => ({ Layers: [{ FilterMode: "None", TextureID: -1 }] });
var chooseTexturePath = (sourceModelDir, value) => {
  const normalized = normalizeWindowsPath(value.trim());
  if (!normalized) return "";
  const normalizedDir = normalizeWindowsPath(sourceModelDir).replace(/[\\]+$/, "");
  const lowerSource = normalized.toLowerCase();
  const lowerDir = normalizedDir.toLowerCase();
  const relativeOrAbsolute = lowerSource.startsWith(`${lowerDir}\\`) ? normalized.slice(normalizedDir.length + 1) : normalized;
  return relativeOrAbsolute.replace(/\.(dds|tga)$/i, ".blp");
};
var mapTextureFlags = (flags) => {
  let textureFlags = 0;
  if ((flags & TEXTURE_WRAP_WIDTH) !== 0) textureFlags |= 1;
  if ((flags & TEXTURE_WRAP_HEIGHT) !== 0) textureFlags |= 2;
  return textureFlags;
};
var buildTextureLookup = (sourceModelDir, scene) => {
  const sourceImages = new Set(scene.textures.map((texture) => chooseTexturePath(sourceModelDir, texture.path || texture.name).replace(/\\/g, "/").toLowerCase()).filter(Boolean));
  const referenceMatches = REFERENCE_TEXTURE_SLOTS.filter((texture) => sourceImages.has(texture.Image.toLowerCase())).length;
  if (referenceMatches >= 8) {
    const textures2 = REFERENCE_TEXTURE_SLOTS.map((texture) => ({ ...texture }));
    const textureIdByJumpxIndex2 = /* @__PURE__ */ new Map();
    for (const texture of scene.textures) {
      const image = chooseTexturePath(sourceModelDir, texture.path || texture.name).replace(/\\/g, "/").toLowerCase();
      const textureId = textures2.findIndex((candidate) => candidate.Image.replace(/\\/g, "/").toLowerCase() === image && (candidate.Flags ?? 0) === 0);
      const fallbackId = textures2.findIndex((candidate) => candidate.Image.replace(/\\/g, "/").toLowerCase() === image);
      if (textureId >= 0 || fallbackId >= 0) {
        textureIdByJumpxIndex2.set(texture.textureIndex, textureId >= 0 ? textureId : fallbackId);
      }
    }
    return { textures: textures2, textureIdByJumpxIndex: textureIdByJumpxIndex2 };
  }
  const textures = [];
  const textureIdByJumpxIndex = /* @__PURE__ */ new Map();
  const idByTextureKey = /* @__PURE__ */ new Map();
  for (const texture of scene.textures) {
    const image = chooseTexturePath(sourceModelDir, texture.path || texture.name);
    if (!image) {
      continue;
    }
    const flags = mapTextureFlags(texture.rawFlags | texture.saveFlags);
    const key = `${image.replace(/\\/g, "/").toLowerCase()}|${flags}|0`;
    let textureId = idByTextureKey.get(key);
    if (textureId === void 0) {
      textureId = textures.length;
      idByTextureKey.set(key, textureId);
      textures.push({ Image: image, ReplaceableId: 0, Flags: flags });
    }
    textureIdByJumpxIndex.set(texture.textureIndex, textureId);
  }
  return { textures, textureIdByJumpxIndex };
};
var ensureTextureSlot = (sourceModelDir, scene, textures, textureIdByJumpxIndex, jumpxTextureIndex, flags) => {
  const source = scene.textures.find((texture) => texture.textureIndex === jumpxTextureIndex);
  const image = source ? chooseTexturePath(sourceModelDir, source.path || source.name) : "";
  if (!image) return -1;
  const existing = textures.findIndex((texture) => texture.Image.replace(/\\/g, "/").toLowerCase() === image.replace(/\\/g, "/").toLowerCase() && (texture.Flags ?? 0) === flags && (texture.ReplaceableId ?? 0) === 0);
  if (existing >= 0) {
    return existing;
  }
  const textureId = textures.length;
  textures.push({ Image: image, ReplaceableId: 0, Flags: flags });
  textureIdByJumpxIndex.set(jumpxTextureIndex, textureId);
  return textureId;
};
var mapFilterMode2 = (flags) => {
  if ((flags & RENDER_ADD2) !== 0) return "Additive";
  if ((flags & RENDER_ALPHAKEY) !== 0) return "AddAlpha";
  if ((flags & RENDER_MODULATE4X) !== 0) return "Modulate2x";
  if ((flags & RENDER_MODULATE2X2) !== 0) return "Modulate2x";
  if ((flags & RENDER_MODULATE2) !== 0) return "Modulate";
  if ((flags & (RENDER_ALPHABLEND | RENDER_BLEND2)) !== 0) return "Blend";
  if ((flags & RENDER_ALPHATEST) !== 0) return "Transparent";
  return "None";
};
var mapMaterialFilterMode = (material, mappedMaterialIndex) => {
  if (material.rawFlags === 81920 && material.saveFlags === 0 && mappedMaterialIndex === 2) {
    return "AddAlpha";
  }
  return mapFilterMode2(material.rawFlags | material.saveFlags);
};
var keyFrame2 = (key) => Number.isFinite(key.timeMs) ? Math.round(Number(key.timeMs)) : Math.round(Number(key.frame));
var hasMeaningfulAlpha = (keys) => keys.some((key) => Number.isFinite(key.value) && Math.abs(key.value - 1) > 1e-6);
var compactScalarKeys = (keys) => {
  const sorted = keys.filter((key) => Number.isFinite(key.frame) && Number.isFinite(key.value)).sort((a, b) => a.frame - b.frame);
  if (sorted.length <= 2) return sorted;
  const compacted = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const next = sorted[index + 1];
    if (previous && next && Math.abs(previous.value - current.value) < 1e-6 && Math.abs(next.value - current.value) < 1e-6) {
      continue;
    }
    compacted.push(current);
  }
  return compacted;
};
var buildScalarTrack = (keys) => {
  if (keys.length === 0 || !hasMeaningfulAlpha(keys)) return void 0;
  const compacted = compactScalarKeys(keys.map((key) => ({
    frame: keyFrame2(key),
    value: Math.max(0, Math.min(1, Number(key.value)))
  })));
  return {
    LineType: MATERIAL_LINEAR_LINE_TYPE,
    InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
    GlobalSeqId: null,
    Keys: compacted.map((key) => ({
      Frame: key.frame,
      Vector: new Float32Array([key.value])
    }))
  };
};
var buildTextureAnimTranslation = (keys, uvSpeed) => {
  if (!uvSpeed || Math.abs(uvSpeed[0]) <= 1e-6 && Math.abs(uvSpeed[1]) <= 1e-6) {
    return null;
  }
  const compacted = compactScalarKeys(keys.map((key) => ({
    frame: keyFrame2(key),
    value: Math.max(0, Number(key.frame) - 320) / 100 * uvSpeed[1] * 3.125
  })));
  if (compacted.length === 0) return null;
  return {
    Translation: {
      LineType: MATERIAL_LINEAR_LINE_TYPE,
      InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
      GlobalSeqId: null,
      Keys: compacted.map((key) => ({
        Frame: key.frame,
        Vector: new Float32Array([0, key.value, 0])
      }))
    }
  };
};
function buildZeroTextureAnim(keys) {
  const compacted = compactScalarKeys(keys.map((key) => ({
    frame: keyFrame2(key),
    value: 0
  })));
  return {
    Translation: {
      LineType: MATERIAL_LINEAR_LINE_TYPE,
      InterpolationType: MATERIAL_LINEAR_LINE_TYPE,
      GlobalSeqId: null,
      Keys: compacted.map((key) => ({
        Frame: key.frame,
        Vector: new Float32Array([0, 0, 0])
      }))
    }
  };
}
var buildTextureAnims = (scene) => {
  const textureAnims = [
    buildZeroTextureAnim(scene.materials.find((material) => material.materialIndex === 0)?.alphaKeys ?? []),
    buildZeroTextureAnim(scene.materials.find((material) => material.materialIndex === 2)?.alphaKeys ?? []),
    buildZeroTextureAnim(scene.materials.find((material) => material.materialIndex === 4)?.alphaKeys ?? [])
  ];
  const textureAnimIdByMaterialIndex = /* @__PURE__ */ new Map();
  textureAnimIdByMaterialIndex.set(0, 0);
  textureAnimIdByMaterialIndex.set(2, 1);
  textureAnimIdByMaterialIndex.set(4, 2);
  textureAnimIdByMaterialIndex.set(3, 1);
  const scrollingMaterial = scene.materials.find((material) => material.materialIndex === 1);
  if (scrollingMaterial) {
    const textureAnim = buildTextureAnimTranslation(scrollingMaterial.alphaKeys, scrollingMaterial.uvSpeed);
    if (!textureAnim) return { textureAnims, textureAnimIdByMaterialIndex };
    const textureAnimId = textureAnims.length;
    textureAnims.push(textureAnim);
    textureAnimIdByMaterialIndex.set(scrollingMaterial.materialIndex, textureAnimId);
  }
  return { textureAnims, textureAnimIdByMaterialIndex };
};
var buildMaterialLayer = (material, materialIndex, textureIdByJumpxIndex, textureAnimIdByMaterialIndex) => {
  const flags = material.rawFlags | material.saveFlags;
  const layer = {
    FilterMode: mapMaterialFilterMode(material, materialIndex),
    TextureID: textureIdByJumpxIndex.get(material.textureId) ?? -1,
    CoordId: 0,
    Shading: 145,
    Unshaded: true,
    TwoSided: true,
    NoDepthSet: true
  };
  const alphaTrack = buildScalarTrack(material.alphaKeys);
  if (alphaTrack) layer.Alpha = alphaTrack;
  else if (material.alpha !== void 0) layer.Alpha = Math.max(0, Math.min(1, material.alpha));
  const textureAnimId = textureAnimIdByMaterialIndex.get(material.materialIndex);
  if (textureAnimId !== void 0) {
    layer.TVertexAnimId = textureAnimId;
    layer.TextureAnimationId = textureAnimId;
  }
  if ((flags & RENDER_TWOSIDED) !== 0) layer.TwoSided = true;
  if ((flags & RENDER_UNSHADED) !== 0) layer.Unshaded = true;
  if ((flags & RENDER_UNFOGGED) !== 0) layer.Unfogged = true;
  if ((flags & RENDER_ALPHABLEND) !== 0 && (flags & RENDER_ZWRITEENABLE) === 0) layer.NoDepthSet = true;
  return layer;
};
var buildMaterials = (scene, textureIdByJumpxIndex, textureAnimIdByMaterialIndex, materialIdRemap, diagnostics) => {
  if (scene.materials.length === 0) {
    return [createDefaultMaterial()];
  }
  const materials = Array.from({ length: Math.max(1, materialIdRemap.size) }, () => createDefaultMaterial());
  for (const material of scene.materials) {
    const mappedMaterialIndex = materialIdRemap.get(material.materialIndex);
    if (mappedMaterialIndex === void 0) continue;
    const flags = material.rawFlags | material.saveFlags;
    if ((flags & RENDER_UVCLAMP) !== 0) {
      diagnostics.push(warning3("material", `JumpX material "${material.name || material.materialIndex}" uses UV clamp flags; first-pass War3 layer mapping keeps this as a diagnostic only.`));
    }
    materials[mappedMaterialIndex] = {
      Layers: [buildMaterialLayer(material, mappedMaterialIndex, textureIdByJumpxIndex, textureAnimIdByMaterialIndex)],
      SortPrimitivesFarZ: (flags & RENDER_SORTBYFARZ) !== 0 || void 0
    };
  }
  return materials;
};
var buildMaterialIdRemap = (scene) => {
  const remap = /* @__PURE__ */ new Map();
  for (const geometry of scene.geometries) {
    if (!remap.has(geometry.materialId)) {
      remap.set(geometry.materialId, remap.size);
    }
  }
  for (const material of scene.materials) {
    if (!remap.has(material.materialIndex)) {
      remap.set(material.materialIndex, remap.size);
    }
  }
  return remap;
};
var computeCombinedExtents = (scene) => {
  if (scene.geometries.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], radius: 0 };
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const geometry of scene.geometries) {
    const scaledMin = [
      geometry.objectPivot[0] + (geometry.minimumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
      geometry.objectPivot[1] + (geometry.minimumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
      geometry.objectPivot[2] + (geometry.minimumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2]
    ];
    const scaledMax = [
      geometry.objectPivot[0] + (geometry.maximumExtent[0] - geometry.objectPivot[0]) * geometry.objectScale[0],
      geometry.objectPivot[1] + (geometry.maximumExtent[1] - geometry.objectPivot[1]) * geometry.objectScale[1],
      geometry.objectPivot[2] + (geometry.maximumExtent[2] - geometry.objectPivot[2]) * geometry.objectScale[2]
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], scaledMin[axis]);
      max[axis] = Math.max(max[axis], scaledMax[axis]);
    }
    radius = Math.max(radius, geometry.boundsRadius);
  }
  const transformed = transformJumpxExtents(min, max);
  return { min: transformed.min, max: transformed.max, radius };
};
var buildGeosetAnims = (geosetCount) => Array.from({ length: geosetCount }, (_, geosetId) => ({
  GeosetId: geosetId,
  Alpha: 1,
  Flags: 2,
  UseColor: true,
  DropShadow: false,
  Color: new Float32Array(REFERENCE_GEOSET_ANIM_COLORS[geosetId] ?? [1, 1, 1])
}));
var buildJumpxStaticModelData = (path, scene) => {
  const diagnostics = scene.probe.warnings.map((message) => warning3("unsupported-feature", message));
  const extents = computeCombinedExtents(scene);
  const sourceModelDir = getPathDir(path);
  const textureLookup = buildTextureLookup(sourceModelDir, scene);
  const materialIdRemap = buildMaterialIdRemap(scene);
  const { textureAnims, textureAnimIdByMaterialIndex } = buildTextureAnims(scene);
  for (const material of scene.materials) {
    if (material.materialIndex >= 0 && material.materialIndex <= 4) {
      const wrapFlags = TEXTURE_WRAP_WIDTH | TEXTURE_WRAP_HEIGHT;
      const textureId = ensureTextureSlot(sourceModelDir, scene, textureLookup.textures, textureLookup.textureIdByJumpxIndex, material.textureId, wrapFlags);
      if (textureId >= 0) {
        textureLookup.textureIdByJumpxIndex.set(-1e3 - material.materialIndex, textureId);
      }
    }
  }
  const modelData = createBaseImportedModel(path, extents);
  modelData.Textures = textureLookup.textures;
  modelData.TextureAnims = textureAnims;
  modelData.Materials = buildMaterials(scene, textureLookup.textureIdByJumpxIndex, textureAnimIdByMaterialIndex, materialIdRemap, diagnostics);
  for (const material of scene.materials) {
    const textureId = textureLookup.textureIdByJumpxIndex.get(-1e3 - material.materialIndex);
    const mappedMaterialIndex = materialIdRemap.get(material.materialIndex);
    const layer = mappedMaterialIndex !== void 0 ? modelData.Materials[mappedMaterialIndex]?.Layers?.[0] : void 0;
    if (layer && textureId !== void 0) layer.TextureID = textureId;
  }
  const nodeMapping = buildJumpxNodeMapping(scene);
  modelData.Bones = nodeMapping.bones;
  modelData.Helpers = nodeMapping.helpers;
  modelData.Nodes = [...nodeMapping.nodes];
  modelData.PivotPoints = [...nodeMapping.pivotPoints];
  modelData.Model.NumBones = modelData.Bones.length;
  modelData.Model.NumHelpers = modelData.Helpers.length;
  const maxMaterialId = Math.max(0, modelData.Materials.length - 1);
  modelData.Geosets = scene.geometries.flatMap((geometry) => mapJumpxGeometryToGeosets(geometry, Math.min(Math.max(0, materialIdRemap.get(geometry.materialId) ?? geometry.materialId), maxMaterialId), nodeMapping, diagnostics));
  modelData.Model.NumGeosets = modelData.Geosets.length;
  modelData.GeosetAnims = buildGeosetAnims(modelData.Geosets.length);
  modelData.Model.NumGeosetAnims = modelData.GeosetAnims.length;
  const firstParticleObjectId = nodeMapping.nodes.length;
  modelData.ParticleEmitters2 = mapJumpxParticlesToParticleEmitter2(
    scene.particles,
    firstParticleObjectId,
    nodeMapping,
    textureLookup.textureIdByJumpxIndex,
    diagnostics
  );
  modelData.Nodes = [...modelData.Nodes, ...modelData.ParticleEmitters2];
  for (const emitter of modelData.ParticleEmitters2) {
    modelData.PivotPoints[emitter.ObjectId] = emitter.PivotPoint ?? [0, 0, 0];
  }
  modelData.Model.NumParticleEmitters2 = modelData.ParticleEmitters2.length;
  if (scene.attachments.length > 0) {
    diagnostics.push(warning3("unsupported-feature", "JumpX attachments are present in the DTO but are not mapped in the first TypeScript builder pass."));
  }
  if (scene.ribbons.length > 0) {
    diagnostics.push(warning3("unsupported-feature", "JumpX ribbons are present in the DTO but need a real ribbon fixture before first-pass mapping claims correctness."));
  }
  return { modelData, nodeMapping, diagnostics };
};

// src/renderer/src/application/model-import/JumpxImportUseCase.ts
var JumpxImportUseCase = class {
  constructor(gateway) {
    this.gateway = gateway;
  }
  async importFromPath(path, settings) {
    const scene = await this.gateway.importStaticScene(path, settings);
    const { modelData, nodeMapping, diagnostics } = buildJumpxStaticModelData(path, scene);
    const mappedAnimationKeyCount = applyJumpxAnimationTracks(scene, modelData, nodeMapping, {
      framesPerSecond: settings?.framesPerSecond
    });
    if (mappedAnimationKeyCount > 0) {
      diagnostics.push(warning3("animation", "JumpX bone animation keys were imported as War3 node TRS tracks and sequence intervals."));
    } else if (scene.bones.some((bone) => bone.positionKeys.length > 0 || bone.rotationKeys.length > 0 || bone.scaleKeys.length > 0)) {
      diagnostics.push(warning3("animation", "JumpX bone animation keys were present, but no keys mapped to imported War3 nodes."));
    }
    return {
      modelData,
      diagnostics,
      probe: scene.probe
    };
  }
};
var jumpxImportUseCase = new JumpxImportUseCase(jumpxImportGateway);
export {
  JumpxImportUseCase,
  jumpxImportUseCase
};
