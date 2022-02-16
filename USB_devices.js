const HID = require('node-hid');

// Create USB transfer buffer
var buff = new Buffer.alloc(21);

// Set fixed headers that never get changed
buff[0] = 0xFE;
buff[1] = 0xFD;
buff[2] = 0x04;

// Find XHC-HB04
function USB_Init(HID_VID, HID_PID) {
  const devices = HID.devices(HID_VID, HID_PID);
  if (devices.length === 0) {
    console.error("Could not find HID device with VID=0x%s and PID=0x%s", HID_VID.toString(16), HID_PID.toString(16));
    process.exit(1);
  }

  var dev_USB_OUT;
  var dev_USB_IN;

  if (devices.length > 1) {
    // Windows finds multiple HID devices for single XHC-HB04. 1 is input device and other is output device
    for (iLooper = 0; iLooper < devices.length; iLooper++) {
      // This works for 1 windows setup. Not sure if it is portable
      if (devices[iLooper].path.includes("col01")) {
        dev_USB_IN = new HID.HID(devices[iLooper].path);
      }

      if (devices[iLooper].path.includes("col02")) {
        dev_USB_OUT = new HID.HID(devices[iLooper].path);
      }
    }
  } else {
    // Single device found for both input and output. 1 call to new HID with duplicate reference
    dev_USB_IN = new HID.HID(devices[0].path);
    dev_USB_OUT = dev_USB_IN;
  }
  if (!dev_USB_IN) {
    console.log('USB Pendant not found');
    process.exit(1);
  }
  if (!dev_USB_OUT) {
    console.log('USB Pendant not found');
    process.exit(1);
  }

  dev_USB_IN.on('error', function (error) {
    console.log("on error", error);
  });
  dev_USB_IN.on('end', function () {
    console.log("on end");
  });

  console.log("found XHC-HB04 device");

  return dev_USB_IN;
}

function xhc_display_encode() {
  // Determine which axis to use
  // Assumes 3 axis so ignores axis rotary knob
  var DispAxis = [0, 0, 0];

  if (WorkPos) {
    DispAxis = CNC_State.WPos;
  } else {
    DispAxis = CNC_State.MPos;
  }

  // Stp, Cont, MPG or nothing [0:1]
  // MC 0; WC 1 [7]
  buff[3] = (0x80 & WorkPos);
  //buff[16]=6;

  // Update XYZ
  xhc_encode_float(DispAxis[0], 4);
  xhc_encode_float(DispAxis[1], 8);
  xhc_encode_float(DispAxis[2], 12);
}

function xhc_encode_float(v, buff_offset) {
  // Make integer part fraction into unsigned integer number
  var unsigned_v = Math.abs(v);

  // Separate into whole and fractional parts
  var int_part = Math.trunc(unsigned_v);
  // truncateDecimals(unsigned_v,0);
  var frac_part = Math.trunc((unsigned_v - int_part) * 10000);

  // Write to buffer
  xhc_uint16_to_buffer(int_part, buff_offset);
  xhc_uint16_to_buffer(frac_part, buff_offset + 2);

  // Set negative bit if required
  if (v < 0)
    buff[buff_offset + 3] = buff[buff_offset + 3] | 0x80;
}

function xhc_uint16_to_buffer(v, offset) {
  buff[offset + 1] = v >> 8;
  buff[offset] = v & 0xff;
}

function xhc_set_display() {
  // Format the display data into a buffer
  xhc_display_encode();

  // Packetize buffer
  var packets = Buffer.allocUnsafe(8);
  packets[0] = 6;

  // Send "6" and then 7 bytes of buffer
  var iIndex = 0;

  for (var iPacket = 0; iPacket < 3; iPacket++) {
    // Copy 7 bytes into packets[1:7]
    buff.copy(packets, 1, iIndex, iIndex + 7);
    // Move index to beginning of next 7 bytes
    iIndex += 7;

    // send packets
    dev_USB_OUT.sendFeatureReport(packets);
  }
}

module.exports = {
  USB_Init,
  xhc_set_display
};
