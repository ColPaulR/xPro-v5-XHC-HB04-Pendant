const net = require('net');

// create message stack
var bufTelnetIncoming = [];

// Setup telnet connection and start listening
function Telnet_Init(HOST, PORT, parseGrbl) {

    // Create new socket
    var myTelnet = new net.Socket();

    myTelnet.connect(PORT, HOST, function () {
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
            setTimeout(cbTimer, 500);
        }
    }
    // Add a 'data' event handler for the client socket
    // data is what the server sent to this socket
    myTelnet.on('data', function (data) {
        onTelnetData(data);
    });

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
                parseGrbl(bufTelnetIncoming.slice(0, iNLCR));
            }

            // Remove the string that was just parsed from the message queue
            bufTelnetIncoming = bufTelnetIncoming.slice(iNLCR + 2);
            iNLCR = bufTelnetIncoming.indexOf('\r\n');
        } while (iNLCR >= 0);
    }
}

module.exports = {Telnet_Init};
