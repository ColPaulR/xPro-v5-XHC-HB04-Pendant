const net = require('net');
var fs = require('fs');
const { config } = require('process');

// create file pointer
var logger;

// Log file stream or not
var doLog = false;

// create message stack
var bufTelnetIncoming = [];

// Define GRBL cnc state
var CNC_state = {
    state: "",
    FeedRate: 0,
    MaxRate: [],
    SpindleSpeed: 0,
    WPos: [],
    MPos: [],
    WCO: [],
    PinState: "",
    Pull_Off: 0,
    Inches: 0
};

// Machine or Work coordinates
var WorkPos;

// External function
var xhc_display;

// Create new socket
var myTelnet = new net.Socket();

// IP config
var HOST;
var PORT;

// Setup telnet connection and start listening
function Telnet_Init(config, xhc_set_display) {

    // Copy parameters to module variables
    WorkPos = config.WorkPos;
    xhc_display = xhc_set_display;
    doLog = config.LogStream;
    HOST = config.HOST;
    PORT = config.PORT;

    // Do connect routine
    myConnect();

    // Set timeout
    myTelnet.setTimeout(500);
    myTelnet.setKeepAlive(true, 1000);

    // reconnect on timeout
    myTelnet.on('timeout', function () {
        myConnect();
    });

    // Add a 'close' event handler for the myTelnet socket
    myTelnet.on('close', function () {
        console.log('Connection closed');
        //setTimeout(myConnect, 500);
    });

    // Add a 'data' event handler for the client socket
    // data is what the server sent to this socket
    myTelnet.on('data', function (data) {
        onTelnetData(data);
    });

    myTelnet.on('error', function (err) {
        switch (err.code) {
            case 'ECONNRESET':
                console.log("Telnet connection reset.");
            case 'ETIMEDOUT':
                console.log("Telnet connection timed out.");
                break;
            default:
                console.log("err: " + err);
                process.exit(1);
        }
        myConnect();
        // setTimeout(myConnect, 500);
    });

    // Pass reference to open socket back to caller
    return myTelnet;
}

function myConnect() {
    // Return immedia
    if (!myTelnet.connecting) {
        myTelnet.removeAllListeners();
        myTelnet.connect(PORT, HOST, function () {
            // Log that we are connected to telnet
            console.log('CONNECTED TO: ' + HOST + ':' + PORT);

            // Start timer 
            cbTimer();
        });
    }
}



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

// Telnet functions
function onTelnetData(data) {
    // send data to console log
    // console.log('DATA: ' + data);

    // Log data to file if required
    if (doLog) {
        // Create file on first call
        if (!logger) logger = fs.createWriteStream('./GRBL_log.txt');

        // Write new data
        logger.write(data);
    }

    // Add new data to end of incoming stack
    bufTelnetIncoming += data;

    // Check to see a new line LF + CR in the message queue
    var iNLCR = bufTelnetIncoming.indexOf('\r\n');
    do {
        // Found whole line so parse
        if (iNLCR) {
            // Non-zero length before \r\n
            parseGrbl(bufTelnetIncoming.slice(0, iNLCR));
        }

        // Remove the string that was just parsed from the message queue
        bufTelnetIncoming = bufTelnetIncoming.slice(iNLCR + 2);
        iNLCR = bufTelnetIncoming.indexOf('\r\n');
    } while (iNLCR >= 0);
}

// Begin XHC out and Grbl parsing functions
function parseGrbl(bufResponse) {
    // echo line
    // console.log(bufResponse);

    // check for settings
    if (bufResponse[0] == '$') {
        var myArray = bufResponse.slice(1).split("=");

        // Only allow for setting number and value
        if (myArray.length != 2) return false;

        // Store value in CNC State if needed
        switch (myArray[0]) {
            case '13':
                // Set for inches; zero for mm
                CNC_state.Inches = parseInt(myArray[1]);

                // For current code, only allow mm mode
                if (CNC_state.Inches) {
                    console.error("code currently only supports mm mode ($13=0");
                    process.exit(1);
                }
                break;
            case '27':
                // Homing switch pull-off distance, millimeters as string
                CNC_state.Pull_Off = myArray[1];
                break;
            case '110':
            case '111':
            case '112':
            case '113':
            case '114':
            case '115':
                // Store maximum rate as string
                CNC_state.MaxRate[(parseInt(myArray[0]) - 110)] = myArray[1];
                break;
            default:
        }

        // return success
        return true;
    }

    // status data should begin with '<' and end with '>' 
    // Assume no further syntax remains other than <State|.....> so return failed if not status message
    if (bufResponse[0] != '<') return false;
    if (bufResponse.slice(-1) != '>') return false;

    // Strip 1st and last char from input and split result by '|' 
    var myBuff = bufResponse.slice(1, -1).split('|');

    // State may have substates separated by ':'. E.g. `Hold:'[0,1], `Door'[0-3]
    var myStateTemp = myBuff.shift().split(':');

    // Compare new state to last state
    if (myStateTemp[0] != CNC_state.state) {
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
            case 'F':
                console.log(bufResponse);
                CNC_state.FeedRate = strParts[1];
                break;
            case 'FS':
                // console.log(bufResponse);
                var myArray = strParts[1].split(',');
                if (myArray.length == 2) {
                    CNC_state.FeedRate = myArray[0];
                    CNC_state.SpindleSpeed = myArray[1];
                }
                break;
            case 'WCO':
                CNC_state.WCO = strParts[1].split(',');
                break;
            case 'Ov':
                // Ignore feed, rapid, and spindle overrides
                // console.log(bufResponse);
                break;
            case 'Pn':
                CNC_state.PinState = strParts[1];
                // console.log(strParts);
                break;
            case 'A':
                /* ignore accessories 
                    S indicates spindle is enabled in the CW direction. This does not appear with C.
                    C indicates spindle is enabled in the CCW direction. This does not appear with S.
                    F indicates flood coolant is enabled.
                    M indicates mist coolant is enabled.S - spindle
                */
                break;
            default:
                console.log('Data not handled: ' + strParts);
                console.log('Data not handled: ' + bufResponse);

                break
        }
    }

    xhc_display();

    // Return success
    return true;
}


module.exports = { Telnet_Init, CNC_state };
