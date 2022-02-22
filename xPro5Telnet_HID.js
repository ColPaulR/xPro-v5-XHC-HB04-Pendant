const config = require('./xhcrc');
const {USB_Init, xhc_set_display } = require("./USB_devices");
const { Telnet_Init, CNC_state } = require('./myTelnet');

// Initialize Telnet
const myTelnet = Telnet_Init(config,xhc_set_display);

// Get all settings
myTelnet.write("$$\n");

// Initialize USB
USB_Init(config, CNC_state, myTelnet);