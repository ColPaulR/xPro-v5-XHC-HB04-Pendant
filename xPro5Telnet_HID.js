const config = require('./xhcrc');
const {USB_Init, xhc_set_display } = require("./USB_devices");
const { Telnet_Init } = require('./myTelnet');

// initialize buttons to nothing pressed;
var prevButtons = [0, 0];

var CNC_state = {
  // Default to off axis, which ignores buttons and switches
  axis: 0,

  // Default to 2% / 0.001
  feedselect: 0,

  // CNC parameters
  WPos: [1, 2, 3],
  MPos: [],
  WCO: []
};

// Use Work Position or Machine Position
var WorkPos = 0;

const dev_USB_IN=USB_Init(config.HID_VID, config.HID_PID);

// Setup callback for data in
dev_USB_IN.on('data', function (d) {
  parseButtonData(d);
});

// Initialize Telnet
Telnet_Init(config.HOST, config.PORT, parseGrbl);

// Begin XHC out and Grbl parsing functions
function parseGrbl(bufResponse) {
  // data should begin with '<' and end with '>' 
  if (bufResponse[0] != '<') return false;
  if (bufResponse.slice(-1) != '>') return false;

  // Strip 1st and last char from input and split result by '|' 
  var myBuff = bufResponse.slice(1, -1).split('|');

  // State may have substates separated by ':'. E.g. `Hold:'[0,1], `Door'[0-3]
  var myStateTemp = myBuff.shift().split(':');

  while (myBuff.length > 0) {
    var strParts = myBuff.shift().split(':');

    switch (strParts[0]) {
      case 'MPos':
        CNC_state.MPos = strParts[1].split(',');
        // Calculate WPos from MPos 
        if (CNC_State.WCO.length == CNC_State.MPos.length) {
          for (var iLooper = 0; iLooper < CNC_State.WCO.length; iLooper++) {
            CNC_State.WPos[iLooper] = CNC_State.MPos[iLooper] - CNC_State.WCO[iLooper];
          }
        }
        break;
      case 'FS':
        var myArray = strParts[1].split(',');
        break;
      case 'WCO':
        CNC_State.WCO = strParts[1].split(',');
        break;
      case 'Ov':
        break;
      default:
        console.log('Data not handled: ' + strParts);
        break
    }
  }

  xhc_set_display();
}
exports.parseGrbl = parseGrbl;


// Begin XHC in functions here
// Data available parsing function
function parseButtonData(data) {
  // console.log("usb data:", data, " len:", data.length);

  // Process feed knob
  // if (feedselect!=data[4]){
  //     console.log("Feed selector change from %d to %d",feedselect,data[4]);
  // }
  CNC_state.feedselect = data[4];

  // Process axis selector switch
  if (CNC_state.axis != (data[5] - 0x11)) {
    // console.log("Axis selector change from %d to %d",axis,data[5]-11);
    // Save last axix
    CNC_state.axis = data[5] - 0x11;// If axis selector is "off", clear last buttons and ignore everything else
  }

  if (data[5] == 6) {
    // Axis selector is off
    // Clear all prior button presses
    prevButtons = [0, 0];

    // Don't process message any further
    return;
  }

  // Create newButtons slice of data buffer
  var newButtons = [data[2], data[3]];;

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
  prevButtons = newButtons;

  // Process jog dial
  if (data[6]) {
    // data[6] is a int8 need to determine sign
    var iJog = (data[6] > 127 ? data[6] - 256 : data[6]);
    //console.log("Jog dial is %i", iJog);
    const axischars = "XYZA";

    switch (data[4]) {
      case 13:
        // 13 = 0.001
        iJog *= 0.01;
        break;
      case 14:
        // 14 = 0.01         
        iJog *= 0.1;
        break;
      case 15:
        // 15 = 0.1
        iJog *= 1;
        break;
      case 16:
        // 16 = 1
        iJog *= 10;
        break;
      case 26:
        // 26 = 60%
        iJog *= 100;
        break;
      case 27:
        // 27 = 100%
        iJog *= 250;
        break;
      default:
        // 28 = Lead 
        return;
    }
    // Log or send string to telnet
    var myString = "$J=G21G91" + axischars[CNC_state.axis] + iJog.toPrecision(4) + "F2500\r\n";
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
        if (feedknob <= 16) {
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
        if (feedknob <= 16) {
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
        if (feedknob <= 16) {
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
        if (feedknob <= 16) {
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