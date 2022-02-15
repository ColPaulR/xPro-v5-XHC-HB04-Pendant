const net = require('net');
const HID = require('node-hid');
const scanf=require('sscanf');
const config=require('./xhcrc');

// initialize buttons to nothing pressed;
var prevButtons=[0,0];

// Default to off axis, which ignores buttons and switches
var axis=0;

// Default to 2% / 0.001
var feedselect=0;

// CNC parameters
var WPos=[1,2,3];
var MPos=[];
var WCO=[];
var WorkPos = 0;

// Create USB transfer buffer
var buff=new Buffer.alloc(21);
    
// Set fixed headers that never get changed
buff[0]=0xFE;
buff[1]=0xFD;
buff[2]=0x04;

// telnet host param
var HOST = config.HOST;
var PORT = config.PORT;
  
// create message stack
var bufTelnetIncoming=[];

// Number of milliseconds to schedule between telnet queries
const tmrWait = 500;

// Start USB setup here
// Find XHC-HB04
const devices = HID.devices(config.HID_VID,config.HID_PID);

if (devices.length === 0) {
  console.error("Could not find HID device with VID=0x%s and PID=0x%s",config.HID_VID.toString(16), config.HID_PID.toString(16));
  process.exit(1);
}

var dev_USB_OUT;
var dev_USB_IN;

if (devices.length>1) {
  // Windows finds multiple HID devices for single XHC-HB04. 1 is input device and other is output device
  for (iLooper=0; iLooper<devices.length; iLooper++) {
    // This works for 1 windows setup. Not sure if it is portable
    if (devices[iLooper].path.includes("col01")){
      dev_USB_IN = new HID.HID(devices[iLooper].path);
    }
  
    if (devices[iLooper].path.includes("col02")){
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

console.log("found XHC-HB04 device");

// Set up callbacks
dev_USB_IN.on('data', function (d) {
    parseButtonData(d);
});

dev_USB_IN.on('error', function (error) {
    console.log("on error", error);
});
    
dev_USB_IN.on('end', function () {
    console.log("on end");
});
// Done with USB Device setup 

// Setup telnet connection and start listening
var myTelnet = new net.Socket();
myTelnet.connect(PORT, HOST, function() {
  // Log that we are connected to telnet
  console.log('CONNECTED TO: ' + HOST + ':' + PORT);
  
  // Start timer 
  cbTimer();
});

// Add a 'data' event handler for the client socket
// data is what the server sent to this socket
myTelnet.on('data', function (data) {
  onTelnetData(data);
});

// Add a 'close' event handler for the myTelnet socket
myTelnet.on('close', function() {
  console.log('Connection closed');
  myTelnet.destroy();
});

// Timer functions
function cbTimer() {
  // Check to see if telnet is still connected
  if (!myTelnet.destroyed) {
    // query Grbl status
    myTelnet.write('?');
  
    // Restart timer
    setTimeout(cbTimer, tmrWait);
  }
}

// Telnet functions
function onTelnetData(data) {
  // send data to console log
  // console.log('DATA: ' + data);

  // Add new data to end of incoming stack
  bufTelnetIncoming += data;

  // Check to see a new line LF + CR in the message queue
  var iNLCR=bufTelnetIncoming.indexOf('\r\n');
  do {
    // Found whole line so parse
    if (iNLCR) {
      // Non-zero length before \r\n
      parseGrbl(bufTelnetIncoming.slice(0,iNLCR));
    }

    // Remove the string that was just parsed from the message queue
    bufTelnetIncoming = bufTelnetIncoming.slice(iNLCR+2);
    iNLCR=bufTelnetIncoming.indexOf('\r\n');
  } while (iNLCR>=0);
}
// End Telnet functions

// Begin XHC out and Grbl parsing functions
function parseGrbl(bufResponse) {
  // data should begin with '<' and end with '>' 
  if (bufResponse[0] !='<') return false;
  if (bufResponse.slice(-1) !='>') return false;

  // Strip 1st and last char from input and split result by '|' 
  var myBuff = bufResponse.slice(1,-1).split('|');

  // State may have substates separated by ':'. E.g. `Hold:'[0,1], `Door'[0-3]
  var myStateTemp = myBuff.shift().split(':');

  while (myBuff.length>0){
    var strParts = myBuff.shift().split(':');

    switch(strParts[0]) {
      case 'MPos':
          MPos = strParts[1].split(',');
          // Calculate WPos from MPos 
          if (WCO.length==MPos.length) {
            for (var iLooper = 0; iLooper<WCO.length; iLooper++){
              WPos[iLooper] = MPos[iLooper] - WCO[iLooper];
            }
          }
          break;
      case 'FS':
          var myArray=strParts[1].split(',');
          break;
      case 'WCO':
          WCO=strParts[1].split(',');
          break;
      case 'Ov':
          break;
      default:
          console.log('Data not handled: '+ strParts);
          break
    }      
  }

  xhc_set_display();
}

function xhc_display_encode() {
  // Determine which axis to use
  // Assumes 3 axis so ignores axis rotary knob
  var DispAxis=[0,0,0];

  if (WorkPos) {
      DispAxis = WPos;
   } else {
       DispAxis = MPos;
   }

  // Stp, Cont, MPG or nothing [0:1]
  // MC 0; WC 1 [7]
  buff[3]=(0x80 & WorkPos);
  //buff[16]=6;

  // Update XYZ
  xhc_encode_float(DispAxis[0],4);
  xhc_encode_float(DispAxis[1],8);	
  xhc_encode_float(DispAxis[2],12);
}

function xhc_encode_float(v,buff_offset) {
// Make integer part fraction into unsigned integer number
var unsigned_v=Math.abs(v);

// Separate into whole and fractional parts
var int_part=Math.trunc(unsigned_v);
// truncateDecimals(unsigned_v,0);
var frac_part=Math.trunc((unsigned_v - int_part)*10000);

// Write to buffer
xhc_uint16_to_buffer(int_part, buff_offset);
xhc_uint16_to_buffer(frac_part, buff_offset+2);

// Set negative bit if required
if (v<0) 
  buff[buff_offset+3]=buff[buff_offset+3] | 0x80;
}

function xhc_uint16_to_buffer(v, offset){
buff[offset+1]=v>>8;
buff[offset]=v & 0xff;
}

function xhc_set_display(){
  // Format the display data into a buffer
  xhc_display_encode();

  // Packetize buffer
  var packets=Buffer.allocUnsafe(8);
  packets[0]=6;

  // Send "6" and then 7 bytes of buffer
  var iIndex=0;

  for (var iPacket=0; iPacket<3; iPacket++) {
    // Copy 7 bytes into packets[1:7]
    buff.copy(packets,1,iIndex,iIndex+7);
    // Move index to beginning of next 7 bytes
    iIndex +=7;

    // send packets
    dev_USB_OUT.sendFeatureReport(packets);
  }
}
// End XHC out and Grbl parsing functions

// Begin XHC in functions here
// Data available parsing function
function parseButtonData(data){
  // console.log("usb data:", data, " len:", data.length);

  // Process feed knob
  // if (feedselect!=data[4]){
  //     console.log("Feed selector change from %d to %d",feedselect,data[4]);
  // }
  feedselect=data[4];

  // Process axis selector switch
  if (axis!=(data[5]-0x11)){
      // console.log("Axis selector change from %d to %d",axis,data[5]-11);
      // Save last axix
      axis=data[5]-0x11;// If axis selector is "off", clear last buttons and ignore everything else
  }      
  
  if (data[5]==6){
    // Axis selector is off
      // Clear all prior button presses
      prevButtons=[0,0];
        
      // Don't process message any further
      return;   
      }

  // Create newButtons slice of data buffer
  var newButtons=[data[2], data[3]];;

  // At least one button was pressed
  // Check to see if button 1 was recorded previously
  if ((newButtons[0]) && (!prevButtons.includes(newButtons[0]))) {
      // Button1 was not recorded previous
      // console.log("Button %d is down",newButtons[0]);

      // Process button press
      doButton(newButtons, 0, data[4]);
  }

  // Check to see if button 2 was recorded previously
  if ((newButtons[1]) && (!prevButtons.includes(newButtons[1]))) {
      // Button2 was not recorded previous
      // console.log("Button %d is down",newButtons[1]);
      
      // Process button press
      doButton(newButtons, 1, data[4]);
  }

  // Check to see if previous button 1 is release
  // if ((prevButtons[0]) && (!newButtons.includes(prevButtons[0]))) {
      // Previous Button 1 is released
      // console.log("Button %d is up",prevButtons[0]);
  // }

  // Check to see if previous button 2 is release
  // if ((prevButtons[1]) && (!newButtons.includes(prevButtons[1]))) {
      // Previous Button 2 is released
      // console.log("Button %d is up",prevButtons[1]);
  // }

  // Record new buttons
  prevButtons=newButtons;  

  // Process jog dial
  if (data[6]) {
      // data[6] is a int8 need to determine sign
      var iJog = (data[6]>127 ? data[6]-256:data[6]);
      //console.log("Jog dial is %i", iJog);
      const axischars="XYZA";
   
      switch (data[4]) {
        case 13:
          // 13 = 0.001
          iJog*=0.01;
            break;
        case 14:
          // 14 = 0.01         
          iJog*=0.1;
          break;
        case 15:
          // 15 = 0.1
          iJog*=1;
          break;
        case 16:
          // 16 = 1
          iJog*=10;
          break;
        case 26:
          // 26 = 60%
          iJog*=100;
          break;
        case 27:
          // 27 = 100%
          iJog*=250;
          break;
        default:
          // 28 = Lead 
          return;
      }
      // Log or send string to telnet
      var myString="$J=G21G91"+axischars[axis]+iJog.toPrecision(4)+"F2500\r\n";
      console.log(myString);
      myTelnet.write(myString);
  }
}

function doButton(newButtons, iButton, feedknob) {
  // console.log("Button %d is down",newButtons[iButton]);

  switch (newButtons[iButton]) {
    case 1:
      // Reset button
      myTelnet.write("$X\r\n");
      break;
    case 2:
      // Stop button
      // console.log("$X\r\n");
      break;
      case 2:
        // Stop button
        // console.log("$X\r\n");
        break;    
      case 3:
        // Start/pause button
        // console.log("$X\r\n");
        break;
      case 4:
        // Feed+ button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          if (feedknob<=16) {
            console.log("0x93");
          } else {
            console.log("0x91");
          }
        } else {
          // Do Macro 1
          console.log("Macro 1");
        }
        break;
      case 5:
        // Feed- button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          if (feedknob<=16) {
            console.log("0x94");
          } else {
            console.log("0x92");
          }
        } else {
          // Do Macro 2
          console.log("Macro 2");
        }
        break;
      case 6:
        // Spindle+ button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          if (feedknob<=16) {
            console.log("0x9C");
          } else {
            console.log("0x9A");
          }
        } else {
          // Do Macro 3
        }
        break;
      case 7:
        // Spindle- button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          if (feedknob<=16) {
            console.log("0x9D");
          } else {
            console.log("0x9B");
          }
        } else {
          // Do Macro 5
        }
        break;
      case 8:
        // M-Home button
        if (newButtons.includes(12)) {
          myTelnet.write("$H\r\n");
        } else {
          // Do Macro 5
        }
        break;
      case 9:
        // Safe-Z button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          // Safe Z
        } else {
          // Do Macro 6
        }
        break;
      case 10:
        // W-Home button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          console.log("G10 P1 L20 X0 Y0 Z0\r\n");
        } else {
          // Do Macro 7
        }
        break;
      case 11:
        // Spindle On/Off button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          console.log("Spindle Toggle\r\n");
        } else {
          // Do Macro 8
        }
        break;
      case 13:
        // Probe-Z button
        if (newButtons.includes(12)) {
          // Function key is pressed.
          console.log("Probe Z\r\n");
        } else {
          // Do Macro 9
          console.log("Macro9");
        }
        break;      
      case 16:
          // Do Macro 10
          console.log("Macro10");
          break;      
      default:
  }
}
// End XHC in functions here