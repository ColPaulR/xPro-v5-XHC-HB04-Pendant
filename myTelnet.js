const net = require('net');

// create message stack
var bufTelnetIncoming = [];

// Define GRBL cnc state
var CNC_state = {
    state: "",
    axis: 0,
    feedselect: 0,
    WPos: [],
    MPos: [],
    WCO: [],
    PinState: ""
};

// Machine or Work coordinates
var WorkPos;

// External function
var xhc_display;

// Setup telnet connection and start listening
function Telnet_Init(config, xhc_set_display) {

    // Copy parameters to module variables
    WorkPos = config.WorkPos;
    xhc_display = xhc_set_display;

    // Create new socket
    var myTelnet = new net.Socket();

    myTelnet.connect(config.PORT, config.HOST, function () {
        // Log that we are connected to telnet
        console.log('CONNECTED TO: ' + config.HOST + ':' + config.PORT);

        // Start timer 
        cbTimer();
    });

    // Add a 'close' event handler for the myTelnet socket
    myTelnet.on('close', function () {
        console.log('Connection closed');
        myTelnet.destroy();
    });

    // Timer functions
    function cbTimer() {
        // Check to see if telnet is still connected
        if (!myTelnet.destroyed) {
            // query Grbl status
            myTelnet.write('?');

            // Restart timer to trigger after 500ms
            setTimeout(cbTimer, 250);
        }
    }
    // Add a 'data' event handler for the client socket
    // data is what the server sent to this socket
    myTelnet.on('data', function (data) {
        onTelnetData(data);
    });

    // Pass reference to open socket back to caller
    return myTelnet;
}

// Telnet functions
function onTelnetData(data) {
    // send data to console log
    // console.log('DATA: ' + data);

    // Add new data to end of incoming stack
    bufTelnetIncoming += data;

    // Check to see a new line LF + CR in the message queue
    var iNLCR = bufTelnetIncoming.indexOf('\r\n');
    do {
        // Found whole line so parse
        if (iNLCR) {
            // Non-zero length before \r\n
            parseGrbl(bufTelnetIncoming.slice(0, iNLCR), WorkPos);
        }

        // Remove the string that was just parsed from the message queue
        bufTelnetIncoming = bufTelnetIncoming.slice(iNLCR + 2);
        iNLCR = bufTelnetIncoming.indexOf('\r\n');
    } while (iNLCR >= 0);
}

// Begin XHC out and Grbl parsing functions
function parseGrbl(bufResponse) {
    // data should begin with '<' and end with '>' 
    if (bufResponse[0] != '<') return false;
    if (bufResponse.slice(-1) != '>') return false;

    // Strip 1st and last char from input and split result by '|' 
    var myBuff = bufResponse.slice(1, -1).split('|');

    // State may have substates separated by ':'. E.g. `Hold:'[0,1], `Door'[0-3]
    var myStateTemp = myBuff.shift().split(':');

    // Compare new state to last state
    if (myStateTemp != CNC_state.state) {
        console.log("State changed from %s to %s", CNC_state.state, myStateTemp[0]);
        CNC_state.state = myStateTemp[0];
    }

    // Check for pin states
    if (!bufResponse.includes("Pn:")) {
        CNC_state.PinState = "";
    } else {
        // console.log(bufResponse);
    }

    while (myBuff.length > 0) {
        var strParts = myBuff.shift().split(':');

        switch (strParts[0]) {
            case 'MPos':
                CNC_state.MPos = strParts[1].split(',');
                // Calculate WPos from MPos 
                if (CNC_state.WCO.length == CNC_state.MPos.length) {
                    for (var iLooper = 0; iLooper < CNC_state.WCO.length; iLooper++) {
                        CNC_state.WPos[iLooper] = CNC_state.MPos[iLooper] - CNC_state.WCO[iLooper];
                    }
                }
                break;
            case 'FS':
                var myArray = strParts[1].split(',');
                break;
            case 'WCO':
                CNC_state.WCO = strParts[1].split(',');
                break;
            case 'Ov':
                break;
            case 'Pn':
                CNC_state.PinState = strParts[1];
                // console.log(strParts);
                break;
            default:
                console.log('Data not handled: ' + strParts);
                break
        }
    }

    xhc_display();
}


module.exports = { Telnet_Init, CNC_state };
